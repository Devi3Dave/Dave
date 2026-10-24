// Pure trading math for the calculator page (position sizing, expectancy, R-multiples,
// Fibonacci, leverage). All amounts are in quote currency, rates as fractions 0..1.

/** Units to buy/sell so that hitting the stop loses exactly `risk`. */
export function positionSize(risk: number, entry: number, stop: number): number {
  const dist = Math.abs(entry - stop);
  return dist > 0 ? risk / dist : 0;
}

/** Expected result per trade in R: winRate × avgWin − lossRate × avgLoss. */
export function expectancy(winRate: number, avgWinR: number, avgLossR = 1): number {
  return winRate * avgWinR - (1 - winRate) * avgLossR;
}

/** Win rate at which the system breaks even (expectancy = 0). */
export function breakEvenWinRate(avgWinR: number, avgLossR = 1): number {
  return avgWinR + avgLossR > 0 ? avgLossR / (avgWinR + avgLossR) : 1;
}

/** Price at which a trade reaches `r` times its risk (direction follows entry vs. stop). */
export function targetPrice(entry: number, stop: number, r: number): number {
  return entry + r * (entry - stop);
}

export const FIB_RETRACEMENTS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_EXTENSIONS = [1, 1.618, 2.618, 3.618];

export interface FibLevel {
  ratio: number;
  price: number;
}

/** Retracement levels of the impulse a → b, measured back from b (0 % = b, 100 % = a). */
export function fibRetracement(a: number, b: number, ratios = FIB_RETRACEMENTS): FibLevel[] {
  return ratios.map((ratio) => ({ ratio, price: b - ratio * (b - a) }));
}

/** Trend-based extension: the impulse a → b projected from the pullback point c. */
export function fibExtension(a: number, b: number, c: number, ratios = FIB_EXTENSIONS): FibLevel[] {
  return ratios.map((ratio) => ({ ratio, price: c + ratio * (b - a) }));
}

/** Own capital needed for a leveraged position. */
export function requiredMargin(notional: number, leverage: number): number {
  return leverage > 0 ? notional / leverage : notional;
}

/** Small deterministic PRNG so a simulated trade series can be reproduced from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TradeSeries {
  /** R result of each trade. */
  results: number[];
  /** Cumulative R after each trade, starting with 0 before the first. */
  equity: number[];
  wins: number;
  maxDrawdown: number;
  longestLosingStreak: number;
}

/** Simulates `count` trades that either win `avgWinR` or lose `avgLossR`. */
export function simulateTrades(count: number, winRate: number, avgWinR: number, avgLossR: number, seed: number): TradeSeries {
  const rnd = mulberry32(seed);
  const results: number[] = [];
  const equity = [0];
  let peak = 0;
  let maxDrawdown = 0;
  let streak = 0;
  let longestLosingStreak = 0;
  let wins = 0;
  for (let i = 0; i < count; i++) {
    const win = rnd() < winRate;
    const r = win ? avgWinR : -avgLossR;
    results.push(r);
    const eq = equity[equity.length - 1] + r;
    equity.push(eq);
    peak = Math.max(peak, eq);
    maxDrawdown = Math.max(maxDrawdown, peak - eq);
    if (win) {
      wins++;
      streak = 0;
    } else {
      streak++;
      longestLosingStreak = Math.max(longestLosingStreak, streak);
    }
  }
  return { results, equity, wins, maxDrawdown, longestLosingStreak };
}

/** Probability of at least `n` losses in a row within `trades` trades. */
export function losingStreakProbability(n: number, trades: number, winRate: number): number {
  if (n <= 0) return 1;
  if (n > trades) return 0;
  const q = 1 - winRate;
  // p[k] = probability that the current run of losses has length k and no run of n happened yet.
  let p = new Array<number>(n).fill(0);
  p[0] = 1;
  for (let t = 0; t < trades; t++) {
    const next = new Array<number>(n).fill(0);
    for (let k = 0; k < n; k++) {
      next[0] += p[k] * winRate;
      if (k + 1 < n) next[k + 1] += p[k] * q;
    }
    p = next;
  }
  return 1 - p.reduce((s, v) => s + v, 0);
}
