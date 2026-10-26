import { useSyncExternalStore } from "react";
import { binanceInterval, bucketTime, loadMarketData, loadOpenInterest, type MarketData, type OpenInterestPoint } from "../shared/marketData";
import { findAsset } from "../shared/assets";
import { applyPrice, type FeedSymbol } from "../shared/exchangeFeed";
import { marketNow, referenceMarket, type LiveTick, type RestCheck } from "../shared/freshness";
import type { Bar } from "../shared/math";
import type { PositionInput } from "../shared/position";
import { barIndexAt, carryReplay, randomStart } from "../shared/replay";
import type { CHART_TYPES, CustomInterval, INTERVALS } from "../shared/tools";
import { DEFAULT_SETTINGS, type ChartSettings } from "./chartSettings";
import { STANDALONE } from "./config";
import { measureClock } from "./market/clockSync";
import { connectFeedLive, feedFor, loadFeedData } from "./market/exchangeFeed";

export type Interval = (typeof INTERVALS)[number] | CustomInterval;
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
  /** Device time (ms) the candles arrived, newest live tick and last REST cross-check: the freshness proof. */
  loadedAt: number | null;
  liveTick: LiveTick | null;
  restCheck: RestCheck | null;
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
  /** Reloads the candles over REST and reconnects the live stream, keeping drawings and replay. */
  refresh(): Promise<void>;
  /** Refreshes when the live stream went quiet or REST-only data is due (called by the watchdog). */
  watchdog(): void;
}

/** Live stream without a message this long counts as stalled (Binance sends several per second). */
const STALL_MS = 60_000;
/** Sources without a live stream (Yahoo) are reloaded this often. */
const POLL_MS = 60_000;

export const MAX_CHARTS = 8;
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
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
    loadedAt: null,
    liveTick: null,
    restCheck: null,
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
  let refreshing = false;
  /** Device time of the last live message or REST load (ms). */
  let lastData = 0;
  let retries = 0;
  let retryTimer: number | undefined;
  /** The exchange feed refused to stream this symbol (plan): the chart is reloaded over REST instead. */
  let streamRefused = false;

  const closeSocket = () => {
    window.clearTimeout(retryTimer);
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    socket = null;
  };

  /** Reconnects after a dropped connection: 2 s, 4 s, 8 s … up to 30 s. */
  const scheduleRetry = (seq: number) => {
    window.clearTimeout(retryTimer);
    const delay = Math.min(30_000, 2000 * 2 ** retries++);
    retryTimer = window.setTimeout(() => {
      if (seq === loadSeq && started) void chart.refresh();
    }, delay);
  };

  const startLive = (json: MarketData, interval: Interval, seq: number) => {
    const current = () => seq === loadSeq;
    const onData = () => {
      lastData = Date.now();
      retries = 0;
    };
    let ws: WebSocket;
    if (json.source === "twelvedata") {
      const f = feedFor(json.symbol);
      if (!f || streamRefused) return;
      ws = connectExchangeLive(chart, f.feed, interval, current, onData, () => {
        streamRefused = true;
        if (socket === ws) closeSocket();
      });
    } else if (json.source === "binance" || json.source === "binance_futures") {
      ws = connectLive(chart, json.symbol, interval, json.source === "binance_futures", current, onData);
    } else return;
    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (current() && started) scheduleRetry(seq);
    };
    socket = ws;
  };

  /** Puts freshly loaded candles into the chart (or the hidden part of a running replay). */
  const applyBars = (json: MarketData, keepPlaying = false) => {
    lastData = Date.now();
    const base = { source: json.source, symbol: json.symbol, loading: false, error: null, loadedAt: Date.now(), liveTick: null };
    const r = chart.get().replay;
    if (r?.phase === "play") {
      const shown = carryReplay(r.all, r.shown, json.bars);
      // Without a finished candle before that moment, a new start has to be chosen.
      const next: ReplayState = shown > 0 ? { ...r, all: json.bars, shown, playing: keepPlaying && r.playing } : { ...r, phase: "select", all: json.bars, shown: 0, playing: false };
      chart.set({ ...base, bars: next.phase === "play" ? json.bars.slice(0, shown) : json.bars, replay: next });
    } else if (r) {
      chart.set({ ...base, bars: json.bars, replay: { ...r, all: json.bars, shown: 0 } });
    } else chart.set({ ...base, bars: json.bars });
  };

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
      closeSocket();
      retries = 0;
      // The exchange symbol and the Binance perpetual of one asset (TSLA / TSLAUSDT) count as the same chart.
      const asset = findAsset(symbol);
      const symbolChanged = symbol !== state.symbol && (!asset || asset !== findAsset(state.symbol));
      if (symbolChanged) streamRefused = false;
      // A new time frame keeps the replay at the same moment; another asset ends it.
      const replay = symbolChanged ? null : state.replay;
      chart.set({
        symbol,
        interval,
        loading: true,
        error: null,
        replay,
        loadedAt: null,
        liveTick: null,
        restCheck: null,
        // Drawings and markers are anchored to prices of one symbol.
        ...(symbolChanged ? { drawings: [], markers: [] } : {}),
      });
      try {
        const json = await fetchMarketData(symbol, interval);
        if (seq !== loadSeq) return;
        applyBars(json);
        startLive(json, interval, seq);
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
      closeSocket();
      if (state.loading) chart.set({ loading: false });
    },
    async refresh() {
      if (!started || state.loading || refreshing) return;
      refreshing = true;
      const seq = ++loadSeq;
      closeSocket();
      const { symbol, interval } = state;
      try {
        const json = await fetchMarketData(symbol, interval);
        if (seq !== loadSeq) return;
        applyBars(json, true);
        startLive(json, interval, seq);
      } catch {
        // Offline or blocked: keep the candles shown (the freshness light turns red) and try again.
        if (seq === loadSeq) scheduleRetry(seq);
      } finally {
        refreshing = false;
      }
    },
    watchdog() {
      // A replay shows the past on purpose; polling would only disturb it.
      if (!started || state.loading || state.replay || !state.source || state.source === "demo") return;
      let live = state.source === "binance" || state.source === "binance_futures";
      if (state.source === "twelvedata") {
        // Exchange prices only move while the exchange trades; reloading a closed market would only use up the plan's credits.
        if (!marketNow(referenceMarket(state.symbol, state.source), Math.floor(Date.now() / 1000)).open) return;
        live = !streamRefused;
      }
      if (Date.now() - lastData > (live ? STALL_MS : POLL_MS)) void chart.refresh();
    },
  };
  return chart;
}

