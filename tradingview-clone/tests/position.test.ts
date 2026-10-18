import { describe, expect, it } from "vitest";
import type { Bar } from "../shared/math";
import { isValidPosition, placeOnSide, positionStats, type PositionInput } from "../shared/position";

const bar = (time: number, low: number, high: number, close = (low + high) / 2): Bar => ({ time, open: close, high, low, close, volume: 1 });

const long: PositionInput = { side: "long", entry: 100, stop: 95, target: 110, from: 0, to: 1000, account: 10000, risk: 1, leverage: 1 };

describe("position tool", () => {
  it("sizes the position from account risk", () => {
    const st = positionStats(long, []);
    expect(st.valid).toBe(true);
    expect(st.rr).toBeCloseTo(2);
    expect(st.riskAmount).toBeCloseTo(100);
    expect(st.qty).toBeCloseTo(20);
    expect(st.rewardAmount).toBeCloseTo(200);
    expect(st.notional).toBeCloseTo(2000);
    expect(st.riskPct).toBeCloseTo(5);
    expect(st.liqPrice).toBeNull();
  });

  it("detects target, stop and the running state", () => {
    expect(positionStats(long, [bar(0, 80, 120), bar(60, 99, 104, 103)]).status).toBe("running");
    expect(positionStats(long, [bar(60, 99, 104, 103)]).pnl).toBeCloseTo(60);
    const hit = positionStats(long, [bar(60, 98, 104), bar(120, 103, 111)]);
    expect(hit.status).toBe("target");
    expect(hit.exitTime).toBe(120);
    expect(hit.pnl).toBeCloseTo(200);
    expect(positionStats(long, [bar(60, 94, 101)]).status).toBe("stop");
    // Both levels inside one candle: assume the stop came first.
    expect(positionStats(long, [bar(60, 90, 120)]).status).toBe("stop");
    expect(positionStats({ ...long, to: 100 }, [bar(60, 99, 101), bar(120, 99, 120)]).status).toBe("expired");
  });

  it("handles shorts and invalid setups", () => {
    const short: PositionInput = { ...long, side: "short", stop: 105, target: 90 };
    expect(isValidPosition(short)).toBe(true);
    expect(positionStats(short, [bar(60, 89, 101)]).status).toBe("target");
    expect(positionStats(short, [bar(60, 89, 101)]).pnl).toBeCloseTo(200);
    expect(positionStats({ ...long, stop: 105 }, [bar(60, 0, 200)]).status).toBe("invalid");
  });

  it("estimates liquidation and warns when it comes before the stop", () => {
    const st = positionStats({ ...long, leverage: 10 }, []);
    expect(st.liqPrice!).toBeCloseTo(90.5);
    expect(st.liqBeforeStop).toBe(false);
    expect(positionStats({ ...long, leverage: 50 }, []).liqBeforeStop).toBe(true);
    expect(st.margin).toBeCloseTo(200);
  });

  it("mirrors clicks onto the correct side", () => {
    expect(placeOnSide("long", 100, 104, "stop")).toBe(96);
    expect(placeOnSide("long", 100, 96, "target")).toBe(104);
    expect(placeOnSide("short", 100, 96, "stop")).toBe(104);
    expect(placeOnSide("short", 100, 90, "target")).toBe(90);
  });
});
