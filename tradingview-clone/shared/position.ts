import { liquidationPrice } from "./liquidations";
import type { Bar } from "./math";

export type Side = "long" | "short";

export interface PositionInput {
  side: Side;
  entry: number;
  stop: number;
  target: number;
  /** Entry time (unix seconds); the trade is evaluated on the bars after it. */
  from: number;
  /** End of the trade window (unix seconds, may lie in the future). */
  to: number;
  /** Account size in quote currency. */
  account: number;
  /** Risk per trade in percent of the account. */
  risk: number;
  leverage: number;
}

export type PositionStatus = "invalid" | "running" | "target" | "stop" | "expired";

export interface PositionStats {
  valid: boolean;
  /** Reward-to-risk ratio. */
  rr: number;
  riskPct: number;
  rewardPct: number;
  qty: number;
  riskAmount: number;
  rewardAmount: number;
  notional: number;
  margin: number;
  liqPrice: number | null;
  /** Liquidation would hit before the stop (leverage too high for this stop). */
  liqBeforeStop: boolean;
  status: PositionStatus;
  exitTime: number | null;
  exitPrice: number | null;
  /** Realised or open profit/loss at the exit (or latest) price. */
  pnl: number;
  pnlPct: number;
}

export function isValidPosition(p: Pick<PositionInput, "side" | "entry" | "stop" | "target">): boolean {
  return p.side === "long" ? p.stop < p.entry && p.entry < p.target : p.target < p.entry && p.entry < p.stop;
}

export function positionStats(p: PositionInput, bars: Bar[]): PositionStats {
  const dir = p.side === "long" ? 1 : -1;
  const valid = isValidPosition(p) && p.entry > 0;
  const riskDist = Math.abs(p.entry - p.stop);
  const rewardDist = Math.abs(p.target - p.entry);
  const riskAmount = (p.account * p.risk) / 100;
  const qty = riskDist > 0 ? riskAmount / riskDist : 0;
  const notional = qty * p.entry;
  const leverage = Math.max(1, p.leverage || 1);
  const liqPrice = leverage > 1 ? liquidationPrice(p.entry, leverage, p.side) : null;
  const stats: PositionStats = {
    valid,
    rr: riskDist > 0 ? rewardDist / riskDist : 0,
    riskPct: (riskDist / p.entry) * 100,
    rewardPct: (rewardDist / p.entry) * 100,
    qty,
    riskAmount,
    rewardAmount: qty * rewardDist,
    notional,
    margin: notional / leverage,
    liqPrice,
    liqBeforeStop: liqPrice !== null && (p.side === "long" ? liqPrice >= p.stop : liqPrice <= p.stop),
    status: valid ? "running" : "invalid",
    exitTime: null,
    exitPrice: null,
    pnl: 0,
    pnlPct: 0,
  };
  if (!valid) return stats;

  let lastClose: number | null = null;
  for (const b of bars) {
    if (b.time <= p.from) continue;
    if (b.time > p.to) {
      stats.status = "expired";
      break;
    }
    const hitStop = dir === 1 ? b.low <= p.stop : b.high >= p.stop;
    const hitTarget = dir === 1 ? b.high >= p.target : b.low <= p.target;
    // Both inside one candle: the order is unknown, assume the worse outcome.
    if (hitStop || hitTarget) {
      stats.status = hitStop ? "stop" : "target";
      stats.exitTime = b.time;
      stats.exitPrice = hitStop ? p.stop : p.target;
      break;
    }
    lastClose = b.close;
  }
  const exit = stats.exitPrice ?? lastClose;
  if (exit !== null) {
    if (stats.exitPrice === null) stats.exitPrice = exit;
    stats.pnl = qty * (exit - p.entry) * dir;
    stats.pnlPct = ((exit - p.entry) / p.entry) * 100 * dir;
  }
  return stats;
}

/** Mirror a clicked price onto the side of the entry where it belongs (stop below a long, target above, ...). */
export function placeOnSide(side: Side, entry: number, price: number, role: "stop" | "target"): number {
  const below = (side === "long") === (role === "stop");
  const dist = Math.abs(price - entry) || entry * 0.005;
  return below ? entry - dist : entry + dist;
}
