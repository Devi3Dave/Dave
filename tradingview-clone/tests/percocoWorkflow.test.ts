import { describe, expect, it } from "vitest";
import { describeAlert, evaluateAlert, eventAlertRule, parseAlerts, type Alert } from "../shared/alerts";
import { fairValueGaps, fvgEvents } from "../shared/fvg";
import { getIndicator, resolveParams } from "../shared/indicators";
import { checklistStats, parseBackup, toCsv, type JournalTrade } from "../shared/journal";
import type { Bar } from "../shared/math";
import { positionStats, type PositionInput } from "../shared/position";
import { marketStructure, structureEvents } from "../shared/structure";
import { BUILTIN_WORKSPACES } from "../src/templates";

const M = 60;
const opts = { minPct: 0, mitigation: "touch" as const, maxZones: 5, showMitigated: true };

// 1m bars that form three 15m candles with a bullish gap: 15m #1 high 101, #2 up candle, #3 low 103.
function oneMinuteGap(): Bar[] {
  const out: Bar[] = [];
  const segment = (k: number, open: number, close: number, lo: number, hi: number) => {
    for (let j = 0; j < 15; j++) {
      const t = (k * 15 + j) * M;
      const o = j === 0 ? open : out[out.length - 1].close;
      const c = j === 14 ? close : open + ((close - open) * (j + 1)) / 15;
      out.push({ time: t, open: o, high: Math.max(o, c, j === 7 ? hi : -Infinity), low: Math.min(o, c, j === 7 ? lo : Infinity), close: c, volume: 1 });
    }
  };
  segment(0, 100, 100.5, 99, 101);
  segment(1, 100.5, 105.5, 100.4, 106);
  segment(2, 105.5, 106.5, 103, 107);
  segment(3, 106.5, 107, 105, 108);
  return out;
}

describe("1. FVG of a higher time frame on a lower chart", () => {
  it("finds the 15m gap on 1m bars, active from the candle after the third 15m candle closed", () => {
    const bars = oneMinuteGap();
    const zones = fairValueGaps(bars, { ...opts, higher: [15 * M] }).filter((z) => z.tf === "15m");
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ side: "bull", bottom: 101, top: 103, from: 0, label: "FVG 15m", activeIndex: 45 });
    // Without the option only 1m gaps.
    expect(fairValueGaps(bars, opts).every((z) => z.tf === "1m")).toBe(true);
  });

  it("is reachable through the indicator parameter tf2 (minutes)", () => {
    const def = getIndicator("fvg")!;
    const r = def.patterns!(oneMinuteGap(), resolveParams(def, { tf2: 15, mitigated: 1 }));
    expect(r.zones!.some((z) => z.label === "FVG 15m")).toBe(true);
  });
});

