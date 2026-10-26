import { describe, expect, it } from "vitest";
import { divergenceLine, divergences, pivotAt } from "../shared/divergence";
import type { Bar, Series } from "../shared/math";
import { newYorkOpens, sessionBoxes } from "../shared/sessions";

// Rules of Pine ta.pivotlow/pivothigh (ties: left equal allowed, right equal vetoes; LuxAlgo/PineTS #322)
// and of TradingView's open-source "RSI Divergence Indicator" (lbL 5, lbR 5, range 5–60).
describe("pivotAt (Pine ta.pivotlow / ta.pivothigh)", () => {
  it("finds a strict pivot low `right` bars back", () => {
    const v: Series = [5, 4, 3, 1, 3, 4, 5];
    expect(pivotAt(v, 5, 2, 2, "low")).toBe(3);
    expect(pivotAt(v, 4, 2, 2, "low")).toBe(-1);
  });
  it("lets an equal value on the left pass, but not on the right (plateau → later bar)", () => {
    const v: Series = [5, 5, 3, 3, 4, 5];
    expect(pivotAt(v, 4, 1, 1, "low")).toBe(3);
    expect(pivotAt(v, 3, 1, 1, "low")).toBe(-1);
    const h: Series = [1, 3, 3, 2];
    expect(pivotAt(h, 3, 1, 1, "high")).toBe(2);
    expect(pivotAt(h, 2, 1, 1, "high")).toBe(-1);
  });
  it("needs a full window without gaps", () => {
    expect(pivotAt([null, 2, 1, 2], 3, 2, 1, "low")).toBe(-1);
    expect(pivotAt([3, 2, 1, 2], 3, 2, 1, "low")).toBe(2);
  });
});

const bar = (i: number, low: number, high: number): Bar => ({ time: i * 900, open: low, high, low, close: (low + high) / 2, volume: 1 });

describe("divergences (TradingView RSI Divergence Indicator)", () => {
  // Oscillator pivot lows at 6 and 16 (found at 11 and 21 with lbR 5).
  const osc: Series = Array.from({ length: 30 }, (_, i) => (i === 6 ? 20 : i === 16 ? 25 : 50));
  const opts = { left: 5, right: 5, rangeLower: 5, rangeUpper: 60 };

  it("bullish: price lower low, oscillator higher low", () => {
    const bars = osc.map((_, i) => bar(i, i === 16 ? 90 : i === 6 ? 95 : 100, 110));
    const d = divergences(bars, osc, opts);
    expect(d).toEqual([{ kind: "bull", from: 6, to: 16 }]);
    const line = divergenceLine(osc, d, "bull");
    expect(line[6]).toBe(20);
    expect(line[16]).toBe(25);
    expect(line[11]).toBeCloseTo(22.5);
    expect(line[17]).toBeNull();
  });

  it("hidden bullish: price higher low, oscillator lower low", () => {
    const o2 = osc.map((v, i) => (i === 16 ? 15 : v));
    const bars = osc.map((_, i) => bar(i, i === 16 ? 97 : i === 6 ? 95 : 100, 110));
    expect(divergences(bars, o2, opts)).toEqual([{ kind: "hiddenBull", from: 6, to: 16 }]);
  });

  it("bearish: price higher high, oscillator lower high", () => {
    const o3: Series = Array.from({ length: 30 }, (_, i) => (i === 6 ? 80 : i === 16 ? 75 : 50));
    const bars = o3.map((_, i) => bar(i, 90, i === 16 ? 120 : i === 6 ? 115 : 110));
    expect(divergences(bars, o3, opts)).toEqual([{ kind: "bear", from: 6, to: 16 }]);
  });

  it("respects the lookback range: barssince(plFound[1]) = t - 1 - previous", () => {
    const bars = osc.map((_, i) => bar(i, i === 16 ? 90 : i === 6 ? 95 : 100, 110));
    // pivots found at 11 and 21 → barssince = 9
    expect(divergences(bars, osc, { ...opts, rangeUpper: 8 })).toEqual([]);
    expect(divergences(bars, osc, { ...opts, rangeUpper: 9 })).toHaveLength(1);
    expect(divergences(bars, osc, { ...opts, rangeLower: 10 })).toEqual([]);
  });
});

describe("sessions", () => {
  // 15m bars over Mon 2026-10-26 (New York still on EDT until 2026-11-01).
  const start = Date.UTC(2026, 9, 26, 0, 0) / 1000;
  const bars: Bar[] = Array.from({ length: 96 }, (_, i) => ({ time: start + i * 900, open: 100, high: 100 + i, low: 100 - i, close: 100, volume: 1 }));

  it("draws the NY open at 9:30 New York = 13:30 UTC in summer time", () => {
    expect(newYorkOpens(bars, 10).map((l) => l.time)).toEqual([Date.UTC(2026, 9, 26, 13, 30) / 1000]);
  });

  it("boxes the New York session from 9:30 to 16:00 with its high and low", () => {
    const [ny] = sessionBoxes(bars, "nyse", "New York", 10);
    expect(ny.from).toBe(Date.UTC(2026, 9, 26, 13, 30) / 1000);
    expect(ny.to).toBe(Date.UTC(2026, 9, 26, 20, 0) / 1000);
    // bars 54 (13:30) … 79 (19:45)
    expect(ny.top).toBe(179);
    expect(ny.bottom).toBe(21);
  });

  it("uses 14:30 UTC after the US clock change", () => {
    const s = Date.UTC(2026, 10, 2, 0, 0) / 1000;
    const b: Bar[] = Array.from({ length: 96 }, (_, i) => ({ time: s + i * 900, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
    expect(newYorkOpens(b, 10).map((l) => l.time)).toEqual([Date.UTC(2026, 10, 2, 14, 30) / 1000]);
  });
});
