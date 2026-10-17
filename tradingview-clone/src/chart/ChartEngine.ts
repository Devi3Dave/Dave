import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { getIndicator, resolveParams, type IndicatorDef, type OutputDef } from "../../shared/indicators";
import { heikinAshi, type Bar, type Series } from "../../shared/math";
import type { ChartMarker, ChartState, ChartType, IndicatorInstance } from "../store";
import { BandFillPrimitive, type BandPoint } from "./BandFillPrimitive";
import { DrawingsPrimitive } from "./DrawingsPrimitive";

export const THEME = {
  bg: "#131722",
  text: "#d1d4dc",
  grid: "rgba(42,46,57,0.6)",
  border: "#2a2e39",
  up: "#26a69a",
  down: "#ef5350",
};

export interface ComputedIndicator {
  instance: IndicatorInstance;
  def: IndicatorDef;
  params: Record<string, number>;
  outputs: Record<string, Series>;
  paneIndex: number;
}

interface BuiltIndicator {
  computed: ComputedIndicator;
  series: ISeriesApi<SeriesType>[];
  bands: { primitive: BandFillPrimitive; host: ISeriesApi<SeriesType>; upper: string; lower: string }[];
}

export interface PointerEvent {
  x: number;
  y: number;
  logical: number;
  paneIndex: number;
}

const ts = (t: number) => t as UTCTimestamp;

export class ChartEngine {
  readonly chart: IChartApi;
  readonly drawings = new DrawingsPrimitive();
  private main: ISeriesApi<SeriesType> | null = null;
  private markersApi: ISeriesMarkersPluginApi<Time> | null = null;
  private chartType: ChartType | null = null;
  private bars: Bar[] = [];
  private symbolKey = "";
  private indicatorKey = "";
  private built: BuiltIndicator[] = [];
  private markers: ChartMarker[] = [];

  onCrosshair: (logical: number | null, point: PointerEvent | null) => void = () => {};
  onClick: (e: PointerEvent) => void = () => {};
  onLayout: () => void = () => {};

