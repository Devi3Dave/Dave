import { describe, expect, it } from "vitest";
import { buildFootprints, footprintInterval, footprintRowSize } from "../shared/footprint";
import type { Bar } from "../shared/math";

const bar = (time: number, low: number, high: number, volume: number, buyVolume?: number): Bar => ({ time, open: low, high, low, close: high, volume, buyVolume });

describe("footprintRowSize", () => {
  it("rounds to 1, 2 or 5 × 10^n for about 12 rows", () => {
    expect(footprintRowSize([bar(0, 100, 112, 1)])).toBe(1);
    expect(footprintRowSize([bar(0, 100, 130, 1)])).toBe(5);
    expect(footprintRowSize([bar(0, 1, 1.2, 1)])).toBe(0.02);
    expect(footprintRowSize([bar(0, 1, 1, 1)])).toBe(0);
  });
});

describe("buildFootprints", () => {
  // One 1h candle from 1m parts: 100–102 with 10 (6 bought), then 101–102 with 4 (1 bought).
  const hour = [bar(0, 100, 103, 14), bar(3600, 103, 104, 1)];
  const sub = [bar(0, 100, 102, 10, 6), bar(60, 101, 102, 4, 1)];

  it("spreads bought and sold volume over the rows each part covers", () => {
    const [fp] = buildFootprints(hour, sub, 1);
    expect(fp.rows).toEqual([
      { price: 100, buy: 3, sell: 2 },
      { price: 101, buy: 4, sell: 5 },
    ]);
    expect(fp.poc).toBe(101);
    expect(fp.delta).toBe(7 - 7);
    expect(fp.volume).toBe(14);
  });

  it("leaves out candles the lower time frame does not cover from their start", () => {
    expect(buildFootprints(hour, [bar(3600, 103, 104, 1, 1)], 1).map((f) => f.time)).toEqual([3600]);
    expect(buildFootprints(hour, sub, 0)).toEqual([]);
  });

  it("ignores parts after the last candle (replay)", () => {
    const shown = [bar(0, 100, 103, 14), bar(3600, 103, 104, 1)];
    const later = [...sub, bar(3600, 103, 104, 1, 1), bar(7200, 200, 210, 99, 99)];
    const fps = buildFootprints(shown, later, 1);
    expect(fps.map((f) => f.time)).toEqual([0, 3600]);
    expect(fps[1].volume).toBe(1);
  });

  it("estimates buying from the candle without taker volume", () => {
    const [fp] = buildFootprints([bar(0, 100, 101, 4)], [{ time: 0, open: 101, high: 101, low: 100, close: 100.25, volume: 4 }], 1);
    expect(fp.rows[0].buy).toBeCloseTo(1);
    expect(fp.rows[0].sell).toBeCloseTo(3);
  });
});

describe("footprintInterval", () => {
  it("picks a lower time frame with enough parts", () => {
    expect([1, 60, 900, 3600, 14400, 86400].map(footprintInterval)).toEqual([null, "1s", "1m", "1m", "5m", "15m"]);
  });
});
