import { describe, expect, it } from "vitest";
import {
  SHAPES,
  SHAPE_KINDS,
  anchoredVwapLine,
  dateRangeStats,
  fibTimeZones,
  gannAngleEnd,
  harmonicRatios,
  patternLabels,
  pitchforkOrigin,
  regressionTrend,
} from "../shared/drawingShapes";
import type { Bar } from "../shared/math";
import { moveAnchor, shiftDrawing } from "../src/drawingOps";
import type { Drawing } from "../src/store";

const bar = (time: number, close: number, volume = 1, high = close, low = close): Bar => ({ time, open: close, high, low, close, volume });

describe("drawing shapes", () => {
  it("has one definition per kind with hints for every point", () => {
    expect(SHAPES.map((s) => s.id).sort()).toEqual([...SHAPE_KINDS].sort());
    for (const s of SHAPES) expect(s.hints).toHaveLength(s.points);
  });

  it("labels every point of the patterns", () => {
    for (const s of SHAPES.filter((x) => x.group === "Muster")) expect(patternLabels(s.id)).toHaveLength(s.points);
  });

  it("moves the pitchfork pivot for Schiff and modified Schiff", () => {
    const p = [
      { time: 0, price: 100 },
      { time: 10, price: 120 },
      { time: 20, price: 110 },
    ];
    expect(pitchforkOrigin("pitchfork", p)).toEqual({ time: 0, price: 100 });
    expect(pitchforkOrigin("schiff", p)).toEqual({ time: 0, price: 110 });
    expect(pitchforkOrigin("modschiff", p)).toEqual({ time: 5, price: 110 });
  });

  it("puts Fibonacci time zones at Fibonacci multiples of the unit", () => {
    expect(fibTimeZones({ time: 100, price: 1 }, { time: 160, price: 1 }).slice(0, 7)).toEqual([100, 160, 220, 280, 400, 580, 880]);
  });

  it("runs the Gann 1×1 line through the second point and 1×2 twice as steep", () => {
    const a = { time: 0, price: 100 };
    const b = { time: 10, price: 110 };
    expect(gannAngleEnd(a, b, [1, 1])).toEqual(b);
    expect(gannAngleEnd(a, b, [1, 2])).toEqual({ time: 10, price: 120 });
    expect(gannAngleEnd(a, b, [2, 1])).toEqual({ time: 20, price: 110 });
  });

  it("fits the regression trend exactly to a straight line", () => {
    const bars = [0, 1, 2, 3, 4, 5].map((i) => bar(i * 60, 100 + 2 * i));
    const r = regressionTrend(bars, 60, 300)!;
    expect(r.count).toBe(5);
    expect(r.from.price).toBeCloseTo(102);
    expect(r.to.price).toBeCloseTo(110);
    expect(r.deviation).toBeCloseTo(0);
    expect(r.pearson).toBeCloseTo(1);
  });

  it("measures the spread around the regression line", () => {
    const bars = [bar(0, 1), bar(1, 3), bar(2, 1), bar(3, 3)];
    const r = regressionTrend(bars, 0, 3)!;
    // Least squares of 1,3,1,3: slope 0.4, intercept 1.4; residuals -0.4, 1.2, -1.2, 0.4.
    expect(r.from.price).toBeCloseTo(1.4);
    expect(r.to.price).toBeCloseTo(2.6);
    expect(r.deviation).toBeCloseTo(Math.sqrt(3.2 / 4), 5);
  });

  it("computes the anchored VWAP from hlc3 and volume from the anchor on", () => {
    const bars = [bar(0, 50, 5), bar(60, 10, 1, 12, 8), bar(120, 20, 3, 22, 18)];
    const line = anchoredVwapLine(bars, 60);
    expect(line.map((p) => p.time)).toEqual([60, 120]);
    expect(line[0].price).toBeCloseTo(10);
    expect(line[1].price).toBeCloseTo((10 * 1 + 20 * 3) / 4);
  });

  it("counts candles and volume in a date range", () => {
    const bars = [0, 1, 2, 3].map((i) => bar(i * 60, 1, 2));
    expect(dateRangeStats(bars, 180, 60)).toEqual({ bars: 2, seconds: 120, volume: 6 });
  });

  it("gives the XABCD ratios AB/XA, BC/AB, CD/BC and AD/XA", () => {
    const p = [100, 200, 138.2, 180, 121.4].map((price, i) => ({ time: i, price }));
    const r = harmonicRatios("xabcd", p).map((x) => +x.value.toFixed(3));
    expect(r).toEqual([0.618, 0.676, 1.402, 0.786]);
  });
});

describe("shape drawings in edits", () => {
  const d: Drawing = {
    id: "s",
    author: "user",
    kind: "shape",
    shape: "pitchfork",
    color: "#2962ff",
    points: [
      { time: 0, price: 1 },
      { time: 10, price: 2 },
      { time: 20, price: 3 },
    ],
  };

  it("moves one point", () => {
    const moved = moveAnchor(d, 2, { time: 30, price: 4 });
    expect(moved?.kind === "shape" && moved.points[2]).toEqual({ time: 30, price: 4 });
    expect(moveAnchor(d, 3, { time: 0, price: 0 })).toBeNull();
  });

  it("shifts all points", () => {
    const s = shiftDrawing(d, (t) => t + 5, 1);
    expect(s.kind === "shape" && s.points).toEqual([
      { time: 5, price: 2 },
      { time: 15, price: 3 },
      { time: 25, price: 4 },
    ]);
  });
});