export const charts: ChartStore[] = Array.from({ length: MAX_CHARTS }, (_, i) => createChartStore(i));

/** Reloads every running chart (candles and live stream) and measures the clock again. */
export async function refreshAll(): Promise<void> {
  await Promise.all([...charts.map((c) => c.refresh()), measureClock()]);
}

// Keeps the data current on its own: browsers and iPads drop WebSockets while the app sleeps
// in the background or the screen is locked, and a stream can stall without closing.
if (typeof window !== "undefined") {
  window.setInterval(() => charts.forEach((c) => c.watchdog()), 15_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshAll();
  });
  window.addEventListener("online", () => void refreshAll());
}

// ---------------- Workspace (layout + active chart) ----------------

export type LayoutId = "1" | "2h" | "2v" | "3" | "3h" | "4" | "6" | "8";

export const LAYOUTS: { id: LayoutId; count: number; label: string; icon: string }[] = [
  { id: "1", count: 1, label: "Ein Chart", icon: "▢" },
  { id: "2h", count: 2, label: "Zwei Charts nebeneinander", icon: "◫" },
  { id: "2v", count: 2, label: "Zwei Charts übereinander", icon: "⊟" },
  { id: "3", count: 3, label: "Drei Charts (einer groß)", icon: "◧" },
  { id: "3h", count: 3, label: "Drei Charts nebeneinander", icon: "⫼" },
  { id: "4", count: 4, label: "Vier Charts (2 × 2)", icon: "⊞" },
  { id: "6", count: 6, label: "Sechs Charts (3 × 2)", icon: "☷" },
  { id: "8", count: 8, label: "Acht Charts (4 × 2)", icon: "▦" },
];

export interface Workspace {
  layout: LayoutId;
  active: number;
  /** A new time frame on one chart is applied to all visible charts. */
  syncInterval: boolean;
  /** A new symbol on one chart is applied to all visible charts. */
  syncSymbol: boolean;
  /** The crosshair is shown at the same time in all charts. */
  syncCrosshair: boolean;
  /** Scrolling and zooming one chart shows the same time range in the others. */
  syncTime: boolean;
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
  syncSymbol: savedWorkspace.syncSymbol ?? false,
  syncCrosshair: savedWorkspace.syncCrosshair ?? true,
  syncTime: savedWorkspace.syncTime ?? false,
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
  const w = workspaceState;
  const syncI = w.syncInterval && interval !== target.get().interval;
  const syncS = w.syncSymbol && symbol !== target.get().symbol;
  if (!syncI && !syncS) return target.load(symbol, interval);
  // Synced time frame or symbol: the other visible charts follow.
  const count = layoutCount(w.layout);
  await Promise.all(
    charts.slice(0, count).map((c) => (c === target ? c.load(symbol, interval) : c.load(syncS ? symbol : c.get().symbol, syncI ? interval : c.get().interval))),
  );
}

