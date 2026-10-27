/**
 * Keyboard shortcuts: the list of actions, their default keys, matching and recording.
 *
 * Defaults marked `tv` follow TradingView's own documentation:
 * - Advanced Charts docs, "Keyboard shortcuts":
 *   https://www.tradingview.com/charting-library-docs/latest/getting_started/Shortcuts/
 *   (Alt+T/H/V/F, Alt+Shift+R, Ctrl+Alt+H, Alt+R, Alt+L/P/I, Ctrl+K, "/", Ctrl+Z/Y, Ctrl+C/V, Del,
 *   arrows to scroll, Ctrl+↑/↓ to zoom; on macOS ⌘/⌥/⇧ replace Ctrl/Alt/Shift)
 * - TradingView blog, shortcuts list on Ctrl+/ (⌘/ on Mac):
 *   https://www.tradingview.com/blog/en/new-shortcuts-rectangle-shortcuts-list-42318/
 * - TradingView blog, Alt+A for alerts: https://www.tradingview.com/blog/en/new-hotkeys-on-the-chart-37650/
 * Where the plain Mac translation collides with macOS/Safari, the Mac default differs:
 * redo is ⌘⇧Z (⌘Y opens Safari's history), hide drawings is ⌃⌥H (⌘⌥H hides all other apps).
 *
 * A combo is written "Mod+Alt+Shift+KeyA": Mod = ⌘ on Apple devices, Ctrl elsewhere; Ctrl = the
 * Control key itself (only differs from Mod on Apple devices). The key is a KeyboardEvent.code for
 * letters, digits, arrows and named keys, or a printed character such as "/" (layout independent).
 */

import { CHART_TYPE_LABELS, CHART_TYPES } from "./tools.js";
import { SHAPES } from "./drawingShapes.js";

export type ShortcutGroup = "Zeichnen" | "Bearbeiten" | "Chart" | "Preisskala" | "Fenster" | "Replay" | "Zeiteinheit" | "Charttyp";

