import { useSyncExternalStore } from "react";
import { afterFire, armAlert, describeAlert, evaluateAlert, parseAlerts, type Alert, type AlertHit } from "../shared/alerts";
import { getIndicator, resolveParams } from "../shared/indicators";
import { INTERVAL_SECONDS } from "../shared/marketData";
import type { Bar, Series } from "../shared/math";
import type { TradeLine } from "./chart/ChartEngine";
import { formatPrice } from "./chart/DrawingsPrimitive";
import { charts, fetchMarketData, type Drawing } from "./store";

const KEY = "chartai.alerts.v1";
/** Alerts whose symbol no chart shows are checked this often. */
const POLL_MS = 15_000;
/** A chart's ticks are checked at most this often (indicators are recomputed each time). */
const THROTTLE_MS = 1000;
const LOG_MAX = 50;
/** Window event that opens the alerts tab of the side panel. */
export const OPEN_ALERTS_EVENT = "chartai:open-alerts";

export interface AlertLogEntry {
  id: number;
  alertId: string;
  /** Device time it fired (ms). */
  at: number;
  text: string;
  message: string;
  value: number;
  symbol: string;
}

export interface AlertSettings {
  sound: boolean;
  /** System notification (needs the browser's permission). */
  notify: boolean;
}

interface AlertState {
  alerts: Alert[];
  log: AlertLogEntry[];
  settings: AlertSettings;
  /** Hits shown as toasts. */
  events: AlertLogEntry[];
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

const saved = readJson(KEY) as { alerts?: unknown; log?: AlertLogEntry[]; settings?: Partial<AlertSettings> } | null;
let state: AlertState = {
  alerts: parseAlerts(saved?.alerts),
  log: Array.isArray(saved?.log) ? saved.log.slice(-LOG_MAX) : [],
  settings: { sound: true, notify: false, ...saved?.settings },
  events: [],
};
let logSeq = state.log.reduce((m, e) => Math.max(m, e.id), 0);
const listeners = new Set<() => void>();

function set(patch: Partial<AlertState>) {
  state = { ...state, ...patch };
  if (patch.alerts || patch.log || patch.settings) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ alerts: state.alerts, log: state.log, settings: state.settings }));
    } catch {
      // storage full or blocked: alerts last for this session
    }
  }
  listeners.forEach((l) => l());
}

export const alertStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useAlerts<T>(select: (s: AlertState) => T): T {
  return useSyncExternalStore(alertStore.subscribe, () => select(state));
}

/** The watched series of an alert: null for the price (closes), else the indicator output. */
function sourceValues(alert: Alert, bars: Bar[]): Series | null {
  if (alert.source.kind === "price") return null;
  const def = getIndicator(alert.source.type);
  if (!def) return bars.map(() => null);
  return def.compute(bars, resolveParams(def, alert.source.params))[alert.source.output] ?? bars.map(() => null);
}

const lastClosed = (bars: Bar[], interval: string) => {
  const last = bars[bars.length - 1];
  return !!last && Date.now() / 1000 >= last.time + (INTERVAL_SECONDS[interval] ?? 3600);
};

