import { useSyncExternalStore } from "react";
import { getIndicator, resolveParams } from "../shared/indicators";
import {
  charts,
  layoutCount,
  newId,
  setLayout,
  workspace,
  type ChartMarker,
  type ChartStore,
  type ChartType,
  type Drawing,
  type IndicatorInstance,
  type Interval,
  type LayoutId,
} from "./store";

/** What a template puts on a chart. Symbol and drawings only when saved with them. */
export interface ChartSnapshot {
  symbol?: string;
  interval?: Interval;
  chartType?: ChartType;
  indicators: Omit<IndicatorInstance, "id" | "author">[];
  drawings?: Drawing[];
  markers?: ChartMarker[];
}

export interface Template {
  id: string;
  name: string;
  kind: "chart" | "workspace";
  builtin?: boolean;
  description?: string;
  chart?: ChartSnapshot;
  workspace?: { layout: LayoutId; syncInterval: boolean; syncSymbol?: boolean; syncCrosshair?: boolean; syncTime?: boolean; charts: ChartSnapshot[] };
  savedAt?: number;
}

const ind = (type: string, params: Record<string, number> = {}, colors?: string[]) => {
  const def = getIndicator(type);
  return { type, params: def ? resolveParams(def, params) : params, ...(colors ? { colors } : {}) };
};

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "builtin-clean",
    name: "Nur Chart",
    kind: "chart",
    builtin: true,
    description: "Alle Indikatoren entfernen, nur der reine Chart",
    chart: { indicators: [] },
  },
  {
    id: "builtin-scalping",
    name: "Scalping",
    kind: "chart",
    builtin: true,
    description: "1m · EMA 9/21, VWAP, RSI 7, Volumen",
    chart: { interval: "1m", indicators: [ind("volume"), ind("ema", { length: 9 }, ["#00bcd4"]), ind("ema", { length: 21 }, ["#ff9800"]), ind("vwap"), ind("rsi", { length: 7 })] },
  },
  {
    id: "builtin-daytrading",
    name: "Daytrading",
    kind: "chart",
    builtin: true,
    description: "15m · EMA 20/50, VWAP-Bänder, MACD, Volumen",
    chart: { interval: "15m", indicators: [ind("volume"), ind("ema", { length: 20 }, ["#00bcd4"]), ind("ema", { length: 50 }, ["#ff9800"]), ind("vwapbands"), ind("macd")] },
  },
  {
    id: "builtin-swing",
    name: "Swing",
    kind: "chart",
    builtin: true,
    description: "4h · EMA 50/200, Supertrend, RSI, MACD, Volumen",
    chart: { interval: "4h", indicators: [ind("volume"), ind("ema", { length: 50 }, ["#00bcd4"]), ind("ema", { length: 200 }, ["#f23645"]), ind("supertrend"), ind("rsi"), ind("macd")] },
  },
  {
    id: "builtin-position",
    name: "Krypto-Zyklus",
    kind: "chart",
    builtin: true,
    description: "1d · Bull Market Support Band, Pi Cycle, Mayer Multiple",
    chart: { interval: "1d", chartType: "candles", indicators: [ind("volume"), ind("bmsb"), ind("picycle"), ind("mayer")] },
  },
  {
    id: "builtin-smc",
    name: "Smart Money",
    kind: "chart",
    builtin: true,
    description: "Orderblöcke 4h/1d mit Buy/Sell-Signalen, EMA 50/200, Volumen",
    chart: { indicators: [ind("volume"), ind("orderblocks"), ind("ema", { length: 50 }, ["#00bcd4"]), ind("ema", { length: 200 }, ["#f23645"])] },
  },
  {
    id: "builtin-patterns",
    name: "Mustererkennung",
    kind: "chart",
    builtin: true,
    description: "Kerzenmuster, Chartformationen, Volumen",
    chart: { indicators: [ind("volume"), ind("candlepatterns"), ind("chartpatterns")] },
  },
  {
    // Weitere Elemente nach Devis Liste seines Setups (2026-10-26): Sessions + NY-Open (statt "IT Foundation"),
    // RSI mit Wolken und Divergenzen (statt "Inevitrade Pro Plus" / "Cloud Highlight RSI"), FVG mit CE und
    // CHoCH/BOS (wie LuxAlgo SMC / FVG), Volumen.
    // Quellen: Craig Percoco, "My Trading Strategy is Boring But Made Me $18,565 (Step By Step)"
    // (youtube.com/watch?v=c5ATdFHneJo) – 15m-FVGs vor dem New-York-Open markieren, Einstieg nach
    // Change of Character + FVG auf 1m (CHoCH/BOS nach smart-money-concepts); RSI-Überkauft/Überverkauft aus seinem Einsteiger-Tutorial
    // "How to Start Day Trading as a Beginner". Seine bezahlten Layout-Einstellungen sind nicht öffentlich.
    id: "builtin-percoco",
    name: "Craig Percoco",
    kind: "chart",
    builtin: true,
    description: "15m · Sessions + NY-Open, FVG mit CE, CHoCH/BOS, Volumen, RSI-Wolken mit Divergenzen – Einstieg auf 1m",
    chart: {
      interval: "15m",
      chartType: "candles",
      indicators: [ind("volume"), ind("sessions"), ind("fvg", { ce: 1 }), ind("structure"), ind("rsicloud", { length: 14 })],
    },
  },
];

