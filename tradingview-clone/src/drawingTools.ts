import { useSyncExternalStore } from "react";
import { SHAPES, type ShapeGroup } from "../shared/drawingShapes";
import type { Tool } from "./store";

export interface ToolInfo {
  id: Tool;
  icon: string;
  label: string;
}

const BASIC: Record<string, ToolInfo> = Object.fromEntries(
  (
    [
      { id: "trendline", icon: "╱", label: "Trendlinie\nZwei Punkte antippen" },
      { id: "ray", icon: "⟋", label: "Strahl\nTrendlinie, nach rechts verlängert" },
      { id: "hline", icon: "―", label: "Horizontale Linie" },
      { id: "vline", icon: "│", label: "Vertikale Linie" },
      { id: "channel", icon: "▱", label: "Paralleler Kanal\nZwei Punkte für die Linie, dritter für die Breite" },
      { id: "fib", icon: "≣", label: "Fibonacci-Retracement\nVon Swing-Tief zu Swing-Hoch ziehen" },
      { id: "fibext", icon: "⋰", label: "Fibonacci-Extension (trendbasiert)\nStart, Ende der Bewegung, dann Ende des Rücksetzers antippen" },
      { id: "long", icon: "▲", label: "Long-Position\nEinstieg, dann Stop-Loss, dann Take-Profit antippen\nAntippen der Position öffnet die Einstellungen" },
      { id: "short", icon: "▼", label: "Short-Position\nEinstieg, dann Stop-Loss, dann Take-Profit antippen\nAntippen der Position öffnet die Einstellungen" },
      { id: "measure", icon: "⇲", label: "Messen\nΔ Preis, Δ %, Anzahl Kerzen und Δ Zeit zwischen zwei Punkten" },
      { id: "zone", icon: "▭", label: "Rechteck / Zone\nZwei Ecken antippen" },
      { id: "brush", icon: "✎", label: "Pinsel\nFreihand zeichnen; Esc oder Cursor beendet" },
      { id: "text", icon: "T", label: "Text" },
    ] as ToolInfo[]
  ).map((t) => [t.id, t]),
);

export const CURSOR: ToolInfo = { id: "cursor", icon: "↖", label: "Cursor\nEsc bricht das Zeichnen ab" };
export const ERASER: ToolInfo = { id: "erase", icon: "⌫", label: "Radierer\nZeichnung anklicken zum Löschen" };

export function toolInfo(id: Tool): ToolInfo {
  if (id === "cursor") return CURSOR;
  if (id === "erase") return ERASER;
  const basic = BASIC[id];
  if (basic) return basic;
  const s = SHAPES.find((x) => x.id === id)!;
  return { id: s.id, icon: s.icon, label: `${s.name}\n${s.tip}` };
}

/** First line of a tool's tooltip: its name. */
export const toolName = (id: Tool) => toolInfo(id).label.split("\n")[0];

export interface ToolGroup {
  id: ShapeGroup;
  icon: string;
  tools: Tool[];
}

/** The left toolbar's groups, in TradingView's order (lines, Fibonacci/Gann, patterns, forecasting, shapes, annotations). */
export const TOOL_GROUPS: ToolGroup[] = [
  { id: "Linien", icon: "╱", tools: ["trendline", "ray", "trendangle", "arrowline", "hline", "hray", "vline", "crossline", "channel", "regression", "pitchfork", "schiff", "modschiff"] },
  { id: "Fibonacci & Gann", icon: "≣", tools: ["fib", "fibext", "fibchannel", "fibtimezone", "fibfan", "fibcircles", "fibarcs", "gannbox", "gannfan"] },
  { id: "Muster", icon: "Ⓧ", tools: ["xabcd", "cypher", "abcd", "headshoulders", "trianglepattern", "threedrives", "elliott5", "elliottabc", "elliotttri", "elliottwxy"] },
  { id: "Prognose & Messen", icon: "⇲", tools: ["long", "short", "measure", "pricerange", "daterange", "avwap"] },
  { id: "Formen", icon: "▭", tools: ["zone", "circle", "ellipse", "triangle", "brush"] },
  { id: "Beschriftung", icon: "T", tools: ["text", "callout", "note", "pricelabel", "arrowup", "arrowdown", "emoji"] },
];

// ---------------- Remembered state: favorites, last tool per group, favorites bar ----------------

const KEY = "chartai.drawingTools.v1";

interface State {
  favorites: Tool[];
  /** Tool shown on each group's button: the one last picked from it. */
  last: Partial<Record<ShapeGroup, Tool>>;
  barVisible: boolean;
  /** Position of the floating favorites bar, px from the top left of the window. */
  barPos: { x: number; y: number } | null;
}

const ALL = new Set<string>(TOOL_GROUPS.flatMap((g) => g.tools));

function load(): State {
  const empty: State = { favorites: ["trendline", "hline", "fib", "long", "short"], last: {}, barVisible: false, barPos: null };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return empty;
    return {
      favorites: Array.isArray(v.favorites) ? v.favorites.filter((t: unknown) => typeof t === "string" && ALL.has(t)) : empty.favorites,
      last: v.last && typeof v.last === "object" ? v.last : {},
      barVisible: v.barVisible === true,
      barPos: v.barPos && Number.isFinite(v.barPos.x) && Number.isFinite(v.barPos.y) ? v.barPos : null,
    };
  } catch {
    return empty;
  }
}

let state = load();
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // not remembered
  }
  listeners.forEach((l) => l());
}

export function useDrawingTools(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function toggleToolFavorite(id: Tool) {
  set({ favorites: state.favorites.includes(id) ? state.favorites.filter((f) => f !== id) : [...state.favorites, id] });
}

export function rememberTool(id: Tool) {
  const group = TOOL_GROUPS.find((g) => g.tools.includes(id));
  if (group && state.last[group.id] !== id) set({ last: { ...state.last, [group.id]: id } });
}

export function groupTool(g: ToolGroup): Tool {
  return state.last[g.id] ?? g.tools[0];
}

export function setFavoritesBar(visible: boolean) {
  set({ barVisible: visible });
}

export function moveFavoritesBar(pos: { x: number; y: number }) {
  set({ barPos: pos });
}
