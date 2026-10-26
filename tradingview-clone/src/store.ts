import { useSyncExternalStore } from "react";
import { binanceInterval, bucketTime, loadMarketData, loadOpenInterest, type MarketData, type OpenInterestPoint } from "../shared/marketData";
import type { Bar } from "../shared/math";
import type { PositionInput } from "../shared/position";
import { barIndexAt, carryReplay, randomStart } from "../shared/replay";
import type { CHART_TYPES, INTERVALS } from "../shared/tools";
import { DEFAULT_SETTINGS, type ChartSettings } from "./chartSettings";
import { STANDALONE } from "./config";

export type Interval = (typeof INTERVALS)[number];
export type ChartType = (typeof CHART_TYPES)[number];
export type Author = "user" | "claude";
export type LineStyleName = "solid" | "dashed" | "dotted";

export interface Point {
  time: number;
  price: number;
}

interface DrawingBase {
  id: string;
  author: Author;
  color: string;
  label?: string;
  /** Locked drawings cannot be moved or erased (context menu: Sperren). */
  locked?: boolean;
  /** Hidden drawings are kept but not drawn (context menu: Ausblenden). */
  hidden?: boolean;
}

export type Drawing =
  | (DrawingBase & { kind: "trendline"; a: Point; b: Point; extend: "none" | "right" | "left" | "both"; style: LineStyleName; width: number })
  | (DrawingBase & { kind: "hline"; price: number; style: LineStyleName; width?: number })
  | (DrawingBase & { kind: "vline"; time: number; style?: LineStyleName; width?: number })
  | (DrawingBase & { kind: "zone"; top: number; bottom: number; from?: number; to?: number; extendRight: boolean })
  | (DrawingBase & { kind: "fib"; a: Point; b: Point; levels: number[] })
  | (DrawingBase & { kind: "text"; at: Point; text: string })
  | (DrawingBase & { kind: "fibext"; a: Point; b: Point; c: Point; levels: number[] })
  | (DrawingBase & { kind: "channel"; a: Point; b: Point; offset: number })
  | (DrawingBase & { kind: "measure"; a: Point; b: Point })
  | (DrawingBase & { kind: "path"; points: Point[]; width: number })
  | (DrawingBase & { kind: "position" } & PositionInput);

export type DrawingKind = Drawing["kind"];

export interface ChartMarker {
  id: string;
  author: Author;
  time: number;
  position: "above" | "below";
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
  text?: string;
}

export interface IndicatorInstance {
  id: string;
  type: string;
  params: Record<string, number>;
  colors?: string[];
  hidden?: boolean;
  author: Author;
}

export type Tool = "cursor" | "trendline" | "ray" | "hline" | "vline" | "zone" | "fib" | "text" | "fibext" | "channel" | "measure" | "brush" | "long" | "short" | "erase";

/** Bar replay of one chart: `bars` shows only the first `shown` of `all` loaded candles. */
export interface ReplayState {
  /** New for every chosen start; the replay trading account belongs to it. */
  id: string;
  /** "select": waiting for the start candle to be tapped. */
  phase: "select" | "play";
  all: Bar[];
  /** Candles shown; while selecting, 0 shows all (first start) and otherwise only earlier starts can be tapped (rewind). */
  shown: number;
  playing: boolean;
  /** Candles per second. */
  speed: number;
}

export interface ChartState {
  symbol: string;
  interval: Interval;
  chartType: ChartType;
  bars: Bar[];
  source: MarketData["source"] | null;
  loading: boolean;
  error: string | null;
  indicators: IndicatorInstance[];
  drawings: Drawing[];
  markers: ChartMarker[];
  tool: Tool;
  settings: ChartSettings;
  replay: ReplayState | null;
}

type Listener = () => void;
type Patch = Partial<ChartState> | ((s: ChartState) => Partial<ChartState>);

