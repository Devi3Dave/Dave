// Journal analytics in the style of TradeZella (tradezella.com): daily results for the calendar and day view,
// breakdown reports, playbooks with rule adherence, a 0–100 performance score and a CSV import.
// Feature set after TradeZella's public help center (help.tradezella.com: "Understanding Dashboard Widgets and Stats",
// "Understanding the Daily Journal Page", "Introducing the All-New Zella Score"); the code and look are our own.

import { CHECKLIST, PERCOCO_PLAYBOOK, sortTrades, tradePnl, tradeR, type JournalTrade } from "./journal";

/**
 * Trades per setup before its numbers mean much. 30 is the usual rule of thumb for a sample mean to be roughly
 * normal (central limit theorem); with trading results that are far from normal, more (50–100) is better.
 */
export const MIN_SAMPLE = 30;

// ---------- days ----------

export interface DayResult {
  date: string;
  pnl: number;
  count: number;
  wins: number;
  losses: number;
  /** Sum of R over the day's trades that have a stop. */
  r: number;
  trades: JournalTrade[];
}

/** One entry per trading day, oldest first. */
export function dailyResults(trades: JournalTrade[]): DayResult[] {
  const days = new Map<string, DayResult>();
  for (const t of sortTrades(trades)) {
    const d = days.get(t.date) ?? { date: t.date, pnl: 0, count: 0, wins: 0, losses: 0, r: 0, trades: [] };
    const p = tradePnl(t);
    d.pnl += p;
    d.count++;
    if (p > 0) d.wins++;
    else if (p < 0) d.losses++;
    d.r += tradeR(t) ?? 0;
    d.trades.push(t);
    days.set(t.date, d);
  }
  return [...days.values()];
}

/** Share of trading days that ended with a profit (TradeZella "Day Win %"); break-even days count as not won. */
export function dayWinRate(days: DayResult[]): number {
  return days.length ? days.filter((d) => d.pnl > 0).length / days.length : 0;
}

/** Monday-first weeks of a month for a calendar; days outside the month are null. month: 1–12. */
export function monthWeeks(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month - 1, 1);
  const daysIn = new Date(year, month, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysIn; d++) cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ---------- breakdown reports ----------

export interface GroupRow {
  key: string;
  count: number;
  wins: number;
  winRate: number;
  net: number;
  /** Gross profit ÷ gross loss (Infinity without losses). */
  profitFactor: number;
  /** Average result per trade in $. */
  expectancy: number;
  avgR: number | null;
  /** Sum of R over the trades that have a stop. */
  totalR: number;
}

export function groupStats(trades: JournalTrade[], keysOf: (t: JournalTrade) => string | string[] | null, order?: string[]): GroupRow[] {
  const groups = new Map<string, JournalTrade[]>();
  for (const t of trades) {
    const k = keysOf(t);
    for (const key of k === null ? [] : Array.isArray(k) ? k : [k]) groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const rows = [...groups.entries()].map(([key, ts]) => {
    const pnls = ts.map(tradePnl);
    const rs = ts.map(tradeR).filter((r): r is number => r !== null);
    const gp = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
    const gl = -pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0);
    const net = gp - gl;
    const wins = pnls.filter((p) => p > 0).length;
    return {
      key,
      count: ts.length,
      wins,
      winRate: wins / ts.length,
      net,
      profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
      expectancy: net / ts.length,
      avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
      totalR: rs.reduce((a, b) => a + b, 0),
    };
  });
  if (order) return order.flatMap((k) => rows.filter((r) => r.key === k));
  return rows.sort((a, b) => b.net - a.net);
}

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Weekday of an ISO date, Monday first (keys of WEEKDAYS). */
export const weekdayOf = (iso: string) => WEEKDAYS[(new Date(`${iso}T12:00:00`).getDay() + 6) % 7];

/** Entry hour as "09 Uhr", or null without an entry time. */
export const hourOf = (t: JournalTrade) => (t.time ? `${t.time.slice(0, 2)} Uhr` : null);

/** Minutes between entry and exit time; an exit before the entry counts as the next day. */
export function durationMin(t: JournalTrade): number | null {
  if (!t.time || !t.exitTime) return null;
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const d = m(t.exitTime) - m(t.time);
  return d < 0 ? d + 1440 : d;
}

export const DURATION_BUCKETS = ["< 5 Min", "5–15 Min", "15–60 Min", "1–4 Std", "> 4 Std"];

