import { describe, expect, it } from "vitest";
import { feedInterval } from "../shared/exchangeFeed";
import { aggregate, baseInterval, binanceInterval, bucketTime, intervalSeconds, normalizeInterval, parseInterval } from "../shared/marketData";
import type { Bar } from "../shared/math";

describe("parseInterval", () => {
  it("knows presets and custom time frames up to a week", () => {
    expect(parseInterval("1s")).toBe(1);
    expect(parseInterval("45m")).toBe(2700);
    expect(parseInterval("7m")).toBe(420);
    expect(parseInterval("90s")).toBe(90);
    expect(parseInterval("2d")).toBe(172800);
    expect(parseInterval("8d")).toBeNull();
    expect(parseInterval("0m")).toBeNull();
    expect(parseInterval("abc")).toBeNull();
    expect(intervalSeconds("1M")).toBe(2629800);
  });
});

describe("normalizeInterval", () => {
  it("reads what people type and picks the largest whole unit", () => {
    expect(normalizeInterval("7m")).toBe("7m");
    expect(normalizeInterval(" 120 min ")).toBe("2h");
    expect(normalizeInterval("90s")).toBe("90s");
    expect(normalizeInterval("60s")).toBe("1m");
    expect(normalizeInterval("10")).toBe("10m");
    expect(normalizeInterval("2 Tage")).toBe("2d");
    expect(normalizeInterval("3 Std")).toBe("3h");
    expect(normalizeInterval("30d")).toBeNull();
    expect(normalizeInterval("x")).toBeNull();
  });
});

describe("binanceInterval / baseInterval", () => {
  it("requests native klines directly and merges the rest from the largest divisor", () => {
    expect(binanceInterval("1s")).toBe("1s");
    expect(binanceInterval("3d")).toBe("3d");
    expect(binanceInterval("5s")).toBe("1s");
    expect(binanceInterval("45m")).toBe("15m");
    expect(binanceInterval("7m")).toBe("1m");
    expect(binanceInterval("3h")).toBe("1h");
    expect(binanceInterval("2d")).toBe("1d");
    expect(binanceInterval("3M")).toBe("1M");
    expect(binanceInterval("all")).toBe("1w");
  });

  it("has no base below the smallest one", () => {
    expect(baseInterval("30s", ["1m", "5m"])).toBeNull();
  });
});

describe("bucketTime", () => {
  it("restarts time frames that do not divide a day at 00:00 UTC", () => {
    const day = 20000 * 86400;
    // 7 minutes: the last candle of a day is cut short, the next day starts fresh.
    expect(bucketTime("7m", day + 7 * 60 * 205 + 30)).toBe(day + 7 * 60 * 205);
    expect(bucketTime("7m", day + 86400 + 10)).toBe(day + 86400);
    expect(bucketTime("45m", day + 2700 + 5)).toBe(day + 2700);
  });
});

describe("aggregate seconds", () => {
  it("merges 1 s klines into 5 s candles", () => {
    const bars: Bar[] = Array.from({ length: 10 }, (_, i) => ({ time: 1000 + i, open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 1 }));
    const out = aggregate(bars, "5s");
    expect(out.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume])).toEqual([
      [1000, 0, 5, -1, 4.5, 5],
      [1005, 5, 10, 4, 9.5, 5],
    ]);
  });
});

describe("feedInterval (Twelve Data)", () => {
  it("merges custom time frames and refuses seconds", () => {
    expect(feedInterval("45m")).toEqual({ interval: "45min", aggregate: false });
    expect(feedInterval("3h")).toEqual({ interval: "1h", aggregate: true });
    expect(feedInterval("10m")).toEqual({ interval: "5min", aggregate: true });
    expect(() => feedInterval("5s")).toThrow();
  });
});
