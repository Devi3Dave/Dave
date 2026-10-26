import { describe, expect, it } from "vitest";
import { displayBars, hollowStyle, lineBreak, renko, renkoBoxSize } from "../shared/chartTypes";
import type { Bar } from "../shared/math";

const bar = (i: number, close: number, open = close): Bar => ({ time: i * 60, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 10 });
const oc = (bars: Bar[]) => bars.map((b) => [b.open, b.close]);

describe("renko (stocktrends period_close_bricks)", () => {
  const closes = [100, 115, 131, 125, 105, 98, 120];
  const bricks = renko(
    closes.map((c, i) => bar(i, c)),
    10,
  );

  it("adds a brick per full box and needs two boxes to reverse", () => {
    expect(oc(bricks)).toEqual([
      [100, 110],
      [110, 120],
      [120, 130],
      // 131 → 105: two boxes down, the reversal starts at the bottom of the last up brick.
      [120, 110],
      [110, 100],
      // 100 → 120: two boxes up.
      [110, 120],
    ]);
  });

  it("keeps brick times unique and ordered", () => {
    expect(bricks.map((b) => b.time)).toEqual([60, 120, 121, 240, 300, 360]);
  });

  it("splits a candle's volume over its bricks", () => {
    expect(bricks[1].volume).toBe(5);
    expect(bricks[0].volume).toBe(10);
  });

  it("returns nothing without a box", () => {
    expect(renko([bar(0, 1)], 0)).toEqual([]);
  });

  it("enlarges a box far too small for the price range", () => {
    const many = renko(
      Array.from({ length: 100 }, (_, i) => bar(i, 1000 + (i % 2) * 5000)),
      0.001,
    );
    expect(many.length).toBeLessThanOrEqual(20_000);
  });
});

describe("lineBreak (Nison three-line break)", () => {
  const bars = [bar(0, 105, 100), bar(1, 110), bar(2, 108), bar(3, 115), bar(4, 104), bar(5, 99), bar(6, 95), bar(7, 112), bar(8, 116)];

  it("continues on a new extreme and reverses only past the last three lines", () => {
    expect(oc(lineBreak(bars, 3))).toEqual([
      [100, 105],
      [105, 110],
      [110, 115],
      [110, 99],
      [99, 95],
      [99, 116],
    ]);
  });

  it("reverses sooner with fewer lines", () => {
    // With one line, 104 already breaks below the last line (110–115); with three it does not.
    expect(oc(lineBreak(bars, 1)).slice(0, 4)).toEqual([
      [100, 105],
      [105, 110],
      [110, 115],
      [110, 104],
    ]);
  });
});

describe("renkoBoxSize", () => {
  it("uses the fixed size or the latest ATR", () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({ ...bar(i, 100), high: 102, low: 98 }));
    expect(renkoBoxSize(bars, 5, 14)).toBe(5);
    expect(renkoBoxSize(bars, 0, 14)).toBeCloseTo(4);
  });
});

describe("displayBars", () => {
  it("passes time-based types through", () => {
    const bars = [bar(0, 1)];
    expect(displayBars(bars, "candles", { renkoBox: 0, renkoAtr: 14, lineBreakLines: 3 })).toBe(bars);
  });
});

describe("hollowStyle (mplfinance hollow_and_filled)", () => {
  const bars = [bar(0, 100, 100), bar(1, 105, 101), bar(2, 103, 106), bar(3, 102, 101)];
  it("colors by the previous close and hollows up bodies", () => {
    expect(hollowStyle(bars, 1, "G", "R")).toEqual({ color: "rgba(0,0,0,0)", borderColor: "G", wickColor: "G" });
    expect(hollowStyle(bars, 2, "G", "R")).toEqual({ color: "R", borderColor: "R", wickColor: "R" });
    // Close above open but below the previous close: hollow and red.
    expect(hollowStyle(bars, 3, "G", "R")).toEqual({ color: "rgba(0,0,0,0)", borderColor: "R", wickColor: "R" });
  });
});
