import { describe, expect, it } from "vitest";
import { alignCompare, compareCloseAt, withCompare } from "../shared/compare";
import type { MarketData } from "../shared/marketData";
import type { Bar } from "../shared/math";
import { combineSpread, formatSpread, loadSpreadData, parseSpread, spreadSymbols } from "../shared/spread";

const bar = (time: number, open: number, high: number, low: number, close: number, volume = 10): Bar => ({ time, open, high, low, close, volume });

describe("parseSpread", () => {
  it("reads ratios, sums and products", () => {
    expect(parseSpread("btcusdt/ethusdt")).toEqual({ left: { symbol: "BTCUSDT" }, op: "/", right: { symbol: "ETHUSDT" } });
    expect(parseSpread("GC=F / SI=F")).toEqual({ left: { symbol: "GC=F" }, op: "/", right: { symbol: "SI=F" } });
    expect(parseSpread("AAPL+MSFT")?.op).toBe("+");
    expect(parseSpread("BTCUSDT*2")).toEqual({ left: { symbol: "BTCUSDT" }, op: "*", right: { value: 2 } });
  });

  it("reads a minus with spaces or between long symbols", () => {
    expect(parseSpread("BTCUSDT-ETHUSDT")?.op).toBe("-");
    expect(parseSpread("AAPL - MSFT")?.op).toBe("-");
  });

  it("keeps plain symbols and pairs as one symbol", () => {
    for (const s of ["BTCUSDT", "BRK-B", "BTC-USD", "EURUSD=X", "^GDAXI", "BTC/USDT", "1/2", ""]) expect(parseSpread(s)).toBeNull();
  });

  it("writes the expression the same way every time", () => {
    expect(formatSpread(parseSpread("btcusdt  /  ethusdt")!)).toBe("BTCUSDT/ETHUSDT");
    expect(formatSpread(parseSpread("BTCUSDT-ETHUSDT")!)).toBe("BTCUSDT - ETHUSDT");
    expect(spreadSymbols(parseSpread("2*ETHUSDT")!)).toEqual(["ETHUSDT"]);
  });
});

describe("combineSpread", () => {
  const a = [bar(1, 100, 110, 90, 105, 7), bar(2, 105, 120, 100, 110, 8), bar(3, 110, 115, 105, 112)];
  const b = [bar(1, 50, 55, 45, 50), bar(3, 55, 56, 50, 56)];

  it("combines each OHLC part on candles both legs have", () => {
    const r = combineSpread(parseSpread("A0000/B0000")!, [a, b]);
    expect(r.map((x) => x.time)).toEqual([1, 3]);
    expect(r[0]).toEqual({ time: 1, open: 2, close: 2.1, high: 2.1, low: 2, volume: 7 });
  });

  it("takes high and low over the four results", () => {
    // 110-55 = 55 and 90-45 = 45, but the close difference 105-50 = 55 and open 100-50 = 50: high 55, low 45.
    const [r] = combineSpread(parseSpread("A0000 - B0000")!, [a, b]);
    expect([r.open, r.high, r.low, r.close]).toEqual([50, 55, 45, 55]);
    // A ratio of highs can be below the ratio of closes.
    const [q] = combineSpread(parseSpread("A0000/B0000")!, [[bar(1, 10, 12, 8, 11)], [bar(1, 10, 20, 5, 10)]]);
    expect(q.high).toBe(Math.max(1, 0.6, 1.6, 1.1));
    expect(q.low).toBe(0.6);
  });

  it("works with a number and skips a division by zero", () => {
    expect(combineSpread(parseSpread("A0000*2")!, [a]).map((x) => x.close)).toEqual([210, 220, 224]);
    expect(combineSpread(parseSpread("A0000/B0000")!, [a, [bar(1, 0, 0, 0, 0)]])).toEqual([]);
  });

  it("loads both legs and marks demo data", async () => {
    const load = async (symbol: string, interval: string): Promise<MarketData> => ({ symbol, interval, source: symbol === "DEMO1" ? "demo" : "binance", bars: symbol === "ETHUSDT" ? b : a });
    const live = await loadSpreadData(parseSpread("BTCUSDT/ETHUSDT")!, "1h", 100, load);
    expect(live.symbol).toBe("BTCUSDT/ETHUSDT");
    expect(live.source).toBe("spread");
    expect((await loadSpreadData(parseSpread("DEMO1/ETHUSDT")!, "1h", 100, load)).source).toBe("demo");
    await expect(loadSpreadData(parseSpread("BTCUSDT/ETHUSDT")!, "1h", 100, async (s, i) => ({ ...(await load(s, i)), bars: s === "ETHUSDT" ? [] : a }))).rejects.toThrow(/keine gemeinsamen/);
  });
});

describe("compare", () => {
  const main = [bar(10, 1, 1, 1, 1), bar(20, 1, 1, 1, 1), bar(30, 1, 1, 1, 1)];
  it("keeps the compared closes within the chart's time range", () => {
    expect(alignCompare(main, [bar(0, 5, 5, 5, 5), bar(10, 6, 6, 6, 6), bar(30, 7, 7, 7, 7), bar(40, 8, 8, 8, 8)])).toEqual([
      { time: 10, value: 6 },
      { time: 30, value: 7 },
    ]);
  });

  it("finds the close at or before a time", () => {
    const other = [bar(10, 0, 0, 0, 1), bar(30, 0, 0, 0, 3)];
    expect(compareCloseAt(other, 5)).toBeNull();
    expect(compareCloseAt(other, 20)).toBe(1);
    expect(compareCloseAt(other, 30)).toBe(3);
  });

  it("adds symbols once, never the chart's own, at most five", () => {
    expect(withCompare(["ETHUSDT"], "ethusdt", "BTCUSDT")).toEqual(["ETHUSDT"]);
    expect(withCompare([], "BTCUSDT", "BTCUSDT")).toEqual([]);
    expect(withCompare(["A", "B", "C", "D", "E"], "F", "X")).toHaveLength(5);
    expect(withCompare([], " solusdt ", "BTCUSDT")).toEqual(["SOLUSDT"]);
  });
});