const newId = () => `alert-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Latest bars of a symbol and time frame from a running chart, if one shows them live. */
function chartBars(symbol: string, interval: string): Bar[] | null {
  for (const c of charts) {
    const s = c.get();
    if (s.symbol === symbol && s.interval === interval && !s.replay && !s.loading && !s.error && s.bars.length) return s.bars;
  }
  return null;
}

/** Adds an alert; a crossing that already happened in the current bar does not fire it. */
export function createAlert(input: Omit<Alert, "id" | "active" | "createdAt" | "firedBar">): Alert {
  let alert: Alert = { ...input, id: newId(), active: true, createdAt: Date.now() };
  const bars = chartBars(alert.symbol, alert.interval);
  if (bars) alert = armAlert(alert, bars, sourceValues(alert, bars), lastClosed(bars, alert.interval));
  set({ alerts: [...state.alerts, alert] });
  if (bars) check(alert.symbol, alert.interval, bars);
  return alert;
}

export function updateAlert(id: string, patch: Partial<Alert>) {
  set({ alerts: state.alerts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
}

/** Switches an alert on again; it starts fresh (no crossing from before counts). */
export function resumeAlert(id: string) {
  const a = state.alerts.find((x) => x.id === id);
  if (!a) return;
  let next: Alert = { ...a, active: true, firedBar: undefined };
  const bars = chartBars(a.symbol, a.interval);
  if (bars) next = armAlert(next, bars, sourceValues(next, bars), lastClosed(bars, a.interval));
  set({ alerts: state.alerts.map((x) => (x.id === id ? next : x)) });
}

export function deleteAlert(id: string) {
  set({ alerts: state.alerts.filter((a) => a.id !== id) });
}

export function clearAlertLog() {
  set({ log: [] });
}

export function dismissAlertEvent(id: number) {
  set({ events: state.events.filter((e) => e.id !== id) });
}

export function updateAlertSettings(patch: Partial<AlertSettings>) {
  set({ settings: { ...state.settings, ...patch } });
}

export function openAlertsPanel() {
  window.dispatchEvent(new Event(OPEN_ALERTS_EVENT));
}

// ---------------- Notification (toast, sound, system notification) ----------------

let audio: AudioContext | null = null;

/** iPad Safari only plays sound from an AudioContext created or resumed in a tap. */
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}

function beep() {
  if (!audio || audio.state !== "running") return;
  const t = audio.currentTime;
  [880, 1320, 880].forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t + i * 0.18);
    osc.stop(t + i * 0.18 + 0.17);
  });
}

export const notificationsSupported = () => typeof Notification !== "undefined";

/** Asks for the system notification permission; returns whether it was granted. */
export async function requestNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  updateAlertSettings({ notify: p === "granted" });
  return p === "granted";
}

function announce(alert: Alert, hit: AlertHit) {
  const entry: AlertLogEntry = {
    id: ++logSeq,
    alertId: alert.id,
    at: Date.now(),
    text: describeAlert(alert),
    message: alert.message,
    value: hit.value,
    symbol: alert.symbol,
  };
  set({ log: [...state.log, entry].slice(-LOG_MAX), events: [...state.events, entry].slice(-5) });
  if (state.settings.sound) beep();
  if (state.settings.notify && notificationsSupported() && Notification.permission === "granted") {
    try {
      new Notification(`🔔 ${alert.symbol} ${formatPrice(hit.value)}`, { body: alert.message || entry.text, tag: alert.id });
    } catch {
      // iPad Safari only shows notifications through a service worker; the toast is enough there.
    }
  }
}

// ---------------- Checking ----------------

/** Checks all active alerts of a symbol and time frame against fresh bars. */
function check(symbol: string, interval: string, bars: Bar[]) {
  const closed = lastClosed(bars, interval);
  const fired: [Alert, AlertHit][] = [];
  const alerts = state.alerts.map((a) => {
    if (!a.active || a.symbol !== symbol || a.interval !== interval) return a;
    const hit = evaluateAlert(a, bars, sourceValues(a, bars), closed);
    if (!hit) return a;
    fired.push([a, hit]);
    return afterFire(a, hit);
  });
  if (!fired.length) return;
  set({ alerts });
  for (const [a, hit] of fired) announce(a, hit);
}

/** A moved line, zone or trend line moves the alerts that belong to it. */
function followDrawings(slot: number, drawings: Drawing[]) {
  let changed = false;
  const alerts = state.alerts.map((a) => {
    if (a.drawing?.slot !== slot) return a;
    const d = drawings.find((x) => x.id === a.drawing!.id);
    const target = d && targetOf(d);
    if (!target || JSON.stringify(target) === JSON.stringify(a.target)) return a;
    changed = true;
    return { ...a, target };
  });
  if (changed) set({ alerts });
}

/** Alert target for a drawing, or null for drawings alerts cannot follow. */
export function targetOf(d: Drawing): Alert["target"] | null {
  if (d.kind === "hline") return { kind: "value", value: d.price };
  if (d.kind === "trendline") return { kind: "line", a: d.a, b: d.b };
  if (d.kind === "zone") return { kind: "channel", top: d.top, bottom: d.bottom };
  return null;
}

const lastSeen = new Map<string, number>();
let started = false;

/** Watches the prices of all charts (live) and polls alerts whose symbol no chart shows. */
export function startAlertFeed() {
  if (started) return;
  started = true;
  window.addEventListener("pointerdown", unlockAudio, true);
  window.addEventListener("keydown", unlockAudio, true);
  for (const chart of charts) {
    let timer: number | undefined;
    let lastDrawings: Drawing[] | null = null;
    const run = () => {
      timer = undefined;
      const s = chart.get();
      if (s.drawings !== lastDrawings) {
        lastDrawings = s.drawings;
        followDrawings(chart.slot, s.drawings);
      }
      // A replay shows the past; alerts only look at live prices.
      if (s.replay || s.loading || s.error || !s.bars.length || s.source === "demo") return;
      lastSeen.set(`${s.symbol}|${s.interval}`, Date.now());
      if (state.alerts.some((a) => a.active && a.symbol === s.symbol && a.interval === s.interval)) check(s.symbol, s.interval, s.bars);
    };
    chart.subscribe(() => {
      if (timer === undefined) timer = window.setTimeout(run, THROTTLE_MS);
    });
  }
  const poll = async () => {
    const keys = [...new Set(state.alerts.filter((a) => a.active).map((a) => `${a.symbol}|${a.interval}`))].filter(
      (k) => Date.now() - (lastSeen.get(k) ?? 0) > POLL_MS,
    );
    await Promise.all(
      keys.map(async (k) => {
        const [symbol, interval] = k.split("|");
        try {
          const data = await fetchMarketData(symbol, interval, 300);
          // Demo data is made up; an alert on it would fire on noise.
          if (data.source !== "demo" && data.bars.length) check(symbol, interval, data.bars);
        } catch {
          // next round
        }
      }),
    );
  };
  void poll();
  window.setInterval(() => void poll(), POLL_MS);
}

/** Dashed lines for the active value alerts of a symbol (and the edges of channel alerts). */
export function alertLinesFor(symbol: string): TradeLine[] {
  return state.alerts
    .filter((a) => a.active && a.symbol === symbol && a.source.kind === "price" && !a.drawing)
    .flatMap((a) => {
      if (a.target.kind === "value") return [{ price: a.target.value, color: "#ff9800", title: "🔔", dashed: true }];
      if (a.target.kind === "channel") return [a.target.top, a.target.bottom].map((price) => ({ price, color: "#ff9800", title: "🔔", dashed: true }));
      return [];
    });
}