export async function fetchMarketData(symbol: string, interval: string, limit = 1000): Promise<MarketData> {
  // Without the Node server the browser fetches directly (Binance allows it; Yahoo does not, so stocks
  // use Binance perpetuals where one exists, see shared/assets.ts, and otherwise fall back to demo data).
  // With the user's exchange-feed key, stocks, indices and forex come from the exchange; without it (or on errors) as before.
  const feed = feedFor(symbol);
  if (feed) {
    try {
      return await loadFeedData(feed.id, feed.feed, interval, limit);
    } catch (err) {
      console.warn(`[market] twelvedata ${symbol} ${interval}: ${(err as Error).message}`);
    }
  }
  if (STANDALONE) return loadMarketData(symbol, interval, limit);
  const res = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as MarketData;
}

function connectLive(chart: ChartStore, symbol: string, interval: Interval, futures: boolean, current: () => boolean, onData: () => void): WebSocket {
  const stream = binanceInterval(interval);
  // Quarter and year candles follow the monthly stream, 5 s the 1 s stream, 45 m the 15 m one …; `seen` is the last source kline, for volume deltas.
  const merge = stream !== interval && interval !== "all";
  let seen: Bar | null = null;
  const host = futures ? "wss://fstream.binance.com" : "wss://stream.binance.com:9443";
  const ws = new WebSocket(`${host}/ws/${symbol.toLowerCase()}@kline_${stream}`);
  ws.onmessage = (ev) => {
    if (!current()) return;
    onData();
    const receivedAt = Date.now();
    const msg = JSON.parse(ev.data);
    const k = msg.k;
    if (!k) return;
    const liveTick: LiveTick = { eventTime: Number(msg.E) || receivedAt, receivedAt };
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
      if (!s.replay) return { bars, liveTick };
      return s.replay.phase === "select" && !s.replay.shown ? { bars, liveTick, replay: { ...s.replay, all: bars } } : { liveTick, replay: { ...s.replay, all: bars } };
    });
  };
  return ws;
}

/** Exchange prices from the Twelve Data WebSocket, folded into the chart's candles. */
function connectExchangeLive(chart: ChartStore, feed: FeedSymbol, interval: Interval, current: () => boolean, onData: () => void, onRefused: () => void): WebSocket {
  let dayVolume: number | undefined;
  return connectFeedLive(
    feed,
    (e) => {
      if (!current()) return;
      onData();
      const receivedAt = Date.now();
      // The exchange reports the day's volume so far; the candle gets what was added since the last price.
      const volume = e.dayVolume !== undefined && dayVolume !== undefined && e.dayVolume >= dayVolume ? e.dayVolume - dayVolume : 0;
      dayVolume = e.dayVolume;
      const liveTick: LiveTick = { eventTime: e.time, receivedAt };
      chart.set((s) => {
        const series = s.replay ? s.replay.all : s.bars;
        const bars = applyPrice(series, interval, e.price, e.time, volume);
        if (!s.replay) return { bars, liveTick };
        return s.replay.phase === "select" && !s.replay.shown ? { bars, liveTick, replay: { ...s.replay, all: bars } } : { liveTick, replay: { ...s.replay, all: bars } };
      });
    },
    () => current() && onRefused(),
  );
}

/** Loads the newest candles again over REST and compares them with what the chart shows. */
export async function crossCheckLatest(chart: ChartStore): Promise<void> {
  const { symbol, interval, source } = chart.get();
  if (!source || source === "demo") return;
  const json = await fetchMarketData(symbol, interval, 50);
  const rest = json.bars[json.bars.length - 1];
  if (!rest || chart.get().symbol !== symbol || chart.get().interval !== interval) return;
  const s = chart.get();
  const series = s.replay ? s.replay.all : s.bars;
  // A candle the chart started after the REST answer was built is compared at the REST candle's time.
  const shown = [...series].reverse().find((b) => b.time === rest.time) ?? series[series.length - 1];
  chart.set({ restCheck: { at: Date.now(), restTime: rest.time, restClose: rest.close, chartTime: shown?.time ?? null, chartClose: shown?.close ?? null } });
}

export async function fetchOpenInterest(symbol: string, period: string, limit = 500): Promise<OpenInterestPoint[]> {
  if (STANDALONE) return loadOpenInterest(symbol, period, limit);
  const res = await fetch(`/api/open-interest?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=${limit}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as OpenInterestPoint[];
}
