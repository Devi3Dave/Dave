import { describe, expect, it } from "vitest";
import { aggTradeToTrade, intervalSeconds, isValidInterval, loadMarketData } from "../shared/marketData";
import { addTrades, normalizeTradeInterval, parseTradeInterval, tickSizeFromPrices, type Trade } from "../shared/tickBars";

const t = (timeMs: number, price: number, qty = 1, count = 1, buy = true): Trade => ({ timeMs, price, qty, count, buy });

describe("tick and range intervals", () => {
  it("parses TradingView's tick and range intervals", () => {
    expect(parseTradeInterval("100T")).toEqual({ kind: "ticks", count: 100 });
    expect(parseTradeInterval("10R")).toEqual({ kind: "range", count: 10 });
    expect(parseTradeInterval("1m")).toBeNull();
    expect(parseTradeInterval("0T")).toBeNull();
    expect(isValidInterval("1000T")).toBe(true);
    expect(isValidInterval("1R")).toBe(true);
    expect(intervalSeconds("10T")).toBe(1);
  });

  it("reads typed tick and range intervals, a lowercase t stays days", () => {
    expect(normalizeTradeInterval("50T")).toBe("50T");
    expect(normalizeTradeInterval("50 Ticks")).toBe("50T");
    expect(normalizeTradeInterval("25 Bereiche")).toBe("25R");
    expect(normalizeTradeInterval("1 Bereich")).toBe("1R");
    expect(normalizeTradeInterval("5t")).toBeNull();
  });
});

describe("tick bars", () => {
  it("closes a bar after N trades and splits an aggregate trade across bars", () => {
    const bars = addTrades([], { kind: "ticks", count: 3 }, 0.01, [t(1000, 10), t(1100, 12, 1, 1, false), t(1200, 11), t(1300, 9, 4, 4)]);
    expect(bars).toHaveLength(3);
    expect(bars[0]).toMatchObject({ open: 10, high: 12, low: 10, close: 11, volume: 3, buyVolume: 2 });
    // The 4-trade aggregate: 3 trades fill the second bar, 1 starts the third, volume split 3:1.
    expect(bars[1]).toMatchObject({ open: 9, close: 9, volume: 3 });
    expect(bars[2]).toMatchObject({ open: 9, volume: 1 });
    expect(bars[2].time).toBeGreaterThan(bars[1].time);
  });

  it("keeps times unique and ordered within one millisecond", () => {
    const bars = addTrades([], { kind: "ticks", count: 1 }, 0.01, [t(5000, 1), t(5000, 2), t(5000, 3)]);
    expect(bars.map((b) => b.time)).toEqual([5, 5.001, 5.002]);
  });

  it("continues a live bar without changing the input", () => {
    const first = addTrades([], { kind: "ticks", count: 2 }, 0.01, [t(1000, 10)]);
    const next = addTrades(first, { kind: "ticks", count: 2 }, 0.01, [t(2000, 11)]);
    expect(first[0].close).toBe(10);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ close: 11, high: 11 });
  });
});

describe("range bars from trades", () => {
  it("spans count × tick size and opens the next bar at the close", () => {
    // 10 ranges of 0.01 = 0.10 per bar.
    const bars = addTrades([], { kind: "range", count: 10 }, 0.01, [t(1000, 100), t(1100, 100.05), t(1200, 100.12)]);
    expect(bars).toHaveLength(2);
    expect(bars[0].low).toBe(100);
    expect(bars[0].high).toBeCloseTo(100.1, 10);
    expect(bars[0].close).toBeCloseTo(100.1, 10);
    expect(bars[1].open).toBeCloseTo(100.1, 10);
    expect(bars[1].close).toBe(100.12);
  });

  it("fills the bars in between on a gap", () => {
    const bars = addTrades([], { kind: "range", count: 1 }, 1, [t(1000, 100), t(2000, 103.5)]);
    expect(bars.map((b) => [b.open, b.close])).toEqual([
      [100, 101],
      [101, 102],
      [102, 103],
      [103, 103.5],
    ]);
    expect(bars.every((b) => b.high - b.low <= 1 + 1e-9)).toBe(true);
  });
});

describe("trade helpers", () => {
  it("counts the single trades of a Binance aggregate trade", () => {
    expect(aggTradeToTrade({ a: 7, p: "65000.10", q: "0.5", f: 100, l: 104, T: 1700000000123, m: true })).toEqual({
      timeMs: 1700000000123,
      price: 65000.1,
      qty: 0.5,
      count: 5,
      buy: false,
    });
  });

  it("guesses the tick size from the prices", () => {
    expect(tickSizeFromPrices([65000.1, 65000.12, 65001])).toBe(0.01);
    expect(tickSizeFromPrices([5, 6])).toBe(1);
  });

  it("falls back to demo bars for symbols without Binance trades", async () => {
    const data = await loadMarketData("DEMOXYZ", "10T", 200);
    expect(data.source).toBe("demo");
    expect(data.bars.length).toBeGreaterThan(10);
    for (let i = 1; i < data.bars.length; i++) expect(data.bars[i].time).toBeGreaterThan(data.bars[i - 1].time);
  });
});
