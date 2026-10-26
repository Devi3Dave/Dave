import { describe, expect, it } from "vitest";
import { getIndicator } from "../shared/indicators";
import { sessionStart, sessionVolumeProfiles, tpoProfiles, volumeProfile, volumeProfileRange, type Bar } from "../shared/math";

const bar = (time: number, low: number, high: number, volume = 10): Bar => ({ time, open: low, high, low, close: high, volume });

describe("volumeProfileRange", () => {
  const bars = [bar(0, 100, 110), bar(60, 100, 110), bar(120, 200, 210, 50), bar(180, 105, 106, 40)];

  it("covers only the given bars", () => {
    const vp = volumeProfileRange(bars, 0, 1, 10, 70)!;
    expect([vp.fromIndex, vp.toIndex]).toEqual([0, 1]);
    expect(vp.rows[0].low).toBe(100);
    expect(vp.rows[9].high).toBe(110);
    expect(vp.rows.reduce((s, r) => s + r.volume, 0)).toBeCloseTo(20);
  });

  it("clamps the range and matches the last-n profile", () => {
    expect(volumeProfileRange(bars, -5, 99, 10, 70)).toEqual(volumeProfile(bars, 4, 10, 70));
    expect(volumeProfileRange(bars, 5, 9, 10, 70)).toBeNull();
  });

  it("finds the POC where most volume traded", () => {
    const vp = volumeProfileRange(bars, 0, 3, 11, 70)!;
    // Rows of 10 between 100 and 210: the 40 at 105–106 and half of the 20 at 100–110 share the first row.
    expect(vp.poc).toBe(105);
  });
});

describe("sessionStart", () => {
  const t = Date.UTC(2026, 9, 28, 15, 30) / 1000; // Wednesday
  it("finds the UTC day, Monday and the first of the month", () => {
    expect(sessionStart(t, "day")).toBe(Date.UTC(2026, 9, 28) / 1000);
    expect(sessionStart(t, "week")).toBe(Date.UTC(2026, 9, 26) / 1000);
    expect(sessionStart(Date.UTC(2026, 9, 26) / 1000, "week")).toBe(Date.UTC(2026, 9, 26) / 1000);
    expect(sessionStart(t, "month")).toBe(Date.UTC(2026, 9, 1) / 1000);
  });
});

describe("session profiles", () => {
  // Two days of hourly bars; day two trades higher.
  const bars = Array.from({ length: 48 }, (_, i) => bar(i * 3600, i < 24 ? 100 : 200, i < 24 ? 110 : 220));

  it("builds one volume profile per day", () => {
    const list = sessionVolumeProfiles(bars, "day", 10, 70);
    expect(list.map((p) => [p.fromIndex, p.toIndex])).toEqual([
      [0, 23],
      [24, 47],
    ]);
    expect(list[1].rows[0].low).toBe(200);
    expect(sessionVolumeProfiles(bars, "day", 10, 70, 1)).toHaveLength(1);
    expect(sessionVolumeProfiles(bars, "week", 10, 70).length).toBeLessThanOrEqual(2);
  });

  it("counts one TPO per period and price row", () => {
    // 4 bars of 15 min = 2 periods of 30 min; period one trades 100–101, period two 100–104.
    const quarter = [bar(0, 100, 101), bar(900, 100, 101), bar(1800, 100, 104), bar(2700, 102, 104)];
    const [tpo] = tpoProfiles(quarter, "day", 4, 70, 1800);
    expect(tpo.tpo).toBe(true);
    expect(tpo.rows.map((r) => r.volume)).toEqual([2, 1, 1, 1]);
    expect(tpo.poc).toBe(100.5);
  });
});

describe("profile indicators", () => {
  it("are registered with the right anchors", () => {
    expect(getIndicator("vpvr_visible")?.visibleRange).toBe(true);
    expect(getIndicator("vp_session")?.profileAnchor).toBe("start");
    expect(getIndicator("tpo")?.profileAnchor).toBe("start");
    const bars = Array.from({ length: 30 }, (_, i) => bar(i * 1800, 100 + (i % 5), 106 + (i % 5)));
    const vis = getIndicator("vpvr_visible")!;
    const vp = vis.profile!(bars, { rows: 10, valueArea: 70 }, { from: 10, to: 19 });
    expect(Array.isArray(vp) ? null : vp?.fromIndex).toBe(10);
  });
});
