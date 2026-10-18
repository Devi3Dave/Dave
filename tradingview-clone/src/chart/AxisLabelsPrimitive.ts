import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { Bar } from "../../shared/math";

export interface AxisLabelOptions {
  countdown: boolean;
  highLow: boolean;
  lastPriceLabel: boolean;
  intervalSeconds: number;
  upColor: string;
  downColor: string;
}

// Height of the library's last-price label; the countdown sits right below it.
const LABEL_HEIGHT = 18;

/** Formats the time left until the current candle closes, like TradingView. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}T ${pad(h)}:${pad(m)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}

/** Extra price-axis labels: countdown to candle close and high/low of the visible range. */
export class AxisLabelsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private timer: number | undefined;
  private bars: Bar[] = [];
  private opts: AxisLabelOptions = { countdown: true, highLow: false, lastPriceLabel: true, intervalSeconds: 60, upColor: "#26a69a", downColor: "#ef5350" };

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    // The countdown changes every second even without new data.
    this.timer = window.setInterval(() => {
      if (this.opts.countdown) this.requestUpdate?.();
    }, 1000);
  }

  detached() {
    window.clearInterval(this.timer);
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setData(bars: Bar[], opts: AxisLabelOptions) {
    this.bars = bars;
    this.opts = opts;
    this.requestUpdate?.();
  }

  priceAxisViews(): ISeriesPrimitiveAxisView[] {
    const views: ISeriesPrimitiveAxisView[] = [];
    const series = this.series;
    const last = this.bars[this.bars.length - 1];
    if (!series || !last) return views;
    const fmt = (p: number) => series.priceFormatter().format(p);

    if (this.opts.countdown) {
      // Count down to the next candle boundary on the clock, so it keeps running while the
      // next candle's data is on its way; hide it when the data is clearly stale.
      const step = this.opts.intervalSeconds;
      const elapsed = Date.now() / 1000 - last.time;
      const remaining = step - (((elapsed % step) + step) % step);
      const y = series.priceToCoordinate(last.close);
      if (elapsed < 2 * step && y !== null) {
        const color = last.close >= last.open ? this.opts.upColor : this.opts.downColor;
        // Below the last-price label, or in its place when that label is hidden.
        const offset = this.opts.lastPriceLabel ? LABEL_HEIGHT : 0;
        views.push(axisView(y + offset, formatCountdown(remaining), color, "#ffffff"));
      }
    }

    if (this.opts.highLow && this.chart) {
      const range = this.chart.timeScale().getVisibleLogicalRange();
      if (range) {
        const from = Math.max(0, Math.floor(range.from));
        const to = Math.min(this.bars.length - 1, Math.ceil(range.to));
        let hi = -Infinity;
        let lo = Infinity;
        for (let i = from; i <= to; i++) {
          hi = Math.max(hi, this.bars[i].high);
          lo = Math.min(lo, this.bars[i].low);
        }
        const yHi = Number.isFinite(hi) ? series.priceToCoordinate(hi) : null;
        const yLo = Number.isFinite(lo) ? series.priceToCoordinate(lo) : null;
        if (yHi !== null) views.push(axisView(yHi, `H ${fmt(hi)}`, "#2a2e39", "#d1d4dc"));
        if (yLo !== null) views.push(axisView(yLo, `T ${fmt(lo)}`, "#2a2e39", "#d1d4dc"));
      }
    }
    return views;
  }

  updateAllViews() {}
}

function axisView(coordinate: number, text: string, backColor: string, textColor: string): ISeriesPrimitiveAxisView {
  return {
    coordinate: () => coordinate,
    text: () => text,
    backColor: () => backColor,
    textColor: () => textColor,
    visible: () => true,
    tickVisible: () => false,
  };
}
