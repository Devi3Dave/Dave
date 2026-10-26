// Proof that a chart is current: the device clock against the data server's
// clock, the last candle against the candle that should be forming now (taking
// exchange hours and holidays into account), the age of the last live tick and
// a REST cross-check of the last candle. Everything here is pure, so it can be
// tested with fixed times; the app feeds in its measurements.

import { findAsset } from "./assets";
import { getExchange, holidayName, marketStatus, tradingDays, wallTime, zoneOffset, zonedToUtc, type Exchange } from "./exchanges";
import { venueName } from "./venues";
import { intervalSeconds, bucketTime, isCalendarInterval, isCryptoSymbol, type MarketData } from "./marketData";
import { parseSpread, spreadSymbols } from "./spread";

export type Level = "ok" | "warn" | "bad" | "info";

// ---------------- Clock ----------------

/** One round trip to a time server (all ms; sentAt/receivedAt on the device clock). */
export interface ClockSample {
  sentAt: number;
  serverTime: number;
  receivedAt: number;
}

export interface ClockSync {
  /** Server time minus device time: positive when the device clock is behind. */
  offsetMs: number;
  /** Round trip of the sample used; the offset is exact to ± half of it. */
  rttMs: number;
  source: string;
  /** Device time of the measurement. */
  measuredAt: number;
  samples: number;
}

/** NTP-style estimate from the sample with the shortest round trip (least network noise). */
export function clockFromSamples(samples: ClockSample[], source: string): ClockSync | null {
  const valid = samples.filter((s) => s.receivedAt >= s.sentAt && Number.isFinite(s.serverTime));
  if (valid.length === 0) return null;
  const best = valid.reduce((a, b) => (b.receivedAt - b.sentAt < a.receivedAt - a.sentAt ? b : a));
  return {
    offsetMs: Math.round(best.serverTime - (best.sentAt + best.receivedAt) / 2),
    rttMs: best.receivedAt - best.sentAt,
    source,
    measuredAt: best.receivedAt,
    samples: valid.length,
  };
}

// ---------------- Reference market ----------------

export type MarketRef =
  | { kind: "24/7"; label: string }
  /** Forex and futures: Sunday 18:00 to Friday 17:00 New York time. */
  | { kind: "24/5"; label: string }
  | { kind: "exchange"; label: string; exchange: Exchange };