/** Built-in workspaces; charts without a symbol take the symbol of the active chart. */
export const BUILTIN_WORKSPACES: Template[] = [
  {
    // Percocos Ablauf (Video c5ATdFHneJo, s. o.): 15m-FVGs vor dem NY-Open markieren, Einstieg auf 1m nach
    // CHoCH + FVG. Links der Überblick, rechts der Einstieg mit den 15m-FVGs eingeblendet.
    id: "builtin-ws-percoco",
    name: "Percoco 15m + 1m",
    kind: "workspace",
    builtin: true,
    description: "Zwei Charts, gleiches Symbol: 15m-Vorlage links, 1m mit 15m-FVGs, CHoCH und Sessions rechts",
    workspace: {
      layout: "2h",
      syncInterval: false,
      syncSymbol: true,
      charts: [
        BUILTIN_TEMPLATES.find((t) => t.id === "builtin-percoco")!.chart!,
        { interval: "1m", chartType: "candles", indicators: [ind("volume"), ind("sessions"), ind("fvg", { ce: 1, tf2: 15 }), ind("structure", { bos: 0 })] },
      ],
    },
  },
];

const KEY = "chartai.templates.v1";

function load(): Template[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? (v as Template[]) : [];
  } catch {
    return [];
  }
}

let saved = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // not remembered
  }
  listeners.forEach((l) => l());
}

export function useSavedTemplates(): Template[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => saved,
  );
}

export function snapshotOf(chart: ChartStore, opts: { symbol: boolean; interval: boolean; drawings: boolean }): ChartSnapshot {
  const s = chart.get();
  return {
    ...(opts.symbol || opts.drawings ? { symbol: s.symbol } : {}),
    ...(opts.interval ? { interval: s.interval } : {}),
    chartType: s.chartType,
    indicators: s.indicators.map(({ type, params, colors, hidden }) => ({ type, params, ...(colors ? { colors } : {}), ...(hidden ? { hidden } : {}) })),
    ...(opts.drawings ? { drawings: s.drawings, markers: s.markers } : {}),
  };
}

/** Saves (or replaces, same name and kind) a template. */
export function saveTemplate(t: Omit<Template, "id" | "savedAt">): Template {
  const existing = saved.find((x) => x.kind === t.kind && x.name.toLowerCase() === t.name.toLowerCase());
  const full: Template = { ...t, id: existing?.id ?? newId("tpl"), savedAt: Date.now() };
  saved = existing ? saved.map((x) => (x.id === existing.id ? full : x)) : [...saved, full];
  persist();
  return full;
}

export function deleteTemplate(id: string) {
  saved = saved.filter((t) => t.id !== id);
  persist();
}

