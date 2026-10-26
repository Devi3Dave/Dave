import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { OrderBlock } from "../../shared/orderblocks";
import type { Formation } from "../../shared/patterns";
import type { SessionBox, TimeLine } from "../../shared/sessions";
import type { StructureBreak } from "../../shared/structure";
import { formatPrice, withAlpha } from "./DrawingsPrimitive";

const COLORS = { bullish: "#26a69a", bearish: "#ef5350", neutral: "#2962ff" };

/** Chart formations: pattern outline through the swing points, neckline/boundaries and price target. */
export class PatternsPrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private formations: Formation[] = [];
  private zones: OrderBlock[] = [];
  private structure: StructureBreak[] = [];
  private sessions: SessionBox[] = [];
  private timeLines: TimeLine[] = [];
  private readonly view: IPrimitivePaneView;
  private readonly zoneView: IPrimitivePaneView;

  constructor(private readonly timeToX: (time: number) => number | null) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.save();
          this.drawTimeLines(ctx, mediaSize.height);
          ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
          ctx.textBaseline = "middle";
          for (const f of this.formations) this.drawOne(ctx, f);
          for (const s of this.structure) this.drawBreak(ctx, s);
          ctx.restore();
        }),
    };
    this.view = { renderer: () => renderer, zOrder: () => "top" };
    const zoneRenderer: IPrimitivePaneRenderer = {
      draw: () => {},
      drawBackground: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.save();
          ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
          ctx.textBaseline = "middle";
          this.drawSessions(ctx);
          this.drawZones(ctx, mediaSize.width);
          ctx.restore();
        }),
    };
    // Order blocks sit behind the candles.
    this.zoneView = { renderer: () => zoneRenderer, zOrder: () => "bottom" };
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return [this.zoneView, this.view];
  }

  setFormations(formations: Formation[]) {
    this.formations = formations;
    this.requestUpdate?.();
  }

  setStructure(structure: StructureBreak[]) {
    this.structure = structure;
    this.requestUpdate?.();
  }

  setSessions(sessions: SessionBox[], timeLines: TimeLine[]) {
    this.sessions = sessions;
    this.timeLines = timeLines;
    this.requestUpdate?.();
  }

  /** Session ranges as grey boxes (open → close, session high → low) with the name on top. */
  private drawSessions(ctx: CanvasRenderingContext2D) {
    for (const s of this.sessions) {
      const a = this.xy(s.from, s.top);
      const b = this.xy(s.to, s.bottom);
      if (!a || !b) continue;
      ctx.fillStyle = "rgba(120,123,134,0.10)";
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeStyle = "rgba(120,123,134,0.45)";
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.fillStyle = "rgba(120,123,134,0.9)";
      ctx.fillText(s.label, a.x + 4, a.y - 7);
    }
  }

  /** Full-height dotted lines at fixed times (New York open). */
  private drawTimeLines(ctx: CanvasRenderingContext2D, height: number) {
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    for (const l of this.timeLines) {
      const x = this.timeToX(l.time);
      if (x === null) continue;
      ctx.strokeStyle = l.color;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  setZones(zones: OrderBlock[]) {
    this.zones = zones;
    this.requestUpdate?.();
  }

  /** Order blocks and fair value gaps as boxes from their candle to the right edge (or to where they broke). */
  private drawZones(ctx: CanvasRenderingContext2D, width: number) {
    // Higher time frames first so the finer zones stay visible on top.
    const sorted = [...this.zones].sort((a, b) => b.tfSeconds - a.tfSeconds);
    const maxTf = Math.max(1, ...sorted.map((z) => z.tfSeconds));
    for (const z of sorted) {
      const x1 = this.timeToX(z.from);
      const yTop = this.series?.priceToCoordinate(z.top) ?? null;
      const yBottom = this.series?.priceToCoordinate(z.bottom) ?? null;
      if (x1 === null || yTop === null || yBottom === null) continue;
      const x2 = z.end !== null ? (this.timeToX(z.end) ?? width) : width;
      if (x2 < 0 || x1 > width) continue;
      const broken = z.end !== null;
      const color = z.side === "bull" ? COLORS.bullish : COLORS.bearish;
      // Weight grows with the time frame: 0.10 (chart) … 0.22 (highest).
      const weight = 0.1 + 0.12 * (z.tfSeconds / maxTf);
      const h = Math.max(1, yBottom - yTop);
      ctx.fillStyle = withAlpha(broken ? "#787b86" : color, broken ? 0.06 : weight);
      ctx.fillRect(x1, yTop, x2 - x1, h);
      ctx.strokeStyle = withAlpha(broken ? "#787b86" : color, broken ? 0.3 : 0.4 + weight);
      ctx.lineWidth = z.tfSeconds === maxTf && sorted.length > 1 ? 1.5 : 1;
      ctx.setLineDash(broken ? [3, 3] : []);
      ctx.strokeRect(x1, yTop, x2 - x1, h);
      if (z.mid) {
        const yMid = yTop + h / 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, yMid);
        ctx.lineTo(x2, yMid);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const text = `${z.label ?? `OB ${z.tf}`}${broken ? " ✕" : ""}`;
      ctx.fillStyle = withAlpha(broken ? "#787b86" : color, 0.95);
      ctx.fillText(text, Math.max(x1, 0) + 4, yTop + Math.min(8, h / 2));
    }
  }

  /** BOS (solid) / CHoCH (dashed): level line from the swing to the breaking candle, label in the middle. */
  private drawBreak(ctx: CanvasRenderingContext2D, s: StructureBreak) {
    const a = this.xy(s.time, s.level);
    const b = this.xy(s.brokenTime, s.level);
    if (!a || !b) return;
    const color = s.side === "bull" ? COLORS.bullish : COLORS.bearish;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(s.kind === "choch" ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const text = s.kind === "choch" ? "CHoCH" : "BOS";
    ctx.fillStyle = color;
    ctx.fillText(text, (a.x + b.x) / 2 - ctx.measureText(text).width / 2, a.y + (s.side === "bull" ? -7 : 7));
  }

  private xy(time: number, price: number): { x: number; y: number } | null {
    const x = this.timeToX(time);
    const y = this.series?.priceToCoordinate(price) ?? null;
    return x === null || y === null ? null : { x, y };
  }

  private drawOne(ctx: CanvasRenderingContext2D, f: Formation) {
    const color = COLORS[f.direction];
    const dash = f.confirmed ? [] : [5, 4];
    const pts = f.points.map((p) => this.xy(p.time, p.price)).filter((p): p is { x: number; y: number } => !!p);
    if (pts.length < 2) return;

    ctx.strokeStyle = withAlpha(color, 0.85);
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dash);
    if (!f.lines) {
      // Outline H-L-H... with a light fill beneath.
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.fillStyle = withAlpha(color, 0.07);
      ctx.fill();
    }
    const segments = [...(f.neckline ? [f.neckline] : []), ...(f.lines ?? [])];
    ctx.setLineDash(f.confirmed ? [] : [3, 3]);
    for (const [a, b] of segments) {
      const pa = this.xy(a.time, a.price);
      const pb = this.xy(b.time, b.price);
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const p of pts) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Label above (bearish) or below (bullish) the extreme point.
    const ys = pts.map((p) => p.y);
    const bearish = f.direction === "bearish";
    const y = bearish ? Math.min(...ys) - 14 : Math.max(...ys) + 14;
    const x = (pts[0].x + pts[pts.length - 1].x) / 2;
    const text = `${f.name}${f.confirmed ? " ✓" : " (unbestätigt)"}${f.target !== undefined ? ` · Ziel ${formatPrice(f.target)}` : ""}`;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(19,23,34,0.85)";
    ctx.fillRect(x - w / 2 - 4, y - 8, w + 8, 16);
    ctx.fillStyle = color;
    ctx.fillText(text, x - w / 2, y);
  }
}
