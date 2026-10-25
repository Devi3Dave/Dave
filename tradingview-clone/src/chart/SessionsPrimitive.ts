import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import { withAlpha } from "./DrawingsPrimitive";

export interface SessionBand {
  start: number;
  end: number;
  color: string;
  /** Shown at the top of the band (only on the first part of a day). */
  label?: string;
  /** Row for the label (from the bottom), so overlapping exchanges do not cover each other. */
  row: number;
  /** Open/close edges get a line; lunch-break edges do not. */
  openEdge: boolean;
  closeEdge: boolean;
}

/** Exchange trading sessions as shaded columns behind the candles. */
export class SessionsPrimitive implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null;
  private bands: SessionBand[] = [];
  private readonly view: IPrimitivePaneView;

  constructor(private readonly timeToX: (time: number) => number | null) {
    const renderer: IPrimitivePaneRenderer = {
      draw: () => {},
      drawBackground: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.save();
          ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
          ctx.textBaseline = "middle";
          this.drawBands(ctx, mediaSize.width, mediaSize.height);
          ctx.restore();
        }),
    };
    this.view = { renderer: () => renderer, zOrder: () => "bottom" };
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.requestUpdate = null;
  }

  paneViews() {
    return [this.view];
  }

  setBands(bands: SessionBand[]) {
    this.bands = bands;
    this.requestUpdate?.();
  }

  private drawBands(ctx: CanvasRenderingContext2D, width: number, height: number) {
    for (const b of this.bands) {
      const x1 = this.timeToX(b.start);
      const x2 = this.timeToX(b.end);
      if (x1 === null || x2 === null || x2 < 0 || x1 > width || x2 - x1 < 0.5) continue;
      ctx.fillStyle = withAlpha(b.color, 0.08);
      ctx.fillRect(x1, 0, x2 - x1, height);
      ctx.strokeStyle = withAlpha(b.color, 0.55);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      if (b.openEdge) {
        ctx.moveTo(Math.round(x1) + 0.5, 0);
        ctx.lineTo(Math.round(x1) + 0.5, height);
      }
      if (b.closeEdge) {
        ctx.moveTo(Math.round(x2) + 0.5, 0);
        ctx.lineTo(Math.round(x2) + 0.5, height);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (b.label) {
        const y = height - 10 - b.row * 16;
        const text = b.label;
        const w = ctx.measureText(text).width + 8;
        if (x2 - x1 < w + 4) continue;
        // Sticks to the left edge while the session start is scrolled out of view.
        const lx = Math.min(Math.max(x1 + 2, 2), x2 - w - 2);
        ctx.fillStyle = withAlpha(b.color, 0.85);
        ctx.fillRect(lx, y - 7, w, 14);
        ctx.fillStyle = isLight(b.color) ? "#131722" : "#fff";
        ctx.fillText(text, lx + 4, y);
      }
    }
  }
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160;
}