export async function applySnapshot(chart: ChartStore, snap: ChartSnapshot) {
  const indicators: IndicatorInstance[] = snap.indicators.map((i) => ({ ...i, id: newId(i.type), author: "user" }));
  chart.set({ indicators, ...(snap.chartType ? { chartType: snap.chartType } : {}) });
  const cur = chart.get();
  const symbol = snap.symbol ?? cur.symbol;
  const interval = snap.interval ?? cur.interval;
  if (symbol !== cur.symbol || interval !== cur.interval || cur.bars.length === 0) await chart.load(symbol, interval);
  // After loading: a symbol change clears drawings.
  if (snap.drawings) chart.set({ drawings: snap.drawings.map((d) => ({ ...d })), markers: snap.markers ?? [] });
}

export async function applyTemplate(t: Template, target: ChartStore) {
  if (t.kind === "chart" && t.chart) return applySnapshot(target, t.chart);
  if (t.kind === "workspace" && t.workspace) {
    const w = t.workspace;
    const symbol = target.get().symbol;
    setLayout(w.layout);
    workspace.set({
      syncInterval: w.syncInterval,
      ...(w.syncSymbol !== undefined ? { syncSymbol: w.syncSymbol } : {}),
      ...(w.syncCrosshair !== undefined ? { syncCrosshair: w.syncCrosshair } : {}),
      ...(w.syncTime !== undefined ? { syncTime: w.syncTime } : {}),
      active: 0,
    });
    await Promise.all(w.charts.slice(0, layoutCount(w.layout)).map((snap, i) => applySnapshot(charts[i], { ...snap, symbol: snap.symbol ?? symbol })));
  }
}

/** The whole layout as it is now: every visible chart with symbol, interval, indicators and drawings. */
export function workspaceSnapshot(): NonNullable<Template["workspace"]> {
  const w = workspace.get();
  const count = layoutCount(w.layout);
  return {
    layout: w.layout,
    syncInterval: w.syncInterval,
    syncSymbol: w.syncSymbol,
    syncCrosshair: w.syncCrosshair,
    syncTime: w.syncTime,
    charts: charts.slice(0, count).map((c) => snapshotOf(c, { symbol: true, interval: true, drawings: true })),
  };
}

export function saveWorkspace(name: string): Template {
  return saveTemplate({ name, kind: "workspace", workspace: workspaceSnapshot() });
}

/** Overwrites the saved workspace `id` with the current layout (keeps its name); null when it is gone. */
export function overwriteWorkspace(id: string): Template | null {
  const t = saved.find((x) => x.id === id && x.kind === "workspace");
  if (!t) return null;
  const full: Template = { ...t, workspace: workspaceSnapshot(), savedAt: Date.now() };
  saved = saved.map((x) => (x.id === id ? full : x));
  persist();
  return full;
}

/** Renames a saved template; false when another one of the same kind already has the name. */
export function renameTemplate(id: string, name: string): boolean {
  const t = saved.find((x) => x.id === id);
  if (!t || saved.some((x) => x.id !== id && x.kind === t.kind && x.name.toLowerCase() === name.toLowerCase())) return false;
  saved = saved.map((x) => (x.id === id ? { ...x, name } : x));
  persist();
  return true;
}

export function findTemplate(id: string): Template | undefined {
  return saved.find((t) => t.id === id);
}

export function describeTemplate(t: Template): string {
  if (t.description) return t.description;
  if (t.kind === "workspace" && t.workspace) return t.workspace.charts.map((c) => `${c.symbol} ${c.interval}`).join(" · ");
  const c = t.chart;
  if (!c) return "";
  const parts = [c.symbol, c.interval].filter(Boolean).join(" ");
  const names = c.indicators.map((i) => getIndicator(i.type)?.short ?? getIndicator(i.type)?.name.replace(/\s*\(.*\)$/, "") ?? i.type);
  return [parts, names.join(", "), c.drawings?.length ? `${c.drawings.length} Zeichnungen` : ""].filter(Boolean).join(" · ");
}
