import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { VolumeProfile } from "../../shared/math";

const POC_COLOR = "#ff9800";

/**
 * Horizontal volume-by-price histograms: one drawn from the right edge of the price pane ("right"), or one per
 * session drawn from the session's first candle across its width ("start"). TPO profiles are drawn in blue.
 */
export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private profiles: VolumeProfile[] = [];

  /** `pocLine`: draw the POC here (profiles whose indicator has no POC line of its own). */
  constructor(
    private anchor: "right" | "start" = "right",
    private pocLine = false,
  ) {}

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

  setProfile(profile: VolumeProfile | VolumeProfile[] | null) {
    this.profiles = profile === null ? [] : Array.isArray(profile) ? profile : [profile];
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
    const series = this.series;
    const timeScale = this.chart?.timeScale();
    if (!series || !timeScale || !this.profiles.length) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const half = Math.max(1, timeScale.options().barSpacing / 2);
      const x = (i: number) => timeScale.logicalToCoordinate(i as Logical);
      for (const profile of this.profiles) {
        let left: number;
        let right: number;
        let maxWidth: number;
        if (this.anchor === "start") {
          const a = x(profile.fromIndex);
          const b = x(profile.toIndex);
          if (a === null || b === null) continue;
          left = a - half;
          right = b + half;
          if (right < 0 || left > mediaSize.width) continue;
          // As TradingView's session profiles: up to 70 % of the session's width.
          maxWidth = (right - left) * 0.7;
        } else {
          left = this.pocLine ? (x(profile.fromIndex) ?? 0) - half : 0;
          right = mediaSize.width;
          maxWidth = mediaSize.width * 0.25;
        }
        const maxVol = Math.max(...profile.rows.map((r) => r.volume));
        if (maxVol <= 0) continue;
        for (const row of profile.rows) {
          const yTop = series.priceToCoordinate(row.high);
          const yBottom = series.priceToCoordinate(row.low);
          if (yTop === null || yBottom === null) continue;
          const h = Math.max(1, yBottom - yTop - 1);
          const w = (row.volume / maxVol) * maxWidth;
          const alpha = row.inValueArea ? 0.45 : 0.2;
          const x0 = this.anchor === "start" ? left : right - w;
          if (profile.tpo) {
            ctx.fillStyle = `rgba(41,98,255,${alpha})`;
            ctx.fillRect(x0, yTop, w, h);
            continue;
          }
          const buyW = row.volume > 0 ? (w * row.buy) / row.volume : 0;
          ctx.fillStyle = `rgba(38,166,154,${alpha})`;
          ctx.fillRect(x0, yTop, buyW, h);
          ctx.fillStyle = `rgba(239,83,80,${alpha})`;
          ctx.fillRect(x0 + buyW, yTop, w - buyW, h);
        }
        if (this.pocLine) {
          const y = series.priceToCoordinate(profile.poc);
          if (y === null) continue;
          ctx.strokeStyle = POC_COLOR;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(Math.max(0, left), y);
          ctx.lineTo(Math.min(mediaSize.width, right), y);
          ctx.stroke();
        }
      }
    });
  }
}
