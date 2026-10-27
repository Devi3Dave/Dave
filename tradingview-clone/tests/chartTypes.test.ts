import { describe, expect, it } from "vitest";
import { brickKey, displayBars, hollowStyle, isPriceDriven, kagi, lineBreak, pointFigure, rangeBars, renko, renkoBoxSize } from "../shared/chartTypes";
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

describe("kagi (Nison, Beyond Candlesticks)", () => {
  const closes = [100, 102, 105, 103, 99, 101, 107, 104, 96, 95, 100, 108];
  const lines = kagi(
    closes.map((c, i) => bar(i, c)),
    4,
  );

  it("turns after the reversal amount and switches yang/yin at the shoulder and waist", () => {
    expect(lines.map((l) => [l.open, l.close, l.thick, l.switchAt])).toEqual([
      // Starts once the price has moved 4 from the first close.
      [100, 105, true, null],
      [105, 99, true, null],
      [99, 107, true, null],
      // Falls below the last waist (99): thin from there.
      [107, 95, true, 99],
      // Rises above the last shoulder (107): thick from there.
      [95, 108, false, 107],
    ]);
  });

  it("keeps times unique and ordered", () => {
    const times = lines.map((l) => l.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
  });

  it("returns nothing without a reversal amount", () => {
    expect(kagi([bar(0, 1)], 0)).toEqual([]);
  });
});

describe("pointFigure (du Plessis, Dorsey)", () => {
  it("fills whole boxes and reverses after three boxes, one box from the extreme (close method)", () => {
    const closes = [10, 12.5, 13, 11, 9.9, 9, 12, 12.2];
    const cols = pointFigure(
      closes.map((c, i) => bar(i, c)),
      1,
      3,
      "close",
    );
    expect(oc(cols)).toEqual([
      [10, 13],
      // 13 → 9.9: three boxes (12, 11, 10), then 9.
      [12, 9],
      [10, 12],
    ]);
    expect(cols.every((c) => c.box === 1)).toBe(true);
  });

  it("checks the column's direction first with high/low", () => {
    const hl = (i: number, high: number, low: number): Bar => ({ time: i * 60, open: low, high, low, close: high, volume: 1 });
    const cols = pointFigure([bar(0, 10), hl(1, 12, 10), hl(2, 13, 8), hl(3, 13, 9.5)], 1, 3, "hl");
    expect(oc(cols)).toEqual([
      // Bar 2 reaches a new high: the X column grows, its low of 8 is ignored.
      [10, 13],
      [12, 10],
    ]);
  });
});

describe("rangeBars (Nicolellis range bars)", () => {
  const candles: Bar[] = [
    { time: 0, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
    { time: 60, open: 100.5, high: 104, low: 100, close: 103.5, volume: 9 },
  ];
  const out = rangeBars(candles, 2);

  it("closes a bar when the price leaves its range and opens the next at that price", () => {
    expect(out.map((b) => [b.open, b.high, b.low, b.close])).toEqual([
      [100, 101, 99, 101],
      [101, 103, 101, 103],
      [103, 104, 103, 103.5],
    ]);
    expect(out.slice(0, 2).every((b) => b.high - b.low === 2)).toBe(true);
  });

  it("shares a candle's volume among the bars it touched", () => {
    expect(out[0].volume).toBeCloseTo(13);
    expect(out[2].volume).toBeCloseTo(3);
    expect(out.reduce((s, b) => s + b.volume, 0)).toBeCloseTo(19);
  });
});

describe("renkoBoxSize", () => {
  it("uses the fixed size or the latest ATR", () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({ ...bar(i, 100), high: 102, low: 98 }));
    expect(renkoBoxSize(bars, 5, 14)).toBe(5);
    expect(renkoBoxSize(bars, 0, 14)).toBeCloseTo(4);
  });
});

const OPTS = { renkoBox: 0, renkoAtr: 14, lineBreakLines: 3, kagiReversal: 0, pnfBox: 0, pnfReversal: 3, pnfSource: "hl" as const, rangeSize: 0 };

describe("displayBars", () => {
  it("passes time-based types through", () => {
    const bars = [bar(0, 1)];
    expect(displayBars(bars, "candles", OPTS)).toBe(bars);
  });

  it("builds every price-driven type with an ATR size", () => {
    const bars = Array.from({ length: 200 }, (_, i) => {
      const c = 100 + 10 * Math.sin(i / 8);
      return { time: i * 60, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 1 };
    });
    for (const type of ["renko", "line_break", "kagi", "point_figure", "range"]) {
      expect(isPriceDriven(type)).toBe(true);
      expect(displayBars(bars, type, OPTS).length).toBeGreaterThan(3);
    }
    expect(brickKey("candles", OPTS)).toBe("");
    expect(brickKey("kagi", OPTS)).not.toBe(brickKey("kagi", { ...OPTS, kagiReversal: 2 }));
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
