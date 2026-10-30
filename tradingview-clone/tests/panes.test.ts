import { describe, expect, it } from "vitest";
import { assignScales, availableMoves, indicatorPaneItems, joinPane, movePane, resolvePanes, type PaneItem } from "../shared/panes";
import { INDICATORS, resolveParams } from "../shared/indicators";

const apply = (items: PaneItem[], panes: Map<string, number>): PaneItem[] => items.map((it) => (panes.has(it.id) ? { ...it, pane: panes.get(it.id) } : it));
const asObject = (m: Map<string, number>) => Object.fromEntries(m);

describe("indicator panes", () => {
  const items: PaneItem[] = [
    { id: "ema", overlay: true },
    { id: "rsi", overlay: false },
    { id: "cvd", overlay: false },
    { id: "macd", overlay: false },
  ];

  it("gives every oscillator a pane of its own by default", () => {
    expect(asObject(resolvePanes(items))).toEqual({ ema: 0, rsi: 1, cvd: 2, macd: 3 });
  });

  it("keeps an indicator on another indicator's line in that pane", () => {
    const withSma = [...items, { id: "sma", overlay: true, sourceId: "rsi" }];
    expect(resolvePanes(withSma).get("sma")).toBe(1);
  });

  it("merges CVD into the RSI pane and closes the gap", () => {
    const moved = apply(items, movePane(items, "cvd", "up"));
    expect(asObject(resolvePanes(moved))).toEqual({ ema: 0, rsi: 1, cvd: 1, macd: 2 });
    expect(asObject(resolvePanes(apply(items, joinPane(items, "cvd", "rsi"))))).toEqual({ ema: 0, rsi: 1, cvd: 1, macd: 2 });
  });

  it("splits an indicator back into a new pane right below", () => {
    const merged = apply(items, joinPane(items, "macd", "rsi"));
    expect(availableMoves(merged, "macd")).toContain("new");
    const split = apply(merged, movePane(merged, "macd", "new"));
    expect(asObject(resolvePanes(split))).toEqual({ ema: 0, rsi: 1, macd: 2, cvd: 3 });
  });

  it("moves an oscillator onto the price chart and a moving average out of it", () => {
    expect(resolvePanes(apply(items, movePane(items, "rsi", "main"))).get("rsi")).toBe(0);
    const ownPane = apply(items, movePane(items, "ema", "new"));
    expect(asObject(resolvePanes(ownPane))).toEqual({ ema: 1, rsi: 2, cvd: 3, macd: 4 });
  });

  it("offers only moves that change something", () => {
    expect(availableMoves(items, "rsi")).toEqual(["down", "main"]);
    expect(availableMoves(items, "macd")).toEqual(["up", "main"]);
    expect(availableMoves(items, "ema")).toEqual(["down", "new"]);
  });

  it("takes lines computed on the indicator along", () => {
    const withSma = [...items, { id: "sma", overlay: true, sourceId: "rsi" }];
    const moved = apply(withSma, movePane(withSma, "rsi", "down"));
    expect(resolvePanes(moved).get("sma")).toBe(resolvePanes(moved).get("rsi"));
    // RSI with only its own SMA is still alone in its pane: no "new pane" to offer.
    expect(availableMoves(withSma, "rsi")).not.toContain("new");
  });

  it("reads panes from chart indicators and ignores the choice for profiles", () => {
    const panes = resolvePanes(
      indicatorPaneItems([
        { id: "v", type: "volume" },
        { id: "r", type: "rsi", pane: 1 },
        { id: "c", type: "cvd", pane: 1 },
        { id: "p", type: "candlepatterns", pane: 5 },
      ]),
    );
    expect(asObject(panes)).toEqual({ v: 0, r: 1, c: 1, p: 0 });
  });
});

describe("indicator scales", () => {
  const rsi = { min: 0, max: 100 };

  it("gives RSI and CVD in one pane an axis each", () => {
    const scales = assignScales([
      { id: "rsi", pane: 1, fixed: rsi },
      { id: "cvd", pane: 1 },
    ]);
    expect(Object.fromEntries(scales)).toEqual({ rsi: "main", cvd: "other" });
  });

  it("lets indicators with the same fixed range share one axis", () => {
    const scales = assignScales([
      { id: "rsi", pane: 1, fixed: rsi },
      { id: "stoch", pane: 1, fixed: rsi },
      { id: "cvd", pane: 1 },
      { id: "obv", pane: 1 },
    ]);
    expect(Object.fromEntries(scales)).toEqual({ rsi: "main", stoch: "main", cvd: "other", obv: "own:1:auto:obv" });
  });

  it("puts an oscillator on the price chart on the second axis and keeps volume apart", () => {
    const scales = assignScales([
      { id: "vol", pane: 0, volume: true },
      { id: "ema", pane: 0, onPrice: true },
      { id: "rsi", pane: 0, fixed: rsi },
    ]);
    expect(Object.fromEntries(scales)).toEqual({ vol: "volume", ema: "main", rsi: "other" });
  });

  it("draws a line computed on an indicator on that indicator's scale", () => {
    const scales = assignScales([
      { id: "cvd", pane: 1 },
      { id: "rsi", pane: 1, fixed: rsi },
      { id: "sma", pane: 1, sourceId: "rsi" },
    ]);
    expect(scales.get("sma")).toBe("other");
  });
});

describe("fixed indicator scales", () => {
  const bars = Array.from({ length: 400 }, (_, i) => {
    const close = 100 + Math.sin(i / 7) * 12 + Math.sin(i / 31) * 20 + (i % 5) * 0.7;
    return { time: i * 3600, open: close - 0.8, high: close + 2 + (i % 3), low: close - 2 - (i % 4), close, volume: 100 + (i % 11) * 40 };
  });

  it("keeps every fixed-range indicator inside its range", () => {
    const fixed = INDICATORS.filter((d) => d.scale);
    expect(fixed.map((d) => d.id)).toEqual(expect.arrayContaining(["rsi", "mfi", "stoch", "stochrsi", "willr"]));
    for (const def of fixed) {
      const out = def.compute(bars, resolveParams(def, {}));
      for (const o of def.outputs) {
        if (o.helper || o.sparse) continue;
        for (const v of out[o.key] ?? []) {
          if (v === null || !Number.isFinite(v)) continue;
          expect(v, `${def.id}.${o.key}`).toBeGreaterThanOrEqual(def.scale!.min - 1e-9);
          expect(v, `${def.id}.${o.key}`).toBeLessThanOrEqual(def.scale!.max + 1e-9);
        }
      }
    }
  });

  it("draws boundary lines inside the fixed range", () => {
    for (const def of INDICATORS.filter((d) => d.scale)) {
      expect(def.levels?.length, def.id).toBeGreaterThan(0);
      for (const l of def.levels!) expect(l >= def.scale!.min && l <= def.scale!.max, `${def.id} ${l}`).toBe(true);
    }
  });
});
