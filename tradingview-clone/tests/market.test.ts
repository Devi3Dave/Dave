import { describe, expect, it } from "vitest";
import { liquidationClusters, liquidationHeatmap, liquidationPrice } from "../shared/liquidations";
import { demoBars } from "../shared/marketData";
import { LocalBook, groupLevels, groupingSteps } from "../shared/orderbook";

const snap = { lastUpdateId: 100, bids: [["99.5", "2"], ["99.0", "1"]] as [string, string][], asks: [["100.5", "3"], ["101.0", "1"]] as [string, string][] };

describe("LocalBook", () => {
  it("ignores stale events, applies straddling and consecutive ones", () => {
    const b = new LocalBook();
    b.loadSnapshot(snap);
    expect(b.apply({ U: 90, u: 100, b: [], a: [] })).toBe("ignored");
    expect(b.apply({ U: 95, u: 105, b: [["99.5", "0"], ["99.8", "4"]], a: [] })).toBe("applied");
    expect(b.apply({ U: 106, u: 107, b: [], a: [["100.5", "5"]] })).toBe("applied");
    const top = b.top();
    expect(top.bids).toEqual([[99.8, 4], [99, 1]]);
    expect(top.asks[0]).toEqual([100.5, 5]);
  });

  it("detects gaps (spot: U != prev u + 1, futures: pu != prev u)", () => {
    const spot = new LocalBook();
    spot.loadSnapshot(snap);
    expect(spot.apply({ U: 101, u: 102, b: [], a: [] })).toBe("applied");
    expect(spot.apply({ U: 104, u: 105, b: [], a: [] })).toBe("gap");

    const fut = new LocalBook();
    fut.loadSnapshot(snap);
    expect(fut.apply({ U: 98, u: 103, pu: 97, b: [], a: [] })).toBe("applied");
    expect(fut.apply({ U: 110, u: 112, pu: 103, b: [], a: [] })).toBe("applied");
    expect(fut.apply({ U: 120, u: 125, pu: 115, b: [], a: [] })).toBe("gap");
  });

  it("a first event that starts after the snapshot is a gap", () => {
    const b = new LocalBook();
    b.loadSnapshot(snap);
    expect(b.apply({ U: 105, u: 110, b: [], a: [] })).toBe("gap");
  });
});

describe("grouping", () => {
  it("rounds bids down and asks up and sums quantities", () => {
    expect(groupLevels([[99.8, 1], [99.2, 2], [98.7, 4]], 1, "bid")).toEqual([[99, 3], [98, 4]]);
    expect(groupLevels([[100.2, 1], [100.9, 2], [101.4, 4]], 1, "ask")).toEqual([[101, 3], [102, 4]]);
  });

  it("offers steps that scale with the price", () => {
    expect(groupingSteps(65000)).toEqual([0.01, 0.1, 1, 10, 50, 100]);
    expect(groupingSteps(2.5)[0]).toBe(0.000001);
  });
});

describe("liquidation heatmap", () => {
  const bars = demoBars("BTCUSDT", "1h", 400);

  it("liquidation prices follow leverage", () => {
    expect(liquidationPrice(100, 10, "long")).toBeCloseTo(90.5);
    expect(liquidationPrice(100, 100, "short")).toBeCloseTo(100.5);
  });

  it("only keeps levels price has not traded through", () => {
    const hm = liquidationHeatmap(bars, 300, 120)!;
    expect(hm.max).toBeGreaterThan(0);
    const last = bars[bars.length - 1];
    const col = bars.length - 1 - hm.fromIndex;
    for (let r = 0; r < hm.rows; r++) {
      if (hm.grid[col * hm.rows + r] <= 0) continue;
      const lo = hm.priceLow + r * hm.priceStep;
      const hi = lo + hm.priceStep;
      // An open level can't sit inside the last candle's range (it would have been hit).
      expect(hi <= last.low || lo >= last.high || (lo < last.low && hi > last.low) || (lo < last.high && hi > last.high)).toBe(true);
    }
  });

  it("clusters above are shorts, below are longs", () => {
    const hm = liquidationHeatmap(bars, 300, 120)!;
    const c = liquidationClusters(bars, hm, 5);
    for (const x of c.above) expect(x.distancePct).toBeGreaterThan(0);
    for (const x of c.below) expect(x.distancePct).toBeLessThan(0);
  });

  it("is cached per bars array", () => {
    expect(liquidationHeatmap(bars, 300, 120)).toBe(liquidationHeatmap(bars, 300, 120));
  });
});
