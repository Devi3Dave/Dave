/**
 * Spread charts: a chart of two symbols (or a symbol and a number) combined with + − × ÷, as TradingView's
 * symbol expressions such as BTCUSDT/ETHUSDT. Each OHLC part is combined on its own (open with open, high
 * with high …) on candles both legs have; high and low are then taken over the four results, since a
 * ratio or difference of highs need not be the highest value.
 *
 * Source: TradingView Help Center, "Spread charts" / "How to build a spread chart" (symbol expressions with
 * the operators + - * /, legs aligned on common bar times). The volume is the first leg's, so volume-based
 * indicators keep working; the combined volume has no meaning of its own.
 */
import type { MarketData } from "./marketData.js";
import type { Bar } from "./math.js";

export type SpreadOp = "+" | "-" | "*" | "/";
export type SpreadLeg = { symbol: string } | { value: number };

export interface Spread {
  left: SpreadLeg;
  op: SpreadOp;
  right: SpreadLeg;
}

export const SPREAD_OP_LABELS: Record<SpreadOp, string> = { "/": "Verhältnis", "-": "Differenz", "+": "Summe", "*": "Produkt" };

const QUOTES = new Set(["USDT", "USDC", "BUSD", "FDUSD", "USD", "EUR", "BTC"]);
const SYMBOL = /^[A-Z0-9^=._:!-]+$/;

function leg(raw: string): SpreadLeg | null {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  if (/^[0-9.,]+$/.test(s) && Number.isFinite(n)) return { value: n };
  return SYMBOL.test(s) ? { symbol: s } : null;
}

/**
 * Reads a symbol expression; null for a plain symbol. "/", "*", "+" split anywhere. "-" splits with spaces
 * around it, or between two symbols of five or more characters (BTCUSDT-ETHUSDT), so tickers such as
 * BRK-B or BTC-USD stay one symbol.
 */
export function parseSpread(expr: string): Spread | null {
  const s = expr.trim().replace(/[−–]/g, "-").replace(/×/g, "*").replace(/÷/g, "/");
  const plain = /^(.+?)\s*([/*+])\s*(.+)$/.exec(s);
  const spaced = /^(.+?)\s+-\s+(.+)$/.exec(s);
  const joined = /^([^\s-]{5,})-([^\s-]{5,})$/.exec(s);
  let a: string;
  let b: string;
  let op: SpreadOp;
  if (plain) [a, op, b] = [plain[1], plain[2] as SpreadOp, plain[3]];
  else if (spaced) [a, op, b] = [spaced[1], "-", spaced[2]];
  else if (joined) [a, op, b] = [joined[1], "-", joined[2]];
  else return null;
  // BTC/USDT is one pair written with a slash, not a ratio.
  if (op === "/" && QUOTES.has(b.trim().toUpperCase())) return null;
  const left = leg(a);
  const right = leg(b);
  // Two numbers are no chart, and each leg must be a single symbol or number.
  if (!left || !right || ("value" in left && "value" in right)) return null;
  return { left, op, right };
}

export const isSpread = (symbol: string) => parseSpread(symbol) !== null;

const legText = (l: SpreadLeg) => ("symbol" in l ? l.symbol : String(l.value));

/** The expression written the same way every time (BTCUSDT/ETHUSDT, BTCUSDT - ETHUSDT). */
export function formatSpread(s: Spread): string {
  return s.op === "-" ? `${legText(s.left)} - ${legText(s.right)}` : `${legText(s.left)}${s.op}${legText(s.right)}`;
}

/** The symbols an expression needs to load. */
export const spreadSymbols = (s: Spread): string[] => [s.left, s.right].flatMap((l) => ("symbol" in l ? [l.symbol] : []));

function apply(op: SpreadOp, a: number, b: number): number {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    default:
      return a / b;
  }
}

/** The candles of the expression from the candles of its symbol legs (in the order of `spreadSymbols`). */
export function combineSpread(s: Spread, legs: Bar[][]): Bar[] {
  let next = 0;
  // Per side: the candles by time, or the fixed number.
  const sides = [s.left, s.right].map((l) => ("symbol" in l ? { byTime: new Map((legs[next++] ?? []).map((b) => [b.time, b])), value: 0 } : { byTime: null, value: l.value }));
  const base = legs[0] ?? [];
  const parts = ["open", "high", "low", "close"] as const;
  const out: Bar[] = [];
  for (const b of base) {
    const bars = sides.map((side) => side.byTime?.get(b.time));
    if (sides.some((side, k) => side.byTime && !bars[k])) continue;
    const values = parts.map((p) => apply(s.op, bars[0]?.[p] ?? sides[0].value, bars[1]?.[p] ?? sides[1].value));
    if (!values.every(Number.isFinite)) continue;
    const [open, , , close] = values;
    // The first symbol's volume (also when the number comes first).
    out.push({ time: b.time, open, close, high: Math.max(...values), low: Math.min(...values), volume: (bars[0] ?? bars[1])!.volume });
  }
  return out;
}

/** Loads both legs with `load` and combines them; demo data in a leg makes the whole chart demo data. */
export async function loadSpreadData(
  s: Spread,
  interval: string,
  limit: number,
  load: (symbol: string, interval: string, limit: number) => Promise<MarketData>,
): Promise<MarketData> {
  const legs = await Promise.all(spreadSymbols(s).map((symbol) => load(symbol, interval, limit)));
  const bars = combineSpread(
    s,
    legs.map((l) => l.bars),
  );
  if (!bars.length) throw new Error(`${formatSpread(s)}: keine gemeinsamen Kerzen (andere Handelszeiten oder Division durch 0)`);
  return { symbol: formatSpread(s), interval, source: legs.some((l) => l.source === "demo") ? "demo" : "spread", bars };
}
