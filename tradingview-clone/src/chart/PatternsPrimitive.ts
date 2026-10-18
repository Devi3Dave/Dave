import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { Formation } from "../../shared/patterns";
import { formatPrice, withAlpha } from "./DrawingsPrimitive";

const COLORS = { bullish: "#26a69a", bearish: "#ef5350", neutral: "#2962ff" };

/** Chart formations: pattern outline through the swing points, neckline/boundaries and price target. */
export class PatternsPrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private formations: Formation[] = [];
  private readonly view: IPrimitivePaneView;

  constructor(private readonly timeToX: (time: number) => number | null) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          ctx.save();
          ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
          ctx.textBaseline = "middle";
          for (const f of this.formations) this.drawOne(ctx, f);
          ctx.restore();
        }),
    };
    this.view = { renderer: () => renderer, zOrder: () => "top" };
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
    return [this.view];
  }

  setFormations(formations: Formation[]) {
    this.formations = formations;
    this.requestUpdate?.();
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
