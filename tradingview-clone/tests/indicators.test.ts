import { describe, expect, it } from "vitest";
import { INDICATORS, resolveParams } from "../shared/indicators";
import * as m from "../shared/math";
import { demoBars } from "../shared/marketData";
import { toolDefinitions } from "../shared/tools";

const bars = demoBars("TEST", "1h", 400);
// Daily bars: the crypto cycle indicators need up to 350 days of history.
const daily = demoBars("TEST", "1d", 1000);

describe("math", () => {
  it("sma / ema basics", () => {
    expect(m.sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    // EMA is seeded with the SMA of the first `period` values
    const e = m.ema([1, 2, 3, 4], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
  });

  it("rsi is 100 for a strictly rising series and within 0..100 otherwise", () => {
    const rising = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(m.rsi(rising, 14).at(-1)).toBe(100);
    for (const v of m.rsi(m.closes(bars), 14)) if (v !== null) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
  });

  it("macd histogram equals macd - signal", () => {
    const r = m.macd(m.closes(bars), 12, 26, 9);
    const i = bars.length - 1;
    expect(r.histogram[i]).toBeCloseTo((r.macd[i] as number) - (r.signal[i] as number));
  });

  it("bollinger bands bracket the basis", () => {
    const r = m.bollinger(m.closes(bars), 20, 2);
    const i = bars.length - 1;
    expect(r.upper[i]!).toBeGreaterThan(r.basis[i]!);
    expect(r.lower[i]!).toBeLessThan(r.basis[i]!);
  });

  it("supertrend is defined on exactly one side per bar", () => {
    const r = m.supertrend(bars, 10, 3);
    for (let i = 20; i < bars.length; i++) expect((r.up[i] === null) !== (r.down[i] === null)).toBe(true);
  });

  it("heikin ashi keeps bar count and high >= low", () => {
    const ha = m.heikinAshi(bars);
    expect(ha).toHaveLength(bars.length);
    for (const b of ha) expect(b.high).toBeGreaterThanOrEqual(b.low);
  });
});

describe("crypto indicators", () => {
  it("zigzag joins alternating pivots that differ by at least the threshold", () => {
    const z = m.zigzag(daily, 10);
    const pivots: number[] = [];
    for (let i = 1; i < z.length - 1; i++) {
      const [a, b, c] = [z[i - 1], z[i], z[i + 1]];
      if (a !== null && b !== null && c !== null && (b - a) * (c - b) < 0) pivots.push(b);
    }
    expect(pivots.length).toBeGreaterThan(2);
    for (let k = 1; k < pivots.length; k++) expect(Math.abs(pivots[k] / pivots[k - 1] - 1)).toBeGreaterThanOrEqual(0.0999);
  });

  it("volume profile conserves volume and puts the POC inside the value area", () => {
    const vp = m.volumeProfile(daily, 300, 30, 70)!;
    const total = daily.slice(-300).reduce((s, b) => s + b.volume, 0);
    expect(vp.rows.reduce((s, r) => s + r.volume, 0)).toBeCloseTo(total, 3);
    expect(vp.val).toBeLessThanOrEqual(vp.poc);
    expect(vp.vah).toBeGreaterThanOrEqual(vp.poc);
    const inVa = vp.rows.filter((r) => r.inValueArea).reduce((s, r) => s + r.volume, 0);
    expect(inVa / total).toBeGreaterThanOrEqual(0.7);
  });

  it("CVD uses taker-buy volume when present", () => {
    const b = [
      { time: 0, open: 1, high: 2, low: 1, close: 2, volume: 10, buyVolume: 7 },
      { time: 60, open: 2, high: 2, low: 1, close: 1, volume: 10, buyVolume: 2 },
    ];
    expect(m.cvd(b, false)).toEqual([4, -2]);
  });

  it("higher-timeframe SMA equals the SMA of daily closes on daily bars", () => {
    const htf = m.onHigherTimeframe(daily, 86400, (c) => m.smaLast(c, 111));
    const direct = m.sma(m.closes(daily), 111);
    expect(htf.at(-1)).toBeCloseTo(direct.at(-1) as number);
  });

  it("squeeze state is 0 or 1 and WaveTrend is centered", () => {
    const sq = m.squeezeMomentum(daily, 20, 2, 1.5);
    for (const v of sq.squeeze) if (v !== null) expect([0, 1]).toContain(v);
    const wt = m.waveTrend(daily, 10, 21);
    const vals = wt.wt1.filter((v): v is number => v !== null);
    expect(Math.abs(vals.reduce((a, b) => a + b, 0) / vals.length)).toBeLessThan(40);
  });
});

describe("registry", () => {
  it.each(INDICATORS.map((d) => [d.id, d] as const))("%s computes aligned, finite outputs", (_id, def) => {
    const out = def.compute(daily, resolveParams(def));
    for (const o of def.outputs) {
      expect(out[o.key], o.key).toHaveLength(daily.length);
      const defined = out[o.key].filter((v) => v !== null);
      expect(defined.length, `${def.id}.${o.key} has values`).toBeGreaterThan(0);
      for (const v of defined) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("resolveParams clamps and rounds", () => {
    const rsi = INDICATORS.find((d) => d.id === "rsi")!;
    expect(resolveParams(rsi, { length: 0 })).toEqual({ length: 1, maLength: 14 });
    expect(resolveParams(rsi, { length: 14.6, maLength: 500 })).toEqual({ length: 15, maLength: 200 });
  });
});

describe("tools", () => {
  it("produce object JSON schemas without $schema", () => {
    for (const t of toolDefinitions()) {
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema).not.toHaveProperty("$schema");
    }
  });
});

describe("countdown", () => {
  it("formats like TradingView", async () => {
    const { formatCountdown } = await import("../src/chart/AxisLabelsPrimitive");
    expect(formatCountdown(42)).toBe("00:42");
    expect(formatCountdown(59 * 60 + 5)).toBe("59:05");
    expect(formatCountdown(3 * 3600 + 7 * 60 + 9)).toBe("03:07:09");
    expect(formatCountdown(2 * 86400 + 5 * 3600 + 30 * 60)).toBe("2T 05:30");
    expect(formatCountdown(-5)).toBe("00:00");
  });
});