export interface ShortcutAction {
  id: string;
  label: string;
  group: ShortcutGroup;
  /** Default combos; a pair when Apple devices need other keys. */
  defaults: string[] | { mac: string[]; other: string[] };
  /** Default taken from TradingView's documentation (see above). */
  tv?: boolean;
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = ["Zeichnen", "Bearbeiten", "Chart", "Preisskala", "Fenster", "Replay", "Zeiteinheit", "Charttyp"];

const TOOL_ACTIONS: ShortcutAction[] = [
  { id: "tool.cursor", label: "Cursor", group: "Zeichnen", defaults: [] },
  { id: "tool.trendline", label: "Trendlinie", group: "Zeichnen", defaults: ["Alt+KeyT"], tv: true },
  { id: "tool.ray", label: "Strahl", group: "Zeichnen", defaults: [] },
  { id: "tool.hline", label: "Horizontale Linie", group: "Zeichnen", defaults: ["Alt+KeyH"], tv: true },
  { id: "tool.vline", label: "Vertikale Linie", group: "Zeichnen", defaults: ["Alt+KeyV"], tv: true },
  { id: "tool.zone", label: "Rechteck / Zone", group: "Zeichnen", defaults: ["Alt+Shift+KeyR"], tv: true },
  { id: "tool.fib", label: "Fibonacci-Retracement", group: "Zeichnen", defaults: ["Alt+KeyF"], tv: true },
  { id: "tool.fibext", label: "Fibonacci-Extension", group: "Zeichnen", defaults: [] },
  { id: "tool.channel", label: "Paralleler Kanal", group: "Zeichnen", defaults: [] },
  { id: "tool.measure", label: "Messen", group: "Zeichnen", defaults: [] },
  { id: "tool.brush", label: "Pinsel", group: "Zeichnen", defaults: [] },
  { id: "tool.text", label: "Text", group: "Zeichnen", defaults: [] },
  { id: "tool.long", label: "Long-Position", group: "Zeichnen", defaults: [] },
  { id: "tool.short", label: "Short-Position", group: "Zeichnen", defaults: [] },
  { id: "tool.erase", label: "Radierer", group: "Zeichnen", defaults: [] },
  ...SHAPES.map((t): ShortcutAction => ({ id: `tool.${t.id}`, label: t.name, group: "Zeichnen", defaults: [] })),
  { id: "drawings.toggleHidden", label: "Alle Zeichnungen aus-/einblenden", group: "Zeichnen", defaults: ["Ctrl+Alt+KeyH"], tv: true },
];

const MAIN_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"];

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  ...TOOL_ACTIONS,
  { id: "edit.undo", label: "Rückgängig", group: "Bearbeiten", defaults: ["Mod+KeyZ"], tv: true },
  { id: "edit.redo", label: "Wiederholen", group: "Bearbeiten", defaults: { mac: ["Mod+Shift+KeyZ"], other: ["Mod+KeyY"] }, tv: true },
  { id: "drawing.copy", label: "Zeichnung kopieren", group: "Bearbeiten", defaults: ["Mod+KeyC"], tv: true },
  { id: "drawing.paste", label: "Zeichnung einfügen", group: "Bearbeiten", defaults: ["Mod+KeyV"], tv: true },
  { id: "drawing.clone", label: "Zeichnung klonen", group: "Bearbeiten", defaults: ["Mod+KeyD"] },
  { id: "drawing.delete", label: "Zeichnung löschen", group: "Bearbeiten", defaults: { mac: ["Backspace", "Delete"], other: ["Delete", "Backspace"] }, tv: true },
  { id: "chart.reset", label: "Chart zurücksetzen", group: "Chart", defaults: ["Alt+KeyR"], tv: true },
  { id: "chart.scrollLeft", label: "Eine Kerze zurück scrollen", group: "Chart", defaults: ["ArrowLeft"], tv: true },
  { id: "chart.scrollRight", label: "Eine Kerze vor scrollen", group: "Chart", defaults: ["ArrowRight"], tv: true },
  { id: "chart.goto", label: "Gehe zu Datum", group: "Chart", defaults: ["Alt+KeyG"] },
  { id: "chart.zoomIn", label: "Hineinzoomen", group: "Chart", defaults: ["Mod+ArrowUp"], tv: true },
  { id: "chart.zoomOut", label: "Herauszoomen", group: "Chart", defaults: ["Mod+ArrowDown"], tv: true },
  { id: "scale.log", label: "Logarithmische Skala an/aus", group: "Preisskala", defaults: ["Alt+KeyL"], tv: true },
  { id: "scale.percent", label: "Prozent-Skala an/aus", group: "Preisskala", defaults: ["Alt+KeyP"], tv: true },
  { id: "scale.invert", label: "Skala invertieren", group: "Preisskala", defaults: ["Alt+KeyI"], tv: true },
  { id: "panel.alerts", label: "Alarme", group: "Fenster", defaults: ["Alt+KeyA"], tv: true },
  { id: "layout.save", label: "Layout speichern", group: "Fenster", defaults: ["Mod+KeyS"] },
  { id: "dialog.search", label: "Asset-Suche", group: "Fenster", defaults: ["Mod+KeyK"], tv: true },
  { id: "dialog.indicators", label: "Indikatoren", group: "Fenster", defaults: ["/"], tv: true },
  { id: "dialog.shortcuts", label: "Tastenkürzel (diese Liste)", group: "Fenster", defaults: ["Mod+/"], tv: true },
  { id: "dialog.compare", label: "Symbol vergleichen", group: "Fenster", defaults: [] },
  { id: "dialog.settings", label: "Chart-Einstellungen", group: "Fenster", defaults: [] },
  { id: "panel.claude", label: "Seitenleiste ein/aus", group: "Fenster", defaults: [] },
  { id: "panel.demo", label: "Demo-Trading", group: "Fenster", defaults: [] },
  { id: "panel.strategy", label: "Strategietester", group: "Fenster", defaults: [] },
  { id: "panel.objects", label: "Objektbaum und Datenfenster", group: "Fenster", defaults: [] },
  { id: "page.heatmap", label: "Heatmap", group: "Fenster", defaults: [] },
  { id: "page.calc", label: "Rechner", group: "Fenster", defaults: [] },
  { id: "page.journal", label: "Journal", group: "Fenster", defaults: [] },
  { id: "page.exchanges", label: "Börsen", group: "Fenster", defaults: [] },
  { id: "replay.toggle", label: "Replay starten/beenden", group: "Replay", defaults: [] },
  { id: "replay.next", label: "Nächste Kerze", group: "Replay", defaults: ["Shift+ArrowRight"], tv: true },
  { id: "replay.prev", label: "Kerze zurück", group: "Replay", defaults: ["Shift+ArrowLeft"] },
  ...MAIN_INTERVALS.map((iv): ShortcutAction => ({ id: `interval.${iv}`, label: `Zeiteinheit ${iv === "1M" ? "1 Monat" : iv.replace(/d$/, "D").replace(/w$/, "W")}`, group: "Zeiteinheit", defaults: [] })),
  ...CHART_TYPES.map((t): ShortcutAction => ({ id: `chartType.${t}`, label: CHART_TYPE_LABELS[t], group: "Charttyp", defaults: [] })),
];

