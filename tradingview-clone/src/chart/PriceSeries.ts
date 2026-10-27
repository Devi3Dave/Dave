import type { CanvasRenderingTarget2D } from "fancy-canvas";
import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesPricePlotValues,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
} from "lightweight-charts";
import { formatPrice } from "./DrawingsPrimitive";

/**
 * The chart types lightweight-charts has no series for, drawn as one custom series each so that the price
 * scale, crosshair and last-price line work as for candles. Looks follow TradingView's chart types:
 * - Volume candles: candles whose body width follows the volume ("New chart type — Volume candles",
 *   tradingview.com/blog/en/new-chart-type-volume-candles-43863), here relative to the largest volume in view.
 * - HLC area: high, low and close lines, filled between high and close and between close and low
 *   ("New chart type — HLC area", tradingview.com/blog/en/new-chart-type-hlc-area-38579).
 * - Columns: one column per candle up to the close, green when close ≥ open
 *   ("New chart type added: Columns", tradingview.com/blog/en/new-chart-type-added-columns-32391).
 * - High-Low: one filled bar from low to high with both prices written above and below
 *   ("New chart type — High-Low", tradingview.com/blog/en/new-chart-type-high-low-33180).
 * - Kagi and Point & Figure: see shared/chartTypes.ts for the construction.
 */
export type PriceSeriesKind = "volume_candles" | "hlc_area" | "columns" | "high_low" | "kagi" | "point_figure";

export interface PriceItem extends CustomData<Time> {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Kagi: yang (thick) at the line's start; switches at `switchAt`. */
  thick?: boolean;
  switchAt?: number | null;
  /** Point & Figure box size. */
  box?: number;
}

export interface PriceSeriesColors {
  up: string;
  down: string;
}

const HIGH_LOW_COLOR = "#2962ff";
const HLC_CLOSE_COLOR = "#b2b5be";

const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

export class PriceSeriesView implements ICustomSeriesPaneView<Time, PriceItem, CustomSeriesOptions> {
  private data: PaneRendererCustomData<Time, PriceItem> | null = null;

  constructor(
    private readonly kind: PriceSeriesKind,
    private readonly colors: PriceSeriesColors,
  ) {}

  renderer() {
    return { draw: (target: CanvasRenderingTarget2D, toY: PriceToCoordinateConverter) => this.draw(target, toY) };
  }

  update(data: PaneRendererCustomData<Time, PriceItem>) {
    this.data = data;
  }

  priceValueBuilder(d: PriceItem): CustomSeriesPricePlotValues {
    if (this.kind === "columns") return [d.close];
    // Glyphs are centred on their box level and reach half a box beyond it.
    if (this.kind === "point_figure") return [d.low - (d.box ?? 0) / 2, d.high + (d.box ?? 0) / 2, d.close];
    return [d.low, d.high, d.close];
  }

  isWhitespace(d: PriceItem | CustomSeriesWhitespaceData<Time>): d is CustomSeriesWhitespaceData<Time> {
    return (d as Partial<PriceItem>).close === undefined;
  }

  defaultOptions(): CustomSeriesOptions {
    return { ...customSeriesDefaultOptions, color: this.kind === "high_low" ? HIGH_LOW_COLOR : this.colors.up };
  }

  destroy() {
    this.data = null;
  }

