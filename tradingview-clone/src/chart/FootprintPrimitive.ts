import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { FootprintBar } from "../../shared/footprint";
import { barIndexAt } from "../../shared/replay";
import type { Bar } from "../../shared/math";

const compact = (v: number) =>
  (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toPrecision(2)).replace(".", ",");

/**
 * Footprint cells over the candles: sold volume on the left, bought on the right of each price row, tinted by
 * which side dominates; the POC row is outlined and the delta written under the candle. Zoomed out, the cells
 * shrink to coloured halves without numbers.
 */
export class FootprintPrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private footprints: FootprintBar[] = [];
  private bars: Bar[] = [];

  attached(param: SeriesAttachedParameter<Time>) {
    this.series = param.series;
    this.chart = param.chart;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.series = null;
    this.chart = null;
    this.requestUpdate = null;
  }

  setData(footprints: FootprintBar[], bars: Bar[]) {
    this.footprints = footprints;
    this.bars = bars;
    this.requestUpdate?.();
  }

  paneViews() {
    return [{ zOrder: () => "top" as const, renderer: () => ({ draw: (target: CanvasRenderingTarget2D) => this.draw(target) }) }];
  }

  private draw(target: CanvasRenderingTarget2D) {
    const series = this.series;
    const timeScale = this.chart?.timeScale();
    if (!series || !timeScale || !this.footprints.length) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const spacing = timeScale.options().barSpacing;
      const width = spacing * 0.92;
      if (width < 6) return;
      const numbers = width >= 56;
      for (const fp of this.footprints) {
        const index = barIndexAt(this.bars, fp.time);
        if (index < 0 || this.bars[index].time !== fp.time) continue;
        const x = timeScale.logicalToCoordinate(index as Logical);
        if (x === null || x < -width || x > mediaSize.width + width) continue;
        const left = x - width / 2;
        const max = Math.max(...fp.rows.map((r) => Math.max(r.buy, r.sell)));
        if (!(max > 0)) continue;
        let lowest = -Infinity;
        for (const row of fp.rows) {
          const yTop = series.priceToCoordinate(row.price + fp.rowSize);
          const yBottom = series.priceToCoordinate(row.price);
          if (yTop === null || yBottom === null) continue;
          lowest = Math.max(lowest, yBottom);
          const h = Math.max(1, yBottom - yTop - 1);
          const half = width / 2;
          ctx.fillStyle = `rgba(239,83,80,${0.12 + 0.6 * (row.sell / max)})`;
          ctx.fillRect(left, yTop, half - 0.5, h);
          ctx.fillStyle = `rgba(38,166,154,${0.12 + 0.6 * (row.buy / max)})`;
          ctx.fillRect(left + half + 0.5, yTop, half - 0.5, h);
          if (row.price === fp.poc) {
            ctx.strokeStyle = "#ff9800";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(left, yTop, width, h);
          }
          if (numbers && h >= 10) {
            ctx.font = `${Math.min(11, Math.floor(h * 0.8))}px -apple-system, system-ui, sans-serif`;
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#e0e3eb";
            ctx.textAlign = "right";
            ctx.fillText(compact(row.sell), left + half - 3, yTop + h / 2);
            ctx.textAlign = "left";
            ctx.fillText(compact(row.buy), left + half + 3, yTop + h / 2);
          }
        }
        if (width >= 30 && lowest > -Infinity) {
          ctx.font = "10px -apple-system, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = fp.delta >= 0 ? "#26a69a" : "#ef5350";
          ctx.fillText(`${fp.delta >= 0 ? "+" : "−"}${compact(Math.abs(fp.delta))}`, x, lowest + 3);
        }
      }
    });
  }
}
