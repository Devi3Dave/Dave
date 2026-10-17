import type { IChartApi, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

export interface BandPoint {
  logical: number;
  upper: number;
  lower: number;
}

/** Shades the area between two value series (Bollinger, Keltner, Ichimoku cloud ...). */
export class BandFillPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;

  constructor(
    private points: BandPoint[],
    private color: string,
    private colorBelow?: string,
  ) {}

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
  }

  setPoints(points: BandPoint[]) {
    this.points = points;
    this.requestUpdate?.();
  }

  paneViews() {
    return [
      {
        zOrder: () => "bottom" as const,
        renderer: () => ({
          draw: () => {},
          drawBackground: (target: import("fancy-canvas").CanvasRenderingTarget2D) => {
            const chart = this.chart;
            const series = this.series;
            if (!chart || !series) return;
            target.useMediaCoordinateSpace(({ context: ctx }) => {
              const ts = chart.timeScale();
              const range = ts.getVisibleLogicalRange();
              if (!range) return;
              const pts = this.points
                .filter((p) => p.logical >= range.from - 2 && p.logical <= range.to + 2)
                .map((p) => ({
                  x: ts.logicalToCoordinate(p.logical as Logical),
                  yu: series.priceToCoordinate(p.upper),
                  yl: series.priceToCoordinate(p.lower),
                  above: p.upper >= p.lower,
                }));
              for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1];
                const b = pts[i];
                if (a.x === null || b.x === null || a.yu === null || a.yl === null || b.yu === null || b.yl === null) continue;
                ctx.fillStyle = !b.above && this.colorBelow ? this.colorBelow : this.color;
                ctx.beginPath();
                ctx.moveTo(a.x, a.yu);
                ctx.lineTo(b.x, b.yu);
                ctx.lineTo(b.x, b.yl);
                ctx.lineTo(a.x, a.yl);
                ctx.closePath();
                ctx.fill();
              }
            });
          },
        }),
      },
    ];
  }
}
