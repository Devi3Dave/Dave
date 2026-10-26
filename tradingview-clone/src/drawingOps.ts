import type { Drawing, Point } from "./store";

/** Name of a drawing as shown in the context menu. */
export function drawingName(d: Drawing): string {
  switch (d.kind) {
    case "trendline":
      return d.extend === "right" ? "Strahl" : d.extend === "none" ? "Trendlinie" : "Verlängerte Linie";
    case "hline":
      return "Horizontale Linie";
    case "vline":
      return "Vertikale Linie";
    case "zone":
      return "Zone";
    case "fib":
      return "Fibonacci-Retracement";
    case "fibext":
      return "Fibonacci-Extension";
    case "text":
      return "Text";
    case "channel":
      return "Paralleler Kanal";
    case "measure":
      return "Messen";
    case "path":
      return "Pinsel";
    case "position":
      return d.side === "long" ? "Long-Position" : "Short-Position";
  }
}

/** Moves a whole drawing: times through `shiftTime`, prices by `dPrice`. Shape and angle stay the same. */
export function shiftDrawing(d: Drawing, shiftTime: (t: number) => number, dPrice: number): Drawing {
  const p = (q: Point): Point => ({ time: shiftTime(q.time), price: q.price + dPrice });
  switch (d.kind) {
    case "trendline":
    case "fib":
    case "measure":
    case "channel":
      return { ...d, a: p(d.a), b: p(d.b) };
    case "fibext":
      return { ...d, a: p(d.a), b: p(d.b), c: p(d.c) };
    case "text":
      return { ...d, at: p(d.at) };
    case "hline":
      return { ...d, price: d.price + dPrice };
    case "vline":
      return { ...d, time: shiftTime(d.time) };
    case "zone":
      return {
        ...d,
        top: d.top + dPrice,
        bottom: d.bottom + dPrice,
        from: d.from === undefined ? undefined : shiftTime(d.from),
        to: d.to === undefined ? undefined : shiftTime(d.to),
      };
    case "path":
      return { ...d, points: d.points.map(p) };
    case "position":
      return { ...d, entry: d.entry + dPrice, stop: d.stop + dPrice, target: d.target + dPrice, from: shiftTime(d.from), to: shiftTime(d.to) };
  }
}

/** Kinds whose anchor points (as drawn when selected) can be dragged one by one. */
export function hasMovableAnchors(d: Drawing): boolean {
  return d.kind === "trendline" || d.kind === "fib" || d.kind === "measure" || d.kind === "fibext" || d.kind === "channel";
}

/** Moves one anchor point (index as in the drawn anchors) to `pt`; null when the drawing has no such anchor. */
export function moveAnchor(d: Drawing, index: number, pt: Point): Drawing | null {
  switch (d.kind) {
    case "trendline":
    case "fib":
    case "measure":
      return index === 0 ? { ...d, a: pt } : index === 1 ? { ...d, b: pt } : null;
    case "fibext":
      return index === 0 ? { ...d, a: pt } : index === 1 ? { ...d, b: pt } : index === 2 ? { ...d, c: pt } : null;
    case "channel":
      // The third anchor sits on the parallel line at the start time: it sets the width.
      return index === 0 ? { ...d, a: pt } : index === 1 ? { ...d, b: pt } : index === 2 ? { ...d, offset: pt.price - d.a.price } : null;
    default:
      return null;
  }
}

/** Copy of a drawing under a new id, drawn by the user, unlocked and visible. */
export function cloneDrawing(d: Drawing, id: string): Drawing {
  const copy = JSON.parse(JSON.stringify(d)) as Drawing;
  delete copy.locked;
  delete copy.hidden;
  return { ...copy, id, author: "user" };
}

export type Arrange = "front" | "forward" | "backward" | "back";

/** Moves a drawing in the paint order: later drawings are drawn on top. */
export function arrangeDrawing(list: Drawing[], id: string, where: Arrange): Drawing[] {
  const i = list.findIndex((d) => d.id === id);
  if (i < 0) return list;
  const rest = list.filter((_, k) => k !== i);
  const to = where === "front" ? rest.length : where === "back" ? 0 : where === "forward" ? Math.min(rest.length, i + 1) : Math.max(0, i - 1);
  rest.splice(to, 0, list[i]);
  return rest;
}
