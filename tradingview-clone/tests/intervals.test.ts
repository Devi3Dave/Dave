import { describe, expect, it } from "vitest";
import { aggregate, binanceInterval, bucketTime, isCalendarInterval } from "../shared/marketData";
import type { Bar } from "../shared/math";

const utc = (y: number, m: number, d = 1, h = 0) => Date.UTC(y, m - 1, d, h) / 1000;
const bar = (time: number, o: number, h: number, l: number, c: number, v: number): Bar => ({ time, open: o, high: h, low: l, close: c, volume: v, buyVolume: v / 2 });

describe("calendar intervals", () => {
  it("buckets by UTC month, quarter and year", () => {
    expect(bucketTime("1M", utc(2024, 2, 17, 13))).toBe(utc(2024, 2));
    expect(bucketTime("3M", utc(2024, 5, 3))).toBe(utc(2024, 4));
    expect(bucketTime("3M", utc(2024, 12, 31))).toBe(utc(2024, 10));
    expect(bucketTime("1y", utc(2024, 7, 9))).toBe(utc(2024, 1));
  });

  it("tolerates monthly candles stamped late on the previous day", () => {
    // Yahoo: 1 March 00:00 CET = 29 Feb 23:00 UTC
    expect(bucketTime("1M", utc(2024, 2, 29, 23))).toBe(utc(2024, 3));
    expect(bucketTime("1y", utc(2023, 12, 31, 23))).toBe(utc(2024, 1));
  });

  it("aggregates monthly candles into quarters", () => {
    const months = [
      bar(utc(2024, 1), 10, 12, 9, 11, 100),
      bar(utc(2024, 2), 11, 15, 10, 14, 200),
      bar(utc(2024, 3), 14, 14, 8, 9, 300),
      bar(utc(2024, 4), 9, 10, 7, 8, 50),
    ];
    const q = aggregate(months, "3M");
    expect(q).toHaveLength(2);
    expect(q[0]).toEqual({ time: utc(2024, 1), open: 10, high: 15, low: 8, close: 9, volume: 600, buyVolume: 300 });
    expect(q[1].time).toBe(utc(2024, 4));
    expect(months[0].volume).toBe(100); // input untouched
  });

  it("maps to Binance source intervals", () => {
    expect(binanceInterval("1M")).toBe("1M");
    expect(binanceInterval("3M")).toBe("1M");
    expect(binanceInterval("1y")).toBe("1M");
    expect(binanceInterval("all")).toBe("1w");
    expect(binanceInterval("4h")).toBe("4h");
    expect(isCalendarInterval("1m")).toBe(false);
    expect(isCalendarInterval("1M")).toBe(true);
  });
});