const NASDAQ = new Set(["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "NFLX", "AMD", "INTC", "PLTR", "COIN", "MSTR", "HOOD"]);
const INDEX_EXCHANGE: Record<string, string> = { "^GSPC": "nyse", "^DJI": "nyse", "^VIX": "nyse", "^NDX": "nasdaq", "^GDAXI": "xetra", "^STOXX50E": "xetra", "^FTSE": "lse", "^N225": "tse" };
const SUFFIX_EXCHANGE: [string, string][] = [
  [".DE", "xetra"],
  [".F", "fra"],
  [".L", "lse"],
  [".PA", "euronext"],
  [".SW", "six"],
  [".T", "tse"],
  [".HK", "hkex"],
  [".SS", "sse"],
  [".SZ", "szse"],
  [".KS", "krx"],
  [".SI", "sgx"],
  [".NS", "nse"],
  [".AX", "asx"],
  [".TO", "tsx"],
];

function exchangeRef(id: string): MarketRef {
  const exchange = getExchange(id)!;
  return { kind: "exchange", label: exchange.short, exchange };
}

/** Where the underlying of a symbol trades: around the clock, 24/5, or on an exchange with its own hours. */
export function referenceMarket(symbol: string, source: MarketData["source"] | null): MarketRef {
  // A spread trades when its first symbol trades.
  const spread = parseSpread(symbol);
  if (spread) {
    const first = spreadSymbols(spread)[0];
    return referenceMarket(first, isCryptoSymbol(first) ? "binance" : null);
  }
  const asset = findAsset(symbol);
  if (source === "binance" || source === "venue" || asset?.category === "Krypto" || (!asset && source === "binance_futures")) return { kind: "24/7", label: "Krypto (rund um die Uhr)" };
  const id = asset?.id ?? symbol;
  if (INDEX_EXCHANGE[id]) return exchangeRef(INDEX_EXCHANGE[id]);
  if (id.endsWith("=X") || id === "DX-Y.NYB") return { kind: "24/5", label: "Devisenmarkt (24/5)" };
  if (id.endsWith("=F")) return { kind: "24/5", label: "Terminbörse CME (fast 24/5)" };
  for (const [suffix, ex] of SUFFIX_EXCHANGE) if (id.endsWith(suffix)) return exchangeRef(ex);
  if (asset?.category === "Aktien" || asset?.category === "Indizes & ETFs" || /^[A-Z.]{1,6}$/.test(id)) return exchangeRef(NASDAQ.has(id) || id === "^NDX" ? "nasdaq" : "nyse");
  return { kind: "24/7", label: "rund um die Uhr" };
}

const NY = "America/New_York";

/** Is a 24/5 market open, and when did it last trade (unix seconds)? */
function fiveDayStatus(now: number): { open: boolean; lastTrade: number } {
  const w = wallTime(now * 1000, NY);
  const dow = new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
  const minutes = w.hh * 60 + w.mm;
  const closed = dow === 6 || (dow === 5 && minutes >= 17 * 60) || (dow === 0 && minutes < 18 * 60);
  if (!closed) return { open: true, lastTrade: now };
  // Back to Friday 17:00 New York.
  const back = dow === 5 ? 0 : dow === 6 ? 1 : 2;
  const fri = new Date(Date.UTC(w.y, w.m - 1, w.d - back));
  return { open: false, lastTrade: zonedToUtc(fri.getUTCFullYear(), fri.getUTCMonth() + 1, fri.getUTCDate(), 17, 0, NY) / 1000 - 1 };
}

export interface MarketNow {
  open: boolean;
  /** Latest moment (unix seconds, ≤ now) the market traded: now while open. */
  lastTrade: number;
  /** Holiday at the exchange today, if any. */
  holiday?: string;
  /** Next open (while closed) or close (while open), unix seconds. */
  next?: number;
}

export function marketNow(ref: MarketRef, now: number): MarketNow {
  if (ref.kind === "24/7") return { open: true, lastTrade: now };
  if (ref.kind === "24/5") return fiveDayStatus(now);
  const ex = ref.exchange;
  const status = marketStatus(ex, now);
  const w = wallTime(now * 1000, ex.timeZone);
  const today = `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
  const holiday = holidayName(ex, today);
  if (status.phase === "open") return { open: true, lastTrade: now, next: status.next, holiday };
  // Closed or lunch: the last part of a session that has ended.
  const parts = tradingDays(ex, now - 14 * 86400, now).flatMap((d) => d.parts).filter((p) => p.start <= now);
  const last = parts[parts.length - 1];
  return { open: false, lastTrade: last ? Math.min(now, last.end) - 1 : now, next: status.next, holiday };
}

// ---------------- Candles ----------------

/** Start of the candle that contains `time`; weeks start on Monday 00:00 UTC like Binance's. */
export function candleStart(interval: string, time: number): number {
  if (interval === "1w" || interval === "all") {
    const monday = 4 * 86400; // the Unix epoch was a Thursday
    return Math.floor((time - monday) / 604800) * 604800 + monday;
  }
  return bucketTime(interval, time);
}

/** Whole candles between two candle starts (calendar candles counted by month). */
export function candlesBetween(interval: string, from: number, to: number): number {
  if (to <= from) return 0;
  if (isCalendarInterval(interval)) {
    const a = new Date(from * 1000);
    const b = new Date(to * 1000);
    const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
    const per = interval === "1M" ? 1 : interval === "3M" ? 3 : 12;
    return Math.max(1, Math.round(months / per));
  }
  return Math.max(1, Math.round((to - from) / intervalSeconds(interval)));
}

// ---------------- Assessment ----------------

export interface LiveTick {
  /** Binance event time (server clock, ms). */
  eventTime: number;
  /** Device time when it arrived (ms). */
  receivedAt: number;
}

export interface RestCheck {
  /** Device time of the check (ms). */
  at: number;
  restTime: number;
  restClose: number;
  chartTime: number | null;
  chartClose: number | null;
}

export interface FreshnessInput {
  symbol: string;
  interval: string;
  source: MarketData["source"] | null;
  lastBarTime: number | null;
  /** Device clock (ms). */
  deviceNow: number;
  clock: ClockSync | null;
  /** True after the clock check failed (offline, blocked). */
  clockFailed?: boolean;
  tick: LiveTick | null;
  /** Device time the data arrived (ms). */
  loadedAt: number | null;
  rest: RestCheck | null;
  replay: boolean;
}

export interface Check {
  id: "clock" | "source" | "candle" | "tick" | "rest" | "market";
  label: string;
  level: Level;
  detail: string;
}

export interface Freshness {
  level: Exclude<Level, "info">;
  /** Short badge text. */
  summary: string;
  /** Best estimate of the true time (device clock corrected by the measured offset), ms. */
  trueNow: number;
  market: MarketRef;
  marketNow: MarketNow;
  checks: Check[];
}

const RANK: Record<Level, number> = { info: 0, ok: 1, warn: 2, bad: 3 };

/** "0,32 s" / "120 ms" / "4 min 10 s". */
export function formatSpan(ms: number): string {
  const a = Math.abs(ms);
  if (a < 1000) return `${Math.round(a)} ms`;
  if (a < 60_000) return `${(a / 1000).toFixed(a < 10_000 ? 2 : 1).replace(".", ",")} s`;
  const s = Math.round(a / 1000);
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  const h = Math.floor(s / 3600);
  return h < 48 ? `${h} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(h / 24)} Tage`;
}

function formatPriceDe(v: number): string {
  return v.toLocaleString("de-DE", { maximumFractionDigits: Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 4 : 8 });
}

const SOURCE_LABEL: Record<MarketData["source"], string> = {
  binance: "Binance Spot",
  binance_futures: "Binance USDⓈ-M Perpetual",
  yahoo: "Yahoo Finance",
  twelvedata: "Twelve Data (Börsenkurs)",
  spread: "Spread (aus zwei Symbolen berechnet)",
  venue: "Krypto-Börse",
  demo: "Demo-Daten",
};

/** The source in words; another crypto exchange is named from the symbol (COINBASE:BTCUSD → Coinbase). */
function sourceLabel(source: MarketData["source"], symbol: string): string {
  return source === "venue" ? `${venueName(symbol.split(":")[0])} (${SOURCE_LABEL.venue}, direkt)` : SOURCE_LABEL[source];
}

export function assessFreshness(input: FreshnessInput, formatTime: (sec: number) => string): Freshness {
  const { interval, source, lastBarTime, clock, tick, replay } = input;
  const trueNow = input.deviceNow + (clock?.offsetMs ?? 0);
  const now = Math.floor(trueNow / 1000);
  const market = referenceMarket(input.symbol, source);
  const mNow = marketNow(market, now);
  const checks: Check[] = [];
  const exchangeFeed = source === "twelvedata";
  const live = source === "binance" || source === "binance_futures" || source === "venue" || exchangeFeed;

  // Device clock against the server clock.
  if (clock) {
    const off = -clock.offsetMs; // device minus server
    const dir = Math.abs(off) < 50 ? "stimmt" : off > 0 ? "geht vor" : "geht nach";
    const level: Level = Math.abs(off) <= 1000 ? "ok" : Math.abs(off) <= 5000 ? "warn" : "bad";
    const ago = Math.round((input.deviceNow - clock.measuredAt) / 1000);
    checks.push({
      id: "clock",
      label: "Geräteuhr",
      level,
      detail:
        `${dir === "stimmt" ? "stimmt" : `${dir}: ${formatSpan(off)}`} (± ${formatSpan(clock.rttMs / 2)}) gegenüber ${clock.source}` +
        `, gemessen vor ${ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`}` +
        (level === "ok" ? "" : ". Alle Prüfungen rechnen mit der korrigierten Serverzeit"),
    });
  } else {
    checks.push({ id: "clock", label: "Geräteuhr", level: "warn", detail: input.clockFailed ? "Serverzeit nicht erreichbar, geprüft wird mit der Geräteuhr" : "wird gemessen …" });
  }

  // Source.
  if (!source) {
    checks.push({ id: "source", label: "Datenquelle", level: "warn", detail: "lädt …" });
  } else if (source === "demo") {
    checks.push({ id: "source", label: "Datenquelle", level: "bad", detail: "Demo-Daten (Zufallskurs): kein echter Kurs, Aktualität nicht nachweisbar" });
  } else {
    const how = live ? "REST + Live-WebSocket" : "REST, kein Live-Stream (Börsenkurse oft 15 min verzögert)";
    checks.push({ id: "source", label: "Datenquelle", level: live ? "ok" : "info", detail: `${sourceLabel(source, input.symbol)} · ${how}` });
  }

  // Last candle against the candle that should be forming now.
  if (replay) {
    checks.push({ id: "candle", label: "Letzte Kerze", level: "info", detail: "Replay läuft: der Chart zeigt absichtlich die Vergangenheit" });
  } else if (lastBarTime !== null && source && source !== "demo") {
    const step = intervalSeconds(interval);
    // Daily and longer candles of an exchange belong to its local date, whatever UTC hour the source stamps them with.
    const local = market.kind === "exchange" && step >= 86400 ? (t: number) => t + zoneOffset(t * 1000, market.exchange.timeZone) * 60 : (t: number) => t;
    const expected = candleStart(interval, mNow.lastTrade);
    const lag = candlesBetween(interval, candleStart(interval, local(lastBarTime)), candleStart(interval, local(mNow.lastTrade)));
    const delay = expected - lastBarTime;
    let level: Level;
    let detail: string;
    if (lastBarTime > now + 60 && !isCalendarInterval(interval) && interval !== "1w" && interval !== "all") {
      level = "bad";
      detail = `liegt in der Zukunft (${formatTime(lastBarTime)}): Zeitstempel oder Uhr stimmen nicht`;
    } else if (lag === 0) {
      level = "ok";
      detail = `${formatTime(lastBarTime)} ist die aktuelle Kerze`;
    } else if (live && lag === 1 && now - expected < 30) {
      level = "ok";
      detail = `neue Kerze ab ${formatTime(expected)} beginnt gerade`;
    } else if (!live && delay <= Math.max(step, 1200)) {
      level = "warn";
      detail = `${formatTime(lastBarTime)}, erwartet ${formatTime(expected)}: ${lag} Kerze${lag === 1 ? "" : "n"} verzögert (übliche Börsen-Verzögerung der Quelle)`;
    } else {
      level = lag === 1 ? "warn" : "bad";
      detail = `${formatTime(lastBarTime)}, erwartet ${formatTime(expected)}: ${lag} Kerze${lag === 1 ? "" : "n"} zurück`;
    }
    if (!mNow.open && market.kind !== "24/7") detail += ` · Markt geschlossen, letzter Handel ${formatTime(mNow.lastTrade + 1)}`;
    checks.push({ id: "candle", label: "Letzte Kerze", level, detail });
  } else if (source && source !== "demo") {
    checks.push({ id: "candle", label: "Letzte Kerze", level: "warn", detail: "keine Kerzen geladen" });
  }

  // Live ticks: how old is the newest price, and how long did it take to arrive?
  if (live && !replay) {
    if (tick) {
      const age = trueNow - tick.eventTime;
      const latency = tick.receivedAt + (clock?.offsetMs ?? 0) - tick.eventTime;
      // Perpetuals of stocks and commodities can go quiet outside exchange hours; an exchange feed is silent while the exchange is closed.
      const quiet = source === "binance_futures" && market.kind !== "24/7";
      const level: Level = exchangeFeed && !mNow.open ? "info" : age <= 15_000 ? "ok" : age <= 120_000 || quiet ? "warn" : "bad";
      checks.push({
        id: "tick",
        label: "Letzter Live-Tick",
        level,
        detail: `${age < 1000 ? "gerade eben" : `vor ${formatSpan(age)}`} (Serverzeit ${formatTime(Math.floor(tick.eventTime / 1000))}) · Übertragung ${clock ? formatSpan(Math.max(0, latency)) : "unbekannt (Uhr nicht gemessen)"}`,
      });
    } else if (exchangeFeed && !mNow.open) {
      checks.push({ id: "tick", label: "Letzter Live-Tick", level: "info", detail: "Markt geschlossen: keine Live-Kurse bis zur Öffnung" });
    } else {
      const waiting = input.loadedAt !== null && input.deviceNow - input.loadedAt < 10_000;
      checks.push({ id: "tick", label: "Letzter Live-Tick", level: waiting ? "info" : "warn", detail: waiting ? "Live-Verbindung wird aufgebaut …" : "noch kein Live-Tick empfangen" });
    }
  }

  // REST cross-check of the last candle.
  if (input.rest) {
    const r = input.rest;
    const ago = Math.round((input.deviceNow - r.at) / 1000);
    const sameCandle = r.chartTime === r.restTime;
    const diff = r.chartClose !== null && r.restClose ? Math.abs(r.chartClose - r.restClose) / r.restClose : 1;
    const level: Level = sameCandle && diff <= 0.002 ? "ok" : sameCandle ? "warn" : "bad";
    checks.push({
      id: "rest",
      label: "Abgleich mit Server",
      level,
      detail:
        `vor ${ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`}: Server ${formatTime(r.restTime)} · ${formatPriceDe(r.restClose)}` +
        ` / Chart ${r.chartTime === null ? "–" : formatTime(r.chartTime)} · ${r.chartClose === null ? "–" : formatPriceDe(r.chartClose)}` +
        (sameCandle ? ` · Abweichung ${(diff * 100).toFixed(3).replace(".", ",")} %` : " · andere Kerze"),
    });
  }

  // Exchange: hours only; there is no exchange feed to compare prices with.
  if (market.kind === "exchange") {
    const state = mNow.open ? `geöffnet${mNow.next ? ` bis ${formatTime(mNow.next)}` : ""}` : `geschlossen${mNow.holiday ? ` (${mNow.holiday})` : ""}${mNow.next ? `, öffnet ${formatTime(mNow.next)}` : ""}`;
    const perp = source === "binance_futures" ? " · Perp-Preis ist kein Börsenkurs und kann außerhalb der Börsenzeiten abweichen" : "";
    const feed = exchangeFeed
      ? " · Börsenkurs direkt aus dem Börsen-Feed (Twelve Data); ob er in Echtzeit kommt, zeigt das Alter des Live-Ticks"
      : " · Kursabgleich mit der Börse selbst ist ohne Börsen-Feed nicht möglich";
    checks.push({ id: "market", label: `Börse ${market.label}`, level: "info", detail: `${state}${perp}${feed}` });
  } else if (market.kind === "24/5") {
    checks.push({ id: "market", label: market.label, level: "info", detail: mNow.open ? "Handel läuft" : `Wochenende, letzter Handel ${formatTime(mNow.lastTrade + 1)}` });
  } else {
    checks.push({ id: "market", label: "Markt", level: "info", detail: `${market.label}: keine Börsenzeiten` });
  }

  const worst = checks.reduce<Level>((w, c) => (RANK[c.level] > RANK[w] ? c.level : w), "info");
  const level = worst === "info" ? "ok" : worst;
  const summary =
    source === "demo"
      ? "Demo"
      : replay
        ? "Replay"
        : level === "ok"
          ? exchangeFeed && market.kind === "exchange"
            ? "Börsenkurs"
            : live
              ? "Live"
              : "Aktuell"
          : level === "warn"
            ? "Prüfen"
            : "Veraltet";
  return { level, summary, trueNow, market, marketNow: mNow, checks };
}

/** Plain-text record of a check, to copy and keep. */
export function freshnessReport(input: FreshnessInput, result: Freshness): string {
  const iso = (ms: number) => new Date(ms).toISOString();
  const lines = [
    `ChartAI Aktualitäts-Nachweis`,
    `Symbol: ${input.symbol} · ${input.interval} · Quelle: ${input.source ? sourceLabel(input.source, input.symbol) : "–"}`,
    `Geräteuhr: ${iso(input.deviceNow)}`,
    `Serverzeit (korrigiert): ${iso(result.trueNow)}${input.clock ? ` · Offset ${input.clock.offsetMs} ms · RTT ${input.clock.rttMs} ms · ${input.clock.source}` : " · nicht gemessen"}`,
    input.lastBarTime !== null ? `Letzte Kerze: ${iso(input.lastBarTime * 1000)}` : "Letzte Kerze: –",
    input.tick ? `Letzter Tick: Server ${iso(input.tick.eventTime)} · empfangen ${iso(input.tick.receivedAt)} (Gerät)` : "Letzter Tick: –",
    "",
    ...result.checks.map((c) => `[${c.level.toUpperCase()}] ${c.label}: ${c.detail}`),
    "",
    `Gesamt: ${result.level.toUpperCase()} (${result.summary})`,
  ];
  return lines.join("\n");
}
