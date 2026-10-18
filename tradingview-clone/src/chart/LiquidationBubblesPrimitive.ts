import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { Bar } from "../../shared/math";
import type { LiveLiquidation } from "../market/liquidationFeed";

/** Real liquidations from Binance Futures as bubbles sized by notional (long = red, short = green). */
export class LiquidationBubblesPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private items: LiveLiquidation[] = [];
  private bars: Bar[] = [];

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

  setData(items: LiveLiquidation[], bars: Bar[]) {
    this.items = items;
    this.bars = bars;
    this.requestUpdate?.();
  }

  paneViews() {
    return [{ zOrder: () => "top" as const, renderer: () => ({ draw: (t: CanvasRenderingTarget2D) => this.draw(t) }) }];
  }

  private logicalOf(time: number): number | null {
    const bars = this.bars;
    const n = bars.length;
    if (n < 2) return null;
    const step = bars[n - 1].time - bars[n - 2].time;
    if (time < bars[0].time) return null;
    // Bars are evenly spaced except for gaps; search from the end where live events land.
    for (let i = n - 1; i >= 0; i--) if (bars[i].time <= time) return i + Math.min(0.99, (time - bars[i].time) / step);
    return null;
  }

  private draw(target: CanvasRenderingTarget2D) {
    const { chart, series } = this;
    if (!chart || !series || this.items.length === 0) return;
    const ts = chart.timeScale();
    const maxNotional = Math.max(...this.items.map((l) => l.notional));
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      for (const l of this.items) {
        const logical = this.logicalOf(l.time);
        if (logical === null) continue;
        const x = ts.logicalToCoordinate(Math.floor(logical) as Logical);
        const y = series.priceToCoordinate(l.price);
        if (x === null || y === null) continue;
        const r = 3 + 11 * Math.sqrt(l.notional / maxNotional);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = l.side === "long" ? "rgba(239,83,80,0.45)" : "rgba(38,166,154,0.45)";
        ctx.strokeStyle = l.side === "long" ? "#ef5350" : "#26a69a";
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    });
  }
}
