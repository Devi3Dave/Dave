import { describe, expect, it } from "vitest";
import type { Bar } from "../shared/math";
import { intrabarIntervals, mergeBars, nextReplayStep, replayFrame, subBarsOf } from "../shared/replay";

const bar = (time: number, open: number, high: number, low: number, close: number, volume = 1): Bar => ({ time, open, high, low, close, volume });

// Three 1h candles; the second (3600) has four 15m parts, the third none loaded.
const all = [bar(0, 10, 12, 9, 11, 4), bar(3600, 11, 15, 8, 14, 4), bar(7200, 14, 16, 13, 15, 4)];
const sub = [bar(2700, 0, 0, 0, 0), bar(3600, 11, 12, 10, 12), bar(4500, 12, 15, 11, 13), bar(5400, 13, 13, 8, 9), bar(6300, 9, 14, 9, 14)];

describe("intrabar replay", () => {
  it("finds the parts of a candle", () => {
    expect(subBarsOf(sub, all, 1).map((b) => b.time)).toEqual([3600, 4500, 5400, 6300]);
    expect(subBarsOf(sub, all, 2)).toEqual([]);
    expect(subBarsOf(sub, all, 9)).toEqual([]);
  });

  it("merges parts into the growing candle", () => {
    expect(mergeBars(sub.slice(1, 4), 3600)).toEqual({ time: 3600, open: 11, high: 15, low: 8, close: 9, volume: 3 });
  });

  it("shows whole candles plus the part-built next one", () => {
    expect(replayFrame(all, 1, 0, sub)).toEqual([all[0]]);
    expect(replayFrame(all, 1, 2, sub)).toEqual([all[0], { time: 3600, open: 11, high: 15, low: 10, close: 13, volume: 2 }]);
    expect(replayFrame(all, 1, 2, null)).toEqual([all[0]]);
  });

  it("steps through the parts, then on to the whole candle", () => {
    const steps: { shown: number; sub: number }[] = [];
    let pos = { shown: 1, sub: 0 };
    while (pos.shown < all.length) {
      pos = nextReplayStep(all, pos.shown, pos.sub, sub);
      steps.push(pos);
    }
    expect(steps).toEqual([
      { shown: 1, sub: 1 },
      { shown: 1, sub: 2 },
      { shown: 1, sub: 3 },
      { shown: 2, sub: 0 },
      // No parts loaded for the last candle: it comes whole.
      { shown: 3, sub: 0 },
    ]);
    expect(nextReplayStep(all, 3, 0, sub)).toEqual({ shown: 3, sub: 0 });
    expect(nextReplayStep(all, 1, 0, null)).toEqual({ shown: 2, sub: 0 });
  });

  it("offers lower time frames that divide the candle", () => {
    const c = [
      { id: "1m", seconds: 60 },
      { id: "5m", seconds: 300 },
      { id: "45m", seconds: 2700 },
      { id: "1h", seconds: 3600 },
    ];
    expect(intrabarIntervals(3600, c)).toEqual(["1m", "5m"]);
    expect(intrabarIntervals(86400 * 7, c)).toEqual(["45m", "1h"]);
  });
});
