import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { Heatmap } from "../../shared/liquidations";

// CoinGlass-like ramp: dark purple → blue → teal → green → yellow.
const STOPS: [number, [number, number, number]][] = [
  [0, [40, 10, 70]],
  [0.25, [45, 70, 170]],
  [0.5, [30, 160, 160]],
  [0.75, [90, 200, 90]],
  [1, [250, 240, 70]],
];

export function heatColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  let k = 0;
  while (k < STOPS.length - 2 && x > STOPS[k + 1][0]) k++;
  const [t0, c0] = STOPS[k];
  const [t1, c1] = STOPS[k + 1];
  const f = (x - t0) / (t1 - t0);
  const c = c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
  // Weak cells fade out so the candles stay readable.
  const alpha = 0.08 + 0.62 * x;
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(2)})`;
}

/** Time × price heatmap drawn behind the candles. */
export class HeatmapPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private heatmap: Heatmap | null = null;
  private contrast = 0.6;

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

  setHeatmap(hm: Heatmap | null, contrast: number) {
    this.heatmap = hm;
    this.contrast = contrast;
    this.requestUpdate?.();
  }

  paneViews() {
    return [
      {
        zOrder: () => "bottom" as const,
        renderer: () => ({
          draw: () => {},
          drawBackground: (target: CanvasRenderingTarget2D) => this.draw(target),
        }),
      },
    ];
  }

  private draw(target: CanvasRenderingTarget2D) {
    const { chart, series, heatmap: hm } = this;
    if (!chart || !series || !hm || hm.max <= 0) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const spacing = ts.options().barSpacing;
    const cols = hm.grid.length / hm.rows;
    const from = Math.max(1, Math.floor(range.from) - hm.fromIndex);
    const to = Math.min(cols - 1, Math.ceil(range.to) - hm.fromIndex);
    // Row edges in pixels (shared by all columns).
    const ys: (number | null)[] = [];
    for (let r = 0; r <= hm.rows; r++) ys.push(series.priceToCoordinate(hm.priceLow + r * hm.priceStep));

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      for (let c = from; c <= to; c++) {
        const x = ts.logicalToCoordinate((c + hm.fromIndex) as Logical);
        if (x === null) continue;
        const left = x - spacing / 2;
        for (let r = 0; r < hm.rows; r++) {
          const v = hm.grid[c * hm.rows + r];
          if (v <= 0) continue;
          const t = (v / hm.max) ** this.contrast;
          if (t < 0.12) continue;
          const y0 = ys[r + 1];
          const y1 = ys[r];
          if (y0 === null || y1 === null) continue;
          ctx.fillStyle = heatColor(t);
          ctx.fillRect(left, Math.min(y0, y1), spacing + 0.5, Math.abs(y1 - y0) + 0.5);
        }
      }
    });
  }
}
