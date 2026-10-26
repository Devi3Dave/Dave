import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bar } from "../shared/math";
import { marketStructure, swingHighsLows } from "../shared/structure";

// Reference output of smart-money-concepts smc.swing_highs_lows / smc.bos_choch (see `source`).
const bars = (JSON.parse(readFileSync(new URL("./fixtures/talib-reference.json", import.meta.url), "utf8")) as { bars: Bar[] }).bars;
const fixture = JSON.parse(readFileSync(new URL("./fixtures/smc-structure-reference.json", import.meta.url), "utf8")) as {
  cases: { swing: number; closeBreak: boolean; swings: number[]; breaks: { index: number; kind: string; side: string; level: number; brokenIndex: number }[] }[];
};

describe("market structure matches smart-money-concepts", () => {
  for (const c of fixture.cases) {
    it(`swing ${c.swing}, close break ${c.closeBreak}`, () => {
      expect(swingHighsLows(bars, c.swing)).toEqual(c.swings);
      const got = marketStructure(bars, c.swing, c.closeBreak);
      expect(got.map(({ index, kind, side, brokenIndex }) => ({ index, kind, side, brokenIndex }))).toEqual(
        c.breaks.map(({ index, kind, side, brokenIndex }) => ({ index, kind, side, brokenIndex })),
      );
      // smc stores the level as float32
      got.forEach((g, k) => expect(Math.abs(g.level - c.breaks[k].level)).toBeLessThan(1e-4 * c.breaks[k].level));
    });
  }

  it("finds a bullish CHoCH after a lower low", () => {
    // low 100, high 110, lower low 95, then a close above 110
    const path = [105, 100, 105, 110, 105, 95, 100, 105, 112, 115, 113, 111];
    const b: Bar[] = path.map((p, i) => ({ time: i * 60, open: p, high: p + 0.5, low: p - 0.5, close: p, volume: 1 }));
    // (the first candle becomes a forced swing high as in smc, which adds a bearish CHoCH at 99.5)
    const r = marketStructure(b, 1);
    expect(r.at(-1)).toEqual(expect.objectContaining({ kind: "choch", side: "bull", index: 3, level: 110.5, brokenIndex: 8 }));
  });
});
