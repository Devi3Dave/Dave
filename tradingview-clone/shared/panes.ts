/**
 * Which chart pane each indicator is drawn in, and TradingView's "Move to" actions
 * (pane above, pane below, new pane, main chart). Pane 0 is the price chart.
 */
import { SOURCE_INDICATORS, getIndicator } from "./indicators.js";

export interface PaneItem {
  id: string;
  /** Drawn on the price chart by default (moving averages, bands …). */
  overlay: boolean;
  /** Chosen pane; without it the default applies. */
  pane?: number;
  /** Computed on this earlier indicator's line: without a chosen pane it stays in that indicator's pane. */
  sourceId?: string;
}

export type PaneMove = "up" | "down" | "new" | "main";

/** Pane index per indicator, gaps closed: 0 = price chart, then 1, 2, … from top to bottom. */
export function resolvePanes(items: PaneItem[]): Map<string, number> {
  const raw = new Map<string, number>();
  let next = Math.max(0, ...items.map((it) => it.pane ?? 0)) + 1;
  for (const it of items) {
    let p: number;
    if (it.pane !== undefined) p = Math.max(0, it.pane);
    else if (it.sourceId !== undefined && raw.has(it.sourceId)) p = raw.get(it.sourceId)!;
    else if (it.overlay) p = 0;
    else p = next++;
    raw.set(it.id, p);
  }
  const order = [...new Set([0, ...raw.values()])].sort((a, b) => a - b);
  const out = new Map<string, number>();
  for (const [id, p] of raw) out.set(id, order.indexOf(p));
  return out;
}

/** The moves that change something for this indicator (for the menu). */
export function availableMoves(items: PaneItem[], id: string): PaneMove[] {
  const panes = resolvePanes(items);
  const p = panes.get(id);
  if (p === undefined) return [];
  // Lines computed on this indicator move along with it.
  const alone = items.every((it) => it.id === id || panes.get(it.id) !== p || (it.sourceId === id && it.pane === undefined));
  const last = Math.max(...panes.values());
  const moves: PaneMove[] = [];
  if (p > 1) moves.push("up");
  if (p < last || (p > 0 && !alone)) moves.push("down");
  if (p === 0 || !alone) moves.push("new");
  if (p !== 0) moves.push("main");
  return moves;
}

/**
 * New pane per indicator after a move, for every indicator whose pane must be stored.
 * Indicators on another indicator's line that were never moved keep following their source.
 */
export function movePane(items: PaneItem[], id: string, move: PaneMove): Map<string, number> {
  const panes = resolvePanes(items);
  const out = new Map<string, number>();
  for (const it of items) if (it.pane !== undefined || it.sourceId === undefined || it.id === id) out.set(it.id, panes.get(it.id)!);
  const p = panes.get(id);
  if (p === undefined || !availableMoves(items, id).includes(move)) return out;
  const last = Math.max(...panes.values());
  if (move === "main") out.set(id, 0);
  else if (move === "up") out.set(id, p - 1);
  else if (move === "down" && p < last) out.set(id, p + 1);
  else {
    // "new", or "down" from the bottom pane: a pane of its own right below the current one.
    for (const [k, v] of out) if (v > p) out.set(k, v + 1);
    out.set(id, p + 1);
  }
  return out;
}

/** Puts the indicator into the pane of another one (e.g. CVD to the RSI). */
export function joinPane(items: PaneItem[], id: string, targetId: string): Map<string, number> {
  const panes = resolvePanes(items);
  const out = new Map<string, number>();
  for (const it of items) if (it.pane !== undefined || it.sourceId === undefined || it.id === id) out.set(it.id, panes.get(it.id)!);
  const target = panes.get(targetId);
  if (target !== undefined && out.has(id)) out.set(id, target);
  return out;
}

/** Indicators that can change panes: ones with lines of their own (not profiles, patterns or sessions). */
export function canMovePane(type: string): boolean {
  const def = getIndicator(type);
  return !!def && def.outputs.length > 0 && !def.patterns && !def.profile && !def.heatmap;
}

/** Pane items for a chart's indicators, in list order; unknown indicator types are left out. */
export function indicatorPaneItems(instances: { id: string; type: string; pane?: number; source?: { id: string } }[]): PaneItem[] {
  const out: PaneItem[] = [];
  for (const inst of instances) {
    const def = getIndicator(inst.type);
    if (!def) continue;
    const movable = canMovePane(inst.type);
    out.push({
      id: inst.id,
      overlay: def.overlay || def.id === "volume",
      ...(movable && inst.pane !== undefined ? { pane: inst.pane } : {}),
      ...(inst.source && SOURCE_INDICATORS.has(def.id) ? { sourceId: inst.source.id } : {}),
    });
  }
  return out;
}
