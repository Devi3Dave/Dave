/**
 * Alerts like TradingView's: a condition on the price (or an indicator line) against a value, a line or a
 * channel, checked on every new price.
 *
 * The crossing conditions follow the Pine Script definitions (TradingView Pine Script v5 reference,
 * `ta.crossover`, `ta.crossunder`, `ta.cross`): source 1 crossed over source 2 when on the current bar it
 * is greater than source 2 and on the previous bar it was less than or equal to source 2; crossing under
 * mirrors it; crossing is either. Like TradingView alerts on a live chart, the current (still forming) bar
 * is compared with the previous bar, so "once per bar" fires on the tick the crossing happens, while
 * "once per bar close" only looks at finished bars.
 */
import type { Bar, Series } from "./math.js";

export type AlertCondition = "crossing" | "crossing_up" | "crossing_down" | "greater" | "less" | "entering" | "exiting";
export type AlertFrequency = "once" | "per_bar" | "per_bar_close";

export const CONDITION_LABELS: Record<AlertCondition, string> = {
  crossing: "kreuzt",
  crossing_up: "kreuzt nach oben",
  crossing_down: "kreuzt nach unten",
  greater: "größer als",
  less: "kleiner als",
  entering: "tritt in Kanal ein",
  exiting: "verlässt Kanal",
};

export const FREQUENCY_LABELS: Record<AlertFrequency, string> = {
  once: "Nur einmal",
  per_bar: "Einmal pro Kerze",
  per_bar_close: "Einmal pro Kerzenschluss",
};

export const isChannelCondition = (c: AlertCondition) => c === "entering" || c === "exiting";

/** What is watched: the closing price or one output of an indicator. */
/**
 * `event` marks an event output (+1 / -1 / 0 per candle, e.g. a new CHoCH): such an alert fires when the
 * value is above 0.5 (up) or below -0.5 (down).
 */
export type AlertSource =
  | { kind: "price" }
  | { kind: "indicator"; type: string; params: Record<string, number>; output: string; label: string; event?: "up" | "down" };

/** What it is compared with. A line is extended in both directions; a channel needs entering/exiting. */
export type AlertTarget =
  | { kind: "value"; value: number }
  | { kind: "line"; a: { time: number; price: number }; b: { time: number; price: number } }
  | { kind: "channel"; top: number; bottom: number };

export interface Alert {
  id: string;
  symbol: string;
  interval: string;
  source: AlertSource;
  condition: AlertCondition;
  target: AlertTarget;
  frequency: AlertFrequency;
  message: string;
  active: boolean;
  createdAt: number;
  /** Bar (start time, unix seconds) the alert last fired on; it fires at most once per bar. */
  firedBar?: number;
  /** Drawing the target follows (moved lines move the alert). */
  drawing?: { slot: number; id: string };
}

export interface AlertHit {
  barTime: number;
  value: number;
  level: number;
}

/** Level of the target at a bar time; [bottom, top] for a channel. */
export function targetLevel(target: AlertTarget, time: number): [number, number] {
  if (target.kind === "value") return [target.value, target.value];
  if (target.kind === "channel") return [Math.min(target.bottom, target.top), Math.max(target.bottom, target.top)];
  const { a, b } = target;
  const v = b.time === a.time ? b.price : a.price + ((b.price - a.price) * (time - a.time)) / (b.time - a.time);
  return [v, v];
}

/** Whether the condition holds on a bar, given the values of this and the previous bar. */
export function conditionMet(condition: AlertCondition, prev: number | null, cur: number, prevLevel: [number, number] | null, level: [number, number]): boolean {
  const inside = (v: number, l: [number, number]) => v >= l[0] && v <= l[1];
  switch (condition) {
    case "greater":
      return cur > level[1];
    case "less":
      return cur < level[0];
    default:
      break;
  }
  if (prev === null || prevLevel === null) return false;
  const up = cur > level[0] && prev <= prevLevel[0];
  const down = cur < level[0] && prev >= prevLevel[0];
  switch (condition) {
    case "crossing_up":
      return up;
    case "crossing_down":
      return down;
    case "crossing":
      return up || down;
    case "entering":
      return inside(cur, level) && !inside(prev, prevLevel);
    case "exiting":
      return !inside(cur, level) && inside(prev, prevLevel);
  }
  return false;
}

/**
 * Checks an alert against the bars of its symbol and time frame (`values` = the watched series, defaults to
 * the closes). `lastClosed` says whether the last bar is finished. Returns the hit or null; an alert that
 * already fired on that bar does not fire again.
 */
/** Condition and level of an event alert ("neuer bullischer CHoCH": value > 0.5). */
export function eventAlertRule(event: "up" | "down"): { condition: AlertCondition; target: AlertTarget } {
  return event === "up" ? { condition: "greater", target: { kind: "value", value: 0.5 } } : { condition: "less", target: { kind: "value", value: -0.5 } };
}