  private draw(target: CanvasRenderingTarget2D, toY: PriceToCoordinateConverter) {
    const data = this.data;
    if (!data?.visibleRange || !data.bars.length) return;
    // One item beyond each edge so lines and areas reach the border.
    const from = Math.max(0, data.visibleRange.from - 1);
    const to = Math.min(data.bars.length - 1, data.visibleRange.to + 1);
    const items = data.bars.slice(from, to + 1);
    const spacing = data.barSpacing * data.conflationFactor;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const y = (p: number) => toY(p) ?? NaN;
      switch (this.kind) {
        case "volume_candles":
          return this.drawVolumeCandles(ctx, items, spacing, y);
        case "hlc_area":
          return this.drawHlcArea(ctx, items, y);
        case "columns":
          return this.drawColumns(ctx, items, spacing, y, mediaSize.height);
        case "high_low":
          return this.drawHighLow(ctx, items, spacing, y);
        case "kagi":
          return this.drawKagi(ctx, data.bars, from, to, y);
        case "point_figure":
          return this.drawPointFigure(ctx, items, spacing, y);
      }
    });
  }

  private color(d: PriceItem) {
    return d.close >= d.open ? this.colors.up : this.colors.down;
  }

  private drawVolumeCandles(ctx: CanvasRenderingContext2D, items: PaneRendererCustomData<Time, PriceItem>["bars"], spacing: number, y: (p: number) => number) {
    const max = Math.max(...items.map((b) => b.originalData.volume || 0));
    for (const { x, originalData: d } of items) {
      const share = max > 0 ? (d.volume || 0) / max : 1;
      const width = Math.max(1, spacing * 0.9 * share);
      const top = y(Math.max(d.open, d.close));
      const bottom = y(Math.min(d.open, d.close));
      ctx.fillStyle = this.color(d);
      ctx.fillRect(Math.round(x) - 0.5, y(d.high), 1, y(d.low) - y(d.high));
      ctx.fillRect(x - width / 2, top, width, Math.max(1, bottom - top));
    }
  }

  private drawHlcArea(ctx: CanvasRenderingContext2D, items: PaneRendererCustomData<Time, PriceItem>["bars"], y: (p: number) => number) {
    if (!items.length) return;
    const band = (upper: keyof PriceItem, lower: keyof PriceItem, fill: string) => {
      ctx.beginPath();
      items.forEach((b, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, b.x, y(b.originalData[upper] as number)));
      for (let i = items.length - 1; i >= 0; i--) ctx.lineTo(items[i].x, y(items[i].originalData[lower] as number));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    const line = (key: keyof PriceItem, color: string, width: number) => {
      ctx.beginPath();
      items.forEach((b, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, b.x, y(b.originalData[key] as number)));
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    band("high", "close", alpha(this.colors.up, 0.2));
    band("close", "low", alpha(this.colors.down, 0.2));
    line("high", this.colors.up, 1);
    line("low", this.colors.down, 1);
    line("close", HLC_CLOSE_COLOR, 2);
  }

  private drawColumns(ctx: CanvasRenderingContext2D, items: PaneRendererCustomData<Time, PriceItem>["bars"], spacing: number, y: (p: number) => number, height: number) {
    const width = Math.max(1, spacing * 0.7);
    for (const { x, originalData: d } of items) {
      const top = y(d.close);
      ctx.fillStyle = alpha(this.color(d), 0.85);
      ctx.fillRect(x - width / 2, top, width, height - top);
    }
  }

  private drawHighLow(ctx: CanvasRenderingContext2D, items: PaneRendererCustomData<Time, PriceItem>["bars"], spacing: number, y: (p: number) => number) {
    const width = Math.max(1, spacing * 0.7);
    const labels = spacing >= 44;
    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
    ctx.textAlign = "center";
    for (const { x, originalData: d } of items) {
      const top = y(d.high);
      ctx.fillStyle = HIGH_LOW_COLOR;
      ctx.fillRect(x - width / 2, top, width, Math.max(1, y(d.low) - top));
      if (!labels) continue;
      ctx.fillStyle = "#d1d4dc";
      ctx.textBaseline = "bottom";
      ctx.fillText(formatPrice(d.high), x, top - 2);
      ctx.textBaseline = "top";
      ctx.fillText(formatPrice(d.low), x, y(d.low) + 2);
    }
  }

  private drawKagi(ctx: CanvasRenderingContext2D, bars: PaneRendererCustomData<Time, PriceItem>["bars"], from: number, to: number, y: (p: number) => number) {
    const stroke = (thick: boolean, path: () => void) => {
      ctx.beginPath();
      path();
      ctx.strokeStyle = thick ? this.colors.up : this.colors.down;
      ctx.lineWidth = thick ? 3 : 1.5;
      ctx.lineCap = "square";
      ctx.stroke();
    };
    for (let i = from; i <= to; i++) {
      const { x, originalData: d } = bars[i];
      const thick = !!d.thick;
      if (i > 0) {
        // The shoulder or waist joining the previous line keeps that line's thickness at its end.
        const prev = bars[i - 1].originalData;
        const prevEnd = prev.switchAt == null ? !!prev.thick : !prev.thick;
        stroke(prevEnd, () => {
          ctx.moveTo(bars[i - 1].x, y(d.open));
          ctx.lineTo(x, y(d.open));
        });
      }
      if (d.switchAt == null) {
        stroke(thick, () => {
          ctx.moveTo(x, y(d.open));
          ctx.lineTo(x, y(d.close));
        });
      } else {
        const at = d.switchAt;
        stroke(thick, () => {
          ctx.moveTo(x, y(d.open));
          ctx.lineTo(x, y(at));
        });
        stroke(!thick, () => {
          ctx.moveTo(x, y(at));
          ctx.lineTo(x, y(d.close));
        });
      }
    }
  }

  private drawPointFigure(ctx: CanvasRenderingContext2D, items: PaneRendererCustomData<Time, PriceItem>["bars"], spacing: number, y: (p: number) => number) {
    for (const { x, originalData: d } of items) {
      const box = d.box ?? 0;
      if (!(box > 0)) continue;
      const rising = d.close > d.open;
      const color = rising ? this.colors.up : this.colors.down;
      const boxPx = Math.abs(y(d.low) - y(d.low + box));
      const size = Math.min(spacing * 0.8, boxPx * 0.9);
      if (size < 3) {
        // Zoomed far out: the column as a bar.
        ctx.fillStyle = color;
        const top = y(d.high + box / 2);
        ctx.fillRect(x - Math.max(1, spacing * 0.4), top, Math.max(2, spacing * 0.8), y(d.low - box / 2) - top);
        continue;
      }
      const count = Math.round((d.high - d.low) / box) + 1;
      const half = size / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, Math.min(2, size / 8));
      ctx.beginPath();
      for (let k = 0; k < count; k++) {
        const cy = y(d.low + k * box);
        if (rising) {
          ctx.moveTo(x - half, cy - half);
          ctx.lineTo(x + half, cy + half);
          ctx.moveTo(x + half, cy - half);
          ctx.lineTo(x - half, cy + half);
        } else {
          ctx.moveTo(x + half, cy);
          ctx.ellipse(x, cy, half, half, 0, 0, Math.PI * 2);
        }
      }
      ctx.stroke();
    }
  }
}
