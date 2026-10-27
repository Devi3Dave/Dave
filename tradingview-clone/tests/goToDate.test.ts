import { describe, expect, it } from "vitest";
import { findBarForDate, zonedToUtc } from "../shared/goToDate";

const bars = [0, 1, 2, 3].map((i) => ({ time: 1000 + i * 60, open: 1, high: 1, low: 1, close: 1, volume: 0 }));

describe("go to date", () => {
  it("reads the wall clock in the chart's time zone", () => {
    expect(zonedToUtc("2026-10-24", "14:30", "UTC")).toBe(Date.UTC(2026, 9, 24, 14, 30) / 1000);
    // Berlin is UTC+2 in summer time and UTC+1 after 25 October 2026.
    expect(zonedToUtc("2026-10-24", "14:30", "Europe/Berlin")).toBe(Date.UTC(2026, 9, 24, 12, 30) / 1000);
    expect(zonedToUtc("2026-10-26", "14:30", "Europe/Berlin")).toBe(Date.UTC(2026, 9, 26, 13, 30) / 1000);
    expect(zonedToUtc("2026-10-24", "", "America/New_York")).toBe(Date.UTC(2026, 9, 24, 4, 0) / 1000);
    expect(zonedToUtc("24.10.2026", "14:30", "UTC")).toBeNull();
  });

  it("finds the candle that contains the date", () => {
    expect(findBarForDate(bars, 1000)).toEqual({ kind: "ok", index: 0 });
    expect(findBarForDate(bars, 1119)).toEqual({ kind: "ok", index: 1 });
    expect(findBarForDate(bars, 1200)).toEqual({ kind: "ok", index: 3 });
    expect(findBarForDate(bars, 1239)).toEqual({ kind: "ok", index: 3 });
    expect(findBarForDate(bars, 1240)).toEqual({ kind: "after", last: 1180 });
    expect(findBarForDate(bars, 999)).toEqual({ kind: "before", first: 1000 });
    expect(findBarForDate([], 5)).toEqual({ kind: "empty" });
  });
});