export const getAction = (id: string) => SHORTCUT_ACTIONS.find((a) => a.id === id);

export function defaultCombos(action: ShortcutAction, mac: boolean): string[] {
  return Array.isArray(action.defaults) ? action.defaults : mac ? action.defaults.mac : action.defaults.other;
}

/** User changes: action id → its combos (an empty list removes the shortcut). */
export type ShortcutOverrides = Record<string, string[]>;

export function resolveBindings(overrides: ShortcutOverrides, mac: boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of SHORTCUT_ACTIONS) out[a.id] = overrides[a.id] ?? defaultCombos(a, mac);
  return out;
}

// ---------------- Combos ----------------

interface Combo {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const CODE_KEY = /^(Key[A-Z]|Digit[0-9]|Numpad\w+|Arrow(Up|Down|Left|Right)|F\d{1,2}|Escape|Delete|Backspace|Enter|Space|Tab|Home|End|PageUp|PageDown|Insert|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash|IntlBackslash)$/;
const MODIFIER_KEYS = new Set(["Shift", "Alt", "Meta", "Control", "AltGraph", "CapsLock", "Fn", "OS"]);

export function parseCombo(s: string): Combo {
  const parts = s.split("+");
  // "Mod++" or a trailing "+" means the plus key itself.
  let key = parts.pop() ?? "";
  if (key === "" && s.endsWith("+")) {
    key = "+";
    parts.pop();
  }
  const has = (m: string) => parts.includes(m);
  return { mod: has("Mod"), ctrl: has("Ctrl"), alt: has("Alt"), shift: has("Shift"), key };
}

export function comboString(c: Combo): string {
  return [c.mod && "Mod", c.ctrl && "Ctrl", c.alt && "Alt", c.shift && "Shift", c.key].filter(Boolean).join("+");
}

/** The parts of a key event the shortcuts look at (a KeyboardEvent fits). */
export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Letters and digits follow the printed key (⌘Z stays on Z with a German keyboard); Option on a Mac changes the character, then the key position counts. */
function keyMatches(ev: KeyLike, key: string): boolean {
  const letter = /^Key([A-Z])$/.exec(key)?.[1] ?? /^Digit([0-9])$/.exec(key)?.[1];
  if (letter) {
    if (/^[a-z0-9]$/i.test(ev.key)) return ev.key.toUpperCase() === letter;
    return ev.code === key;
  }
  if (CODE_KEY.test(key)) return ev.code === key || ev.key === key;
  return ev.key === key;
}

export function matchesCombo(ev: KeyLike, combo: string, mac: boolean): boolean {
  const c = parseCombo(combo);
  if (mac) {
    if (ev.metaKey !== c.mod || ev.ctrlKey !== c.ctrl) return false;
  } else if (ev.metaKey || ev.ctrlKey !== (c.mod || c.ctrl)) return false;
  if (ev.altKey !== c.alt) return false;
  // A printed character ("/", "?") already includes Shift on the keyboards that need it.
  const printed = !CODE_KEY.test(c.key);
  if (!printed && ev.shiftKey !== c.shift) return false;
  if (printed && c.shift && !ev.shiftKey) return false;
  return keyMatches(ev, c.key);
}

/** The first action whose combo the event matches. */
export function findAction(ev: KeyLike, bindings: Record<string, string[]>, mac: boolean): string | null {
  for (const [id, combos] of Object.entries(bindings)) if (combos.some((c) => matchesCombo(ev, c, mac))) return id;
  return null;
}

/** Combo for a key press in the editor; null while only modifiers are held. */
export function comboFromEvent(ev: KeyLike, mac: boolean): string | null {
  if (MODIFIER_KEYS.has(ev.key)) return null;
  const mod = mac ? ev.metaKey : ev.ctrlKey;
  const ctrl = mac && ev.ctrlKey;
  let key: string;
  if (/^[a-z]$/i.test(ev.key)) key = `Key${ev.key.toUpperCase()}`;
  else if (/^[0-9]$/.test(ev.key) && /^(Digit|Numpad)/.test(ev.code)) key = `Digit${ev.key}`;
  else if (/^(Key[A-Z]|Digit[0-9])$/.test(ev.code)) key = ev.code;
  else if (CODE_KEY.test(ev.code) && (ev.key.length !== 1 || ev.altKey || ev.code === "Space")) key = ev.code;
  else if (ev.key.length === 1) key = ev.key;
  else return null;
  // A printed character stands for itself; Shift is part of typing it.
  const printed = !CODE_KEY.test(key);
  return comboString({ mod, ctrl, alt: ev.altKey, shift: printed ? false : ev.shiftKey, key });
}

const KEY_NAMES: Record<string, [mac: string, other: string]> = {
  ArrowLeft: ["←", "←"],
  ArrowRight: ["→", "→"],
  ArrowUp: ["↑", "↑"],
  ArrowDown: ["↓", "↓"],
  Escape: ["Esc", "Esc"],
  Delete: ["⌦", "Entf"],
  Backspace: ["⌫", "Rücktaste"],
  Enter: ["↩", "Enter"],
  Space: ["Leertaste", "Leertaste"],
  Tab: ["⇥", "Tab"],
  Home: ["↖", "Pos1"],
  End: ["↘", "Ende"],
  PageUp: ["⇞", "Bild ↑"],
  PageDown: ["⇟", "Bild ↓"],
  Minus: ["-", "-"],
  Equal: ["=", "="],
  Comma: [",", ","],
  Period: [".", "."],
  Slash: ["/", "/"],
  Semicolon: [";", ";"],
  Quote: ["'", "'"],
  Backquote: ["`", "`"],
  BracketLeft: ["[", "["],
  BracketRight: ["]", "]"],
  Backslash: ["\\", "\\"],
};

function keyName(key: string, mac: boolean): string {
  const m = /^(?:Key|Digit)(.)$/.exec(key);
  if (m) return m[1];
  const named = KEY_NAMES[key];
  if (named) return mac ? named[0] : named[1];
  return key.length === 1 ? key.toUpperCase() : key;
}

/** "⌃⌥⇧⌘A" on Apple devices (Apple's order), "Strg + Alt + Umschalt + A" elsewhere. */
export function formatCombo(combo: string, mac: boolean): string {
  const c = parseCombo(combo);
  const key = keyName(c.key, mac);
  if (mac) return `${c.ctrl ? "⌃" : ""}${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${c.mod ? "⌘" : ""}${key}`;
  return [(c.mod || c.ctrl) && "Strg", c.alt && "Alt", c.shift && "Umschalt", key].filter(Boolean).join(" + ");
}

// ---------------- Conflicts ----------------

/** Combos the browser or the system keeps for itself (the page never sees them or must not take them). */
const RESERVED: { combo: string; mac?: boolean; what: string }[] = [
  { combo: "Mod+KeyQ", mac: true, what: "beendet Safari" },
  { combo: "Mod+KeyW", what: "schließt den Tab" },
  { combo: "Mod+KeyT", what: "öffnet einen neuen Tab" },
  { combo: "Mod+Shift+KeyT", what: "öffnet den zuletzt geschlossenen Tab" },
  { combo: "Mod+KeyN", what: "öffnet ein neues Fenster" },
  { combo: "Mod+Shift+KeyN", what: "öffnet ein privates Fenster" },
  { combo: "Mod+KeyR", what: "lädt die Seite neu" },
  { combo: "Mod+KeyL", what: "springt in die Adresszeile" },
  { combo: "Mod+Tab", what: "wechselt die App bzw. den Tab" },
  { combo: "Mod+KeyH", mac: true, what: "blendet Safari aus" },
  { combo: "Mod+Alt+KeyH", mac: true, what: "blendet alle anderen Apps aus" },
  { combo: "Mod+KeyM", mac: true, what: "minimiert das Fenster" },
  { combo: "Mod+Comma", mac: true, what: "öffnet die Safari-Einstellungen" },
  { combo: "Mod+Space", mac: true, what: "öffnet Spotlight" },
  { combo: "Escape", what: "bricht in ChartAI immer ab (Zeichnen, Auswahl, Dialoge)" },
  { combo: "F5", mac: false, what: "lädt die Seite neu" },
  { combo: "Alt+F4", mac: false, what: "schließt das Fenster" },
];

/** Why the combo cannot be used on this device, or null. */
export function reservedReason(combo: string, mac: boolean): string | null {
  const c = comboString(parseCombo(combo));
  const hit = RESERVED.find((r) => (r.mac === undefined || r.mac === mac) && comboString(parseCombo(r.combo)) === c);
  return hit ? `${formatCombo(combo, mac)} ${hit.what}` : null;
}

/** Same keys on this device (Ctrl and Mod are one key off Apple devices). */
export function sameCombo(a: string, b: string, mac: boolean): boolean {
  const x = parseCombo(a);
  const y = parseCombo(b);
  const norm = (c: Combo) => (mac ? c : { ...c, mod: c.mod || c.ctrl, ctrl: false });
  return comboString(norm(x)) === comboString(norm(y));
}

/** The other action that already uses the combo. */
export function conflictFor(combo: string, bindings: Record<string, string[]>, mac: boolean, except?: string): string | null {
  for (const [id, combos] of Object.entries(bindings)) {
    if (id !== except && combos.some((c) => sameCombo(c, combo, mac))) return id;
  }
  return null;
}

/** Overrides after giving the combo to `id` (taking it away from whatever had it). Entries equal to the defaults are dropped. */
export function assignCombo(overrides: ShortcutOverrides, id: string, combo: string, mac: boolean): ShortcutOverrides {
  const bindings = resolveBindings(overrides, mac);
  const next: ShortcutOverrides = { ...overrides };
  for (const [other, combos] of Object.entries(bindings)) {
    if (other !== id && combos.some((c) => sameCombo(c, combo, mac))) next[other] = combos.filter((c) => !sameCombo(c, combo, mac));
  }
  const own = bindings[id] ?? [];
  if (!own.some((c) => sameCombo(c, combo, mac))) next[id] = [...own, combo];
  return normalizeOverrides(next, mac);
}

export function removeCombo(overrides: ShortcutOverrides, id: string, combo: string, mac: boolean): ShortcutOverrides {
  const own = resolveBindings(overrides, mac)[id] ?? [];
  return normalizeOverrides({ ...overrides, [id]: own.filter((c) => c !== combo) }, mac);
}

export function resetAction(overrides: ShortcutOverrides, id: string): ShortcutOverrides {
  const { [id]: _, ...rest } = overrides;
  return rest;
}

function normalizeOverrides(o: ShortcutOverrides, mac: boolean): ShortcutOverrides {
  const out: ShortcutOverrides = {};
  for (const [id, combos] of Object.entries(o)) {
    const action = getAction(id);
    if (!action) continue;
    const def = defaultCombos(action, mac);
    if (combos.length === def.length && combos.every((c, i) => c === def[i])) continue;
    out[id] = combos;
  }
  return out;
}

export function isModified(overrides: ShortcutOverrides, id: string): boolean {
  return id in overrides;
}

/** Reads stored overrides, dropping anything malformed or unknown. */
export function parseOverrides(raw: string | null): ShortcutOverrides {
  try {
    const v = JSON.parse(raw ?? "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: ShortcutOverrides = {};
    for (const [id, combos] of Object.entries(v)) {
      if (getAction(id) && Array.isArray(combos)) out[id] = combos.filter((c): c is string => typeof c === "string" && c.length > 0);
    }
    return out;
  } catch {
    return {};
  }
}
