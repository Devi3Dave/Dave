import type { Bar } from "../../shared/math";
import {
  FIB_ARC_LEVELS,
  FIB_CHANNEL_LEVELS,
  FIB_CIRCLE_LEVELS,
  FIB_FAN_LEVELS,
  GANN_BOX_LEVELS,
  GANN_FAN_ANGLES,
  anchoredVwapLine,
  dateRangeStats,
  fibTimeZones,
  gannAngleEnd,
  harmonicRatios,
  midpoint,
  patternLabels,
  pitchforkOrigin,
  regressionTrend,
  type ShapeKind,
} from "../../shared/drawingShapes";
import type { Drawing, LineStyleName, Point } from "../store";

export type ShapeDrawing = Extract<Drawing, { kind: "shape" }>;

interface XY {
  x: number;
  y: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ShapeGeometry {
  segments: Segment[];
  rects: { x: number; y: number; w: number; h: number }[];
  anchors: XY[];
}

/** What the renderer needs from the chart. */
export interface Coords {
  timeToX(time: number): number | null;
  priceToY(price: number): number | null;
  timeToLogical(time: number): number | null;
  bars: Bar[];
}

/** Colors of the levels when the drawing color is "auto" (TradingView's fib palette). */
const LEVEL_COLORS = ["#787b86", "#f23645", "#ff9800", "#4caf50", "#089981", "#00bcd4", "#2962ff", "#9c27b0", "#e91e63", "#f7c948", "#787b86"];
const DASH: Record<LineStyleName, number[]> = { solid: [], dashed: [6, 4], dotted: [2, 3] };

const levelColor = (d: ShapeDrawing, i: number) => (d.color === "auto" ? LEVEL_COLORS[i % LEVEL_COLORS.length] : d.color);
export const shapeBaseColor = (d: ShapeDrawing) => (d.color === "auto" ? "#2962ff" : d.color);

function xy(c: Coords, p: Point): XY | null {
  const x = c.timeToX(p.time);
  const y = c.priceToY(p.price);
  return x === null || y === null ? null : { x, y };
}

function allXY(c: Coords, points: Point[]): XY[] | null {
  const out: XY[] = [];
  for (const p of points) {
    const q = xy(c, p);
    if (!q) return null;
    out.push(q);
  }
  return out;
}

/** Segment from a through b, continued to well outside the pane. */
function ray(a: XY, b: XY, width: number, height: number): Segment {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const far = ((width + height) * 4) / Math.max(1e-6, Math.hypot(dx, dy));
  return { x1: a.x, y1: a.y, x2: a.x + dx * far, y2: a.y + dy * far };
}

/** Ellipse outline as a polygon, for hit testing. */
function ellipseSegments(cx: number, cy: number, rx: number, ry: number, from = 0, to = Math.PI * 2, steps = 48): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < steps; i++) {
    const a1 = from + ((to - from) * i) / steps;
    const a2 = from + ((to - from) * (i + 1)) / steps;
    out.push({ x1: cx + rx * Math.cos(a1), y1: cy + ry * Math.sin(a1), x2: cx + rx * Math.cos(a2), y2: cy + ry * Math.sin(a2) });
  }
  return out;
}

function polyline(points: XY[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < points.length; i++) out.push({ x1: points[i - 1].x, y1: points[i - 1].y, x2: points[i].x, y2: points[i].y });
  return out;
}

const TEXT_W = 7;

/** Box of a text label drawn at (x, y) (vertical middle). */
function textBox(text: string, x: number, y: number) {
  return { x: x - 6, y: y - 12, w: text.length * TEXT_W + 12, h: 24 };
}

