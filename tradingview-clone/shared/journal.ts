// Trading journal math: P&L and R per trade, equity curve and summary statistics.
// Amounts are in quote currency; a trade's R is its result divided by its planned risk.

export type Side = "long" | "short";

export interface JournalTrade {
  id: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  symbol: string;
  side: Side;
  entry: number;
  /** Planned stop-loss; without it the trade has no R value. */
  stop?: number;
  exit: number;
  /** Planned take-profit; with the stop it gives the planned reward/risk. */
  target?: number;
  /** Units bought or sold. */
  qty: number;
  fees: number;
  /** Manually entered result in $; overrides the result computed from the prices. */
  pnl?: number;
  setup?: string;
  note?: string;
  /** Ticked rules of the trade's playbook (rule ids; for the Percoco playbook the keys of CHECKLIST). */
  checks?: string[];
  /** Entry and exit time of day (HH:MM, local); used by the time and duration reports. */
  time?: string;
  exitTime?: string;
  /** Playbook (strategy) the trade was taken with, by id. */
  playbook?: string;
  /** Free tags and mistakes ("FOMO", "Stop verschoben"), as in TradeZella's tag categories. */
  tags?: string[];
  mistakes?: string[];
  /** Own grade of the execution, 1–5 stars. */
  rating?: number;
  /** Ids of attached screenshots; the pictures are in the browser's image store (src/journalImages.ts). */
  images?: string[];
}

/**
 * Entry checklist after Craig Percoco's 15m/1m FVG model ("My Trading Strategy is Boring But Made Me
 * $18,565", youtube.com/watch?v=c5ATdFHneJo): reaction at a 15m fair value gap, then a change of character
 * and a fair value gap on the 1-minute chart.
 */
export const CHECKLIST = [
  { key: "htfFvg", label: "Reaktion an 15m-FVG" },
  { key: "choch", label: "CHoCH auf 1m" },
  { key: "ltfFvg", label: "FVG auf 1m" },
] as const;

export interface ChecklistRow {
  key: string;
  label: string;
  with: { count: number; winRate: number; avgR: number | null };
  without: { count: number; winRate: number; avgR: number | null };
}

/** Win rate and average R of the trades with and without each checklist point (only trades that use the checklist). */
export function checklistStats(trades: JournalTrade[]): ChecklistRow[] {
  const used = trades.filter((t) => t.checks !== undefined);
  const summary = (ts: JournalTrade[]) => {
    const rs = ts.map(tradeR).filter((r): r is number => r !== null);
    return {
      count: ts.length,
      winRate: ts.length ? ts.filter((t) => tradePnl(t) > 0).length / ts.length : 0,
      avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    };
  };
  return CHECKLIST.map((c) => ({
    key: c.key,
    label: c.label,
    with: summary(used.filter((t) => t.checks!.includes(c.key))),
    without: summary(used.filter((t) => !t.checks!.includes(c.key))),
  }));
}

/** Result in $ after fees (manual value if one was entered). */
export function tradePnl(t: JournalTrade): number {
  if (t.pnl !== undefined && Number.isFinite(t.pnl)) return t.pnl;
  const dir = t.side === "long" ? 1 : -1;
  return (t.exit - t.entry) * dir * t.qty - (t.fees || 0);
}

/** Planned risk in $: distance entry → stop times quantity. */
export function tradeRisk(t: JournalTrade): number {
  return t.stop === undefined || !Number.isFinite(t.stop) ? 0 : Math.abs(t.entry - t.stop) * t.qty;
}

/** Result in R, or null when the trade has no usable stop. */
export function tradeR(t: JournalTrade): number | null {
  const risk = tradeRisk(t);
  return risk > 0 ? tradePnl(t) / risk : null;
}

/** Planned reward ÷ risk from entry, stop and take-profit, or null without both. */
export function plannedRR(t: JournalTrade): number | null {
  if (t.stop === undefined || t.target === undefined || !Number.isFinite(t.stop) || !Number.isFinite(t.target)) return null;
  const risk = Math.abs(t.entry - t.stop);
  return risk > 0 ? Math.abs(t.target - t.entry) / risk : null;
}

/** Trades in the order they happened (date, then insertion order). */
export function sortTrades(trades: JournalTrade[]): JournalTrade[] {
  return trades
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.i - b.i))
    .map(({ t }) => t);
}

export interface JournalStats {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  /** Gross profit ÷ gross loss; Infinity without losses, 0 without trades. */
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  /** Average result per trade in $. */
  expectancy: number;
  /** Sum and average of R over trades that have a stop. */
  totalR: number;
  avgR: number | null;
  rCount: number;
  /** Largest peak-to-trough drop of the cumulative P&L in $. */
  maxDrawdown: number;
  /** The same drop measured on the cumulative R curve. */
  maxDrawdownR: number;
  longestLosingStreak: number;
  longestWinningStreak: number;
  best: number;
  worst: number;
  /** Cumulative P&L after each trade, starting at 0 (length = count + 1). */
  equity: number[];
  /** Cumulative R after each trade (trades without a stop add 0). */
  equityR: number[];
}

