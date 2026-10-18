import { describe, expect, it } from "vitest";
import type { Bar } from "../shared/math";
import { autoFibonacci, detectCandlePatterns, detectFormations, findPivots } from "../shared/patterns";

const mk = (o: number, h: number, l: number, c: number, i: number): Bar => ({ time: i * 3600, open: o, high: h, low: l, close: c, volume: 1 });

/** A falling series (for "after a downtrend" patterns) followed by the given candles. */
function afterTrend(dir: "down" | "up", tail: [number, number, number, number][]): Bar[] {
  const bars: Bar[] = [];
  let p = 100;
  for (let i = 0; i < 20; i++) {
    const next = p + (dir === "down" ? -1 : 1);
    bars.push(mk(p, Math.max(p, next) + 0.2, Math.min(p, next) - 0.2, next, i));
    p = next;
  }
  tail.forEach((t, k) => bars.push(mk(...t, 20 + k)));
  return bars;
}

/** Bars whose highs/lows follow a path of swing prices, linearly between them. */
function fromPath(path: number[], steps = 8): Bar[] {
  const closes: number[] = [];
  for (let k = 0; k < path.length - 1; k++) for (let s = 0; s < steps; s++) closes.push(path[k] + ((path[k + 1] - path[k]) * s) / steps);
  closes.push(path[path.length - 1]);
  return closes.map((c, i) => mk(c, c + 0.3, c - 0.3, c, i));
}

const names = (bars: Bar[]) => detectCandlePatterns(bars, 5).map((p) => p.name);

describe("candle patterns", () => {
  it("finds engulfing patterns after the matching trend", () => {
    expect(names(afterTrend("down", [[80.5, 80.6, 79.4, 79.5], [79.3, 81.2, 79.2, 81]]))).toContain("Bullish Engulfing");
    expect(names(afterTrend("up", [[119.5, 120.6, 119.4, 120.5], [120.7, 120.8, 118.8, 119]]))).toContain("Bearish Engulfing");
  });

  it("tells hammer from hanging man by the trend", () => {
    const hammer: [number, number, number, number] = [80, 80.3, 77, 80.2];
    expect(names(afterTrend("down", [hammer]))).toContain("Hammer");
    expect(names(afterTrend("up", [[120, 120.3, 117, 120.2]]))).toContain("Hanging Man");
  });

  it("finds morning star and three white soldiers", () => {
    expect(names(afterTrend("down", [[82, 82.1, 79, 79.2], [79, 79.3, 78.6, 79.1], [79.3, 81.5, 79.2, 81.3]]))).toContain("Morning Star");
    expect(names(afterTrend("down", [[80, 81.1, 79.9, 81], [80.5, 82.1, 80.4, 82], [81.5, 83.1, 81.4, 83]]))).toContain("Three White Soldiers");
  });

  it("only reports doji when asked", () => {
    const bars = afterTrend("up", [[120, 121, 119, 120.02]]);
    expect(detectCandlePatterns(bars, 3).some((p) => p.id === "doji")).toBe(false);
    expect(detectCandlePatterns(bars, 3, true).some((p) => p.id === "doji")).toBe(true);
  });
});

describe("chart formations", () => {
  it("alternates pivots", () => {
    const pv = findPivots(fromPath([100, 110, 100, 110, 100]), 3);
    expect(pv.map((p) => p.type)).toEqual(["high", "low", "high"]);
  });

  it("detects a confirmed double top with target", () => {
    const f = detectFormations(fromPath([90, 110, 100, 110.5, 92]), 3, 1.5);
    const top = f.find((x) => x.kind === "double_top");
    expect(top).toBeDefined();
    expect(top!.confirmed).toBe(true);
    expect(top!.target!).toBeCloseTo(88.85, 1);
  });

  it("detects head and shoulders and its inverse", () => {
    expect(detectFormations(fromPath([90, 105, 98, 115, 98.5, 105.5, 88]), 3, 1.5).some((x) => x.kind === "head_shoulders")).toBe(true);
    expect(detectFormations(fromPath([120, 95, 102, 85, 101.5, 94.5, 112]), 3, 1.5).some((x) => x.kind === "inverse_head_shoulders")).toBe(true);
  });

  it("detects the current ascending triangle", () => {
    const f = detectFormations(fromPath([90, 110, 95, 110.3, 101, 108]), 3, 1);
    expect(f.some((x) => x.kind === "ascending_triangle")).toBe(true);
  });
});

describe("auto fibonacci", () => {
  it("runs from the earlier extreme to the later one", () => {
    const up = fromPath([100, 80, 130, 120]);
    const fib = autoFibonacci(up, 0, up.length - 1)!;
    expect(fib.a.price).toBeCloseTo(79.7);
    expect(fib.b.price).toBeCloseTo(130.3);
    const down = fromPath([100, 130, 80, 90]);
    expect(autoFibonacci(down, 0, down.length - 1)!.b.price).toBeCloseTo(79.7);
  });
});