describe("4. event series for alerts", () => {
  it("marks a new FVG on the candle that completes it", () => {
    const H = 3600;
    const b = (i: number, o: number, h: number, l: number, c: number): Bar => ({ time: i * H, open: o, high: h, low: l, close: c, volume: 1 });
    const bars = [b(0, 100, 101, 99, 100.5), b(1, 100.5, 106, 100.4, 105.5), b(2, 105.5, 107, 103, 106.5), b(3, 106.5, 108, 105, 107)];
    expect(fvgEvents(bars, opts)).toEqual([0, 0, 1, 0]);
  });

  it("marks a CHoCH when it is known: after the break and after the newest swing is confirmed", () => {
    const path = [105, 100, 105, 110, 105, 95, 100, 105, 112, 115, 113, 111, 110, 109];
    const bars: Bar[] = path.map((p, i) => ({ time: i * 60, open: p, high: p + 0.5, low: p - 0.5, close: p, volume: 1 }));
    const breaks = marketStructure(bars, 1);
    const bull = breaks.find((s) => s.kind === "choch" && s.side === "bull")!;
    // Break at 8 (close 112 > 110.5); the 4th swing (high at 9) is confirmed one candle later.
    expect(bull).toMatchObject({ brokenIndex: 8, knownIndex: 10 });
    const ev = structureEvents(bars, breaks, "choch");
    expect(ev[10]).toBe(1);
    expect(ev[8]).toBe(0);
  });

  it("fires an event alert on +1 / -1 and describes it by its label", () => {
    const a: Alert = {
      id: "e",
      symbol: "BTCUSDT",
      interval: "1m",
      source: { kind: "indicator", type: "structure", params: {}, output: "chochEvent", label: "CHoCH/BOS · neuer bullischer CHoCH", event: "up" },
      ...eventAlertRule("up"),
      frequency: "per_bar",
      message: "",
      active: true,
      createdAt: 0,
    };
    const bars: Bar[] = [0, 1, 2].map((i) => ({ time: i * 60, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
    expect(evaluateAlert(a, bars, [0, 0, 1])).not.toBeNull();
    expect(evaluateAlert(a, bars, [0, 1, 0])).toBeNull();
    expect(evaluateAlert({ ...a, ...eventAlertRule("down") }, bars, [0, 0, -1])).not.toBeNull();
    expect(describeAlert(a)).toBe("BTCUSDT CHoCH/BOS · neuer bullischer CHoCH");
    expect(parseAlerts([a])[0].source).toMatchObject({ event: "up" });
  });
});

describe("3. fixed risk amount", () => {
  it("sizes the position from a fixed amount instead of the percentage", () => {
    const p: PositionInput = { side: "long", entry: 100, stop: 95, target: 110, from: 0, to: 1000, account: 10000, risk: 1, leverage: 1, riskCash: 500 };
    expect(positionStats(p, []).riskAmount).toBe(500);
    expect(positionStats(p, []).qty).toBeCloseTo(100);
    expect(positionStats({ ...p, riskCash: 0 }, []).qty).toBeCloseTo(20);
  });
});

describe("5. journal checklist", () => {
  const trade = (p: Partial<JournalTrade>): JournalTrade => ({ id: Math.random().toString(36), date: "2026-10-01", symbol: "NQ", side: "long", entry: 100, stop: 95, exit: 110, qty: 10, fees: 0, ...p });

  it("compares win rate and R with and without each point, ignoring trades without checklist", () => {
    const trades = [trade({ checks: ["htfFvg", "choch", "ltfFvg"] }), trade({ checks: ["htfFvg"], exit: 95 }), trade({ checks: [], exit: 95 }), trade({ exit: 120 })];
    const [htf, choch] = checklistStats(trades);
    expect(htf.with).toEqual({ count: 2, winRate: 0.5, avgR: 0.5 });
    expect(htf.without).toEqual({ count: 1, winRate: 0, avgR: -1 });
    expect(choch.with).toEqual({ count: 1, winRate: 1, avgR: 2 });
    expect(choch.without.count).toBe(2);
  });

  it("keeps the checks in CSV and backups", () => {
    const t = trade({ checks: ["choch", "ltfFvg"] });
    expect(toCsv([t]).split("\n")[1].endsWith(";choch,ltfFvg")).toBe(true);
    expect(parseBackup({ trades: [{ ...t, checks: ["choch", "unbekannt"] }] })[0].checks).toEqual(["choch"]);
  });
});

describe("2. workspace", () => {
  it("has the 15m + 1m Percoco workspace with known indicators", () => {
    const ws = BUILTIN_WORKSPACES.find((t) => t.id === "builtin-ws-percoco")!;
    expect(ws.workspace!.layout).toBe("2h");
    expect(ws.workspace!.charts.map((c) => c.interval)).toEqual(["15m", "1m"]);
    for (const c of ws.workspace!.charts) for (const i of c.indicators) expect(getIndicator(i.type), i.type).toBeDefined();
    expect(ws.workspace!.charts[1].indicators.find((i) => i.type === "fvg")!.params.tf2).toBe(15);
  });
});