export function shapeGeometry(d: ShapeDrawing, c: Coords, width: number, height: number): ShapeGeometry {
  const g: ShapeGeometry = { segments: [], rects: [], anchors: [] };
  const p = allXY(c, d.points);
  if (!p || p.length === 0) return g;
  g.anchors = p.slice();
  const [a, b] = p;
  switch (d.shape) {
    case "hray":
      g.segments.push({ x1: a.x, y1: a.y, x2: width, y2: a.y });
      break;
    case "crossline":
      g.segments.push({ x1: 0, y1: a.y, x2: width, y2: a.y }, { x1: a.x, y1: 0, x2: a.x, y2: height });
      break;
    case "trendangle":
    case "arrowline":
      if (b) g.segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      break;
    case "pitchfork":
    case "schiff":
    case "modschiff": {
      if (p.length < 3) {
        g.segments.push(...polyline(p));
        break;
      }
      const o = xy(c, pitchforkOrigin(d.shape, d.points));
      const m = xy(c, midpoint(d.points[1], d.points[2]));
      if (!o || !m) break;
      const dx = m.x - o.x;
      const dy = m.y - o.y;
      g.segments.push(ray(o, m, width, height));
      for (const q of [p[1], p[2]]) g.segments.push(ray(q, { x: q.x + dx, y: q.y + dy }, width, height));
      g.segments.push({ x1: p[1].x, y1: p[1].y, x2: p[2].x, y2: p[2].y });
      if (d.shape !== "pitchfork") g.segments.push({ x1: p[0].x, y1: p[0].y, x2: o.x, y2: o.y });
      break;
    }
    case "regression": {
      const r = b ? regressionTrend(c.bars, d.points[0].time, d.points[1].time) : null;
      if (!r) {
        if (b) g.segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        break;
      }
      for (const k of [0, 2, -2]) {
        const s = xy(c, { time: r.from.time, price: r.from.price + k * r.deviation });
        const e = xy(c, { time: r.to.time, price: r.to.price + k * r.deviation });
        if (s && e) g.segments.push({ x1: s.x, y1: s.y, x2: e.x, y2: e.y });
      }
      break;
    }
    case "fibchannel": {
      if (p.length < 3) {
        g.segments.push(...polyline(p));
        break;
      }
      const [pa, pb, pc] = d.points;
      const onLine = pb.time !== pa.time ? pa.price + ((pb.price - pa.price) * (pc.time - pa.time)) / (pb.time - pa.time) : pa.price;
      const offset = pc.price - onLine;
      for (const level of FIB_CHANNEL_LEVELS) {
        const s = xy(c, { time: pa.time, price: pa.price + offset * level });
        const e = xy(c, { time: pb.time, price: pb.price + offset * level });
        if (s && e) g.segments.push(ray(s, e, width, height));
      }
      break;
    }
    case "fibtimezone": {
      if (!b) break;
      for (const t of fibTimeZones(d.points[0], d.points[1])) {
        const x = c.timeToX(t);
        if (x !== null) g.segments.push({ x1: x, y1: 0, x2: x, y2: height });
      }
      break;
    }
    case "fibfan": {
      if (!b) break;
      const [pa, pb] = d.points;
      for (const level of FIB_FAN_LEVELS) {
        const onPrice = xy(c, { time: pb.time, price: pa.price + (pb.price - pa.price) * level });
        if (onPrice) g.segments.push(ray(a, onPrice, width, height));
        if (level === 1) continue;
        const onTime = xy(c, { time: pa.time + (pb.time - pa.time) * level, price: pb.price });
        if (onTime) g.segments.push(ray(a, onTime, width, height));
      }
      break;
    }
    case "fibcircles": {
      if (!b) break;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const r = Math.hypot(b.x - a.x, b.y - a.y) / 2;
      for (const level of FIB_CIRCLE_LEVELS) g.segments.push(...ellipseSegments(cx, cy, r * level, r * level));
      break;
    }
    case "fibarcs": {
      if (!b) break;
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      // Arcs open away from the start, like TradingView's speed resistance arcs.
      const up = a.y > b.y;
      for (const level of FIB_ARC_LEVELS) g.segments.push(...ellipseSegments(b.x, b.y, r * level, r * level, up ? 0 : Math.PI, up ? Math.PI : Math.PI * 2, 24));
      g.segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      break;
    }
    case "gannbox": {
      if (!b) break;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      g.rects.push({ x, y, w, h });
      for (const level of GANN_BOX_LEVELS) {
        g.segments.push({ x1: x + w * level, y1: y, x2: x + w * level, y2: y + h });
        g.segments.push({ x1: x, y1: y + h * level, x2: x + w, y2: y + h * level });
      }
      g.segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, { x1: a.x, y1: b.y, x2: b.x, y2: a.y });
      break;
    }
    case "gannfan": {
      if (!b) break;
      for (const angle of GANN_FAN_ANGLES) {
        const e = xy(c, gannAngleEnd(d.points[0], d.points[1], angle));
        if (e) g.segments.push(ray(a, e, width, height));
      }
      break;
    }
    case "xabcd":
    case "cypher":
    case "abcd":
    case "headshoulders":
    case "threedrives":
    case "elliott5":
    case "elliottabc":
    case "elliotttri":
    case "elliottwxy":
      g.segments.push(...polyline(p));
      if (d.shape === "headshoulders" && p.length >= 5) g.segments.push(ray(p[2], p[4], width, height));
      break;
    case "trianglepattern":
      g.segments.push(...polyline(p));
      if (p.length >= 3) g.segments.push({ x1: p[0].x, y1: p[0].y, x2: p[2].x, y2: p[2].y });
      if (p.length >= 4) g.segments.push({ x1: p[1].x, y1: p[1].y, x2: p[3].x, y2: p[3].y });
      break;
    case "pricerange":
    case "daterange":
      if (b) g.rects.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(Math.abs(b.x - a.x), 2), h: Math.max(Math.abs(b.y - a.y), 2) });
      break;
    case "avwap": {
      const line = anchoredVwapLine(c.bars, d.points[0].time)
        .map((q) => xy(c, q))
        .filter((q): q is XY => !!q);
      g.segments.push(...polyline(line));
      break;
    }
    case "circle":
      if (b) {
        const r = Math.hypot(b.x - a.x, b.y - a.y);
        g.segments.push(...ellipseSegments(a.x, a.y, r, r));
      }
      break;
    case "ellipse":
      if (b) g.segments.push(...ellipseSegments((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2));
      break;
    case "triangle":
      g.segments.push(...polyline([...p, p[0]]));
      break;
    case "callout": {
      const at = b ?? a;
      g.rects.push(textBox(d.text ?? "", at.x, at.y));
      if (b) g.segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      break;
    }
    case "note":
      g.rects.push({ x: a.x - 10, y: a.y - 24, w: 20, h: 24 });
      break;
    case "pricelabel":
      g.rects.push(textBox("00000000000", a.x + 6, a.y - 14));
      break;
    case "arrowup":
      g.rects.push({ x: a.x - 9, y: a.y, w: 18, h: 26 });
      break;
    case "arrowdown":
      g.rects.push({ x: a.x - 9, y: a.y - 26, w: 18, h: 26 });
      break;
    case "emoji":
      g.rects.push({ x: a.x - 14, y: a.y - 14, w: 28, h: 28 });
      break;
  }
  return g;
}

