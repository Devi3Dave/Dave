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
import type { Drawing, LineStyleName, Point } from "../store";

export const DEFAULT_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
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
  private bars: Bar[] = [];
  private preview: Drawing | null = null;
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

  private xy(p: Point) {
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
    }
    return g;
  }

  /** Returns the id of the drawing under (x, y) in media coordinates, if any. */
  findAt(x: number, y: number, width: number, height: number): string | null {
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      const g = this.geometry(d, width, height);
      if (g.segments.some((s) => distToSegment(x, y, s) < 6)) return d.id;
      if (g.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) return d.id;
      if (d.kind === "text" && g.anchors.some((a) => x >= a.x - 4 && x <= a.x + 8 * d.text.length && Math.abs(y - a.y) < 12)) return d.id;
    }
    return null;
  }

  // ---- rendering ----

  private draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const { width, height } = mediaSize;
      ctx.save();
      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
      ctx.textBaseline = "middle";
      for (const d of this.drawings) this.drawOne(ctx, d, width, height, false);
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
        ctx.lineWidth = d.kind === "trendline" ? d.width : 1.5;
        ctx.setLineDash(DASH["style" in d ? d.style : "solid"]);
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
    }
    if (!preview || d.kind === "text") return;
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
