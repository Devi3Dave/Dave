import { describe, expect, it } from "vitest";
import { journalStats, parseBackup, toCsv, tradePnl, tradeR, type JournalTrade } from "../shared/journal";

const trade = (p: Partial<JournalTrade>): JournalTrade => ({ id: Math.random().toString(36), date: "2026-10-01", symbol: "BTCUSDT", side: "long", entry: 100, stop: 95, exit: 110, qty: 10, fees: 0, ...p });

describe("trading journal", () => {
  it("computes P&L and R for long and short trades", () => {
    const long = trade({});
    expect(tradePnl(long)).toBe(100);
    expect(tradeR(long)).toBeCloseTo(2);
    const short = trade({ side: "short", entry: 100, stop: 105, exit: 90, qty: 2, fees: 4 });
    expect(tradePnl(short)).toBe(16);
    expect(tradeR(short)).toBeCloseTo(1.6);
    const loser = trade({ exit: 95 });
    expect(tradeR(loser)).toBeCloseTo(-1);
  });

  it("uses a manual P&L and has no R without a stop", () => {
    const t = trade({ pnl: -42, stop: undefined });
    expect(tradePnl(t)).toBe(-42);
    expect(tradeR(t)).toBeNull();
  });

  it("builds the equity curve and statistics in date order", () => {
    const trades = [
      trade({ date: "2026-10-03", exit: 120 }), // +200, +4R
      trade({ date: "2026-10-01", exit: 95 }), // -50, -1R
      trade({ date: "2026-10-02", exit: 95 }), // -50, -1R
    ];
    const s = journalStats(trades);
    expect(s.equity).toEqual([0, -50, -100, 100]);
    expect(s.equityR.map((r) => +r.toFixed(6))).toEqual([0, -1, -2, 2]);
    expect(s.netPnl).toBe(100);
    expect(s.winRate).toBeCloseTo(1 / 3);
    expect(s.profitFactor).toBe(2);
    expect(s.maxDrawdown).toBe(100);
    expect(s.longestLosingStreak).toBe(2);
    expect(s.avgR).toBeCloseTo(2 / 3);
    expect(s.expectancy).toBeCloseTo(100 / 3);
  });

  it("handles an empty journal", () => {
    const s = journalStats([]);
    expect(s.count).toBe(0);
    expect(s.equity).toEqual([0]);
    expect(s.profitFactor).toBe(0);
    expect(s.avgR).toBeNull();
  });

  it("exports CSV and restores backups", () => {
    const t = trade({ note: 'Breakout; "sauber"' });
    const csv = toCsv([t]);
    expect(csv.split("\n")[1]).toContain("100;95;110;10;0;100;2");
    expect(csv).toContain('"Breakout; ""sauber"""');
    const restored = parseBackup({ trades: [t, { date: "kaputt" }, null] });
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ entry: 100, stop: 95, exit: 110, qty: 10 });
    expect(() => parseBackup({})).toThrow();
  });
});
