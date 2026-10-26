import { describe, expect, it } from "vitest";
import { fairValueGaps } from "../shared/fvg";
import { getIndicator } from "../shared/indicators";
import type { Bar } from "../shared/math";

const H = 3600;
const bar = (i: number, open: number, high: number, low: number, close: number): Bar => ({ time: i * H, open, high, low, close, volume: 1 });
const opts = { minPct: 0, mitigation: "touch" as const, maxZones: 5, showMitigated: true };

describe("fair value gaps", () => {
  it("finds a bullish gap between the high of candle 1 and the low of candle 3", () => {
    const bars = [bar(0, 100, 101, 99, 100.5), bar(1, 100.5, 106, 100.4, 105.5), bar(2, 105.5, 107, 103, 106.5), bar(3, 106.5, 108, 105, 107)];
    const [z] = fairValueGaps(bars, opts);
    expect(z).toMatchObject({ side: "bull", bottom: 101, top: 103, from: 0, end: null, label: "FVG 1h" });
  });

  it("finds a bearish gap and needs a down candle in the middle", () => {
    const bars = [bar(0, 100, 101, 99, 99.5), bar(1, 99.5, 99.6, 94, 94.5), bar(2, 94.5, 97, 93, 93.5), bar(3, 93.5, 94, 92, 93)];
    expect(fairValueGaps(bars, opts)[0]).toMatchObject({ side: "bear", top: 99, bottom: 97 });
    // Same prices, but the middle candle closes up: no gap.
    bars[1] = bar(1, 94.5, 99.6, 94, 99.5);
    expect(fairValueGaps(bars, opts)).toHaveLength(0);
  });

  it("marks the gap mitigated on touch, at 50 % or when fully filled", () => {
    const base = [bar(0, 100, 101, 99, 100.5), bar(1, 100.5, 106, 100.4, 105.5), bar(2, 105.5, 107, 103, 106.5)];
    const withLow = (low: number) => [...base, bar(3, 106.5, 107, low, 106)];
    expect(fairValueGaps(withLow(102.5), opts)[0].end).toBe(3 * H);
    expect(fairValueGaps(withLow(102.5), { ...opts, mitigation: "half" })[0].end).toBeNull();
    expect(fairValueGaps(withLow(102), { ...opts, mitigation: "half" })[0].end).toBe(3 * H);
    expect(fairValueGaps(withLow(102), { ...opts, mitigation: "full" })[0].end).toBeNull();
    expect(fairValueGaps(withLow(101), { ...opts, mitigation: "full" })[0].end).toBe(3 * H);
    expect(fairValueGaps(withLow(102.5), { ...opts, showMitigated: false })).toHaveLength(0);
  });

  it("filters gaps below the minimum size and is wired up as an indicator", () => {
    const bars = [bar(0, 100, 101, 99, 100.5), bar(1, 100.5, 106, 100.4, 105.5), bar(2, 105.5, 107, 103, 106.5)];
    expect(fairValueGaps(bars, { ...opts, minPct: 2.5 })).toHaveLength(0);
    expect(fairValueGaps(bars, { ...opts, minPct: 1.5 })).toHaveLength(1);
    const def = getIndicator("fvg")!;
    expect(def.patterns!(bars, { minPct: 0, mitigation: 0, zones: 5, mitigated: 0 }).zones).toHaveLength(1);
  });
});
