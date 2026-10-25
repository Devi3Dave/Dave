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
  /** Units bought or sold. */
  qty: number;
  fees: number;
  /** Manually entered result in $; overrides the result computed from the prices. */
  pnl?: number;
  setup?: string;
  note?: string;
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
  longestLosingStreak: number;
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
  let streak = 0;
  let longestLosingStreak = 0;
  pnls.forEach((p, i) => {
    const e = equity[equity.length - 1] + p;
    equity.push(e);
    equityR.push(equityR[equityR.length - 1] + (rs[i] ?? 0));
    peak = Math.max(peak, e);
    maxDrawdown = Math.max(maxDrawdown, peak - e);
    streak = p < 0 ? streak + 1 : 0;
    longestLosingStreak = Math.max(longestLosingStreak, streak);
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
    longestLosingStreak,
    best: pnls.length ? Math.max(...pnls) : 0,
    worst: pnls.length ? Math.min(...pnls) : 0,
    equity,
    equityR,
  };
}

const CSV_COLUMNS = ["date", "symbol", "side", "entry", "stop", "exit", "qty", "fees", "pnl", "r", "setup", "note"] as const;

/** CSV for spreadsheets (semicolon separated, decimal comma, as German Excel expects). */
export function toCsv(trades: JournalTrade[]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(+v.toPrecision(12)).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = sortTrades(trades).map((t) =>
    [t.date, t.symbol, t.side, t.entry, t.stop, t.exit, t.qty, t.fees, tradePnl(t), tradeR(t), t.setup, t.note].map(cell).join(";"),
  );
  return [CSV_COLUMNS.join(";"), ...rows].join("\n");
}

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
      qty: n(r.qty),
      fees: Number.isFinite(n(r.fees)) ? n(r.fees) : 0,
      pnl: r.pnl === undefined || r.pnl === null || r.pnl === "" ? undefined : n(r.pnl),
      setup: typeof r.setup === "string" ? r.setup : undefined,
      note: typeof r.note === "string" ? r.note : undefined,
    };
    if (t.stop !== undefined && !Number.isFinite(t.stop)) t.stop = undefined;
    const pricesOk = [t.entry, t.exit, t.qty].every(Number.isFinite);
    const pnlOk = t.pnl !== undefined && Number.isFinite(t.pnl);
    return /^\d{4}-\d{2}-\d{2}$/.test(t.date) && (pricesOk || pnlOk) ? [t] : [];
  });
}
