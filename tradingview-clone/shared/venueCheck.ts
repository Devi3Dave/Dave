/**
 * Connection test for one crypto exchange, run in the browser: which of its data paths
 * (REST candles, the WebSocket fallback for candles, live trades, market lists) get through.
 * Browsers block REST calls of exchanges without CORS headers (Safari: "Load failed"); WebSockets are not affected.
 */
import type { Bar } from "./math.js";
import { loadVenueMarkets } from "./venueMarkets.js";
import { getVenue, parseVenueSymbol, perpSymbol, venueSymbol, type Instrument, type VenueId, type VenueTrade } from "./venues.js";

export type CheckState = "ok" | "fail" | "skip";

export interface CheckStep {
  label: string;
  state: CheckState;
  detail: string;
}

export interface CheckDeps {
  fetchJson(url: string): Promise<unknown>;
  wsRequest<T>(url: string, message: string, parse: (msg: unknown) => T | null, timeoutMs?: number): Promise<T>;
  isNetworkError(e: unknown): boolean;
}

const LIVE_TIMEOUT_MS = 15_000;

const why = (deps: CheckDeps, e: unknown) => (deps.isNetworkError(e) ? "vom Browser blockiert (CORS) oder nicht erreichbar" : String((e as Error)?.message ?? e));

const lastPrice = (bars: Bar[]) => (bars.length ? `, letzter Kurs ${bars[bars.length - 1].close}` : "");

async function checkInstrument(form: string, inst: Instrument, deps: CheckDeps): Promise<CheckStep[]> {
  const feed = inst.feed;
  const interval = "1h" in feed.intervals ? "1h" : Object.keys(feed.intervals)[0];
  const steps: CheckStep[] = [];
  let restOk = false;
  try {
    const bars = feed.parseCandles(await deps.fetchJson(feed.candlesUrl(inst.native, feed.intervals[interval], 5)));
    restOk = bars.length > 0;
    steps.push({ label: `${form}: Kerzen (REST)`, state: restOk ? "ok" : "fail", detail: restOk ? `${bars.length} Kerzen${lastPrice(bars)}` : "keine Kerzen" });
  } catch (e) {
    steps.push({ label: `${form}: Kerzen (REST)`, state: "fail", detail: why(deps, e) });
  }
  const ws = feed.wsHistory;
  if (restOk) steps.push({ label: `${form}: Kerzen über WebSocket`, state: "skip", detail: "nicht nötig, REST geht" });
  else if (!ws || !feed.wsUrl) steps.push({ label: `${form}: Kerzen über WebSocket`, state: "skip", detail: `${inst.venue.name} bietet keinen Ausweg` });
  else {
    try {
      const bars = await deps.wsRequest(feed.wsUrl, ws.request(inst.wsNative ?? inst.native, interval, 5), ws.parse);
      steps.push({ label: `${form}: Kerzen über WebSocket`, state: bars.length ? "ok" : "fail", detail: bars.length ? `${bars.length} Kerzen${lastPrice(bars)}` : "keine Kerzen" });
    } catch (e) {
      steps.push({ label: `${form}: Kerzen über WebSocket`, state: "fail", detail: why(deps, e) });
    }
  }
  if (!feed.wsUrl) steps.push({ label: `${form}: Live-Kurse`, state: "skip", detail: "kein WebSocket, der Chart lädt jede Minute neu" });
  else {
    try {
      const trades = await deps.wsRequest<VenueTrade[]>(feed.wsUrl, feed.subscribe(inst.wsNative ?? inst.native), (m) => {
        const t = feed.parseTrades(m);
        return t.length ? t : null;
      }, LIVE_TIMEOUT_MS);
      steps.push({ label: `${form}: Live-Kurse`, state: "ok", detail: `Trade zu ${trades[trades.length - 1].price}` });
    } catch (e) {
      steps.push({ label: `${form}: Live-Kurse`, state: "fail", detail: why(deps, e) });
    }
  }
  return steps;
}

const STEP_TIMEOUT_MS = 30_000;

/** A step that hangs (slow network, a request without answer) ends as failed instead of keeping the test running. */
function withTimeout(p: Promise<CheckStep[]>): Promise<CheckStep[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<CheckStep[]>((resolve) => {
    timer = setTimeout(() => resolve([{ label: "Test", state: "fail", detail: "keine Antwort nach 30 s" }]), STEP_TIMEOUT_MS);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Tests BTC spot (and the BTC perpetual where the exchange has one) plus the exchange's market lists. */
export async function checkVenue(id: VenueId, deps: CheckDeps): Promise<CheckStep[]> {
  const venue = getVenue(id);
  if (!venue) return [{ label: id, state: "fail", detail: "unbekannte Börse" }];
  const forms: [string, string | null][] = [
    ["Spot", venue.noSpot ? null : venueSymbol(id, "BTCUSDT")],
    ["Perp", perpSymbol(id, "BTCUSDT")],
  ];
  const runs = forms.map(async ([form, symbol]): Promise<CheckStep[]> => {
    if (!symbol) return [];
    const inst = parseVenueSymbol(symbol);
    // Binance spot (plain BTCUSDT) loads over the app's original Binance path.
    if (!inst) {
      const label = `${form} ${symbol}: Kerzen (REST)`;
      try {
        const rows = (await deps.fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=5`)) as unknown[][];
        return [{ label, state: rows.length ? "ok" : "fail", detail: rows.length ? `${rows.length} Kerzen, letzter Kurs ${Number(rows[rows.length - 1][4])}` : "keine Kerzen" }];
      } catch (e) {
        return [{ label, state: "fail", detail: why(deps, e) }];
      }
    }
    return checkInstrument(`${form} ${symbol}`, inst, deps);
  });
  const lists = (async (): Promise<CheckStep> => {
    const got = await loadVenueMarkets(id, deps.fetchJson as (url: string) => Promise<never>);
    if (!got.failed.length) return { label: "Marktliste", state: "ok", detail: `${got.markets.length} Märkte` };
    return {
      label: "Marktliste",
      state: got.markets.length ? "ok" : "fail",
      detail: `${got.failed.length} Liste(n) blockiert: ${got.failed.map((u) => new URL(u).host).join(", ")}${got.markets.length ? ` · ${got.markets.length} Märkte aus den übrigen` : ""}`,
    };
  })();
  const parts = await Promise.all([...runs, lists.then((s) => [s])].map((p) => withTimeout(p)));
  const steps = parts.flat();
  return venue.noSpot ? [{ label: "Spot", state: "skip", detail: venue.noSpot }, ...steps] : steps;
}
