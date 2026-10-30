import { describe, expect, it } from "vitest";
import { parseBackup, PERCOCO_PLAYBOOK, toCsv, tradePnl, type JournalTrade } from "../shared/journal";
import {
  dailyResults,
  dayWinRate,
  DEFAULT_PLAYBOOKS,
  durationBucket,
  groupStats,
  monthWeeks,
  parseNotes,
  parsePlaybooks,
  parseTradesCsv,
  performanceScore,
  playbookStats,
  weekdayOf,
} from "../shared/journalAnalytics";

let n = 0;
const trade = (p: Partial<JournalTrade>): JournalTrade => ({ id: `t${n++}`, date: "2026-10-01", symbol: "BTCUSDT", side: "long", entry: 100, stop: 95, exit: 110, qty: 10, fees: 0, ...p });

describe("journal analytics", () => {
  it("groups trades into trading days", () => {
    const days = dailyResults([trade({ date: "2026-10-02", exit: 95 }), trade({ date: "2026-10-01" }), trade({ date: "2026-10-02" })]);
    expect(days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(days[1]).toMatchObject({ pnl: 50, count: 2, wins: 1, losses: 1, r: 1 });
    expect(dayWinRate(days)).toBe(1);
    expect(dayWinRate([...days, { ...days[0], date: "2026-10-03", pnl: -1 }])).toBeCloseTo(2 / 3);
  });

  it("lays out a month Monday first", () => {
    // 1 October 2026 is a Thursday.
    const weeks = monthWeeks(2026, 10);
    expect(weeks[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weekdayOf("2026-10-01")).toBe("Do");
  });

  it("breaks results down by a key, also several keys per trade", () => {
    const rows = groupStats(
      [trade({ tags: ["A", "B"] }), trade({ tags: ["A"], exit: 95 }), trade({ exit: 90, stop: undefined })],
      (t) => t.tags ?? null,
    );
    const a = rows.find((r) => r.key === "A")!;
    expect(a).toMatchObject({ count: 2, wins: 1, net: 50, profitFactor: 2, expectancy: 25, totalR: 1 });
    expect(rows.find((r) => r.key === "B")!.net).toBe(100);
    expect(rows).toHaveLength(2);
    expect(durationBucket(trade({ time: "23:50", exitTime: "00:20" }))).toBe("15–60 Min");
  });

  it("scores like the Zella Score where its formulas are public", () => {
    // +100, −50, +100, −50: win 50 %, PF 2, avg win/loss 2, peak 150 then drop 50.
    const ts = [trade({}), trade({ exit: 95 }), trade({}), trade({ exit: 95 })];
    const s = performanceScore(ts)!;
    const part = (k: string) => s.parts.find((p) => p.key === k)!;
    expect(part("win").score).toBeCloseTo((50 / 60) * 100);
    expect(part("pf").score).toBe(100);
    expect(part("wl").score).toBe(100);
    expect(part("dd").value).toBeCloseTo(50 / 150);
    expect(part("dd").score).toBeCloseTo(100 - (50 / 150) * 100);
    // Results ±75 around a mean of 25; total profit 100.
    expect(part("cons").score).toBeCloseTo(100 - (75 / 100) * 100);
    expect(s.parts.reduce((a, p) => a + p.weight, 0)).toBeCloseTo(1);
    expect(performanceScore([trade({ exit: 90 })])!.parts.find((p) => p.key === "cons")!.score).toBe(0);
    expect(performanceScore([])).toBeNull();
  });

  it("keeps old journals: the checklist becomes the Percoco playbook", () => {
    const [t] = parseBackup([{ ...trade({}), checks: ["htfFvg", "choch"] }]);
    expect(t.playbook).toBe(PERCOCO_PLAYBOOK);
    expect(t.checks).toEqual(["htfFvg", "choch"]);
    const s = playbookStats(DEFAULT_PLAYBOOKS[0], [t, { ...trade({ exit: 95 }), playbook: PERCOCO_PLAYBOOK, checks: ["htfFvg", "choch", "ltfFvg"] }]);
    expect(s.count).toBe(2);
    expect(s.adherence).toBeCloseTo(5 / 6);
    expect(s.allRules).toEqual({ count: 1, winRate: 0 });
    expect(s.brokeRule).toEqual({ count: 1, winRate: 1 });
    expect(parsePlaybooks(null)).toBe(DEFAULT_PLAYBOOKS);
    expect(parsePlaybooks([{ id: "x", name: "X", rules: [{ id: "r", label: "R" }, { bad: 1 }] }, { name: "no id" }])).toEqual([{ id: "x", name: "X", rules: [{ id: "r", label: "R" }] }]);
  });

  it("keeps the new trade fields through a backup", () => {
    const t = trade({ time: "09:30", exitTime: "10:05", tags: ["London"], mistakes: ["FOMO"], rating: 4, playbook: "x", checks: ["r1"] });
    expect(parseBackup([t])[0]).toEqual(t);
    expect(parseBackup([{ ...t, time: "9 Uhr", rating: 9 }])[0]).not.toHaveProperty("time");
  });

  it("re-imports the journal's own CSV export", () => {
    const ts = [trade({ setup: "Breakout", time: "09:30" }), trade({ pnl: -42, entry: 0, exit: 0, qty: 0, stop: undefined, date: "2026-10-02", side: "short" })];
    const { trades, skipped } = parseTradesCsv(`﻿${toCsv(ts)}`);
    expect(skipped).toBe(0);
    expect(trades.map(tradePnl)).toEqual([100, -42]);
    expect(trades[0]).toMatchObject({ date: "2026-10-01", symbol: "BTCUSDT", entry: 100, stop: 95, exit: 110, qty: 10, setup: "Breakout", time: "09:30" });
    expect(trades[1].side).toBe("short");
  });

  it("reads a broker export with other column names", () => {
    const csv = ["Close Date,Ticker,Side,Quantity,Entry Price,Exit Price,Commission,Net P&L", "10/29/2026 14:05,ethusdt,SELL,2,2500.5,2450.5,1.2,98.8", "kaputt,x,,,,,,"].join("\n");
    const { trades, skipped } = parseTradesCsv(csv);
    expect(skipped).toBe(1);
    expect(trades[0]).toMatchObject({ date: "2026-10-29", time: "14:05", symbol: "ETHUSDT", side: "short", qty: 2, entry: 2500.5, exit: 2450.5, fees: 1.2 });
    expect(tradePnl(trades[0])).toBeCloseTo(98.8);
    expect(() => parseTradesCsv("a;b\n1;2")).toThrow(/Datum/);
  });

  it("parses notes and drops broken entries", () => {
    expect(parseNotes({ days: { "2026-10-01": "gut", bad: "x", "2026-10-02": " " }, notebook: [{ id: "1", title: "Plan" }, { title: "ohne id" }] })).toEqual({
      days: { "2026-10-01": "gut" },
      notebook: [{ id: "1", title: "Plan", body: "", folder: "Notizen", updated: 0 }],
    });
  });
});

describe("journal screenshots", () => {
  it("keeps the image ids of a trade through a backup", () => {
    const t = { id: "s1", date: "2026-10-01", symbol: "BTCUSDT", side: "long" as const, entry: 100, exit: 110, qty: 1, fees: 0, images: ["img-1", "img-2"] };
    expect(parseBackup([t])[0].images).toEqual(["img-1", "img-2"]);
    expect(parseBackup([{ ...t, images: [3, "", "img-1", "img-1"] }])[0].images).toEqual(["img-1"]);
    expect(parseBackup([{ ...t, images: [] }])[0]).not.toHaveProperty("images");
  });
});
