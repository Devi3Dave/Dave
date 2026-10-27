import { useEffect, useRef, useSyncExternalStore } from "react";
import { claimsEscape, findAction, formatCombo, parseOverrides, resolveBindings, type ShortcutOverrides } from "../shared/shortcuts";

/** ⌘/⌥ on Apple devices (also an iPad with keyboard), Ctrl/Alt elsewhere. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const STORAGE_KEY = "chartai.shortcuts.v1";

function readStored(): ShortcutOverrides {
  try {
    return parseOverrides(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

let overrides = readStored();
let bindings = resolveBindings(overrides, IS_MAC);
const listeners = new Set<() => void>();

export const shortcutStore = {
  overrides: () => overrides,
  bindings: () => bindings,
  set(next: ShortcutOverrides) {
    overrides = next;
    bindings = resolveBindings(next, IS_MAC);
    try {
      if (Object.keys(next).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode: the change lasts until the page reloads.
    }
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useShortcutOverrides(): ShortcutOverrides {
  return useSyncExternalStore(shortcutStore.subscribe, shortcutStore.overrides);
}

/** The keys of an action for tooltips and menus ("⌥T"), or "" when it has none. */
export function shortcutLabel(id: string): string {
  const combo = bindings[id]?.[0];
  return combo ? formatCombo(combo, IS_MAC) : "";
}

/** Like shortcutLabel, re-rendering when the user changes the shortcuts. */
export function useShortcutLabel(id: string): string {
  useShortcutOverrides();
  return shortcutLabel(id);
}

// ---------------- Dispatch ----------------

/** A handler returns false when the key is not its business (e.g. no drawing selected); the next one gets a try. */
type Handler = (ev: KeyboardEvent) => boolean | void;
const handlers = new Map<string, Set<{ current: Handler }>>();
let suspended = 0;

/** While the editor records a new combo, no shortcut fires. */
export function suspendShortcuts(): () => void {
  suspended++;
  return () => void suspended--;
}

function onKeyDown(ev: KeyboardEvent) {
  if (suspended || ev.defaultPrevented || ev.isComposing) return;
  const id = findAction(ev, bindings, IS_MAC);
  if (!id) return;
  // Not while typing (Claude panel, search fields, dialogs), except the list itself.
  const el = ev.target as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && id !== "dialog.shortcuts") return;
  for (const ref of handlers.get(id) ?? []) {
    if (ref.current(ev) !== false) {
      ev.preventDefault();
      return;
    }
  }
}

let installed = false;
function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", onKeyDown);
  // After every other Esc handler on window: Safari would otherwise leave full screen.
  window.addEventListener("keydown", (ev) => {
    if (claimsEscape(ev)) ev.preventDefault();
  });
}

/** Runs the handlers while the component is mounted; the newest handler is always used. */
export function useShortcuts(map: Record<string, Handler>) {
  const refs = useRef(new Map<string, { current: Handler }>());
  for (const [id, fn] of Object.entries(map)) {
    const ref = refs.current.get(id);
    if (ref) ref.current = fn;
    else refs.current.set(id, { current: fn });
  }
  const ids = Object.keys(map).join(",");
  useEffect(() => {
    install();
    const added: [string, { current: Handler }][] = [];
    for (const [id, ref] of refs.current) {
      if (!ids.split(",").includes(id)) continue;
      const set = handlers.get(id) ?? new Set();
      set.add(ref);
      handlers.set(id, set);
      added.push([id, ref]);
    }
    return () => {
      for (const [id, ref] of added) handlers.get(id)?.delete(ref);
    };
  }, [ids]);
}
