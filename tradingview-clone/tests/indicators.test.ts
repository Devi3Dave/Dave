import { describe, expect, it } from "vitest";
import { INDICATORS, resolveParams } from "../shared/indicators";
import * as m from "../shared/math";
import { demoBars } from "../shared/marketData";
import { toolDefinitions } from "../shared/tools";

const bars = demoBars("TEST", "1h", 400);

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

describe("registry", () => {
  it.each(INDICATORS.map((d) => [d.id, d] as const))("%s computes aligned, finite outputs", (_id, def) => {
    const out = def.compute(bars, resolveParams(def));
    for (const o of def.outputs) {
      expect(out[o.key], o.key).toHaveLength(bars.length);
      const defined = out[o.key].filter((v) => v !== null);
      expect(defined.length, `${def.id}.${o.key} has values`).toBeGreaterThan(0);
      for (const v of defined) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("resolveParams clamps and rounds", () => {
    const rsi = INDICATORS.find((d) => d.id === "rsi")!;
    expect(resolveParams(rsi, { length: 0 })).toEqual({ length: 1 });
    expect(resolveParams(rsi, { length: 14.6 })).toEqual({ length: 15 });
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
