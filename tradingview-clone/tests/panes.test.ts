import { describe, expect, it } from "vitest";
import { availableMoves, indicatorPaneItems, joinPane, movePane, resolvePanes, type PaneItem } from "../shared/panes";

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
