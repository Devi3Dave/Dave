import { describe, expect, it } from "vitest";
import { STRATEGIES, defaultParams, getStrategy, runStrategy, type StrategyDef } from "../shared/strategyTester";
import type { Bar } from "../shared/math";

const bar = (i: number, open: number, close = open, high = Math.max(open, close), low = Math.min(open, close)): Bar => ({ time: i * 60, open, high, low, close, volume: 1 });
const settings = { capital: 1000, sizePct: 100, commissionPct: 0, direction: "both" as const };

/** Strategy with fixed signals: index → direction. */
const fixed = (map: Record<number, 1 | -1>): StrategyDef => ({ id: "t", name: "t", description: "", params: [], signals: (bars) => bars.map((_, i) => ({ dir: map[i] ?? 0 })) });

describe("strategy tester", () => {
  it("fills a signal at the next bar's open and reverses on the opposite signal", () => {
    const bars = [bar(0, 10), bar(1, 10), bar(2, 12), bar(3, 15), bar(4, 14), bar(5, 9)];
    const r = runStrategy(bars, fixed({ 1: 1, 3: -1 }), {}, settings);
    // Long at bar 2 open (12) with 1000/12 units, reversed at bar 4 open (14).
    expect(r.trades[0]).toMatchObject({ dir: 1, entryPrice: 12, exitPrice: 14, open: false });
    expect(r.trades[0].pnl).toBeCloseTo((1000 / 12) * 2);
    // The short is still open at the end, valued at the last close (9).
    const eq = 1000 + (1000 / 12) * 2;
    expect(r.trades[1]).toMatchObject({ dir: -1, entryPrice: 14, open: true });
    expect(r.openPnl).toBeCloseTo((eq / 14) * 5);
    expect(r.closedTrades).toBe(1);
    expect(r.netProfit).toBeCloseTo((1000 / 12) * 2);
    expect(r.equity[5]).toBeCloseTo(eq + (eq / 14) * 5);
    expect(r.buyHoldPct).toBeCloseTo(-10);
  });

  it("only exits on short signals in long-only mode and charges commission on both sides", () => {
    const bars = [bar(0, 10), bar(1, 10), bar(2, 10), bar(3, 11), bar(4, 11)];
    const r = runStrategy(bars, fixed({ 1: 1, 2: -1 }), {}, { ...settings, direction: "long", commissionPct: 1 });
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0];
    expect(t).toMatchObject({ dir: 1, entryPrice: 10, exitPrice: 11 });
    // 99 units bought for 990 after a 9.9… fee; simpler: qty = 1000/10 = 100, fees 10 + 11.
    expect(t.qty).toBeCloseTo(100);
    expect(t.pnl).toBeCloseTo(100 - 10 - 11);
    expect(r.commission).toBeCloseTo(21);
    expect(r.equity[4]).toBeCloseTo(1000 + 79);
  });

  it("measures drawdown from the equity peak", () => {
    const bars = [bar(0, 10), bar(1, 10), bar(2, 10, 20), bar(3, 20, 15), bar(4, 15, 18)];
    const r = runStrategy(bars, fixed({ 1: 1 }), {}, settings);
    // 100 units: equity 2000 at the peak, 1500 at the low.
    expect(r.maxDrawdown).toBeCloseTo(500);
    expect(r.maxDrawdownPct).toBeCloseTo(25);
  });

  it("fills channel breakout stop orders at the stop price, or the open after a gap", () => {
    const bars = [bar(0, 10, 10, 11, 9), bar(1, 10, 10, 11, 9), bar(2, 10, 12, 12.5, 10), bar(3, 8, 7, 8, 6.5)];
    const r = runStrategy(bars, getStrategy("channel")!, { length: 2 }, settings);
    expect(r.trades[0]).toMatchObject({ dir: 1, entryPrice: 11, entryIndex: 2, exitPrice: 8, exitIndex: 3 });
    expect(r.trades[1]).toMatchObject({ dir: -1, entryPrice: 8, open: true });
  });

  it("runs every built-in strategy with its defaults", () => {
    const bars = Array.from({ length: 300 }, (_, i) => {
      const c = 100 + 10 * Math.sin(i / 9) + i * 0.05;
      return bar(i, c - 0.5, c, c + 1, c - 1.5);
    });
    for (const s of STRATEGIES) {
      const r = runStrategy(bars, s, defaultParams(s), settings);
      expect(r.equity).toHaveLength(bars.length);
      expect(r.closedTrades).toBeGreaterThan(0);
      expect(r.netProfit).toBeCloseTo(r.grossProfit + r.grossLoss);
    }
  });
});
