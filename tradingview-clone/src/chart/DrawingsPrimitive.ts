import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { Bar } from "../../shared/math";
import { positionStats } from "../../shared/position";
import type { Drawing, LineStyleName, Point } from "../store";
import { drawShape, shapeGeometry } from "./ShapeRenderer";

export const DEFAULT_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
// TradingView "Trend-Based Fib Extension" levels up to 3.618 (golden-ratio multiples 1.618 / 2.618 / 3.618).
export const DEFAULT_FIBEXT_LEVELS = [0, 0.618, 1, 1.272, 1.618, 2, 2.618, 3.618];
const FIBEXT_COLORS = ["#787b86", "#00bcd4", "#2962ff", "#4caf50", "#ff9800", "#f23645", "#9c27b0", "#e91e63"];
const FIB_COLORS = ["#787b86", "#f23645", "#ff9800", "#4caf50", "#089981", "#00bcd4", "#787b86", "#2962ff"];

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Geometry {
  segments: Segment[];
  rects: { x: number; y: number; w: number; h: number }[];
  anchors: { x: number; y: number }[];
}

export interface DrawingPreview {
  drawing: Drawing;
}

const DASH: Record<LineStyleName, number[]> = { solid: [], dashed: [6, 4], dotted: [2, 3] };

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private drawings: Drawing[] = [];
  bars: Bar[] = [];
  private preview: Drawing | null = null;
  private selected: string | null = null;
  /** Drawn in place of the stored drawing with the same id (while it is dragged), or on top if new. */
  private override: Drawing | null = null;
  private readonly view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => this.draw(target),
    };
    this.view = { renderer: () => renderer, zOrder: () => "top" };
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return [this.view];
  }

  setData(drawings: Drawing[], bars: Bar[]) {
    this.drawings = drawings;
    this.bars = bars;
    this.requestUpdate?.();
  }

  setPreview(preview: Drawing | null) {
    this.preview = preview;
    this.requestUpdate?.();
  }

  setSelected(id: string | null) {
    if (id === this.selected) return;
    this.selected = id;
    this.requestUpdate?.();
  }

  setOverride(d: Drawing | null) {
    this.override = d;
    this.requestUpdate?.();
  }

  // ---- coordinate helpers ----

  /** Logical (bar index) position of a timestamp; interpolates and extrapolates. */
  timeToLogical(time: number): number | null {
    const bars = this.bars;
    if (bars.length === 0) return null;
    if (bars.length === 1) return 0;
    const last = bars.length - 1;
    if (time <= bars[0].time) return (time - bars[0].time) / (bars[1].time - bars[0].time);
    if (time >= bars[last].time) return last + (time - bars[last].time) / (bars[last].time - bars[last - 1].time);
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].time <= time) lo = mid;
      else hi = mid;
    }
    return lo + (time - bars[lo].time) / (bars[hi].time - bars[lo].time);
  }

  timeToX(time: number): number | null {
    const logical = this.timeToLogical(time);
    if (logical === null || !this.chart) return null;
    return this.chart.timeScale().logicalToCoordinate(logical as Logical);
  }

  priceToY(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  private xy(p: Point): { x: number; y: number } | null {
    const x = this.timeToX(p.time);
    const y = this.priceToY(p.price);
    return x === null || y === null ? null : { x, y };
  }

  private geometry(d: Drawing, width: number, height: number): Geometry {
    const g: Geometry = { segments: [], rects: [], anchors: [] };
    switch (d.kind) {
      case "trendline": {
        const a = this.xy(d.a);
        const b = this.xy(d.b);
        if (!a || !b) break;
        let { x: x1, y: y1 } = a;
        let { x: x2, y: y2 } = b;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const far = (width + height) * 4 / Math.max(1e-6, Math.hypot(dx, dy));
        if (d.extend === "right" || d.extend === "both") {
          x2 = x1 + dx * far;
          y2 = y1 + dy * far;
        }
        if (d.extend === "left" || d.extend === "both") {
          x1 = b.x - dx * far;
          y1 = b.y - dy * far;
        }
        g.segments.push({ x1, y1, x2, y2 });
        g.anchors.push(a, b);
        break;
      }
      case "hline": {
        const y = this.priceToY(d.price);
        if (y !== null) g.segments.push({ x1: 0, y1: y, x2: width, y2: y });
        break;
      }
      case "vline": {
        const x = this.timeToX(d.time);
        if (x !== null) g.segments.push({ x1: x, y1: 0, x2: x, y2: height });
        break;
      }
      case "zone": {
        const yTop = this.priceToY(Math.max(d.top, d.bottom));
        const yBottom = this.priceToY(Math.min(d.top, d.bottom));
        if (yTop === null || yBottom === null) break;
        const x1 = d.from !== undefined ? (this.timeToX(d.from) ?? 0) : 0;
        const x2 = d.extendRight || d.to === undefined ? width : (this.timeToX(d.to) ?? width);
        g.rects.push({ x: Math.min(x1, x2), y: yTop, w: Math.abs(x2 - x1), h: yBottom - yTop });
        break;
      }
      case "fib": {
        const a = this.xy(d.a);
        const b = this.xy(d.b);
        if (!a || !b) break;
        const x1 = Math.min(a.x, b.x);
        for (const level of d.levels) {
          const y = this.priceToY(d.b.price + (d.a.price - d.b.price) * level);
          if (y !== null) g.segments.push({ x1, y1: y, x2: width, y2: y });
        }
        g.segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        g.anchors.push(a, b);
        break;
      }
      case "text": {
        const p = this.xy(d.at);
        if (p) g.anchors.push(p);
        break;
      }
      case "fibext": {
        const a = this.xy(d.a);
        const b = this.xy(d.b);
        const c = this.xy(d.c);
        if (!a || !b || !c) break;
        for (const level of d.levels) {
          const y = this.priceToY(d.c.price + (d.b.price - d.a.price) * level);
          if (y !== null) g.segments.push({ x1: c.x, y1: y, x2: width, y2: y });
        }
        g.segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, { x1: b.x, y1: b.y, x2: c.x, y2: c.y });
        g.anchors.push(a, b, c);
        break;
      }
      case "channel": {
        const a = this.xy(d.a);
        const b = this.xy(d.b);
        const a2 = this.xy({ time: d.a.time, price: d.a.price + d.offset });
        const b2 = this.xy({ time: d.b.time, price: d.b.price + d.offset });
        if (!a || !b || !a2 || !b2) break;
        g.segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, { x1: a2.x, y1: a2.y, x2: b2.x, y2: b2.y });
        g.anchors.push(a, b, a2);
        break;
      }
      case "measure": {
        const a = this.xy(d.a);
        const b = this.xy(d.b);
        if (!a || !b) break;
        g.rects.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
        g.anchors.push(a, b);
        break;
      }
      case "path": {
        const pts = d.points.map((p) => this.xy(p)).filter((p): p is { x: number; y: number } => !!p);
        for (let i = 1; i < pts.length; i++) g.segments.push({ x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y });
        break;
      }
      case "shape":
        return shapeGeometry(d, this, width, height);
      case "position": {
        const x1 = this.timeToX(d.from);
        const x2 = this.timeToX(d.to);
        const yEntry = this.priceToY(d.entry);
        const yStop = this.priceToY(d.stop);
        const yTarget = this.priceToY(d.target);
        if (x1 === null || x2 === null || yEntry === null || yStop === null || yTarget === null) break;
        const x = Math.min(x1, x2);
        const w = Math.max(Math.abs(x2 - x1), 2);
        // rects[0] = reward, rects[1] = risk
        g.rects.push({ x, y: Math.min(yEntry, yTarget), w, h: Math.abs(yTarget - yEntry) });
        g.rects.push({ x, y: Math.min(yEntry, yStop), w, h: Math.abs(yStop - yEntry) });
        g.anchors.push({ x, y: yEntry });
        break;
      }
    }
    return g;
  }

  /** Returns the id of the visible drawing under (x, y) in media coordinates, if any. `tolerance`: wider for fingers. */
  findAt(x: number, y: number, width: number, height: number, tolerance = 6): string | null {
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (d.hidden) continue;
      const g = this.geometry(d, width, height);
      if (g.segments.some((s) => distToSegment(x, y, s) < tolerance)) return d.id;
      if (g.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) return d.id;
      if (d.kind === "text" && g.anchors.some((a) => x >= a.x - 4 && x <= a.x + 8 * d.text.length && Math.abs(y - a.y) < 12)) return d.id;
    }
    return null;
  }

  /** Index of the anchor of drawing `id` under (x, y), as listed in its geometry. */
  anchorAt(id: string, x: number, y: number, width: number, height: number, tolerance: number): number | null {
    const d = this.drawings.find((x) => x.id === id);
    if (!d) return null;
    const i = this.geometry(d, width, height).anchors.findIndex((a) => Math.hypot(a.x - x, a.y - y) <= tolerance);
    return i < 0 ? null : i;
  }

  // ---- rendering ----

  private draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const { width, height } = mediaSize;
      ctx.save();
      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
      ctx.textBaseline = "middle";
      const o = this.override;
      for (const d of this.drawings) {
        if (d.hidden) continue;
        const shown = o && o.id === d.id ? o : d;
        this.drawOne(ctx, shown, width, height, false);
        if (d.id === this.selected) this.drawHandles(ctx, shown, width, height);
      }
      if (o && !this.drawings.some((d) => d.id === o.id)) {
        this.drawOne(ctx, o, width, height, true);
        this.drawHandles(ctx, o, width, height);
      }
      if (this.preview) this.drawOne(ctx, this.preview, width, height, true);
      ctx.restore();
    });
  }

  private drawOne(ctx: CanvasRenderingContext2D, d: Drawing, width: number, height: number, preview: boolean) {
    const g = this.geometry(d, width, height);
    ctx.globalAlpha = preview ? 0.7 : 1;
    ctx.strokeStyle = d.color;
    ctx.fillStyle = d.color;

    switch (d.kind) {
      case "trendline":
      case "hline":
      case "vline": {
        ctx.lineWidth = d.width ?? 1.5;
        ctx.setLineDash(DASH[d.style ?? "solid"]);
        for (const s of g.segments) line(ctx, s);
        ctx.setLineDash([]);
        if (d.kind === "hline" && g.segments[0]) {
          const y = g.segments[0].y1;
          const text = `${d.label ? d.label + "  " : ""}${formatPrice(d.price)}`;
          label(ctx, text, width - ctx.measureText(text).width - 12, y - 9, d.color);
        } else if (d.kind === "vline" && g.segments[0] && d.label) {
          label(ctx, d.label, g.segments[0].x1 + 4, 12, d.color);
        } else if (d.kind === "trendline" && d.label && g.anchors[1]) {
          label(ctx, d.label, g.anchors[1].x + 6, g.anchors[1].y - 10, d.color);
        }
        break;
      }
      case "zone": {
        for (const r of g.rects) {
          ctx.globalAlpha = preview ? 0.5 : 1;
          ctx.fillStyle = withAlpha(d.color, 0.18);
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.strokeStyle = withAlpha(d.color, 0.8);
          ctx.lineWidth = 1;
          ctx.strokeRect(r.x, r.y, r.w, r.h);
          if (d.label) label(ctx, d.label, r.x + 6, r.y + 10, withAlpha(d.color, 1));
        }
        break;
      }
      case "fib": {
        const levelSegments = g.segments.slice(0, -1);
        const visible = d.levels.map((level, i) => ({ level, s: levelSegments[i] })).filter((l) => l.s);
        for (let i = 0; i < visible.length; i++) {
          const { level, s } = visible[i];
          const c = d.color !== "auto" ? d.color : FIB_COLORS[DEFAULT_FIB_LEVELS.indexOf(level)] ?? "#787b86";
          const next = visible[i + 1];
          if (next) {
            ctx.fillStyle = withAlpha(c, 0.06);
            ctx.fillRect(s.x1, Math.min(s.y1, next.s.y1), s.x2 - s.x1, Math.abs(next.s.y1 - s.y1));
          }
          ctx.strokeStyle = c;
          ctx.lineWidth = 1;
          line(ctx, s);
          const price = d.b.price + (d.a.price - d.b.price) * level;
          ctx.fillStyle = c;
          ctx.fillText(`${level} (${formatPrice(price)})`, s.x1 + 4, s.y1 - 7);
        }
        const diag = g.segments[g.segments.length - 1];
        if (diag) {
          ctx.strokeStyle = "#787b86";
          ctx.setLineDash([4, 4]);
          line(ctx, diag);
          ctx.setLineDash([]);
        }
        break;
      }
      case "text": {
        const p = g.anchors[0];
        if (p) {
          ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
          label(ctx, d.text, p.x, p.y, d.color);
        }
        break;
      }
      case "fibext": {
        const levels = g.segments.slice(0, -2);
        d.levels.forEach((level, i) => {
          const sg = levels[i];
          if (!sg) return;
          const c = d.color !== "auto" ? d.color : FIBEXT_COLORS[DEFAULT_FIBEXT_LEVELS.indexOf(level)] ?? "#787b86";
          ctx.strokeStyle = c;
          ctx.lineWidth = 1;
          line(ctx, sg);
          ctx.fillStyle = c;
          ctx.fillText(`${level} (${formatPrice(d.c.price + (d.b.price - d.a.price) * level)})`, sg.x1 + 4, sg.y1 - 7);
        });
        ctx.strokeStyle = "#787b86";
        ctx.setLineDash([4, 4]);
        for (const sg of g.segments.slice(-2)) line(ctx, sg);
        ctx.setLineDash([]);
        break;
      }
      case "channel": {
        const [s1, s2] = g.segments;
        if (!s1 || !s2) break;
        ctx.fillStyle = withAlpha(d.color, 0.1);
        ctx.beginPath();
        ctx.moveTo(s1.x1, s1.y1);
        ctx.lineTo(s1.x2, s1.y2);
        ctx.lineTo(s2.x2, s2.y2);
        ctx.lineTo(s2.x1, s2.y1);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 1.5;
        line(ctx, s1);
        line(ctx, s2);
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        line(ctx, { x1: (s1.x1 + s2.x1) / 2, y1: (s1.y1 + s2.y1) / 2, x2: (s1.x2 + s2.x2) / 2, y2: (s1.y2 + s2.y2) / 2 });
        ctx.setLineDash([]);
        if (d.label) label(ctx, d.label, s1.x2 + 6, s1.y2, d.color);
        break;
      }
      case "measure": {
        const r = g.rects[0];
        if (!r) break;
        const up = d.b.price >= d.a.price;
        const c = up ? "#2962ff" : "#f23645";
        ctx.fillStyle = withAlpha(c, 0.15);
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = c;
        ctx.lineWidth = 1;
        const [a, b] = g.anchors;
        // Arrows along both axes, like TradingView's ruler.
        line(ctx, { x1: a.x, y1: (a.y + b.y) / 2, x2: b.x, y2: (a.y + b.y) / 2 });
        line(ctx, { x1: (a.x + b.x) / 2, y1: a.y, x2: (a.x + b.x) / 2, y2: b.y });
        const diff = d.b.price - d.a.price;
        const la = this.timeToLogical(d.a.time) ?? 0;
        const lb = this.timeToLogical(d.b.time) ?? 0;
        const text = `${diff >= 0 ? "+" : ""}${formatPrice(diff)} (${diff >= 0 ? "+" : ""}${((diff / d.a.price) * 100).toLocaleString("de-DE", { maximumFractionDigits: 2 })} %) · ${Math.round(Math.abs(lb - la))} Kerzen · ${formatDuration(Math.abs(d.b.time - d.a.time))}`;
        const w = ctx.measureText(text).width;
        const ly = up ? r.y - 12 : r.y + r.h + 12;
        ctx.fillStyle = c;
        ctx.fillRect(r.x + r.w / 2 - w / 2 - 6, ly - 9, w + 12, 18);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, r.x + r.w / 2 - w / 2, ly);
        break;
      }
      case "path": {
        ctx.lineWidth = d.width;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        g.segments.forEach((sg, i) => {
          if (i === 0) ctx.moveTo(sg.x1, sg.y1);
          ctx.lineTo(sg.x2, sg.y2);
        });
        ctx.stroke();
        break;
      }
      case "position":
        this.drawPosition(ctx, d, g, preview);
        break;
      case "shape":
        drawShape(ctx, d, this, width, height, { line, label, withAlpha, formatPrice, formatDuration });
        ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
        break;
    }
    if (!preview || d.kind === "text" || d.kind === "position") return;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 1.5;
    for (const a of g.anchors) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** Selection marks: the anchors (or the middle of a line / corners of a box), grey when locked. */
  private drawHandles(ctx: CanvasRenderingContext2D, d: Drawing, width: number, height: number) {
    const g = this.geometry(d, width, height);
    let pts = d.kind === "position" ? [] : g.anchors;
    if (!pts.length && g.rects[0]) {
      const r = g.rects.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }));
      pts = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }];
    }
    if (!pts.length && g.segments[0]) {
      const s = g.segments[0];
      const x = d.kind === "hline" ? Math.min(width / 2, s.x2 - 40) : (s.x1 + s.x2) / 2;
      pts = [{ x, y: d.kind === "vline" ? height / 2 : (s.y1 + s.y2) / 2 }];
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.fillStyle = "#131722";
    ctx.strokeStyle = d.locked ? "#787b86" : "#2962ff";
    for (const a of pts) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (d.locked && pts[0]) label(ctx, "🔒", pts[0].x + 8, pts[0].y - 12, "#d1d4dc");
  }

  private drawPosition(ctx: CanvasRenderingContext2D, d: Extract<Drawing, { kind: "position" }>, g: Geometry, preview: boolean) {
    const [reward, risk] = g.rects;
    if (!reward || !risk) return;
    const st = positionStats(d, this.bars);
    const done = st.status === "target" || st.status === "stop";
    ctx.globalAlpha = preview ? 0.6 : 1;
    ctx.fillStyle = withAlpha(UP, done && st.status !== "target" ? 0.1 : 0.22);
    ctx.fillRect(reward.x, reward.y, reward.w, reward.h);
    ctx.fillStyle = withAlpha(DOWN, done && st.status !== "stop" ? 0.1 : 0.22);
    ctx.fillRect(risk.x, risk.y, risk.w, risk.h);

    const yEntry = g.anchors[0].y;
    const right = reward.x + reward.w;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#b2b5be";
    line(ctx, { x1: reward.x, y1: yEntry, x2: right, y2: yEntry });
    ctx.strokeStyle = UP;
    const yTarget = d.side === "long" ? reward.y : reward.y + reward.h;
    line(ctx, { x1: reward.x, y1: yTarget, x2: right, y2: yTarget });
    ctx.strokeStyle = DOWN;
    const yStop = d.side === "long" ? risk.y + risk.h : risk.y;
    line(ctx, { x1: risk.x, y1: yStop, x2: right, y2: yStop });

    // Path of the trade from entry to the exit (or the latest price).
    if (st.exitPrice !== null) {
      const xEnd = st.exitTime !== null ? this.timeToX(st.exitTime) : this.timeToX(Math.min(d.to, this.bars[this.bars.length - 1]?.time ?? d.to));
      const yEnd = this.priceToY(st.exitPrice);
      if (xEnd !== null && yEnd !== null) {
        ctx.strokeStyle = st.pnl >= 0 ? UP : DOWN;
        ctx.setLineDash([4, 3]);
        line(ctx, { x1: reward.x, y1: yEntry, x2: xEnd, y2: yEnd });
        ctx.setLineDash([]);
      }
    }

    if (st.liqPrice !== null) {
      const yLiq = this.priceToY(st.liqPrice);
      if (yLiq !== null) {
        ctx.strokeStyle = "#ff9800";
        ctx.setLineDash([2, 3]);
        line(ctx, { x1: reward.x, y1: yLiq, x2: right, y2: yLiq });
        ctx.setLineDash([]);
        label(ctx, `Liq. ${d.leverage}× ${formatPrice(st.liqPrice)}`, reward.x + 4, yLiq + (d.side === "long" ? 9 : -9), "#ff9800");
      }
    }

    const cx = reward.x + 4;
    const above = (y: number) => y - 10;
    const below = (y: number) => y + 10;
    const targetText = `Ziel ${formatPrice(d.target)} · +${fmtPct(st.rewardPct)} · +${fmtMoney(st.rewardAmount)}`;
    const stopText = `Stop ${formatPrice(d.stop)} · −${fmtPct(st.riskPct)} · −${fmtMoney(st.riskAmount)}`;
    label(ctx, targetText, cx, d.side === "long" ? above(yTarget) : below(yTarget), UP);
    label(ctx, stopText, cx, d.side === "long" ? below(yStop) : above(yStop), DOWN);
    if (!st.valid) {
      label(ctx, "Ungültig: Stop/Ziel auf falscher Seite", cx, yEntry, DOWN);
      return;
    }
    const state =
      st.status === "target" ? `Ziel erreicht +${fmtMoney(st.pnl)}` : st.status === "stop" ? `Stop −${fmtMoney(Math.abs(st.pnl))}` : `${st.status === "expired" ? "Ende" : "Offen"} ${st.pnl >= 0 ? "+" : "−"}${fmtMoney(Math.abs(st.pnl))}`;
    const head = `${d.side === "long" ? "Long" : "Short"} ${formatPrice(d.entry)} · CRV ${st.rr.toLocaleString("de-DE", { maximumFractionDigits: 2 })} · Menge ${st.qty.toLocaleString("de-DE", { maximumSignificantDigits: 5 })} · ${state}`;
    label(ctx, d.label ? `${d.label} · ${head}` : head, cx, yEntry, st.status === "stop" ? DOWN : st.status === "target" ? UP : "#d1d4dc");
  }
}

const UP = "#089981";
const DOWN = "#f23645";

function fmtPct(v: number) {
  return `${v.toLocaleString("de-DE", { maximumFractionDigits: 2 })} %`;
}

function fmtMoney(v: number) {
  return v.toLocaleString("de-DE", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/** 90 s → "1 min 30 s", 93600 → "1 T 2 h". */
export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return h ? `${d} T ${h} h` : `${d} T`;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  return m ? `${m} min` : `${seconds} s`;
}

function line(ctx: CanvasRenderingContext2D, s: Segment) {
  ctx.beginPath();
  ctx.moveTo(s.x1, s.y1);
  ctx.lineTo(s.x2, s.y2);
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  const w = ctx.measureText(text).width;
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(19,23,34,0.85)";
  ctx.fillRect(x - 3, y - 8, w + 6, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function distToSegment(px: number, py: number, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

export function withAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  const rgba = color.match(/^rgba?\(([^,]+),([^,]+),([^,)]+)/);
  if (rgba) return `rgba(${rgba[1]},${rgba[2]},${rgba[3]},${alpha})`;
  return color;
}

export function formatPrice(p: number): string {
  const abs = Math.abs(p);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return p.toLocaleString("de-DE", { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits });
}