export function journalStats(trades: JournalTrade[]): JournalStats {
  const sorted = sortTrades(trades);
  const pnls = sorted.map(tradePnl);
  const rs = sorted.map(tradeR);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  const equity = [0];
  const equityR = [0];
  let peak = 0;
  let maxDrawdown = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  let streak = 0;
  let longestLosingStreak = 0;
  let winStreak = 0;
  let longestWinningStreak = 0;
  pnls.forEach((p, i) => {
    const e = equity[equity.length - 1] + p;
    equity.push(e);
    equityR.push(equityR[equityR.length - 1] + (rs[i] ?? 0));
    peak = Math.max(peak, e);
    maxDrawdown = Math.max(maxDrawdown, peak - e);
    peakR = Math.max(peakR, equityR[equityR.length - 1]);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - equityR[equityR.length - 1]);
    streak = p < 0 ? streak + 1 : 0;
    longestLosingStreak = Math.max(longestLosingStreak, streak);
    winStreak = p > 0 ? winStreak + 1 : 0;
    longestWinningStreak = Math.max(longestWinningStreak, winStreak);
  });
  const withR = rs.filter((r): r is number => r !== null);
  const totalR = withR.reduce((a, b) => a + b, 0);
  const netPnl = equity[equity.length - 1];
  return {
    count: pnls.length,
    wins: wins.length,
    losses: losses.length,
    winRate: pnls.length ? wins.length / pnls.length : 0,
    netPnl,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    expectancy: pnls.length ? netPnl / pnls.length : 0,
    totalR,
    avgR: withR.length ? totalR / withR.length : null,
    rCount: withR.length,
    maxDrawdown,
    maxDrawdownR,
    longestLosingStreak,
    longestWinningStreak,
    best: pnls.length ? Math.max(...pnls) : 0,
    worst: pnls.length ? Math.min(...pnls) : 0,
    equity,
    equityR,
  };
}

const CSV_COLUMNS = ["date", "symbol", "side", "entry", "stop", "exit", "qty", "fees", "pnl", "r", "setup", "note", "checks", "time", "exitTime", "tags", "mistakes", "target"] as const;

/** CSV for spreadsheets (semicolon separated, decimal comma, as German Excel expects). */
export function toCsv(trades: JournalTrade[]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(+v.toPrecision(12)).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = sortTrades(trades).map((t) =>
    [t.date, t.symbol, t.side, t.entry, t.stop, t.exit, t.qty, t.fees, tradePnl(t), tradeR(t), t.setup, t.note, t.checks?.join(","), t.time, t.exitTime, t.tags?.join(","), t.mistakes?.join(","), t.target].map(cell).join(";"),
  );
  return [CSV_COLUMNS.join(";"), ...rows].join("\n");
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const strings = (a: unknown[]) => [...new Set(a.filter((c): c is string => typeof c === "string" && c.trim() !== "").map((c) => c.trim()))];
/** Id of the built-in playbook that holds the Percoco checklist. */
export const PERCOCO_PLAYBOOK = "percoco";

/** Validates trades from a backup file; drops entries that are not usable. */
export function parseBackup(json: unknown): JournalTrade[] {
  const list = Array.isArray(json) ? json : json && typeof json === "object" && Array.isArray((json as { trades?: unknown }).trades) ? (json as { trades: unknown[] }).trades : null;
  if (!list) throw new Error("Keine Trades in der Datei gefunden");
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));
  return list.flatMap((raw, i) => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const t: JournalTrade = {
      id: typeof r.id === "string" && r.id ? r.id : `import-${Date.now()}-${i}`,
      date: typeof r.date === "string" ? r.date.slice(0, 10) : "",
      symbol: typeof r.symbol === "string" ? r.symbol : "",
      side: r.side === "short" ? "short" : "long",
      entry: n(r.entry),
      stop: r.stop === undefined || r.stop === null || r.stop === "" ? undefined : n(r.stop),
      exit: n(r.exit),
      ...(r.target === undefined || r.target === null || r.target === "" || !Number.isFinite(n(r.target)) ? {} : { target: n(r.target) }),
      qty: n(r.qty),
      fees: Number.isFinite(n(r.fees)) ? n(r.fees) : 0,
      pnl: r.pnl === undefined || r.pnl === null || r.pnl === "" ? undefined : n(r.pnl),
      setup: typeof r.setup === "string" ? r.setup : undefined,
      note: typeof r.note === "string" ? r.note : undefined,
      ...(Array.isArray(r.checks) ? { checks: strings(r.checks) } : {}),
      ...(typeof r.time === "string" && TIME_RE.test(r.time) ? { time: r.time } : {}),
      ...(typeof r.exitTime === "string" && TIME_RE.test(r.exitTime) ? { exitTime: r.exitTime } : {}),
      ...(typeof r.playbook === "string" && r.playbook ? { playbook: r.playbook } : {}),
      ...(Array.isArray(r.tags) && strings(r.tags).length ? { tags: strings(r.tags) } : {}),
      ...(Array.isArray(r.mistakes) && strings(r.mistakes).length ? { mistakes: strings(r.mistakes) } : {}),
      ...(Array.isArray(r.images) && strings(r.images).length ? { images: strings(r.images) } : {}),
      ...(typeof r.rating === "number" && r.rating >= 1 && r.rating <= 5 ? { rating: Math.round(r.rating) } : {}),
    };
    // Journals before the playbooks: the checklist was the Percoco model's.
    if (t.checks && !t.playbook) t.playbook = PERCOCO_PLAYBOOK;
    if (t.stop !== undefined && !Number.isFinite(t.stop)) t.stop = undefined;
    const pricesOk = [t.entry, t.exit, t.qty].every(Number.isFinite);
    const pnlOk = t.pnl !== undefined && Number.isFinite(t.pnl);
    return /^\d{4}-\d{2}-\d{2}$/.test(t.date) && (pricesOk || pnlOk) ? [t] : [];
  });
}