export function durationBucket(t: JournalTrade): string | null {
  const d = durationMin(t);
  if (d === null) return null;
  return d < 5 ? DURATION_BUCKETS[0] : d < 15 ? DURATION_BUCKETS[1] : d < 60 ? DURATION_BUCKETS[2] : d < 240 ? DURATION_BUCKETS[3] : DURATION_BUCKETS[4];
}

export const R_BUCKETS = ["≤ −2R", "−2 bis −1R", "−1 bis 0R", "0 bis 1R", "1 bis 2R", "≥ 2R"];

export function rBucket(t: JournalTrade): string | null {
  const r = tradeR(t);
  if (r === null) return null;
  return r <= -2 ? R_BUCKETS[0] : r < -1 ? R_BUCKETS[1] : r < 0 ? R_BUCKETS[2] : r < 1 ? R_BUCKETS[3] : r < 2 ? R_BUCKETS[4] : R_BUCKETS[5];
}

// ---------- playbooks ----------

export interface PlaybookRule {
  id: string;
  label: string;
}

export interface Playbook {
  id: string;
  name: string;
  description?: string;
  rules: PlaybookRule[];
}

/** The playbook every journal starts with: the entry checklist the journal had before (same rule ids, so old trades keep their ticks). */
export const DEFAULT_PLAYBOOKS: Playbook[] = [
  {
    id: PERCOCO_PLAYBOOK,
    name: "Percoco 15m/1m FVG",
    description: "Reaktion an einer 15m-FVG, dann CHoCH und FVG auf dem 1-Minuten-Chart (Craig Percoco, youtube.com/watch?v=c5ATdFHneJo).",
    rules: CHECKLIST.map((c) => ({ id: c.key, label: c.label })),
  },
];

export function parsePlaybooks(raw: unknown): Playbook[] {
  if (!Array.isArray(raw)) return DEFAULT_PLAYBOOKS;
  return raw.flatMap((p): Playbook[] => {
    if (!p || typeof p !== "object") return [];
    const r = p as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || typeof r.name !== "string") return [];
    const rules = (Array.isArray(r.rules) ? r.rules : []).flatMap((x): PlaybookRule[] => {
      const q = x as Record<string, unknown> | null;
      return q && typeof q.id === "string" && typeof q.label === "string" ? [{ id: q.id, label: q.label }] : [];
    });
    return [{ id: r.id, name: r.name, ...(typeof r.description === "string" && r.description ? { description: r.description } : {}), rules }];
  });
}

export interface PlaybookStats extends Omit<GroupRow, "key"> {
  /** Share of ticked rules over the playbook's trades that use the checklist (0–1), or null. */
  adherence: number | null;
  /** Win rate of trades with every rule ticked vs. with a rule missing. */
  allRules: { count: number; winRate: number };
  brokeRule: { count: number; winRate: number };
  /** Per rule: how often ticked and the win rate with / without it. */
  rules: { id: string; label: string; followed: number; winWith: number | null; winWithout: number | null }[];
}

export function playbookStats(pb: Playbook, trades: JournalTrade[]): PlaybookStats {
  const ts = trades.filter((t) => t.playbook === pb.id);
  const g = groupStats(ts, () => "")[0];
  const base = { count: g?.count ?? 0, wins: g?.wins ?? 0, winRate: g?.winRate ?? 0, net: g?.net ?? 0, profitFactor: g?.profitFactor ?? 0, expectancy: g?.expectancy ?? 0, avgR: g?.avgR ?? null, totalR: g?.totalR ?? 0 };
  const checked = ts.filter((t) => t.checks !== undefined);
  const winRate = (list: JournalTrade[]) => (list.length ? list.filter((t) => tradePnl(t) > 0).length / list.length : 0);
  const full = checked.filter((t) => pb.rules.every((r) => t.checks!.includes(r.id)));
  const broke = checked.filter((t) => !pb.rules.every((r) => t.checks!.includes(r.id)));
  const ticks = checked.reduce((a, t) => a + pb.rules.filter((r) => t.checks!.includes(r.id)).length, 0);
  return {
    ...base,
    adherence: checked.length && pb.rules.length ? ticks / (checked.length * pb.rules.length) : null,
    allRules: { count: full.length, winRate: winRate(full) },
    brokeRule: { count: broke.length, winRate: winRate(broke) },
    rules: pb.rules.map((r) => {
      const w = checked.filter((t) => t.checks!.includes(r.id));
      const wo = checked.filter((t) => !t.checks!.includes(r.id));
      return { id: r.id, label: r.label, followed: w.length, winWith: w.length ? winRate(w) : null, winWithout: wo.length ? winRate(wo) : null };
    }),
  };
}