export function evaluateAlert(alert: Alert, bars: Bar[], values: Series | null = null, lastClosed = false): AlertHit | null {
  if (!alert.active || bars.length === 0) return null;
  const series = values ?? bars.map((b) => b.close);
  // Once per bar close: the newest finished bar is the current one.
  const i = alert.frequency === "per_bar_close" && !lastClosed ? bars.length - 2 : bars.length - 1;
  if (i < 0) return null;
  const bar = bars[i];
  if (alert.firedBar !== undefined && bar.time <= alert.firedBar) return null;
  const cur = series[i];
  if (cur === null || cur === undefined || !Number.isFinite(cur)) return null;
  const prevRaw = i > 0 ? series[i - 1] : null;
  const prev = prevRaw === null || prevRaw === undefined || !Number.isFinite(prevRaw) ? null : prevRaw;
  const level = targetLevel(alert.target, bar.time);
  const prevLevel = i > 0 ? targetLevel(alert.target, bars[i - 1].time) : null;
  if (!conditionMet(alert.condition, prev, cur, prevLevel, level)) return null;
  // For a channel, the edge the value is nearest to.
  const edge = Math.abs(cur - level[0]) <= Math.abs(cur - level[1]) ? level[0] : level[1];
  return { barTime: bar.time, value: cur, level: edge };
}

/** The alert after it fired: "once" switches it off, the others remember the bar. */
export function afterFire(alert: Alert, hit: AlertHit): Alert {
  return { ...alert, firedBar: hit.barTime, active: alert.frequency === "once" ? false : alert.active };
}

/**
 * A new crossing alert must not fire for a crossing that happened earlier in the current bar, before it
 * existed: such a bar counts as already fired. Greater/less fire at once, as in TradingView.
 */
export function armAlert(alert: Alert, bars: Bar[], values: Series | null = null, lastClosed = false): Alert {
  if (alert.condition === "greater" || alert.condition === "less") return alert;
  const hit = evaluateAlert(alert, bars, values, lastClosed);
  return hit ? { ...alert, firedBar: hit.barTime } : alert;
}

const fmt = (v: number) => {
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return String(+v.toFixed(digits)).replace(".", ",");
};

export function targetText(target: AlertTarget): string {
  if (target.kind === "value") return fmt(target.value);
  if (target.kind === "channel") return `${fmt(Math.min(target.bottom, target.top))} – ${fmt(Math.max(target.bottom, target.top))}`;
  return "Trendlinie";
}

/** "BTCUSDT Kurs kreuzt nach oben 70.000" */
export function describeAlert(alert: Alert): string {
  if (alert.source.kind === "indicator" && alert.source.event) return `${alert.symbol} ${alert.source.label}`;
  const src = alert.source.kind === "price" ? "Kurs" : alert.source.label;
  return `${alert.symbol} ${src} ${CONDITION_LABELS[alert.condition]} ${targetText(alert.target)}`;
}

const CONDITIONS = Object.keys(CONDITION_LABELS) as AlertCondition[];
const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as AlertFrequency[];
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const point = (p: unknown): p is { time: number; price: number } => !!p && typeof p === "object" && finite((p as { time: unknown }).time) && finite((p as { price: unknown }).price);

function parseTarget(t: unknown): AlertTarget | null {
  const o = t as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  if (o.kind === "value" && finite(o.value)) return { kind: "value", value: o.value };
  if (o.kind === "channel" && finite(o.top) && finite(o.bottom)) return { kind: "channel", top: o.top, bottom: o.bottom };
  if (o.kind === "line" && point(o.a) && point(o.b)) return { kind: "line", a: { time: o.a.time, price: o.a.price }, b: { time: o.b.time, price: o.b.price } };
  return null;
}

function parseSource(s: unknown): AlertSource | null {
  const o = s as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  if (o.kind === "price") return { kind: "price" };
  if (o.kind === "indicator" && typeof o.type === "string" && typeof o.output === "string" && o.params && typeof o.params === "object") {
    const params = Object.fromEntries(Object.entries(o.params as Record<string, unknown>).filter((e): e is [string, number] => finite(e[1])));
    const event = o.event === "up" || o.event === "down" ? { event: o.event as "up" | "down" } : {};
    return { kind: "indicator", type: o.type, params, output: o.output, label: typeof o.label === "string" ? o.label : o.type, ...event };
  }
  return null;
}

/** Saved alerts, dropping anything malformed. */
export function parseAlerts(raw: unknown): Alert[] {
  if (!Array.isArray(raw)) return [];
  const out: Alert[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const target = parseTarget(r.target);
    const source = parseSource(r.source);
    const condition = r.condition as AlertCondition;
    const frequency = r.frequency as AlertFrequency;
    if (!target || !source || typeof r.id !== "string" || typeof r.symbol !== "string" || typeof r.interval !== "string") continue;
    if (!CONDITIONS.includes(condition) || !FREQUENCIES.includes(frequency)) continue;
    if (isChannelCondition(condition) !== (target.kind === "channel")) continue;
    const d = r.drawing as { slot?: unknown; id?: unknown } | undefined;
    out.push({
      id: r.id,
      symbol: r.symbol,
      interval: r.interval,
      source,
      condition,
      target,
      frequency,
      message: typeof r.message === "string" ? r.message : "",
      active: r.active !== false,
      createdAt: finite(r.createdAt) ? r.createdAt : 0,
      ...(finite(r.firedBar) ? { firedBar: r.firedBar } : {}),
      ...(d && finite(d.slot) && typeof d.id === "string" ? { drawing: { slot: d.slot, id: d.id } } : {}),
    });
  }
  return out;
}
