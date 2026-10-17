import { useSyncExternalStore } from "react";
import type { Bar } from "../shared/math";
import type { CHART_TYPES, INTERVALS } from "../shared/tools";

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
}

export type Drawing =
  | (DrawingBase & { kind: "trendline"; a: Point; b: Point; extend: "none" | "right" | "left" | "both"; style: LineStyleName; width: number })
  | (DrawingBase & { kind: "hline"; price: number; style: LineStyleName })
  | (DrawingBase & { kind: "vline"; time: number })
  | (DrawingBase & { kind: "zone"; top: number; bottom: number; from?: number; to?: number; extendRight: boolean })
  | (DrawingBase & { kind: "fib"; a: Point; b: Point; levels: number[] })
  | (DrawingBase & { kind: "text"; at: Point; text: string });

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

export type Tool = "cursor" | "trendline" | "ray" | "hline" | "vline" | "zone" | "fib" | "text" | "erase";

export interface ChartState {
  symbol: string;
  interval: Interval;
  chartType: ChartType;
  bars: Bar[];
  source: "binance" | "yahoo" | "demo" | null;
  loading: boolean;
  error: string | null;
  indicators: IndicatorInstance[];
  drawings: Drawing[];
  markers: ChartMarker[];
  tool: Tool;
}

type Listener = () => void;

const STORAGE_KEY = "chartai.layout.v1";

function loadLayout(): Partial<ChartState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ChartState>) : {};
  } catch {
    return {};
  }
}

const saved = loadLayout();

let state: ChartState = {
  symbol: saved.symbol ?? "BTCUSDT",
  interval: saved.interval ?? "1h",
  chartType: saved.chartType ?? "candles",
  bars: [],
  source: null,
  loading: false,
  error: null,
  indicators: saved.indicators ?? [
    { id: "ind-volume", type: "volume", params: { length: 20 }, author: "user" },
    { id: "ind-ema21", type: "ema", params: { length: 21 }, author: "user" },
  ],
  drawings: saved.drawings ?? [],
  markers: saved.markers ?? [],
  tool: "cursor",
};

const listeners = new Set<Listener>();

export const store = {
  get: () => state,
  set(patch: Partial<ChartState> | ((s: ChartState) => Partial<ChartState>)) {
    const next = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...next };
    listeners.forEach((l) => l());
    persist();
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

let persistTimer: number | undefined;
function persist() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    const { symbol, interval, chartType, indicators, drawings, markers } = state;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ symbol, interval, chartType, indicators, drawings, markers }));
    } catch {
      // storage unavailable (private mode) - layout just isn't remembered
    }
  }, 300);
}

export function useChartState<T>(selector: (s: ChartState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

// ---------------- Actions ----------------

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

// ---------------- Market data ----------------

let socket: WebSocket | null = null;
let loadSeq = 0;

export async function loadChart(symbol: string, interval: Interval): Promise<void> {
  const seq = ++loadSeq;
  socket?.close();
  socket = null;
  const symbolChanged = symbol !== state.symbol;
  store.set({
    symbol,
    interval,
    loading: true,
    error: null,
    // Drawings and markers are anchored to prices of one symbol.
    ...(symbolChanged ? { drawings: [], markers: [] } : {}),
  });
  try {
    const res = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    if (seq !== loadSeq) return;
    store.set({ bars: json.bars, source: json.source, symbol: json.symbol, loading: false });
    if (json.source === "binance") connectLive(json.symbol, interval, seq);
  } catch (err) {
    if (seq !== loadSeq) return;
    store.set({ loading: false, error: (err as Error).message });
  }
}

function connectLive(symbol: string, interval: Interval, seq: number) {
  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`);
  socket = ws;
  ws.onmessage = (ev) => {
    if (seq !== loadSeq) return;
    const k = JSON.parse(ev.data).k;
    if (!k) return;
    const bar: Bar = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
    store.set((s) => {
      const bars = s.bars.slice();
      const last = bars[bars.length - 1];
      if (last && last.time === bar.time) bars[bars.length - 1] = bar;
      else if (!last || bar.time > last.time) bars.push(bar);
      return { bars };
    });
  };
}
