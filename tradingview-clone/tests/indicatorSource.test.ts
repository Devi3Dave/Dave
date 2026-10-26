import { describe, expect, it } from "vitest";
import { computeIndicator, computeInstances, getIndicator } from "../shared/indicators";
import { rsi, sma, type Bar } from "../shared/math";

const bars: Bar[] = Array.from({ length: 80 }, (_, i) => {
  const close = 100 + Math.sin(i / 4) * 10 + i * 0.2;
  return { time: i * 60, open: close, high: close + 1, low: close - 1, close, volume: 10 };
});
const closes = bars.map((b) => b.close);

describe("indicator on indicator", () => {
  it("computes an SMA of the RSI, padded to the bars", () => {
    const r = rsi(closes, 14);
    const out = computeIndicator(getIndicator("sma")!, { length: 5 }, bars, r);
    const first = r.findIndex((v) => v !== null);
    const expected = sma(r.slice(first), 5);
    expect(out.value).toHaveLength(bars.length);
    expect(out.value.slice(0, first).every((v) => v === null)).toBe(true);
    expect(out.value.slice(first)).toEqual(expected);
  });

  it("uses the close without a source and for indicators without a price input", () => {
    const def = getIndicator("sma")!;
    expect(computeIndicator(def, { length: 5 }, bars, null)).toEqual(def.compute(bars, { length: 5 }));
    const atr = getIndicator("atr")!;
    expect(computeIndicator(atr, { length: 14 }, bars, closes)).toEqual(atr.compute(bars, { length: 14 }));
  });

  it("follows sources in list order and falls back to the close when the source is missing", () => {
    const list = computeInstances(
      [
        { id: "r", type: "rsi", params: {} },
        { id: "s", type: "sma", params: { length: 5 }, source: { id: "r", output: "value" } },
        { id: "x", type: "ema", params: { length: 5 }, source: { id: "gone", output: "value" } },
      ],
      bars,
    );
    expect(list.map((c) => c.sourced)).toEqual([false, true, false]);
    const r = list[0].outputs.value;
    expect(list[1].outputs.value.at(-1)).toBeCloseTo((r.slice(-5) as number[]).reduce((a, b) => a + b, 0) / 5);
    expect(list[2].outputs).toEqual(getIndicator("ema")!.compute(bars, list[2].params));
  });

  it("returns empty lines when the source has no values", () => {
    const out = computeIndicator(getIndicator("bb")!, { length: 20, mult: 2 }, bars, bars.map(() => null));
    expect(Object.values(out).every((s) => s.every((v) => v === null))).toBe(true);
  });
});