/** One chart of the workspace: its own symbol, data, indicators, drawings and live stream. */
export interface ChartStore {
  readonly slot: number;
  get(): ChartState;
  set(patch: Patch): void;
  subscribe(listener: Listener): () => void;
  load(symbol: string, interval: Interval): Promise<void>;
  /** Loads the saved symbol unless the chart is already running. */
  ensureLoaded(): void;
  /** Stops the live stream of a chart that is no longer shown. */
  stop(): void;
}

export const MAX_CHARTS = 4;
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"];
const storageKey = (slot: number) => (slot === 0 ? "chartai.layout.v1" : `chartai.layout.v1.chart${slot + 1}`);

function readJson<T>(key: string): Partial<T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode) - the layout just isn't remembered
  }
}

function createChartStore(slot: number): ChartStore {
  const saved = readJson<ChartState>(storageKey(slot));
  const first = slot === 0 ? saved : readJson<ChartState>(storageKey(0));
  let state: ChartState = {
    symbol: saved.symbol ?? DEFAULT_SYMBOLS[slot],
    interval: saved.interval ?? first.interval ?? "1h",
    chartType: saved.chartType ?? first.chartType ?? "candles",
    bars: [],
    source: null,
    loading: false,
    error: null,
    indicators: saved.indicators ?? [
      { id: `ind-volume-${slot}`, type: "volume", params: { length: 20 }, author: "user" },
      { id: `ind-ema21-${slot}`, type: "ema", params: { length: 21 }, author: "user" },
    ],
    drawings: saved.drawings ?? [],
    markers: saved.markers ?? [],
    tool: "cursor",
    settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? first.settings) },
    replay: null,
  };
  const listeners = new Set<Listener>();
  let persistTimer: number | undefined;
  let socket: WebSocket | null = null;
  let loadSeq = 0;
  let started = false;

  const persist = () => {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      const { symbol, interval, chartType, indicators, drawings, markers, settings } = state;
      writeJson(storageKey(slot), { symbol, interval, chartType, indicators, drawings, markers, settings });
    }, 300);
  };

  const chart: ChartStore = {
    slot,
    get: () => state,
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
      persist();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load(symbol, interval) {
      started = true;
      const seq = ++loadSeq;
      socket?.close();
      socket = null;
      const symbolChanged = symbol !== state.symbol;
      // A new time frame keeps the replay at the same moment; another asset ends it.
      const replay = symbolChanged ? null : state.replay;
      chart.set({
        symbol,
        interval,
        loading: true,
        error: null,
        replay,
        // Drawings and markers are anchored to prices of one symbol.
        ...(symbolChanged ? { drawings: [], markers: [] } : {}),
      });
      try {
        const json = await fetchMarketData(symbol, interval);
        if (seq !== loadSeq) return;
        const r = chart.get().replay;
        if (r?.phase === "play") {
          const shown = carryReplay(r.all, r.shown, json.bars);
          // Without a finished candle before that moment, a new start has to be chosen.
          const next: ReplayState = shown > 0 ? { ...r, all: json.bars, shown, playing: false } : { ...r, phase: "select", all: json.bars, shown: 0, playing: false };
          chart.set({ bars: next.phase === "play" ? json.bars.slice(0, shown) : json.bars, replay: next, source: json.source, symbol: json.symbol, loading: false });
        } else if (r) {
          chart.set({ bars: json.bars, replay: { ...r, all: json.bars, shown: 0 }, source: json.source, symbol: json.symbol, loading: false });
        } else chart.set({ bars: json.bars, source: json.source, symbol: json.symbol, loading: false });
        if (json.source === "binance" || json.source === "binance_futures") socket = connectLive(chart, json.symbol, interval, json.source === "binance_futures", () => seq === loadSeq);
      } catch (err) {
        if (seq !== loadSeq) return;
        chart.set({ loading: false, error: (err as Error).message });
      }
    },
    ensureLoaded() {
      if (!started) void chart.load(state.symbol, state.interval);
    },
    stop() {
      started = false;
      loadSeq++;
      socket?.close();
      socket = null;
      if (state.loading) chart.set({ loading: false });
    },
  };
  return chart;
}

