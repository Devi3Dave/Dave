import { useSyncExternalStore } from "react";
import { arrangeDrawing, cloneDrawing, type Arrange } from "./drawingOps";
import { newId, type ChartStore, type Drawing } from "./store";

// ---------------- Selection (one drawing in one chart) ----------------

let selection: { slot: number; id: string } | null = null;
const listeners = new Set<() => void>();

export function selectDrawing(slot: number, id: string | null) {
  const next = id ? { slot, id } : null;
  if (next?.slot === selection?.slot && next?.id === selection?.id) return;
  // Deselecting in one chart must not drop the selection of another.
  if (!next && selection && selection.slot !== slot) return;
  selection = next;
  for (const l of listeners) l();
}

export function selectedDrawing(slot: number): string | null {
  return selection?.slot === slot ? selection.id : null;
}

export function useSelectedDrawing(slot: number): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selectedDrawing(slot),
  );
}

// ---------------- Undo (per chart) ----------------

const history = new Map<number, Drawing[][]>();
/** States undone with ⌘Z, for redo; a new edit clears them. */
const future = new Map<number, Drawing[][]>();
let restoring = false;

/** Remembers each earlier state of the chart's drawings, so ⌘Z can go back. A new symbol starts over. */
export function trackHistory(chart: ChartStore): () => void {
  let prev = chart.get().drawings;
  let symbol = chart.get().symbol;
  history.set(chart.slot, []);
  future.set(chart.slot, []);
  return chart.subscribe(() => {
    const s = chart.get();
    if (s.symbol !== symbol) {
      symbol = s.symbol;
      prev = s.drawings;
      history.set(chart.slot, []);
      future.set(chart.slot, []);
      return;
    }
    if (s.drawings === prev) return;
    if (!restoring) {
      const h = history.get(chart.slot) ?? [];
      h.push(prev);
      if (h.length > 50) h.shift();
      history.set(chart.slot, h);
      future.set(chart.slot, []);
    }
    prev = s.drawings;
  });
}

export function canUndo(chart: ChartStore): boolean {
  return (history.get(chart.slot)?.length ?? 0) > 0;
}

export function undoDrawings(chart: ChartStore): boolean {
  const last = history.get(chart.slot)?.pop();
  if (!last) return false;
  future.set(chart.slot, [...(future.get(chart.slot) ?? []), chart.get().drawings]);
  restore(chart, last);
  return true;
}

export function redoDrawings(chart: ChartStore): boolean {
  const next = future.get(chart.slot)?.pop();
  if (!next) return false;
  history.get(chart.slot)?.push(chart.get().drawings);
  restore(chart, next);
  return true;
}

function restore(chart: ChartStore, drawings: Drawing[]) {
  restoring = true;
  chart.set({ drawings });
  restoring = false;
}

/** Hides every drawing, or shows them all again when all are hidden (TradingView: Ctrl + Alt + H). */
export function toggleAllDrawingsHidden(chart: ChartStore) {
  const list = chart.get().drawings;
  if (list.length && list.every((d) => d.hidden)) return showAllDrawings(chart);
  setDrawings(chart, (l) => l.map((d) => (d.hidden ? d : { ...d, hidden: true })));
}

// ---------------- Edits ----------------

const setDrawings = (chart: ChartStore, f: (list: Drawing[]) => Drawing[]) => chart.set((s) => ({ drawings: f(s.drawings) }));

export function patchDrawing(chart: ChartStore, id: string, patch: Partial<Drawing>) {
  setDrawings(chart, (list) => list.map((d) => (d.id === id ? ({ ...d, ...patch } as Drawing) : d)));
}

export function replaceDrawing(chart: ChartStore, d: Drawing) {
  setDrawings(chart, (list) => (list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d]));
}

export function deleteDrawing(chart: ChartStore, id: string) {
  setDrawings(chart, (list) => list.filter((d) => d.id !== id));
  selectDrawing(chart.slot, null);
}

/** Adds a copy at the same place, on top, and selects it (TradingView: Klonen). */
export function cloneInPlace(chart: ChartStore, id: string): string | null {
  const d = chart.get().drawings.find((x) => x.id === id);
  if (!d) return null;
  const copy = cloneDrawing(d, newId("user"));
  setDrawings(chart, (list) => [...list, copy]);
  selectDrawing(chart.slot, copy.id);
  return copy.id;
}

export function arrange(chart: ChartStore, id: string, where: Arrange) {
  setDrawings(chart, (list) => arrangeDrawing(list, id, where));
}

export function showAllDrawings(chart: ChartStore) {
  setDrawings(chart, (list) => list.map((d) => (d.hidden ? { ...d, hidden: false } : d)));
}

// ---------------- Clipboard (works across charts) ----------------

let clipboard: Drawing | null = null;

export function copyDrawing(chart: ChartStore, id: string) {
  clipboard = chart.get().drawings.find((d) => d.id === id) ?? clipboard;
}

export function hasClipboard(): boolean {
  return clipboard !== null;
}

export function pasteDrawing(chart: ChartStore) {
  if (!clipboard) return;
  const copy = cloneDrawing(clipboard, newId("user"));
  setDrawings(chart, (list) => [...list, copy]);
  selectDrawing(chart.slot, copy.id);
}

