import { describe, expect, it } from "vitest";
import { nephewFvgEvents, nephewFvgs, type NephewFvgOptions } from "../shared/fvgNephew";
import { getIndicator } from "../shared/indicators";
import type { Bar } from "../shared/math";

const H = 3600;
const bar = (i: number, open: number, high: number, low: number, close: number): Bar => ({ time: i * H, open, high, low, close, volume: 1 });
const opts: NephewFvgOptions = { length: 0, deleteFilled: false, fillBy: "wick", chartTf: true, higher: [], waitClose: true, labels: true };
const bullGap = [bar(0, 100, 101, 99, 100.5), bar(1, 100.5, 106, 100.4, 105.5), bar(2, 105.5, 107, 103, 106.5)];

describe("FVG (Nephew_Sam_) style", () => {
  it("finds the plain three-candle gap, even with a down candle in the middle", () => {
    expect(nephewFvgs(bullGap, opts)[0]).toMatchObject({ side: "bull", bottom: 101, top: 103, end: null, label: "FVG 1h" });
    const bear = [bar(0, 100, 101, 99, 99.5), bar(1, 94.5, 99.6, 94, 99.5), bar(2, 94.5, 97, 93, 93.5)];
    expect(nephewFvgs(bear, opts)[0]).toMatchObject({ side: "bear", top: 99, bottom: 97 });
  });

  it("counts a gap as filled at the far edge, by wick or by close", () => {
    const touch = [...bullGap, bar(3, 106.5, 107, 102, 106)];
    expect(nephewFvgs(touch, opts)[0].end).toBeNull();
    const wick = [...bullGap, bar(3, 106.5, 107, 101, 102)];
    expect(nephewFvgs(wick, opts)[0].end).toBe(3 * H);
    expect(nephewFvgs(wick, { ...opts, fillBy: "close" })[0].end).toBeNull();
    const close = [...bullGap, bar(3, 106.5, 107, 100, 100.8)];
    expect(nephewFvgs(close, { ...opts, fillBy: "close" })[0].end).toBe(3 * H);
    expect(nephewFvgs(close, { ...opts, deleteFilled: true })).toHaveLength(0);
  });

  it("limits the box to a fixed length and can hide labels", () => {
    const bars = [...bullGap, bar(3, 106.5, 108, 105, 107), bar(4, 107, 109, 106, 108), bar(5, 108, 110, 107, 109)];
    expect(nephewFvgs(bars, { ...opts, length: 3 })[0].until).toBe(3 * H);
    expect(nephewFvgs(bars, { ...opts, length: 10 })[0].until).toBeUndefined();
    expect(nephewFvgs(bars, { ...opts, labels: false })[0].label).toBe("");
  });

  it("adds higher time frames and only uses their forming candle when not waiting for the close", () => {
    // 1h chart, 2h gap: 2h candles [0,1] [2,3] [4,5]; the last one is still forming at bar 4.
    const bars = [
      bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100.5),
      bar(2, 100.5, 104, 100.5, 103.5), bar(3, 103.5, 106, 103, 105.5),
      bar(4, 105.5, 108, 102, 107.5),
    ];
    const htf = { ...opts, chartTf: false, higher: [2 * H] };
    expect(nephewFvgs(bars, htf)).toHaveLength(0);
    expect(nephewFvgs(bars, { ...htf, waitClose: false })[0]).toMatchObject({ side: "bull", tf: "2h", bottom: 101, top: 102 });
  });

  it("is wired up as an indicator with an alert event", () => {
    expect(nephewFvgEvents(bullGap, opts)).toEqual([0, 0, 1]);
    const def = getIndicator("fvgnephew")!;
    const p = Object.fromEntries(def.params.map((x) => [x.key, x.default]));
    expect(def.patterns!(bullGap, p).zones).toHaveLength(1);
    expect(def.compute(bullGap, p).fvgEvent).toEqual([0, 0, 1]);
  });
});
