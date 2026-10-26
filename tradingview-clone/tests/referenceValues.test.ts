import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as m from "../shared/math";
import type { Bar, Series } from "../shared/math";

// Reference values from the TA-Lib C library (see `source` in the fixture). TA-Lib is the
// de-facto open-source reference for these formulas; where TradingView seeds differently
// (MACD, ADX, ATR, Chaikin), only the converged tail is compared.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/talib-reference.json", import.meta.url), "utf8")) as {
  bars: Bar[];
  expected: Record<string, (number | null)[]>;
};
const bars = fixture.bars;
const c = m.closes(bars);

function expectTail(name: string, actual: Series) {
  const want = fixture.expected[name];
  const got = actual.slice(-want.length);
  want.forEach((w, i) => {
    expect(got[i], `${name}[${i}]`).not.toBeNull();
    // relative 1e-6: ADX/DI/ATR/Chaikin are seeded differently and only converge
    expect(Math.abs((got[i] as number) - (w as number)), `${name}[${i}]`).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(w as number)));
  });
}

describe("indicator values match TA-Lib", () => {
  const stoch = m.stochastic(bars, 14, 3, 3);
  const adx = m.adx(bars, 14);
  const bb = m.bollinger(c, 20, 2);
  const macd = m.macd(c, 12, 26, 9);
  const aroon = m.aroon(bars, 14);
  const cases: [string, Series][] = [
    ["sma20", m.sma(c, 20)],
    ["ema21", m.ema(c, 21)],
    ["wma20", m.wma(c, 20)],
    ["dema21", m.dema(c, 21)],
    ["tema21", m.tema(c, 21)],
    ["kama10", m.kama(c, 10, 2, 30)],
    ["linreg25", m.linreg(c, 25)],
    ["stdev20", m.stdev(c, 20)],
    ["bbUpper", bb.upper],
    ["bbLower", bb.lower],
    ["rsi14", m.rsi(c, 14)],
    ["macd", macd.macd],
    ["macdSignal", macd.signal],
    ["stochK", stoch.k],
    ["stochD", stoch.d],
    ["adx14", adx.adx],
    ["plusDI14", adx.plusDI],
    ["minusDI14", adx.minusDI],
    ["cci20", m.cci(bars, 20)],
    ["willr14", m.williamsR(bars, 14)],
    ["mfi14", m.mfi(bars, 14)],
    ["obv", m.obv(bars)],
    ["roc9", m.roc(c, 9)],
    ["mom10", m.momentum(c, 10)],
    // TA-Lib returns percent, the chart uses TradingView's ×10000 scale.
    ["trix18", m.trix(c, 18).map((v) => (v === null ? null : v / 100))],
    ["sar", m.parabolicSar(bars, 0.02, 0.02, 0.2)],
    ["atr14", m.atr(bars, 14)],
    ["aroonDown", aroon.down],
    ["aroonUp", aroon.up],
    ["uo", m.ultimateOscillator(bars, 7, 14, 28)],
    ["adl", m.adl(bars)],
    ["adosc", m.chaikinOscillator(bars, 3, 10)],
    ["ppo", m.ppo(c, 12, 26, 9).ppo],
  ];
  it.each(cases)("%s", (name, series) => expectTail(name, series));

  it("parabolic SAR matches TA-Lib from the second bar on", () => {
    const sar = m.parabolicSar(bars, 0.02, 0.02, 0.2);
    expect(sar[0]).toBeNull();
    for (let i = 1; i < bars.length; i++) {
      // never inside the current bar's range
      const v = sar[i] as number;
      expect(v <= bars[i].low || v >= bars[i].high).toBe(true);
    }
  });
});

describe("definitions from the original sources", () => {
  it("HMA truncates √n (Alan Hull): n = 5 uses a WMA(2) of the raw series", () => {
    const xs = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8];
    const raw = m.wma(xs, 2).map((h, i) => (h === null || m.wma(xs, 5)[i] === null ? null : 2 * h - (m.wma(xs, 5)[i] as number)));
    expect(m.hma(xs, 5)).toEqual(m.wma(raw, 2));
  });

  it("McGinley Dynamic starts at the SMA and follows MD + (P − MD) / (N · (P/MD)^4)", () => {
    const xs = [10, 11, 12, 13, 12, 14];
    const md = m.mcginley(xs, 3);
    expect(md.slice(0, 2)).toEqual([null, null]);
    expect(md[2]).toBeCloseTo(11);
    const next = 11 + (13 - 11) / (3 * (13 / 11) ** 4);
    expect(md[3]).toBeCloseTo(next);
  });

  it("Fisher Transform clamps the smoothed value to ±0.999 beyond ±0.99 (Ehlers)", () => {
    const rising: Bar[] = Array.from({ length: 40 }, (_, i) => ({ time: i * 60, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 }));
    const f = m.fisherTransform(rising, 9).fisher;
    // value pinned at 0.999 → fisher converges to 2 · atanh(0.999)
    expect(f.at(-1) as number).toBeCloseTo(2 * Math.atanh(0.999), 3);
  });

  it("classic pivots: P = (H + L + C) / 3, R1 = 2P − L, S1 = 2P − H, R2/S2 = P ± range, R3 = H + 2(P − L)", () => {
    const day = 86400;
    const bars: Bar[] = [
      { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 1 },
      { time: 3600, open: 11, high: 14, low: 10, close: 13, volume: 1 },
      { time: day, open: 13, high: 13, low: 13, close: 13, volume: 1 },
    ];
    const p = m.pivotPoints(bars);
    const P = (14 + 9 + 13) / 3;
    expect(p.p[2]).toBeCloseTo(P);
    expect(p.r1[2]).toBeCloseTo(2 * P - 9);
    expect(p.s1[2]).toBeCloseTo(2 * P - 14);
    expect(p.r2[2]).toBeCloseTo(P + 5);
    expect(p.s2[2]).toBeCloseTo(P - 5);
    expect(p.r3[2]).toBeCloseTo(14 + 2 * (P - 9));
    expect(p.s3[2]).toBeCloseTo(9 - 2 * (14 - P));
  });
});