export interface DrawHelpers {
  line(ctx: CanvasRenderingContext2D, s: Segment): void;
  label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void;
  withAlpha(color: string, alpha: number): string;
  formatPrice(p: number): string;
  formatDuration(seconds: number): string;
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toLocaleString("de-DE", { maximumFractionDigits: 2 })} %`;
const ratio = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function drawShape(ctx: CanvasRenderingContext2D, d: ShapeDrawing, c: Coords, width: number, height: number, h: DrawHelpers) {
  const g = shapeGeometry(d, c, width, height);
  const p = g.anchors;
  if (!p.length) return;
  const base = shapeBaseColor(d);
  ctx.strokeStyle = base;
  ctx.fillStyle = base;
  ctx.lineWidth = d.width ?? 1.5;
  ctx.setLineDash(DASH[d.style ?? "solid"]);
  const stroke = (s: Segment[]) => s.forEach((x) => h.line(ctx, x));
  const fillPoly = (pts: XY[], alpha: number, color = base) => {
    if (pts.length < 3) return;
    ctx.fillStyle = h.withAlpha(color, alpha);
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fill();
  };
  const [a, b] = p;

  switch (d.shape) {
    case "hray":
      stroke(g.segments);
      h.label(ctx, `${d.label ? d.label + "  " : ""}${h.formatPrice(d.points[0].price)}`, a.x + 4, a.y - 10, base);
      break;
    case "crossline":
      stroke(g.segments);
      break;
    case "trendangle": {
      stroke(g.segments);
      if (!b) break;
      // Angle on screen (up is positive), as TradingView shows it.
      const deg = (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      h.line(ctx, { x1: a.x, y1: a.y, x2: a.x + 50, y2: a.y });
      ctx.beginPath();
      ctx.arc(a.x, a.y, 30, 0, -(deg * Math.PI) / 180, deg > 0);
      ctx.stroke();
      ctx.setLineDash([]);
      h.label(ctx, `${deg.toLocaleString("de-DE", { maximumFractionDigits: 1 })}°`, a.x + 34, a.y + (deg > 0 ? 10 : -10), base);
      break;
    }
    case "arrowline": {
      stroke(g.segments);
      if (!b) break;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - 12 * Math.cos(ang - 0.45), b.y - 12 * Math.sin(ang - 0.45));
      ctx.lineTo(b.x - 12 * Math.cos(ang + 0.45), b.y - 12 * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fillStyle = base;
      ctx.fill();
      break;
    }
    case "pitchfork":
    case "schiff":
    case "modschiff": {
      const [median, up, down] = g.segments;
      if (median && up && down) {
        // Fill between the outer lines, like TradingView.
        fillPoly([{ x: up.x1, y: up.y1 }, { x: up.x2, y: up.y2 }, { x: down.x2, y: down.y2 }, { x: down.x1, y: down.y1 }], 0.08);
      }
      stroke(g.segments);
      break;
    }
    case "regression": {
      const r = b ? regressionTrend(c.bars, d.points[0].time, d.points[1].time) : null;
      const [mid, upper, lower] = g.segments;
      if (upper && lower) fillPoly([{ x: upper.x1, y: upper.y1 }, { x: upper.x2, y: upper.y2 }, { x: lower.x2, y: lower.y2 }, { x: lower.x1, y: lower.y1 }], 0.1);
      if (mid) {
        ctx.setLineDash([6, 4]);
        h.line(ctx, mid);
        ctx.setLineDash([]);
      }
      if (upper) h.line(ctx, upper);
      if (lower) h.line(ctx, lower);
      if (r && lower) h.label(ctx, `r ${r.pearson.toLocaleString("de-DE", { maximumFractionDigits: 3 })} · ${r.count} Kerzen`, lower.x2 - 120, lower.y2 + 14, base);
      if (!r && mid) h.line(ctx, mid);
      break;
    }
    case "fibchannel": {
      const levels = g.segments;
      levels.forEach((s, i) => {
        const next = levels[i + 1];
        if (next) fillPoly([{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }, { x: next.x2, y: next.y2 }, { x: next.x1, y: next.y1 }], 0.05, levelColor(d, i));
        ctx.strokeStyle = levelColor(d, i);
        ctx.lineWidth = 1;
        h.line(ctx, s);
        if (p.length >= 3) {
          ctx.fillStyle = levelColor(d, i);
          ctx.fillText(String(FIB_CHANNEL_LEVELS[i]), s.x1 - 30, s.y1);
        }
      });
      break;
    }
    case "fibtimezone":
      g.segments.forEach((s, i) => {
        ctx.strokeStyle = levelColor(d, i);
        ctx.lineWidth = 1;
        h.line(ctx, s);
        ctx.fillStyle = levelColor(d, i);
        ctx.fillText(String([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89][i]), s.x1 + 3, height - 12);
      });
      break;
    case "fibfan": {
      ctx.lineWidth = 1;
      g.segments.forEach((s, i) => {
        ctx.strokeStyle = levelColor(d, i + 1);
        h.line(ctx, s);
      });
      if (b) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "#787b86";
        h.line(ctx, { x1: a.x, y1: b.y, x2: b.x, y2: b.y });
        h.line(ctx, { x1: b.x, y1: a.y, x2: b.x, y2: b.y });
        ctx.setLineDash([]);
        FIB_FAN_LEVELS.forEach((level, i) => {
          const y = c.priceToY(d.points[0].price + (d.points[1].price - d.points[0].price) * level);
          if (y === null) return;
          ctx.fillStyle = levelColor(d, i + 1);
          ctx.fillText(String(level), b.x + 4, y);
        });
      }
      break;
    }
    case "fibcircles":
    case "fibarcs": {
      if (!b) break;
      const levels = d.shape === "fibcircles" ? FIB_CIRCLE_LEVELS : FIB_ARC_LEVELS;
      const per = d.shape === "fibcircles" ? 48 : 24;
      ctx.lineWidth = 1;
      levels.forEach((level, i) => {
        ctx.strokeStyle = levelColor(d, i + 1);
        stroke(g.segments.slice(i * per, (i + 1) * per));
        const first = g.segments[i * per];
        if (first) {
          ctx.fillStyle = levelColor(d, i + 1);
          ctx.fillText(String(level), first.x1 + 3, first.y1 - 6);
        }
      });
      ctx.strokeStyle = "#787b86";
      ctx.setLineDash([4, 4]);
      h.line(ctx, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      ctx.setLineDash([]);
      break;
    }
    case "gannbox": {
      const r = g.rects[0];
      if (!r) break;
      ctx.fillStyle = h.withAlpha(base, 0.05);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.lineWidth = 1;
      const grid = g.segments.slice(0, GANN_BOX_LEVELS.length * 2);
      grid.forEach((s, i) => {
        ctx.strokeStyle = levelColor(d, Math.floor(i / 2) + 1);
        h.line(ctx, s);
      });
      GANN_BOX_LEVELS.forEach((level, i) => {
        ctx.fillStyle = levelColor(d, i + 1);
        ctx.fillText(String(level), r.x + r.w * level - 8, r.y - 8);
        ctx.fillText(String(level), r.x - 30, r.y + r.h * level);
      });
      ctx.strokeStyle = base;
      ctx.setLineDash([4, 4]);
      stroke(g.segments.slice(-2));
      ctx.setLineDash([]);
      break;
    }
    case "gannfan":
      ctx.lineWidth = 1;
      g.segments.forEach((s, i) => {
        const [t, pr] = GANN_FAN_ANGLES[i];
        ctx.strokeStyle = t === 1 && pr === 1 ? base : levelColor(d, i + 1);
        ctx.lineWidth = t === 1 && pr === 1 ? 1.5 : 1;
        h.line(ctx, s);
        // Label where the line leaves the visible area, at most 160 px from the start.
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        const k = Math.min(1, 160 / Math.max(len, 1));
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(`${t}×${pr}`, s.x1 + (s.x2 - s.x1) * k + 4, s.y1 + (s.y2 - s.y1) * k);
      });
      break;
    case "xabcd":
    case "cypher":
    case "abcd":
    case "headshoulders":
    case "trianglepattern":
    case "threedrives":
    case "elliott5":
    case "elliottabc":
    case "elliotttri":
    case "elliottwxy":
      drawPattern(ctx, d, g, h);
      break;
    case "pricerange":
    case "daterange": {
      const r = g.rects[0];
      if (!r || !b) break;
      const [pa, pb] = d.points;
      const up = d.shape === "pricerange" ? pb.price >= pa.price : pb.time >= pa.time;
      const col = up ? "#2962ff" : "#f23645";
      ctx.fillStyle = h.withAlpha(col, 0.12);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      let text: string;
      if (d.shape === "pricerange") {
        h.line(ctx, { x1: r.x, y1: a.y, x2: r.x + r.w, y2: a.y });
        h.line(ctx, { x1: r.x, y1: b.y, x2: r.x + r.w, y2: b.y });
        h.line(ctx, { x1: r.x + r.w / 2, y1: a.y, x2: r.x + r.w / 2, y2: b.y });
        const diff = pb.price - pa.price;
        text = `${diff >= 0 ? "+" : ""}${h.formatPrice(diff)} (${pct((diff / pa.price) * 100)})`;
      } else {
        h.line(ctx, { x1: a.x, y1: r.y, x2: a.x, y2: r.y + r.h });
        h.line(ctx, { x1: b.x, y1: r.y, x2: b.x, y2: r.y + r.h });
        h.line(ctx, { x1: a.x, y1: r.y + r.h / 2, x2: b.x, y2: r.y + r.h / 2 });
        const st = dateRangeStats(c.bars, pa.time, pb.time);
        const la = c.timeToLogical(pa.time) ?? 0;
        const lb = c.timeToLogical(pb.time) ?? 0;
        text = `${Math.round(Math.abs(lb - la))} Kerzen · ${h.formatDuration(st.seconds)} · Vol ${st.volume.toLocaleString("de-DE", { maximumFractionDigits: 0 })}`;
      }
      const w = ctx.measureText(text).width;
      const ly = r.y + r.h + 14;
      ctx.fillStyle = col;
      ctx.fillRect(r.x + r.w / 2 - w / 2 - 6, ly - 9, w + 12, 18);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, r.x + r.w / 2 - w / 2, ly);
      break;
    }
    case "avwap": {
      ctx.lineWidth = d.width ?? 2;
      ctx.beginPath();
      g.segments.forEach((s, i) => {
        if (i === 0) ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
      ctx.fill();
      const last = g.segments[g.segments.length - 1];
      if (last) h.label(ctx, d.label ?? "AVWAP", last.x2 + 6, last.y2, base);
      break;
    }
    case "circle":
    case "ellipse":
    case "triangle": {
      const outline = g.segments.map((s) => ({ x: s.x1, y: s.y1 }));
      fillPoly(outline, 0.15);
      stroke(g.segments);
      break;
    }
    case "callout": {
      const at = b ?? a;
      const text = d.text ?? "";
      const r = g.rects[0];
      ctx.setLineDash([]);
      ctx.fillStyle = h.withAlpha(base, 0.9);
      if (b) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(r.x + r.w / 2 - 6, r.y + r.h / 2);
        ctx.lineTo(r.x + r.w / 2 + 6, r.y + r.h / 2);
        ctx.closePath();
        ctx.fill();
      }
      roundRect(ctx, r.x, r.y, r.w, r.h, 6);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
      ctx.fillText(text, at.x, at.y);
      break;
    }
    case "note": {
      ctx.setLineDash([]);
      ctx.font = "18px sans-serif";
      ctx.fillText("📌", a.x - 9, a.y - 12);
      if (d.text) h.label(ctx, d.text, a.x + 12, a.y - 12, base);
      break;
    }
    case "pricelabel": {
      const text = h.formatPrice(d.points[0].price);
      ctx.setLineDash([]);
      ctx.fillStyle = base;
      const w = ctx.measureText(text).width;
      roundRect(ctx, a.x + 6, a.y - 26, w + 12, 20, 4);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + 10, a.y - 6);
      ctx.lineTo(a.x + 18, a.y - 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, a.x + 12, a.y - 16);
      break;
    }
    case "arrowup":
    case "arrowdown": {
      const dir = d.shape === "arrowup" ? 1 : -1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + 9, a.y + dir * 10);
      ctx.lineTo(a.x + 4, a.y + dir * 10);
      ctx.lineTo(a.x + 4, a.y + dir * 26);
      ctx.lineTo(a.x - 4, a.y + dir * 26);
      ctx.lineTo(a.x - 4, a.y + dir * 10);
      ctx.lineTo(a.x - 9, a.y + dir * 10);
      ctx.closePath();
      ctx.fill();
      if (d.text) h.label(ctx, d.text, a.x - (d.text.length * TEXT_W) / 2, a.y + dir * 36, base);
      break;
    }
    case "emoji":
      ctx.setLineDash([]);
      ctx.font = "24px sans-serif";
      ctx.globalAlpha = 1;
      ctx.fillText(d.text || "⭐", a.x - 12, a.y);
      break;
  }
  ctx.setLineDash([]);
}

function drawPattern(ctx: CanvasRenderingContext2D, d: ShapeDrawing, g: ShapeGeometry, h: DrawHelpers) {
  const p = g.anchors;
  const base = shapeBaseColor(d);
  const harmonic = d.shape === "xabcd" || d.shape === "cypher";
  if (harmonic) {
    // Two filled triangles X-A-B and B-C-D, like TradingView's harmonic tools.
    for (const tri of [p.slice(0, 3), p.slice(2, 5)]) {
      if (tri.length < 3) continue;
      ctx.fillStyle = h.withAlpha(base, 0.15);
      ctx.beginPath();
      tri.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.strokeStyle = base;
  ctx.lineWidth = d.width ?? 1.5;
  g.segments.forEach((s, i) => {
    // Extra lines (neckline, triangle borders) are dashed.
    ctx.setLineDash(i >= p.length - 1 ? [5, 4] : []);
    h.line(ctx, s);
  });
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  for (const r of harmonicRatios(d.shape as ShapeKind, d.points)) {
    const s = p[r.from];
    const e = p[r.to];
    if (!s || !e) continue;
    h.line(ctx, { x1: s.x, y1: s.y, x2: e.x, y2: e.y });
    h.label(ctx, ratio(r.value), (s.x + e.x) / 2 - 14, (s.y + e.y) / 2, base);
  }
  ctx.setLineDash([]);
  const labels = patternLabels(d.shape as ShapeKind);
  p.forEach((q, i) => {
    const text = labels[i];
    if (!text) return;
    // Highs get the label above, lows below.
    const prev = p[i - 1] ?? p[i + 1];
    const high = prev ? q.y <= prev.y : true;
    h.label(ctx, text, q.x - (text.length * TEXT_W) / 2, q.y + (high ? -14 : 14), base);
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Text near the drawing that says what it shows, for the object tree and Claude. */
export function describeShapeValues(d: ShapeDrawing, bars: Bar[]): string {
  if (d.shape === "regression" && d.points.length >= 2) {
    const r = regressionTrend(bars, d.points[0].time, d.points[1].time);
    return r ? `Pearson r ${r.pearson.toFixed(3)}, Abweichung ${r.deviation.toPrecision(5)}` : "";
  }
  if (d.shape === "avwap") {
    const line = anchoredVwapLine(bars, d.points[0].time);
    return line.length ? `AVWAP aktuell ${line[line.length - 1].price.toPrecision(7)}` : "";
  }
  const ratios = harmonicRatios(d.shape, d.points);
  return ratios.map((r) => r.value.toFixed(3)).join(" / ");
}
