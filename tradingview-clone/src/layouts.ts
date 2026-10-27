import { useSyncExternalStore } from "react";
import { getIndicator, resolveParams } from "../shared/indicators";
import { charts, newId, setLayout, workspace } from "./store";
import { applyTemplate, findTemplate, overwriteWorkspace, renameTemplate, saveWorkspace, workspaceSnapshot, type Template } from "./templates";

/**
 * TradingView-style chart layouts: the layout you work in has a name, ⌘S / Ctrl+S saves it,
 * and with autosave on every change is written back a moment later. Layouts are stored as
 * saved workspaces (see templates.ts), so they also show up under Vorlagen → Arbeitsbereiche.
 */

const KEY = "chartai.currentLayout.v1";

interface State {
  /** Saved workspace the charts belong to; null = not saved yet ("Unbenannt"). */
  id: string | null;
  autosave: boolean;
  /** Changes since the last save. */
  dirty: boolean;
}

function load(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v === "object") return { id: typeof v.id === "string" && findTemplate(v.id) ? v.id : null, autosave: v.autosave !== false, dirty: false };
  } catch {
    // fall through
  }
  return { id: null, autosave: true, dirty: false };
}

let state = load();
const listeners = new Set<() => void>();
/** JSON of the layout as last saved or opened, to tell whether it changed. */
let savedJson = "";

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ id: state.id, autosave: state.autosave }));
  } catch {
    // not remembered
  }
  listeners.forEach((l) => l());
}

export function useLayoutState(): State & { name: string } {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  return { ...s, name: currentName() };
}

export function currentName(): string {
  return (state.id && findTemplate(state.id)?.name) || "Unbenannt";
}

const snapshotJson = () => JSON.stringify(workspaceSnapshot());

/** Saves the current layout; without a name yet it needs `name`. Returns false when there is nothing to save to. */
export function saveLayout(name?: string): boolean {
  if (name) {
    const t = saveWorkspace(name);
    savedJson = snapshotJson();
    set({ id: t.id, dirty: false });
    return true;
  }
  if (!state.id || !overwriteWorkspace(state.id)) return false;
  savedJson = snapshotJson();
  set({ dirty: false });
  return true;
}

export function renameLayout(name: string): boolean {
  if (!state.id) return saveLayout(name);
  const ok = renameTemplate(state.id, name);
  if (ok) listeners.forEach((l) => l());
  return ok;
}

export async function openLayout(t: Template) {
  await applyTemplate(t, charts[0]);
  savedJson = snapshotJson();
  set({ id: t.builtin ? null : t.id, dirty: false });
}

/** A fresh single chart with the active symbol, volume only and no drawings ("Neues Layout"). */
export function newLayout() {
  const symbol = charts[workspace.get().active].get().symbol;
  setLayout("1");
  workspace.set({ active: 0 });
  const c = charts[0];
  c.set({ indicators: [{ id: newId("volume"), type: "volume", params: resolveParams(getIndicator("volume")!, {}), author: "user" }], drawings: [], markers: [], compare: [] });
  if (c.get().symbol !== symbol) void c.load(symbol, c.get().interval);
  savedJson = "";
  set({ id: null, dirty: false });
}

export function setAutosave(on: boolean) {
  set({ autosave: on });
  if (on) check();
}

let timer = 0;

function check() {
  timer = 0;
  const json = snapshotJson();
  if (!savedJson) {
    savedJson = json;
    return;
  }
  if (json === savedJson) {
    if (state.dirty) set({ dirty: false });
    return;
  }
  if (state.autosave && state.id && overwriteWorkspace(state.id)) {
    savedJson = json;
    if (state.dirty) set({ dirty: false });
    return;
  }
  if (!state.dirty) set({ dirty: true });
}

/** Watches the charts; changes mark the layout as unsaved or are autosaved after 1.5 s. Live ticks only cost a cheap timer check. */
export function startLayoutWatch(): () => void {
  const schedule = () => {
    if (!timer) timer = window.setTimeout(check, 1500);
  };
  const offs = [workspace.subscribe(schedule), ...charts.map((c) => c.subscribe(schedule))];
  // The layout as it was restored on start counts as saved.
  timer = window.setTimeout(check, 3000);
  return () => {
    offs.forEach((off) => off());
    window.clearTimeout(timer);
    timer = 0;
  };
}