// ---------- strategy vs. execution ----------

/**
 * "clean": taken by the playbook with every rule ticked and no mistake; "broken": a rule not ticked or a mistake
 * tagged; null: nothing to judge (no playbook checklist and no mistakes).
 */
export function compliance(t: JournalTrade, playbooks: Playbook[]): "clean" | "broken" | null {
  if (t.mistakes?.length) return "broken";
  const pb = playbooks.find((p) => p.id === t.playbook);
  if (!pb || !pb.rules.length || t.checks === undefined) return null;
  return pb.rules.every((r) => t.checks!.includes(r.id)) ? "clean" : "broken";
}

export interface ComplianceStats {
  clean: GroupRow | null;
  broken: GroupRow | null;
  /** Trades that could not be judged. */
  unjudged: number;
}

/** Results of the rule-conform trades against those with a broken rule or a mistake: strategy or execution? */
export function complianceStats(trades: JournalTrade[], playbooks: Playbook[]): ComplianceStats {
  const rows = groupStats(trades, (t) => compliance(t, playbooks));
  return {
    clean: rows.find((r) => r.key === "clean") ?? null,
    broken: rows.find((r) => r.key === "broken") ?? null,
    unjudged: trades.filter((t) => compliance(t, playbooks) === null).length,
  };
}

// ---------- performance score ----------

export interface ScorePart {
  key: "win" | "pf" | "wl" | "dd" | "rf" | "cons";
  label: string;
  /** The raw metric (win % as 0–1, drawdown as 0–1 of the peak). */
  value: number;
  /** 0–100. */
  score: number;
  /** Weight in the total (sum 1). */
  weight: number;
  /** How the score is computed, for the tooltip. */
  rule: string;
}

export interface Score {
  total: number;
  parts: ScorePart[];
}

/**
 * 0–100 score from six metrics, built like TradeZella's Zella Score 2.0 (help.tradezella.com/en/articles/10305642,
 * December 2024): every metric is scored 0–100 and weighted — profit factor 25 %, avg win/loss 20 %, max drawdown 20 %,
 * win % 15 %, recovery factor 10 %, consistency 10 %.
 * Taken from that article: win % scores (win % ÷ 60) × 100, capped at 100; max drawdown scores 100 − drawdown in % of
 * the peak cumulative P&L; consistency is 0 with a negative average result, else 100 − (standard deviation of the
 * results ÷ total profit × 100).
 * TradeZella does not publish the thresholds of the other three. Ours, as a linear scale up to a target:
 * profit factor 2.0 ("excellent" in TradeZella's blog, tradezella.com/blog/profit-factor), avg win/loss 1.5 (the target
 * TradeZella's blog names, tradezella.com/blog/analyze-trading-performance), recovery factor 2.0 (common benchmark).
 * So the total is close to, but not the same as, the Zella Score.
 */
export function performanceScore(trades: JournalTrade[]): Score | null {
  if (!trades.length) return null;
  const pnls = sortTrades(trades).map(tradePnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const gp = wins.reduce((a, b) => a + b, 0);
  const gl = -losses.reduce((a, b) => a + b, 0);
  const net = gp - gl;
  let eq = 0;
  let peak = 0;
  let maxDd = 0;
  for (const p of pnls) {
    eq += p;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak - eq);
  }
  const winRate = wins.length / pnls.length;
  const pf = gl > 0 ? gp / gl : gp > 0 ? Infinity : 0;
  const avgWin = wins.length ? gp / wins.length : 0;
  const avgLoss = losses.length ? gl / losses.length : 0;
  const wl = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;
  // Without any peak above zero every drop is a full drawdown.
  const ddShare = maxDd <= 0 ? 0 : peak > 0 ? maxDd / peak : 1;
  const rf = maxDd > 0 ? net / maxDd : net > 0 ? Infinity : 0;
  const mean = net / pnls.length;
  const sd = Math.sqrt(pnls.reduce((a, p) => a + (p - mean) ** 2, 0) / pnls.length);
  const cons = mean < 0 || net <= 0 ? 0 : 100 - (sd / net) * 100;
  const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100);
  const toTarget = (v: number, target: number) => clamp((v / target) * 100);
  const parts: ScorePart[] = [
    { key: "pf", label: "Profit-Faktor", value: pf, score: toTarget(pf, 2), weight: 0.25, rule: "100 Punkte ab 2,0 (eigene Schwelle, TradeZella nennt sie nicht)" },
    { key: "wl", label: "Ø Gewinn / Ø Verlust", value: wl, score: toTarget(wl, 1.5), weight: 0.2, rule: "100 Punkte ab 1,5 (eigene Schwelle)" },
    { key: "dd", label: "Max. Drawdown", value: ddShare, score: clamp(100 - ddShare * 100), weight: 0.2, rule: "100 − Drawdown in % vom Höchststand" },
    { key: "win", label: "Trefferquote", value: winRate, score: clamp(((winRate * 100) / 60) * 100), weight: 0.15, rule: "Trefferquote ÷ 60 % × 100, ab 60 % volle Punkte" },
    { key: "rf", label: "Recovery-Faktor", value: rf, score: toTarget(rf, 2), weight: 0.1, rule: "Nettogewinn ÷ max. Drawdown, 100 Punkte ab 2,0 (eigene Schwelle)" },
    { key: "cons", label: "Beständigkeit", value: cons, score: clamp(cons), weight: 0.1, rule: "100 − Standardabweichung ÷ Gesamtgewinn × 100; 0 bei Verlust" },
  ];
  return { total: parts.reduce((a, p) => a + p.score * p.weight, 0), parts };
}