export const charts: ChartStore[] = Array.from({ length: MAX_CHARTS }, (_, i) => createChartStore(i));

// ---------------- Workspace (layout + active chart) ----------------

export type LayoutId = "1" | "2h" | "2v" | "3" | "4";

export const LAYOUTS: { id: LayoutId; count: number; label: string; icon: string }[] = [
  { id: "1", count: 1, label: "Ein Chart", icon: "▢" },
  { id: "2h", count: 2, label: "Zwei Charts nebeneinander", icon: "◫" },
  { id: "2v", count: 2, label: "Zwei Charts übereinander", icon: "⊟" },
  { id: "3", count: 3, label: "Drei Charts (einer groß)", icon: "◧" },
  { id: "4", count: 4, label: "Vier Charts (2 × 2)", icon: "⊞" },
];

export interface Workspace {
  layout: LayoutId;
  active: number;
  /** A new time frame on one chart is applied to all visible charts. */
  syncInterval: boolean;
}

export function layoutCount(id: LayoutId): number {
  return LAYOUTS.find((l) => l.id === id)?.count ?? 1;
}

const WORKSPACE_KEY = "chartai.workspace.v1";
const savedWorkspace = readJson<Workspace>(WORKSPACE_KEY);
const initialLayout: LayoutId = LAYOUTS.some((l) => l.id === savedWorkspace.layout) ? savedWorkspace.layout! : "1";
let workspaceState: Workspace = {
  layout: initialLayout,
  active: Math.min(savedWorkspace.active ?? 0, layoutCount(initialLayout) - 1),
  syncInterval: savedWorkspace.syncInterval ?? false,
};
const workspaceListeners = new Set<Listener>();

export const workspace = {
  get: () => workspaceState,
  set(patch: Partial<Workspace>) {
    workspaceState = { ...workspaceState, ...patch };
    workspaceListeners.forEach((l) => l());
    writeJson(WORKSPACE_KEY, workspaceState);
  },
  subscribe(listener: Listener) {
    workspaceListeners.add(listener);
    return () => workspaceListeners.delete(listener);
  },
};

export function useWorkspace<T>(selector: (w: Workspace) => T): T {
  return useSyncExternalStore(workspace.subscribe, () => selector(workspace.get()));
}

export const activeChart = (): ChartStore => charts[workspaceState.active] ?? charts[0];

/** Makes another chart the target of the toolbar, dialogs and Claude. A selected drawing tool moves along. */
export function setActiveChart(slot: number) {
  if (slot === workspaceState.active || !charts[slot]) return;
  const tool = activeChart().get().tool;
  if (tool !== "cursor") activeChart().set({ tool: "cursor" });
  workspace.set({ active: slot });
  if (tool !== "cursor") charts[slot].set({ tool });
}

export function setLayout(layout: LayoutId) {
  const count = layoutCount(layout);
  workspace.set({ layout, active: workspaceState.active < count ? workspaceState.active : 0 });
}

/**
 * The active chart. Everything that acts on "the chart" (top bar, dialogs, Claude) goes through
 * this, so it always targets the chart the user tapped last.
 */
export const store = {
  get: () => activeChart().get(),
  set: (patch: Patch) => activeChart().set(patch),
  subscribe(listener: Listener) {
    const offs = [workspace.subscribe(listener), ...charts.map((c) => c.subscribe(listener))];
    return () => offs.forEach((off) => off());
  },
};

