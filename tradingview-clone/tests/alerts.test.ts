import { describe, expect, it } from "vitest";
import { afterFire, armAlert, conditionMet, describeAlert, evaluateAlert, parseAlerts, targetLevel, type Alert } from "../shared/alerts";
import type { Bar } from "../shared/math";

const bars = (closes: number[]): Bar[] => closes.map((c, i) => ({ time: i * 60, open: c, high: c, low: c, close: c, volume: 1 }));

const alert = (patch: Partial<Alert>): Alert => ({
  id: "a1",
  symbol: "BTCUSDT",
  interval: "1m",
  source: { kind: "price" },
  condition: "crossing_up",
  target: { kind: "value", value: 100 },
  frequency: "per_bar",
  message: "",
  active: true,
  createdAt: 0,
  ...patch,
});

describe("conditionMet (Pine ta.crossover / ta.crossunder)", () => {
  const l = (v: number): [number, number] => [v, v];
  it("crosses over when now above and before at or below", () => {
    expect(conditionMet("crossing_up", 99, 101, l(100), l(100))).toBe(true);
    expect(conditionMet("crossing_up", 100, 101, l(100), l(100))).toBe(true);
    expect(conditionMet("crossing_up", 101, 102, l(100), l(100))).toBe(false);
    // Touching the level is not above it.
    expect(conditionMet("crossing_up", 99, 100, l(100), l(100))).toBe(false);
  });

  it("crosses under symmetrically, crossing is either", () => {
    expect(conditionMet("crossing_down", 101, 99, l(100), l(100))).toBe(true);
    expect(conditionMet("crossing_down", 99, 98, l(100), l(100))).toBe(false);
    expect(conditionMet("crossing", 101, 99, l(100), l(100))).toBe(true);
    expect(conditionMet("crossing", 99, 101, l(100), l(100))).toBe(true);
    expect(conditionMet("crossing", 99, 99.5, l(100), l(100))).toBe(false);
  });

  it("needs a previous value for crossings but not for greater/less", () => {
    expect(conditionMet("crossing", null, 101, null, l(100))).toBe(false);
    expect(conditionMet("greater", null, 101, null, l(100))).toBe(true);
    expect(conditionMet("less", null, 101, null, l(100))).toBe(false);
  });

  it("enters and exits a channel", () => {
    const ch: [number, number] = [90, 110];
    expect(conditionMet("entering", 85, 95, ch, ch)).toBe(true);
    expect(conditionMet("entering", 95, 100, ch, ch)).toBe(false);
    expect(conditionMet("exiting", 105, 115, ch, ch)).toBe(true);
    expect(conditionMet("exiting", 115, 120, ch, ch)).toBe(false);
  });
});

describe("targetLevel", () => {
  it("extends a trend line in both directions", () => {
    const t = { kind: "line" as const, a: { time: 0, price: 100 }, b: { time: 100, price: 200 } };
    expect(targetLevel(t, 50)).toEqual([150, 150]);
    expect(targetLevel(t, 200)).toEqual([300, 300]);
    expect(targetLevel(t, -100)).toEqual([0, 0]);
  });

  it("orders channel edges", () => {
    expect(targetLevel({ kind: "channel", top: 90, bottom: 110 }, 0)).toEqual([90, 110]);
  });
});

describe("evaluateAlert", () => {
  it("fires on the forming bar for once per bar, then not again on that bar", () => {
    const a = alert({});
    const hit = evaluateAlert(a, bars([95, 98, 103]));
    expect(hit).toEqual({ barTime: 120, value: 103, level: 100 });
    const fired = afterFire(a, hit!);
    expect(fired.active).toBe(true);
    expect(evaluateAlert(fired, bars([95, 98, 104]))).toBeNull();
  });

  it("switches a once-only alert off", () => {
    const a = alert({ frequency: "once" });
    expect(afterFire(a, evaluateAlert(a, bars([95, 103]))!).active).toBe(false);
  });

  it("looks only at finished bars for once per bar close", () => {
    const a = alert({ frequency: "per_bar_close" });
    // Forming bar crosses, finished bars do not.
    expect(evaluateAlert(a, bars([95, 98, 103]), null, false)).toBeNull();
    // The crossing bar has closed.
    expect(evaluateAlert(a, bars([95, 98, 103]), null, true)?.barTime).toBe(120);
    // A new bar started: the previous (crossing) bar is now the newest finished one.
    expect(evaluateAlert(a, bars([95, 98, 103, 99]), null, false)?.barTime).toBe(120);
  });

  it("watches an indicator series instead of the price", () => {
    const a = alert({ source: { kind: "indicator", type: "rsi", params: { length: 14 }, output: "rsi", label: "RSI 14" }, target: { kind: "value", value: 70 } });
    expect(evaluateAlert(a, bars([1, 2, 3]), [null, 65, 72])?.value).toBe(72);
    expect(evaluateAlert(a, bars([1, 2, 3]), [null, null, 72])).toBeNull();
  });

  it("follows a rising trend line", () => {
    const a = alert({ target: { kind: "line", a: { time: 0, price: 100 }, b: { time: 60, price: 101 } } });
    // Line at 101 and 102 on bars 1 and 2; the price goes from 101 to 103.
    expect(evaluateAlert(a, bars([90, 101, 103]))?.level).toBe(102);
    expect(evaluateAlert(a, bars([90, 103, 104]))).toBeNull();
  });

  it("ignores inactive alerts", () => {
    expect(evaluateAlert(alert({ active: false }), bars([95, 103]))).toBeNull();
  });
});

describe("armAlert", () => {
  it("does not fire for a crossing before the alert existed", () => {
    const armed = armAlert(alert({}), bars([95, 103]));
    expect(armed.firedBar).toBe(60);
    expect(evaluateAlert(armed, bars([95, 103]))).toBeNull();
    // A new crossing on a later bar still fires.
    expect(evaluateAlert(armed, bars([95, 103, 99, 104]))?.barTime).toBe(180);
  });

  it("leaves greater/less alone", () => {
    expect(armAlert(alert({ condition: "greater" }), bars([95, 103])).firedBar).toBeUndefined();
  });
});

describe("parseAlerts / describeAlert", () => {
  it("keeps valid alerts and drops malformed ones", () => {
    const ok = alert({});
    const parsed = parseAlerts([ok, { ...ok, condition: "nope" }, { ...ok, target: { kind: "channel", top: 1, bottom: 0 } }, null, 5]);
    expect(parsed).toEqual([ok]);
    expect(parseAlerts("x")).toEqual([]);
  });

  it("describes an alert in German", () => {
    expect(describeAlert(alert({}))).toBe("BTCUSDT Kurs kreuzt nach oben 100");
  });
});
