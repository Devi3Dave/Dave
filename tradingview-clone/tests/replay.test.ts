import { describe, expect, it } from "vitest";
import { applyPrice, createAccount, openPosition, toJournalTrade } from "../shared/demoTrading";
import type { Bar } from "../shared/math";
import { barIndexAt, barPath, carryReplay, randomStart } from "../shared/replay";

const bar = (time: number, open = 100, close = 100, high = Math.max(open, close) + 1, low = Math.min(open, close) - 1): Bar => ({ time, open, high, low, close, volume: 1 });
const hourly = Array.from({ length: 10 }, (_, i) => bar(i * 3600));
const quarterHours = Array.from({ length: 40 }, (_, i) => bar(i * 900));

describe("barIndexAt", () => {
  it("finds the candle that contains a time", () => {
    expect(barIndexAt(hourly, 0)).toBe(0);
    expect(barIndexAt(hourly, 3600 * 3 + 120)).toBe(3);
    expect(barIndexAt(hourly, 3600 * 99)).toBe(9);
    expect(barIndexAt(hourly, -5)).toBe(-1);
  });
});

describe("carryReplay", () => {
  it("keeps the same moment on the same time frame", () => {
    expect(carryReplay(hourly, 4, hourly)).toBe(4);
  });

  it("shows only finished candles of a finer time frame", () => {
    // Four hours shown = sixteen quarter hours.
    expect(carryReplay(hourly, 4, quarterHours)).toBe(16);
  });

  it("hides a coarser candle that has not finished at that moment", () => {
    // 6 quarter hours = 1.5 h: only the first hour candle is complete.
    expect(carryReplay(quarterHours, 6, hourly)).toBe(1);
    expect(carryReplay(quarterHours, 3, hourly)).toBe(0);
  });

  it("shows everything once the replay has caught up", () => {
    expect(carryReplay(hourly, 10, quarterHours)).toBe(40);
  });
});

describe("barPath", () => {
  it("runs a rising candle through its low first, a falling one through its high", () => {
    expect(barPath(bar(0, 100, 110, 112, 95))).toEqual([100, 95, 112, 110]);
    expect(barPath(bar(0, 110, 100, 112, 95))).toEqual([110, 112, 95, 100]);
  });

  it("hits a stop inside a candle that closes above it", () => {
    let acc = createAccount(10_000, 0, 0);
    const opened = openPosition(acc, { symbol: "BTCUSDT", side: "long", qty: 1, leverage: 1, stop: 97 }, 100, {}, 0, "a");
    if (typeof opened === "string") throw new Error(opened);
    acc = opened;
    const closed = [];
    for (const price of barPath(bar(3600, 100, 104, 105, 96))) {
      const r = applyPrice(acc, "BTCUSDT", price, 3600_000);
      acc = r.account;
      closed.push(...r.closed);
    }
    expect(closed).toHaveLength(1);
    expect(closed[0].exit).toBe(97);
  });
});

describe("randomStart", () => {
  it("leaves history before and candles after the start", () => {
    expect(randomStart(1000, () => 0)).toBe(200);
    expect(randomStart(1000, () => 0.9999)).toBe(850);
    expect(randomStart(2)).toBe(0);
  });
});

describe("replay trades in the journal", () => {
  it("are marked as replay training", () => {
    const t = { id: "x", symbol: "BTCUSDT", side: "long" as const, qty: 1, entry: 100, leverage: 1, margin: 100, openFee: 0, openedAt: 0, exit: 110, closedAt: 0, reason: "manual" as const, closeFee: 0, pnl: 10, replay: true };
    expect(toJournalTrade(t).setup).toBe("Replay");
    expect(toJournalTrade({ ...t, replay: undefined }).setup).toBe("Demo");
  });
});