// ---------- CSV import ----------

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["date", "datum", "close date", "exit date", "closed", "tag"],
  time: ["time", "entry time", "open time", "uhrzeit", "einstiegszeit"],
  exitTime: ["exittime", "exit time", "close time", "ausstiegszeit"],
  symbol: ["symbol", "ticker", "instrument", "market", "pair"],
  side: ["side", "richtung", "direction", "type", "position"],
  entry: ["entry", "einstieg", "entry price", "open price", "avg entry"],
  stop: ["stop", "stop-loss", "stoploss", "stop loss", "sl"],
  exit: ["exit", "ausstieg", "exit price", "close price", "avg exit"],
  qty: ["qty", "menge", "quantity", "size", "volume", "amount", "shares", "contracts"],
  fees: ["fees", "gebühren", "commission", "commissions", "fee"],
  pnl: ["pnl", "p&l", "net p&l", "profit", "realized pnl", "ergebnis", "gewinn"],
  setup: ["setup", "strategy", "strategie"],
  note: ["note", "notiz", "notes", "comment"],
  tags: ["tags"],
  mistakes: ["mistakes", "fehler"],
};

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Number from "1.234,5", "1,234.5", "-12,3 $" … */
function csvNum(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  let v = s.replace(/[^\d,.\-]/g, "");
  if (v === "" || v === "-") return undefined;
  if (v.includes(",") && v.includes(".")) v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  else if (v.includes(",")) v = v.replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Date as YYYY-MM-DD from "2026-10-30", "30.10.2026", "10/30/2026" or with a time behind it; also returns the time. */
function csvDate(s: string): { date: string; time?: string } | null {
  const time = s.match(/(\d{1,2}):(\d{2})/);
  const t = time ? `${time[1].padStart(2, "0")}:${time[2]}` : undefined;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: t };
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) return { date: `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, time: t };
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { date: `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`, time: t };
  return null;
}

/**
 * Trades from a CSV file: the journal's own export, or a broker/exchange export with common column names
 * (TradeZella's broker sync needs a server; this is the local way). Separator ; , or tab is detected.
 */
export function parseTradesCsv(text: string, idPrefix = `csv-${Date.now()}`): { trades: JournalTrade[]; skipped: number } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new Error("Die Datei hat keine Zeilen mit Trades");
  const head = lines[0];
  const sep = [";", "\t", ","].sort((a, b) => head.split(b).length - head.split(a).length)[0];
  const cols = splitCsvLine(head, sep).map((h) => h.toLowerCase().replace(/[_()]/g, " ").replace(/\s+/g, " ").trim());
  const idx: Record<string, number> = {};
  for (const [field, names] of Object.entries(HEADER_ALIASES)) {
    const i = cols.findIndex((c) => names.includes(c));
    if (i >= 0) idx[field] = i;
  }
  if (idx.date === undefined) throw new Error("Keine Datums-Spalte gefunden (z. B. „date“ oder „Datum“)");
  if (idx.pnl === undefined && (idx.entry === undefined || idx.exit === undefined)) throw new Error("Es fehlt eine Spalte für das Ergebnis (P&L) oder für Einstieg und Ausstieg");
  let skipped = 0;
  const trades = lines.slice(1).flatMap((line, n): JournalTrade[] => {
    const cells = splitCsvLine(line, sep);
    const get = (f: string) => (idx[f] === undefined ? undefined : cells[idx[f]]);
    const when = csvDate(get("date") ?? "");
    const entry = csvNum(get("entry"));
    const exit = csvNum(get("exit"));
    const qty = csvNum(get("qty"));
    const pnl = csvNum(get("pnl"));
    // The journal's own export writes 0 prices for trades entered with a result only.
    const pricesOk = entry !== undefined && exit !== undefined && qty !== undefined && qty !== 0 && (entry !== 0 || exit !== 0);
    if (!when || (!pricesOk && pnl === undefined)) {
      skipped++;
      return [];
    }
    const sideRaw = (get("side") ?? "").toLowerCase();
    const list = (s: string | undefined) => (s ? s.split(/[,|]/).map((x) => x.trim()).filter(Boolean) : []);
    const ownTime = get("time");
    const exitTime = get("exitTime")?.match(/\d{1,2}:\d{2}/)?.[0];
    const time = (ownTime?.match(/\d{1,2}:\d{2}/)?.[0] ?? when.time)?.padStart(5, "0");
    const tags = list(get("tags"));
    const mistakes = list(get("mistakes"));
    return [
      {
        id: `${idPrefix}-${n}`,
        date: when.date,
        symbol: (get("symbol") ?? "").toUpperCase(),
        side: /short|sell|verkauf/.test(sideRaw) ? "short" : "long",
        entry: entry ?? 0,
        stop: csvNum(get("stop")),
        exit: exit ?? 0,
        qty: qty === undefined ? 0 : Math.abs(qty),
        fees: Math.abs(csvNum(get("fees")) ?? 0),
        // Prices win when complete, as in the journal's form; a broker P&L only fills in without them.
        pnl: pricesOk ? undefined : pnl,
        setup: get("setup") || undefined,
        note: get("note") || undefined,
        ...(time && /^\d{2}:\d{2}$/.test(time) ? { time } : {}),
        ...(exitTime ? { exitTime: exitTime.padStart(5, "0") } : {}),
        ...(tags.length ? { tags } : {}),
        ...(mistakes.length ? { mistakes } : {}),
      },
    ];
  });
  return { trades, skipped };
}

// ---------- notes ----------

export interface NotebookNote {
  id: string;
  title: string;
  body: string;
  /** Folder name ("Trading-Plan", "Wochenrückblick" …). */
  folder: string;
  updated: number;
}

export interface JournalNotes {
  /** Day journal, by ISO date. */
  days: Record<string, string>;
  notebook: NotebookNote[];
}

export const NOTE_TEMPLATES: { name: string; folder: string; body: string }[] = [
  { name: "Plan vor Handelsbeginn", folder: "Tagesplan", body: "Marktlage:\n\nWichtige Termine heute:\n\nLevels (Unterstützung / Widerstand):\n\nWelche Setups handle ich heute?\n\nMax. Verlust heute:\n" },
  { name: "Tagesrückblick", folder: "Rückblick", body: "Was lief gut?\n\nWas lief schlecht?\n\nHabe ich meine Regeln eingehalten?\n\nWas mache ich morgen anders?\n" },
  { name: "Wochenrückblick", folder: "Rückblick", body: "Ergebnis der Woche:\n\nBestes Setup:\n\nHäufigster Fehler:\n\nZiel für nächste Woche:\n" },
  { name: "Trading-Plan", folder: "Trading-Plan", body: "Märkte und Zeiten:\n\nRisiko pro Trade:\n\nMax. Trades pro Tag:\n\nEinstiegsregeln:\n\nAusstiegsregeln:\n" },
];

export function parseNotes(raw: unknown): JournalNotes {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const days: Record<string, string> = {};
  if (r.days && typeof r.days === "object") for (const [k, v] of Object.entries(r.days as Record<string, unknown>)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === "string" && v.trim()) days[k] = v;
  const notebook = (Array.isArray(r.notebook) ? r.notebook : []).flatMap((n): NotebookNote[] => {
    const q = n as Record<string, unknown> | null;
    if (!q || typeof q.id !== "string") return [];
    return [{ id: q.id, title: typeof q.title === "string" ? q.title : "", body: typeof q.body === "string" ? q.body : "", folder: typeof q.folder === "string" && q.folder ? q.folder : "Notizen", updated: typeof q.updated === "number" ? q.updated : 0 }];
  });
  return { days, notebook };
}