export function useChartState<T>(selector: (s: ChartState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

/** State of one specific chart (for the chart cells themselves). */
export function useChart<T>(chart: ChartStore, selector: (s: ChartState) => T): T {
  return useSyncExternalStore(chart.subscribe, () => selector(chart.get()));
}

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

// ---------------- Actions ----------------

export function updateSettings(patch: Partial<ChartSettings>) {
  store.set((s) => ({ settings: { ...s.settings, ...patch } }));
}

export function addIndicator(type: string, params: Record<string, number>, author: Author, colors?: string[]): IndicatorInstance {
  const inst: IndicatorInstance = { id: newId(type), type, params, author, colors };
  store.set((s) => ({ indicators: [...s.indicators, inst] }));
  return inst;
}

export function updateIndicator(id: string, patch: Partial<IndicatorInstance>) {
  store.set((s) => ({ indicators: s.indicators.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
}

export function removeIndicator(id: string) {
  store.set((s) => ({ indicators: id === "all" ? [] : s.indicators.filter((i) => i.id !== id) }));
}

export function addDrawing(d: Drawing) {
  store.set((s) => ({ drawings: [...s.drawings, d] }));
}

export function updateDrawing(id: string, patch: Partial<Drawing>) {
  store.set((s) => ({ drawings: s.drawings.map((d) => (d.id === id ? ({ ...d, ...patch } as Drawing) : d)) }));
}

export function removeDrawing(id: string): boolean {
  const s = store.get();
  const exists = s.drawings.some((d) => d.id === id) || s.markers.some((m) => m.id === id);
  store.set({ drawings: s.drawings.filter((d) => d.id !== id), markers: s.markers.filter((m) => m.id !== id) });
  return exists;
}

export function clearDrawings(scope: "claude" | "all") {
  store.set((s) => ({
    drawings: scope === "all" ? [] : s.drawings.filter((d) => d.author !== "claude"),
    markers: scope === "all" ? [] : s.markers.filter((m) => m.author !== "claude"),
  }));
}

// ---------------- Bar replay ----------------

/**
 * Starts a replay on a chart: the next tap in the chart chooses the start candle. During a replay this
 * rewinds: the chart stays cut where it is, so only an earlier candle can be tapped. Only one chart replays at a time.
 */
export function startReplay(chart: ChartStore = activeChart()) {
  const s = chart.get();
  const all = s.replay ? s.replay.all : s.bars;
  if (!all.length || s.loading) return;
  for (const c of charts) if (c !== chart && c.get().replay) exitReplay(c);
  const shown = s.replay?.phase === "play" ? s.replay.shown : 0;
  chart.set({
    replay: { id: newId("replay"), phase: "select", all, shown, playing: false, speed: s.replay?.speed ?? 1 },
    bars: shown ? all.slice(0, shown) : all,
    tool: "cursor",
  });
}

/** Cuts the chart off after the candle at `time` (or a random one); later candles are hidden. */
export function pickReplayStart(chart: ChartStore, time: number | "random") {
  const r = chart.get().replay;
  if (!r || !r.all.length) return;
  const index = time === "random" ? randomStart(r.all.length) : barIndexAt(r.all, time);
  // At least one candle stays hidden to be played; when rewinding, a tap right of the cut stays at the cut.
  const shown = Math.max(1, Math.min(index + 1, r.all.length - 1, time === "random" || !r.shown ? Infinity : r.shown));
  chart.set({ replay: { ...r, id: newId("replay"), phase: "play", shown, playing: false }, bars: r.all.slice(0, shown) });
}

/** Reveals the next candle(s); false when there is nothing more to show. */
export function stepReplay(chart: ChartStore, count = 1): boolean {
  const r = chart.get().replay;
  if (!r || r.phase !== "play") return false;
  const shown = Math.min(r.all.length, r.shown + count);
  const more = shown < r.all.length;
  if (shown === r.shown) {
    if (r.playing) chart.set({ replay: { ...r, playing: false } });
    return false;
  }
  chart.set({ replay: { ...r, shown, playing: r.playing && more }, bars: r.all.slice(0, shown) });
  return more;
}

/** Hides the last candle(s) again; at least one stays. */
export function stepBackReplay(chart: ChartStore, count = 1) {
  const r = chart.get().replay;
  if (!r || r.phase !== "play" || r.shown <= 1) return;
  const shown = Math.max(1, r.shown - count);
  chart.set({ replay: { ...r, shown, playing: false }, bars: r.all.slice(0, shown) });
}

export function setReplayPlaying(chart: ChartStore, playing: boolean) {
  const r = chart.get().replay;
  if (r?.phase === "play") chart.set({ replay: { ...r, playing: playing && r.shown < r.all.length } });
}

export function setReplaySpeed(chart: ChartStore, speed: number) {
  const r = chart.get().replay;
  if (r) chart.set({ replay: { ...r, speed } });
}

/** Back to the live chart with all candles. */
export function exitReplay(chart: ChartStore = activeChart()) {
  const r = chart.get().replay;
  if (r) chart.set({ replay: null, bars: r.all });
}

// ---------------- Market data ----------------

export async function loadChart(symbol: string, interval: Interval): Promise<void> {
  const target = activeChart();
  if (!workspaceState.syncInterval || interval === target.get().interval) return target.load(symbol, interval);
  // Synced time frame: the other visible charts follow.
  const count = layoutCount(workspaceState.layout);
  await Promise.all(charts.slice(0, count).map((c) => c.load(c === target ? symbol : c.get().symbol, interval)));
}

export async function fetchMarketData(symbol: string, interval: string, limit = 1000): Promise<MarketData> {
  // Without the Node server the browser fetches directly (Binance allows it; Yahoo does not, so stocks
  // use Binance perpetuals where one exists, see shared/assets.ts, and otherwise fall back to demo data).
  if (STANDALONE) return loadMarketData(symbol, interval, limit);
  const res = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as MarketData;
}

function connectLive(chart: ChartStore, symbol: string, interval: Interval, futures: boolean, current: () => boolean): WebSocket {
  const stream = binanceInterval(interval);
  // Quarter and year candles follow the monthly stream; `seen` is the last monthly kline, for volume deltas.
  const merge = stream === "1M" && interval !== "1M";
  let seen: Bar | null = null;
  const host = futures ? "wss://fstream.binance.com" : "wss://stream.binance.com:9443";
  const ws = new WebSocket(`${host}/ws/${symbol.toLowerCase()}@kline_${stream}`);
  ws.onmessage = (ev) => {
    if (!current()) return;
    const k = JSON.parse(ev.data).k;
    if (!k) return;
    const raw: Bar = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, buyVolume: +k.V };
    const prev = seen;
    seen = raw;
    chart.set((s) => {
      // During a replay new candles go to the hidden part of the series.
      const series = s.replay ? s.replay.all : s.bars;
      let bar = raw;
      const last = series[series.length - 1];
      if (merge) {
        const time = bucketTime(interval, raw.time);
        if (last && last.time === time) {
          // The first message has no reference yet, so its volume is already in the loaded candle.
          const same = prev?.time === raw.time;
          const dv = !prev ? 0 : same ? raw.volume - prev.volume : raw.volume;
          const dbv = !prev ? 0 : same ? (raw.buyVolume ?? 0) - (prev.buyVolume ?? 0) : (raw.buyVolume ?? 0);
          bar = {
            ...last,
            high: Math.max(last.high, raw.high),
            low: Math.min(last.low, raw.low),
            close: raw.close,
            volume: last.volume + dv,
            buyVolume: last.buyVolume === undefined ? undefined : last.buyVolume + dbv,
          };
        } else {
          bar = { ...raw, time };
        }
      }
      const bars = series.slice();
      if (last && last.time === bar.time) bars[bars.length - 1] = bar;
      else if (!last || bar.time > last.time) bars.push(bar);
      if (!s.replay) return { bars };
      return s.replay.phase === "select" && !s.replay.shown ? { bars, replay: { ...s.replay, all: bars } } : { replay: { ...s.replay, all: bars } };
    });
  };
  return ws;
}

export async function fetchOpenInterest(symbol: string, period: string, limit = 500): Promise<OpenInterestPoint[]> {
  if (STANDALONE) return loadOpenInterest(symbol, period, limit);
  const res = await fetch(`/api/open-interest?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=${limit}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as OpenInterestPoint[];
}
