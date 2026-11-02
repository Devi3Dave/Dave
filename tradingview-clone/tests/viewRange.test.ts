import { describe, expect, it } from "vitest";
import { checkPriceRange, formatSpan, parseNumber, spanSeconds, splitSpan, windowForSpan, windowForTimes } from "../shared/viewRange";

// 1-minute candles over two days.
const bars = Array.from({ length: 2 * 1440 }, (_, i) => ({ time: 1_000_000 + i * 60, open: 1, high: 1, low: 1, close: 1, volume: 0 }));
const hourly = Array.from({ length: 100 }, (_, i) => ({ time: 1_000_000 + i * 3600, open: 1, high: 1, low: 1, close: 1, volume: 0 }));

describe("visible time span", () => {
  it("converts value and unit to seconds", () => {
    expect(spanSeconds(15, "m")).toBe(900);
    expect(spanSeconds(2, "h")).toBe(7200);
    expect(spanSeconds(2, "d")).toBe(172800);
    expect(spanSeconds(1.5, "h")).toBe(5400);
    expect(spanSeconds(0, "h")).toBeNull();
    expect(spanSeconds(NaN, "d")).toBeNull();
  });

  it("splits and names spans in the largest even unit", () => {
    expect(splitSpan(172800)).toEqual({ value: 2, unit: "d" });
    expect(splitSpan(5400)).toEqual({ value: 90, unit: "m" });
    expect(formatSpan(900)).toBe("15 Minuten");
    expect(formatSpan(3600)).toBe("1 Stunde");
    expect(formatSpan(172800)).toBe("2 Tage");
  });

  it("shows exactly the newest span of candles", () => {
    const w = windowForSpan(bars, 15 * 60)!;
    expect(w.bars).toBe(15);
    expect(w.from).toBe(bars.length - 15 - 0.5);
    expect(w.to).toBeGreaterThan(bars.length - 0.5);
    expect(w.clippedStart).toBe(false);
    expect(windowForSpan(bars, 2 * 3600)!.bars).toBe(120);
  });

  it("widens a span shorter than a few candles and flags missing history", () => {
    const short = windowForSpan(hourly, 15 * 60)!;
    expect(short.widened).toBe(true);
    expect(short.bars).toBe(3);
    const long = windowForSpan(hourly, 30 * 86400)!;
    expect(long.clippedStart).toBe(true);
    expect(long.bars).toBe(100);
  });

  it("shows a from–to window on the loaded candles", () => {
    const w = windowForTimes(bars, 1_000_000 + 60 * 60, 1_000_000 + 120 * 60)!;
    expect(w).toMatchObject({ from: 59.5, to: 119.5, bars: 60, clippedStart: false, widened: false });
    expect(windowForTimes(bars, 10, 5)).toBeNull();
  });
});

describe("manual price range", () => {
  it("checks min and max", () => {
    expect(checkPriceRange(100, 200)).toBeNull();
    expect(checkPriceRange(200, 100)).toMatch(/größer/);
    expect(checkPriceRange(NaN, 100)).toMatch(/Zahlen/);
  });

  it("reads German and plain numbers", () => {
    expect(parseNumber("68.500,5")).toBe(68500.5);
    expect(parseNumber("68500.5")).toBe(68500.5);
    expect(parseNumber("0,0012")).toBe(0.0012);
    expect(parseNumber("abc")).toBeNaN();
    expect(parseNumber("")).toBeNaN();
  });
});
