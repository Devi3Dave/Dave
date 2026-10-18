import { describe, expect, it } from "vitest";
import type { Bar } from "../shared/math";
import { barSeconds, orderBlocks, resample, tfLabel } from "../shared/orderblocks";

const H = 3600;

/** Hourly bars following a path of prices (linear between points), small wicks. */
function fromPath(path: number[], steps = 6): Bar[] {
  const closes: number[] = [];
  for (let k = 0; k < path.length - 1; k++) for (let s = 0; s < steps; s++) closes.push(path[k] + ((path[k + 1] - path[k]) * s) / steps);
  closes.push(path[path.length - 1]);
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { time: i * H, open: o, high: Math.max(o, c) + 0.2, low: Math.min(o, c) - 0.2, close: c, volume: 1 };
  });
}

describe("order blocks", () => {
  it("labels time frames and resamples completed buckets only", () => {
    expect(tfLabel(240 * 60)).toBe("4h");
    expect(tfLabel(86400)).toBe("1d");
    const bars = fromPath([100, 110], 9); // 10 hourly bars → 4h buckets 0-3, 4-7, 8-9 (running)
    expect(barSeconds(bars)).toBe(H);
    const htf = resample(bars, 4 * H);
    expect(htf).toHaveLength(2);
    expect(htf[0].last).toBe(3);
    expect(htf[0].open).toBe(bars[0].open);
    expect(htf[0].close).toBe(bars[3].close);
  });

  it("finds a bullish order block at the pullback low before the break, then a buy on retest", () => {
    // up to a swing high, pull back, break above it, then come back into the zone and bounce
    const bars = fromPath([100, 110, 104, 116, 105.2, 112]);
    const { zones, signals } = orderBlocks(bars, { swing: 2, higher: [], maxZones: 5, showBroken: true });
    const bull = zones.find((z) => z.side === "bull");
    expect(bull).toBeDefined();
    expect(bull!.bottom).toBeLessThan(104.5);
    expect(bull!.top).toBeGreaterThan(104);
    expect(signals.some((s) => s.side === "buy")).toBe(true);
  });

  it("invalidates a zone when price closes through it", () => {
    const bars = fromPath([100, 110, 104, 116, 98]);
    const { zones } = orderBlocks(bars, { swing: 2, higher: [], maxZones: 5, showBroken: true });
    const bull = zones.find((z) => z.side === "bull" && z.bottom < 105);
    expect(bull?.end).not.toBeNull();
    expect(orderBlocks(bars, { swing: 2, higher: [], maxZones: 5, showBroken: false }).zones.some((z) => z === bull)).toBe(false);
  });

  it("adds zones from higher time frames", () => {
    const path: number[] = [];
    for (let k = 0; k < 30; k++) path.push(100 + (k % 2 ? 8 : 0) + k * 2);
    const bars = fromPath(path, 12);
    const { zones } = orderBlocks(bars, { swing: 2, higher: [4 * H], maxZones: 10, showBroken: true });
    expect(zones.some((z) => z.tf === "1h")).toBe(true);
    expect(zones.some((z) => z.tf === "4h")).toBe(true);
  });
});