  constructor(container: HTMLElement) {
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: THEME.bg },
        textColor: THEME.text,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
        panes: { separatorColor: THEME.border, separatorHoverColor: "rgba(41,98,255,0.3)", enableResize: true },
      },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: THEME.border },
      timeScale: { borderColor: THEME.border, timeVisible: true, secondsVisible: false, rightOffset: 8 },
      localization: { locale: "de-DE" },
    });

    this.chart.subscribeCrosshairMove((p: MouseEventParams<Time>) => {
      if (p.logical === undefined || !p.point) this.onCrosshair(null, null);
      else this.onCrosshair(Math.round(p.logical), { x: p.point.x, y: p.point.y, logical: p.logical, paneIndex: p.paneIndex ?? 0 });
    });
    // Own click detection: the library folds two quick clicks into a double
    // click, which would swallow the second point of a two-point drawing.
    let down: { x: number; y: number } | null = null;
    container.addEventListener("pointerdown", (ev) => {
      down = { x: ev.clientX, y: ev.clientY };
    });
    container.addEventListener("pointerup", (ev) => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) return;
      down = null;
      const rect = container.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      if (x > this.chart.timeScale().width()) return; // price scale
      const logical = this.chart.timeScale().coordinateToLogical(x);
      const paneIndex = this.paneLayout().findIndex((p) => y >= p.top && y < p.top + p.height);
      if (logical === null || paneIndex < 0) return;
      this.onClick({ x, y: y - this.paneLayout()[paneIndex].top, logical, paneIndex });
    });
  }

  destroy() {
    this.chart.remove();
  }

  // ---------------- state sync ----------------

  update(s: ChartState) {
    const typeChanged = s.chartType !== this.chartType;
    if (typeChanged) {
      // Clear indicator panes first so removing the old price series cannot shift pane indices.
      this.clearIndicators();
      this.createMainSeries(s.chartType);
    }

    const symbolKey = `${s.symbol}|${s.interval}`;
    const prev = this.bars;
    const barsChanged = s.bars !== prev || typeChanged;
    const isTick =
      !typeChanged &&
      symbolKey === this.symbolKey &&
      prev.length > 0 &&
      s.bars.length - prev.length <= 1 &&
      s.bars.length >= prev.length &&
      s.bars[0]?.time === prev[0]?.time;
    this.bars = s.bars;

    if (barsChanged) {
      if (isTick) this.tickMain();
      else this.setMainData();
      if (symbolKey !== this.symbolKey && s.bars.length > 0) {
        this.symbolKey = symbolKey;
        this.chart.timeScale().setVisibleLogicalRange({ from: s.bars.length - 160, to: s.bars.length + 8 });
      }
    }

    const indicatorKey = JSON.stringify(s.indicators);
    if (indicatorKey !== this.indicatorKey || typeChanged) {
      this.indicatorKey = indicatorKey;
      this.buildIndicators(s.indicators);
    } else if (barsChanged) {
      this.fillIndicators();
    }

    this.drawings.setData(s.drawings, s.bars);
    if (s.markers !== this.markers || barsChanged) {
      this.markers = s.markers;
      this.applyMarkers();
    }
  }

  private createMainSeries(type: ChartType) {
    if (this.main) {
      this.main.detachPrimitive(this.drawings);
      this.markersApi?.detach();
      this.chart.removeSeries(this.main);
    }
    const common = { priceLineVisible: true, lastValueVisible: true };
    switch (type) {
      case "bars":
        this.main = this.chart.addSeries(BarSeries, { ...common, upColor: THEME.up, downColor: THEME.down, thinBars: false });
        break;
      case "line":
        this.main = this.chart.addSeries(LineSeries, { ...common, color: "#2962ff", lineWidth: 2 });
        break;
      case "area":
        this.main = this.chart.addSeries(AreaSeries, {
          ...common,
          lineColor: "#2962ff",
          topColor: "rgba(41,98,255,0.35)",
          bottomColor: "rgba(41,98,255,0.02)",
          lineWidth: 2,
        });
        break;
      default:
        this.main = this.chart.addSeries(CandlestickSeries, {
          ...common,
          upColor: THEME.up,
          downColor: THEME.down,
          borderUpColor: THEME.up,
          borderDownColor: THEME.down,
          wickUpColor: THEME.up,
          wickDownColor: THEME.down,
        });
    }
    this.chartType = type;
    this.main.attachPrimitive(this.drawings);
    this.markersApi = createSeriesMarkers(this.main, []);
  }

  private displayBars(): Bar[] {
    return this.chartType === "heikin_ashi" ? heikinAshi(this.bars) : this.bars;
  }

  private toMainPoint(b: Bar) {
    return this.chartType === "line" || this.chartType === "area"
      ? { time: ts(b.time), value: b.close }
      : { time: ts(b.time), open: b.open, high: b.high, low: b.low, close: b.close };
  }

  private setMainData() {
    this.main?.setData(this.displayBars().map((b) => this.toMainPoint(b)));
  }

  private tickMain() {
    const bars = this.displayBars();
    const last = bars[bars.length - 1];
    if (last) this.main?.update(this.toMainPoint(last));
  }

  // ---------------- indicators ----------------

  private clearIndicators() {
    for (const b of this.built) {
      for (const band of b.bands) band.host.detachPrimitive(band.primitive);
      for (const s of b.series) this.chart.removeSeries(s);
    }
    this.built = [];
    while (this.chart.panes().length > 1) this.chart.removePane(this.chart.panes().length - 1);
  }

  private buildIndicators(instances: IndicatorInstance[]) {
    this.clearIndicators();
    let nextPane = 1;
    for (const instance of instances) {
      const def = getIndicator(instance.type);
      if (!def) continue;
      const params = resolveParams(def, instance.params);
      const isVolume = def.id === "volume";
      const paneIndex = def.overlay || isVolume ? 0 : nextPane++;
      const series = def.outputs.map((o, k) => this.addOutputSeries(def, o, instance.colors?.[k] ?? o.color, paneIndex, isVolume, !!instance.hidden));

      if (def.levels && series[0]) {
        for (const price of def.levels) {
          series[0].createPriceLine({ price, color: "rgba(120,123,134,0.6)", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
        }
      }
      const bands = (def.fills ?? []).map((f) => {
        const host = series[def.outputs.findIndex((o) => o.key === f.upper)] ?? series[0];
        const primitive = new BandFillPrimitive([], instance.hidden ? "transparent" : f.color, instance.hidden ? undefined : f.colorBelow);
        host.attachPrimitive(primitive);
        return { primitive, host, upper: f.upper, lower: f.lower };
      });
      this.built.push({ computed: { instance, def, params, outputs: {}, paneIndex }, series, bands });
    }

    const panes = this.chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? Math.max(2, panes.length) : 1));
    this.fillIndicators();
    this.onLayout();
  }

  private addOutputSeries(def: IndicatorDef, o: OutputDef, color: string, paneIndex: number, isVolume: boolean, hidden: boolean) {
    const base = {
      visible: !hidden,
      priceLineVisible: false,
      lastValueVisible: !def.overlay && !isVolume,
      title: "",
      ...(isVolume ? { priceScaleId: "volume" } : {}),
    };
    let s: ISeriesApi<SeriesType>;
    if (o.style === "histogram") {
      s = this.chart.addSeries(HistogramSeries, { ...base, color, priceFormat: isVolume ? { type: "volume" } : { type: "price", precision: 4, minMove: 0.0001 } }, paneIndex);
    } else {
      s = this.chart.addSeries(
        LineSeries,
        {
          ...base,
          color,
          lineWidth: (o.lineWidth ?? 1.5) as 1,
          lineStyle: o.dashed ? LineStyle.Dashed : LineStyle.Solid,
          lineVisible: o.style !== "dots",
          pointMarkersVisible: o.style === "dots",
          pointMarkersRadius: 1.5,
          crosshairMarkerVisible: false,
        },
        paneIndex,
      );
    }
    if (isVolume) s.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    return s;
  }

  private fillIndicators() {
    const bars = this.bars;
    const n = bars.length;
    if (n === 0) return;
    const step = n > 1 ? bars[n - 1].time - bars[n - 2].time : 60;
    const timeAt = (j: number) => (j < n ? bars[j].time : bars[n - 1].time + (j - n + 1) * step);

    for (const b of this.built) {
      const { def, params } = b.computed;
      const outputs = def.compute(bars, params);
      b.computed.outputs = outputs;
      def.outputs.forEach((o, k) => {
        const values = outputs[o.key] ?? [];
        const offset = o.offset?.(params) ?? 0;
        const data: { time: UTCTimestamp; value?: number; color?: string }[] = [];
        for (let i = 0; i < values.length; i++) {
          const j = i + offset;
          if (j < 0) continue;
          const v = values[i];
          if (v === null || !Number.isFinite(v)) {
            if (j < n) data.push({ time: ts(timeAt(j)) });
            continue;
          }
          const point: { time: UTCTimestamp; value: number; color?: string } = { time: ts(timeAt(j)), value: v };
          if (o.style === "histogram") point.color = histogramColor(def.id, values, i, bars[i], b.computed.instance.colors?.[k] ?? o.color);
          data.push(point);
        }
        b.series[k].setData(data as never);
      });
      for (const band of b.bands) {
        const upperDef = def.outputs.find((o) => o.key === band.upper);
        const offset = upperDef?.offset?.(params) ?? 0;
        const up = outputs[band.upper] ?? [];
        const lo = outputs[band.lower] ?? [];
        const pts: BandPoint[] = [];
        for (let i = 0; i < up.length; i++) {
          const u = up[i];
          const l = lo[i];
          if (u !== null && l !== null && Number.isFinite(u) && Number.isFinite(l)) pts.push({ logical: i + offset, upper: u, lower: l });
        }
        band.primitive.setPoints(pts);
      }
    }
  }

  get computed(): ComputedIndicator[] {
    return this.built.map((b) => b.computed);
  }

  /** Top offset and height (CSS px) of every pane, for overlay legends. */
  paneLayout(): { top: number; height: number }[] {
    let top = 0;
    return this.chart.panes().map((p) => {
      const h = p.getHeight();
      const r = { top, height: h };
      top += h + 1;
      return r;
    });
  }

  // ---------------- markers ----------------

  private applyMarkers() {
    const times = new Set(this.bars.map((b) => b.time));
    this.markersApi?.setMarkers(
      this.markers
        .filter((m) => times.has(m.time))
        .sort((a, b) => a.time - b.time)
        .map((m) => ({
          id: m.id,
          time: ts(m.time),
          position: m.position === "above" ? "aboveBar" : "belowBar",
          shape: m.shape,
          color: m.color,
          text: m.text,
        })),
    );
  }

  // ---------------- helpers for tools ----------------

  logicalToTime(logical: number): number | null {
    const bars = this.bars;
    const n = bars.length;
    if (n === 0) return null;
    const i = Math.round(logical);
    if (i >= 0 && i < n) return bars[i].time;
    const step = n > 1 ? bars[n - 1].time - bars[n - 2].time : 60;
    return i < 0 ? bars[0].time + i * step : bars[n - 1].time + (i - n + 1) * step;
  }

  priceAt(y: number): number | null {
    return this.main?.coordinateToPrice(y) ?? null;
  }

  /** Snap a price to the nearest OHLC value of the bar (magnet mode). */
  snapPrice(logical: number, price: number, y: number): number {
    const bar = this.bars[Math.round(logical)];
    if (!bar || !this.main) return price;
    let best = price;
    let bestDist = 18;
    for (const v of [bar.open, bar.high, bar.low, bar.close]) {
      const vy = this.main.priceToCoordinate(v);
      if (vy !== null && Math.abs(vy - y) < bestDist) {
        bestDist = Math.abs(vy - y);
        best = v;
      }
    }
    return best;
  }

  paneSize(): { width: number; height: number } {
    const width = this.chart.timeScale().width();
    const height = this.chart.panes()[0]?.getHeight() ?? 0;
    return { width, height };
  }

  /** JPEG data URL of the full chart, scaled to at most 1568px on the long edge. */
  screenshot(): string {
    const canvas = this.chart.takeScreenshot(true, false);
    const scale = Math.min(1, 1568 / Math.max(canvas.width, canvas.height));
    if (scale === 1) return canvas.toDataURL("image/jpeg", 0.85);
    const out = document.createElement("canvas");
    out.width = Math.round(canvas.width * scale);
    out.height = Math.round(canvas.height * scale);
    out.getContext("2d")?.drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", 0.85);
  }
}

function histogramColor(id: string, values: Series, i: number, bar: Bar | undefined, color: string): string {
  const v = values[i] as number;
  const prev = values[i - 1];
  if (id === "volume" && bar) return bar.close >= bar.open ? "rgba(38,166,154,0.5)" : "rgba(239,83,80,0.5)";
  if (id === "macd") {
    const rising = prev === null || prev === undefined || v >= prev;
    if (v >= 0) return rising ? "#26a69a" : "#b2dfdb";
    return rising ? "#ffcdd2" : "#ef5350";
  }
  if (id === "ao") return prev === null || prev === undefined || v >= prev ? "#26a69a" : "#ef5350";
  return color;
}
