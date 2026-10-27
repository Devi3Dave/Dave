import { bollinger, ema, highest, lowest, macd, rsi, sma, supertrend, type Bar, type Series } from "./math.js";

/**
 * Strategy tester after TradingView's built-in strategies (the Pine sources shipped with TradingView:
 * "MovingAvg2Line Cross", "RSI Strategy", "MACD Strategy", "Bollinger Bands Strategy",
 * "Supertrend Strategy", "ChannelBreakOutStrategy") and the Pine broker emulator's defaults:
 * a signal on a bar's close fills at the next bar's open, an entry in the other direction
 * reverses the position, stop entries fill when the price reaches them.
 * Report fields follow TradingView's "Performance Summary".
 */

export interface StrategyParamDef {
  key: string;
  label: string;
  default: number;
  min?: number;
  step?: number;
}

export interface StrategyDef {
  id: string;
  name: string;
  description: string;
  params: StrategyParamDef[];
  /** Entries per bar: +1 long, -1 short, 0 nothing. `stop` makes it a stop order at that price for the next bar. */
  signals(bars: Bar[], p: Record<string, number>): Signal[];
}

export interface Signal {
  dir: 1 | -1 | 0;
  stop?: number;
  /** Long and short stop orders standing at once (channel breakout); the first one reached fills. */
  both?: { long: number; short: number };
}

const closes = (bars: Bar[]): Series => bars.map((b) => b.close);

/** Pine ta.crossover / ta.crossunder of two series (or a series and a level). */
function crossed(a: Series, b: Series | number, i: number, up: boolean): boolean {
  const bv = (k: number) => (typeof b === "number" ? b : b[k]);
  const a0 = a[i];
  const a1 = a[i - 1];
  const b0 = bv(i);
  const b1 = bv(i - 1);
  if (a0 === null || a1 === null || a0 === undefined || a1 === undefined || b0 === null || b1 === null || b0 === undefined || b1 === undefined) return false;
  return up ? a0 > b0 && a1 <= b1 : a0 < b0 && a1 >= b1;
}

export const STRATEGIES: StrategyDef[] = [
  {
    id: "macross",
    name: "MA-Kreuzung",
    description: "Long, wenn der schnelle SMA den langsamen nach oben kreuzt, Short beim Kreuzen nach unten (TradingView „MovingAvg2Line Cross“).",
    params: [
      { key: "fast", label: "Schneller MA", default: 9, min: 1 },
      { key: "slow", label: "Langsamer MA", default: 18, min: 2 },
      { key: "useEma", label: "EMA statt SMA (0/1)", default: 0, min: 0, step: 1 },
    ],
    signals(bars, p) {
      const c = closes(bars);
      const ma = p.useEma ? ema : sma;
      const f = ma(c, p.fast);
      const s = ma(c, p.slow);
      return bars.map((_, i) => ({ dir: crossed(f, s, i, true) ? 1 : crossed(f, s, i, false) ? -1 : 0 }));
    },
  },
  {
    id: "rsi",
    name: "RSI-Strategie",
    description: "Long, wenn der RSI über die überverkaufte Grenze steigt, Short, wenn er unter die überkaufte fällt (TradingView „RSI Strategy“).",
    params: [
      { key: "length", label: "RSI-Länge", default: 14, min: 2 },
      { key: "oversold", label: "Überverkauft", default: 30, min: 1 },
      { key: "overbought", label: "Überkauft", default: 70, min: 1 },
    ],
    signals(bars, p) {
      const r = rsi(closes(bars), p.length);
      return bars.map((_, i) => ({ dir: crossed(r, p.oversold, i, true) ? 1 : crossed(r, p.overbought, i, false) ? -1 : 0 }));
    },
  },
  {
    id: "macd",
    name: "MACD-Strategie",
    description: "Long, wenn MACD − Signal über 0 steigt, Short beim Fall unter 0 (TradingView „MACD Strategy“).",
    params: [
      { key: "fast", label: "Schnell", default: 12, min: 1 },
      { key: "slow", label: "Langsam", default: 26, min: 2 },
      { key: "signal", label: "Signal", default: 9, min: 1 },
    ],
    signals(bars, p) {
      const m = macd(closes(bars), p.fast, p.slow, p.signal);
      return bars.map((_, i) => ({ dir: crossed(m.histogram, 0, i, true) ? 1 : crossed(m.histogram, 0, i, false) ? -1 : 0 }));
    },
  },
  {
    id: "bollinger",
    name: "Bollinger-Bänder-Strategie",
    description: "Kreuzt der Schluss das untere Band nach oben, Long-Stop-Order am unteren Band; kreuzt er das obere nach unten, Short-Stop am oberen (TradingView „Bollinger Bands Strategy“).",
    params: [
      { key: "length", label: "Länge", default: 20, min: 2 },
      { key: "mult", label: "Faktor", default: 2, min: 0.1, step: 0.1 },
    ],
    signals(bars, p) {
      const c = closes(bars);
      const b = bollinger(c, p.length, p.mult);
      return bars.map((_, i) => {
        if (crossed(c, b.lower, i, true)) return { dir: 1, stop: b.lower[i] as number };
        if (crossed(c, b.upper, i, false)) return { dir: -1, stop: b.upper[i] as number };
        return { dir: 0 };
      });
    },
  },
  {
    id: "supertrend",
    name: "Supertrend-Strategie",
    description: "Long, wenn der Supertrend nach oben dreht, Short, wenn er nach unten dreht (TradingView „Supertrend Strategy“).",
    params: [
      { key: "period", label: "ATR-Länge", default: 10, min: 1 },
      { key: "factor", label: "Faktor", default: 3, min: 0.1, step: 0.1 },
    ],
    signals(bars, p) {
      const st = supertrend(bars, p.period, p.factor);
      const dir = bars.map((_, i) => (st.up[i] !== null ? 1 : st.down[i] !== null ? -1 : 0));
      return bars.map((_, i) => ({ dir: i > 0 && dir[i] !== 0 && dir[i - 1] !== 0 && dir[i] !== dir[i - 1] ? (dir[i] as 1 | -1) : 0 }));
    },
  },
  {
    id: "channel",
    name: "Kanalausbruch",
    description: "Stop-Orders am höchsten Hoch und tiefsten Tief der letzten n Kerzen, Ausbruch nach oben Long, nach unten Short (TradingView „ChannelBreakOutStrategy“).",
    params: [{ key: "length", label: "Länge", default: 5, min: 1 }],
    signals(bars, p) {
      const hi = highest(bars.map((b) => b.high), p.length);
      const lo = lowest(bars.map((b) => b.low), p.length);
      // Both stop orders stand at once; the tester fills whichever the next bar reaches first.
      return bars.map((_, i): Signal => (hi[i] === null || lo[i] === null ? { dir: 0 } : { dir: 0, both: { long: hi[i] as number, short: lo[i] as number } }));
    },
  },
];

