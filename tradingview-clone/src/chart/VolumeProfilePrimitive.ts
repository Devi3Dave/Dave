import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { VolumeProfile } from "../../shared/math";

/** Horizontal volume-by-price histogram drawn from the right edge of the price pane. */
export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private profile: VolumeProfile | null = null;

  attached(param: SeriesAttachedParameter<Time>) {
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.series = null;
    this.requestUpdate = null;
  }

  setProfile(profile: VolumeProfile | null) {
    this.profile = profile;
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
    const profile = this.profile;
    if (!series || !profile) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const maxVol = Math.max(...profile.rows.map((r) => r.volume));
      if (maxVol <= 0) return;
      const maxWidth = mediaSize.width * 0.25;
      for (const row of profile.rows) {
        const yTop = series.priceToCoordinate(row.high);
        const yBottom = series.priceToCoordinate(row.low);
        if (yTop === null || yBottom === null) continue;
        const h = Math.max(1, yBottom - yTop - 1);
        const w = (row.volume / maxVol) * maxWidth;
        const buyW = row.volume > 0 ? (w * row.buy) / row.volume : 0;
        const alpha = row.inValueArea ? 0.45 : 0.2;
        const x = mediaSize.width - w;
        ctx.fillStyle = `rgba(38,166,154,${alpha})`;
        ctx.fillRect(x, yTop, buyW, h);
        ctx.fillStyle = `rgba(239,83,80,${alpha})`;
        ctx.fillRect(x + buyW, yTop, w - buyW, h);
      }
    });
  }
}