export function getStrategy(id: string): StrategyDef | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

export function defaultParams(def: StrategyDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

export interface TesterSettings {
  capital: number;
  /** Order size in % of equity at entry. */
  sizePct: number;
  /** Commission per side in % of the trade value. */
  commissionPct: number;
  direction: "both" | "long" | "short";
}

export const DEFAULT_TESTER: TesterSettings = { capital: 10000, sizePct: 100, commissionPct: 0.1, direction: "both" };

export interface Trade {
  dir: 1 | -1;
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  /** Still open at the last bar, valued at its close. */
  open: boolean;
}

export interface Report {
  trades: Trade[];
  /** Equity at each bar's close (closed trades plus the open position at the close). */
  equity: number[];
  netProfit: number;
  netProfitPct: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  closedTrades: number;
  winners: number;
  losers: number;
  winRate: number;
  avgTrade: number;
  avgWin: number;
  avgLoss: number;
  ratioWinLoss: number | null;
  largestWin: number;
  largestLoss: number;
  avgBars: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  buyHold: number;
  buyHoldPct: number;
  openPnl: number;
  commission: number;
}

/** Runs a strategy over the bars and builds TradingView's performance summary. */
export function runStrategy(bars: Bar[], def: StrategyDef, params: Record<string, number>, settings: TesterSettings = DEFAULT_TESTER): Report {
  const signals = def.signals(bars, params);
  const allowed = (d: 1 | -1) => settings.direction === "both" || (settings.direction === "long" ? d === 1 : d === -1);
  const trades: Trade[] = [];
  const equity: number[] = [];
  let realized = 0;
  let commission = 0;
  type Position = { dir: 1 | -1; qty: number; price: number; index: number };
  let pos: Position | null = null;
  // Read through a function: TypeScript does not see the changes made inside the helpers below.
  const current = (): Position | null => pos;

  const close = (i: number, price: number) => {
    if (!pos) return;
    const value = pos.qty * price;
    const fee = (value * settings.commissionPct) / 100;
    const entryFee = (pos.qty * pos.price * settings.commissionPct) / 100;
    const gross = pos.dir * (price - pos.price) * pos.qty;
    const pnl = gross - fee - entryFee;
    commission += fee;
    realized += gross - fee;
    trades.push({
      dir: pos.dir,
      entryIndex: pos.index,
      entryTime: bars[pos.index].time,
      entryPrice: pos.price,
      exitIndex: i,
      exitTime: bars[i].time,
      exitPrice: price,
      qty: pos.qty,
      pnl,
      pnlPct: (pnl / (pos.qty * pos.price)) * 100,
      open: false,
    });
    pos = null;
  };
  const open = (i: number, dir: 1 | -1, price: number) => {
    const eq = settings.capital + realized;
    if (eq <= 0 || price <= 0) return;
    const qty = (eq * settings.sizePct) / 100 / price;
    const fee = (qty * price * settings.commissionPct) / 100;
    commission += fee;
    realized -= fee;
    pos = { dir, qty, price, index: i };
  };
  /** An entry signal: reverse, or only exit when that direction is not allowed. */
  const enter = (i: number, dir: 1 | -1, price: number) => {
    if (pos && pos.dir === dir) return;
    if (pos) close(i, price);
    if (allowed(dir)) open(i, dir, price);
  };

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const sig = i > 0 ? signals[i - 1] : undefined;
    if (sig?.both) {
      // Two stop orders: the one closer to the open is reached first.
      const { long, short } = sig.both;
      const hitLong = b.high >= long && current()?.dir !== 1;
      const hitShort = b.low <= short && current()?.dir !== -1;
      if (hitLong && hitShort) {
        const first: 1 | -1 = Math.abs(b.open - long) <= Math.abs(b.open - short) ? 1 : -1;
        enter(i, first, first === 1 ? Math.max(b.open, long) : Math.min(b.open, short));
      } else if (hitLong) enter(i, 1, Math.max(b.open, long));
      else if (hitShort) enter(i, -1, Math.min(b.open, short));
    } else if (sig && sig.dir !== 0) {
      if (sig.stop === undefined) enter(i, sig.dir, b.open);
      else {
        // Stop entry: long fills once the price rises to the stop, short once it falls to it.
        const hit = sig.dir === 1 ? b.high >= sig.stop : b.low <= sig.stop;
        if (hit) enter(i, sig.dir, sig.dir === 1 ? Math.max(b.open, sig.stop) : Math.min(b.open, sig.stop));
      }
    }
    const p = current();
    equity.push(settings.capital + realized + (p ? p.dir * (b.close - p.price) * p.qty : 0));
  }

  let openPnl = 0;
  const last = bars.length - 1;
  const finalPos = current();
  if (finalPos && last >= 0) {
    openPnl = finalPos.dir * (bars[last].close - finalPos.price) * finalPos.qty;
    trades.push({
      dir: finalPos.dir,
      entryIndex: finalPos.index,
      entryTime: bars[finalPos.index].time,
      entryPrice: finalPos.price,
      exitIndex: last,
      exitTime: bars[last].time,
      exitPrice: bars[last].close,
      qty: finalPos.qty,
      pnl: openPnl,
      pnlPct: (openPnl / (finalPos.qty * finalPos.price)) * 100,
      open: true,
    });
  }

  const closed = trades.filter((t) => !t.open);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = losses.reduce((s, t) => s + t.pnl, 0);
  const netProfit = grossProfit + grossLoss;
  let peak = settings.capital;
  let maxDd = 0;
  let maxDdPct = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    if (peak - e > maxDd) {
      maxDd = peak - e;
      maxDdPct = ((peak - e) / peak) * 100;
    }
  }
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const first = bars[0]?.close ?? 0;
  const lastClose = bars[last]?.close ?? 0;
  const buyHoldPct = first ? ((lastClose - first) / first) * 100 : 0;
  return {
    trades,
    equity,
    netProfit,
    netProfitPct: (netProfit / settings.capital) * 100,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss < 0 ? grossProfit / -grossLoss : null,
    closedTrades: closed.length,
    winners: wins.length,
    losers: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    avgTrade: closed.length ? netProfit / closed.length : 0,
    avgWin,
    avgLoss,
    ratioWinLoss: avgLoss < 0 ? avgWin / -avgLoss : null,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0,
    avgBars: closed.length ? closed.reduce((s, t) => s + (t.exitIndex - t.entryIndex), 0) / closed.length : 0,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    buyHold: (settings.capital * buyHoldPct) / 100,
    buyHoldPct,
    openPnl,
    commission,
  };
}
