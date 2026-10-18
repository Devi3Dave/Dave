import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { getIndicator, resolveParams, type IndicatorDef, type OutputDef } from "../../shared/indicators";
import { heikinAshi, type Bar, type Series } from "../../shared/math";
import { INTERVAL_SECONDS } from "../../shared/marketData";
import type { OrderBlock, OrderBlockSignal } from "../../shared/orderblocks";
import type { CandlePattern, Formation } from "../../shared/patterns";
import { resolveTimeZone, type ChartSettings } from "../chartSettings";
import type { ChartMarker, ChartState, ChartType, IndicatorInstance } from "../store";
import type { LiveLiquidation } from "../market/liquidationFeed";
import { AxisLabelsPrimitive } from "./AxisLabelsPrimitive";
import { BandFillPrimitive, type BandPoint } from "./BandFillPrimitive";
import { DrawingsPrimitive } from "./DrawingsPrimitive";
import { HeatmapPrimitive } from "./HeatmapPrimitive";
import { LiquidationBubblesPrimitive } from "./LiquidationBubblesPrimitive";
import { PatternsPrimitive } from "./PatternsPrimitive";
import { VolumeProfilePrimitive } from "./VolumeProfilePrimitive";

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
  profile?: { primitive: VolumeProfilePrimitive; host: ISeriesApi<SeriesType> };
  heatmap?: { primitive: HeatmapPrimitive; host: ISeriesApi<SeriesType> };
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
  private readonly axisLabels = new AxisLabelsPrimitive();
  private readonly liquidationBubbles = new LiquidationBubblesPrimitive();
  private readonly patterns = new PatternsPrimitive((t) => this.drawings.timeToX(t));
  private patternMarkers: SeriesMarker<Time>[] = [];
  private patternKey = "";
  private liquidations: LiveLiquidation[] = [];
  private side: "left" | "right" = "right";
  private settingsKey = "";
  private intervalSeconds = 3600;

  onCrosshair: (logical: number | null, point: PointerEvent | null) => void = () => {};
  onClick: (e: PointerEvent) => void = () => {};
  onLayout: () => void = () => {};
  /** Freehand drawing (brush): pointer down → moves → up, while chart panning is off. */
  onDrag: (phase: "start" | "move" | "end", e: PointerEvent) => void = () => {};
  private dragMode = false;

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
    let dragging = false;
    const toEvent = (ev: globalThis.PointerEvent): PointerEvent | null => {
      const rect = container.getBoundingClientRect();
      // Pane x starts after a left-side price scale.
      const x = ev.clientX - rect.left - (this.side === "left" ? this.priceScaleWidth() : 0);
      const y = ev.clientY - rect.top;
      if (x < 0 || x > this.chart.timeScale().width()) return null; // price scale
      const logical = this.chart.timeScale().coordinateToLogical(x);
      const layout = this.paneLayout();
      const paneIndex = layout.findIndex((p) => y >= p.top && y < p.top + p.height);
      if (logical === null || paneIndex < 0) return null;
      return { x, y: y - layout[paneIndex].top, logical, paneIndex };
    };
    container.addEventListener("pointerdown", (ev) => {
      down = { x: ev.clientX, y: ev.clientY };
      if (!this.dragMode) return;
      const e = toEvent(ev);
      if (!e || e.paneIndex !== 0) return;
      dragging = true;
      container.setPointerCapture(ev.pointerId);
      this.onDrag("start", e);
    });
    container.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      const e = toEvent(ev);
      if (e && e.paneIndex === 0) this.onDrag("move", e);
    });
    container.addEventListener("pointerup", (ev) => {
      if (dragging) {
        dragging = false;
        down = null;
        const e = toEvent(ev);
        if (e) this.onDrag("end", e);
        return;
      }
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) return;
      down = null;
      const e = toEvent(ev);
      if (e) this.onClick(e);
    });
  }

  /** While on, dragging draws instead of panning/zooming the chart. */
  setDragMode(on: boolean) {
    if (on === this.dragMode || this.destroyed) return;
    this.dragMode = on;
    this.chart.applyOptions({ handleScroll: !on, handleScale: !on });
  }

  private destroyed = false;

  destroy() {
    this.destroyed = true;
    // remove() does not detach primitives; the countdown timer would keep redrawing the disposed chart.
    this.main?.detachPrimitive(this.drawings);
    this.main?.detachPrimitive(this.axisLabels);
    this.main?.detachPrimitive(this.liquidationBubbles);
    this.main?.detachPrimitive(this.patterns);
    this.chart.remove();
  }

  // ---------------- state sync ----------------

  update(s: ChartState) {
    // A new chart type or price-scale side recreates the price series and all indicators.
    const typeChanged = s.chartType !== this.chartType || s.settings.scalePosition !== this.side;
    if (typeChanged) {
      // Clear indicator panes first so removing the old price series cannot shift pane indices.
      this.clearIndicators();
      this.side = s.settings.scalePosition;
      this.createMainSeries(s.chartType);
    }
    this.intervalSeconds = INTERVAL_SECONDS[s.interval] ?? 3600;

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

    const settingsKey = `${JSON.stringify(s.settings)}|${s.interval}`;
    if (typeChanged || settingsKey !== this.settingsKey) {
      this.settingsKey = settingsKey;
      this.applySettings(s.settings);
    }
    this.axisLabels.setData(s.bars, {
      countdown: s.settings.countdown,
      highLow: s.settings.highLowLabels,
      lastPriceLabel: s.settings.lastPriceLabel,
      intervalSeconds: this.intervalSeconds,
      upColor: THEME.up,
      downColor: THEME.down,
    });

    this.drawings.setData(s.drawings, s.bars);
    this.liquidationBubbles.setData(s.settings.liveLiquidations ? this.liquidations : [], s.bars);
    if (s.markers !== this.markers || barsChanged) {
      this.markers = s.markers;
      this.applyMarkers();
    }
  }

  private createMainSeries(type: ChartType) {
    if (this.main) {
      this.main.detachPrimitive(this.drawings);
      this.main.detachPrimitive(this.axisLabels);
      this.main.detachPrimitive(this.liquidationBubbles);
      this.main.detachPrimitive(this.patterns);
      this.markersApi?.detach();
      this.chart.removeSeries(this.main);
    }
    const common = { priceLineVisible: true, lastValueVisible: true, priceScaleId: this.side };
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
    this.main.attachPrimitive(this.axisLabels);
    this.main.attachPrimitive(this.liquidationBubbles);
    this.main.attachPrimitive(this.patterns);
    this.markersApi = createSeriesMarkers(this.main, []);
  }

  private applySettings(st: ChartSettings) {
    const scale = { visible: true, borderColor: THEME.border };
    const hidden = { visible: false };
    const tz = resolveTimeZone(st.timeZone);
    const daily = this.intervalSeconds >= 86400;
    const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("de-DE", { timeZone: tz, ...o });
    const tick = {
      [TickMarkType.Year]: fmt({ year: "numeric" }),
      [TickMarkType.Month]: fmt({ month: "short" }),
      [TickMarkType.DayOfMonth]: fmt({ day: "numeric" }),
      [TickMarkType.Time]: fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
      [TickMarkType.TimeWithSeconds]: fmt({ hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }),
    };
    const crosshairFmt = fmt({
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "2-digit",
      ...(daily ? {} : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }),
      ...(st.showSeconds && !daily ? { second: "2-digit" as const } : {}),
    });
    const toDate = (t: Time) => new Date((t as number) * 1000);

    this.chart.applyOptions({
      rightPriceScale: this.side === "right" ? scale : hidden,
      leftPriceScale: this.side === "left" ? scale : hidden,
      grid: {
        vertLines: { visible: st.grid === "both" || st.grid === "vert", color: THEME.grid },
        horzLines: { visible: st.grid === "both" || st.grid === "horz", color: THEME.grid },
      },
      crosshair: { mode: st.crosshair === "magnet" ? CrosshairMode.Magnet : st.crosshair === "hidden" ? CrosshairMode.Hidden : CrosshairMode.Normal },
      timeScale: {
        secondsVisible: st.showSeconds,
        tickMarkFormatter: (t: Time, type: TickMarkType) => tick[type].format(toDate(t)),
      },
      localization: { locale: "de-DE", timeFormatter: (t: Time) => crosshairFmt.format(toDate(t)) },
    });
    // Scale mode and inversion only for the price pane; indicator panes stay linear.
    this.chart.priceScale(this.side, 0).applyOptions({
      mode: { normal: PriceScaleMode.Normal, log: PriceScaleMode.Logarithmic, percent: PriceScaleMode.Percentage, indexed: PriceScaleMode.IndexedTo100 }[st.scaleMode],
      invertScale: st.invertScale,
    });
    this.main?.applyOptions({ lastValueVisible: st.lastPriceLabel, priceLineVisible: st.lastPriceLine });
    this.onLayout();
  }

  /** Live liquidations to draw as bubbles (only when the setting is on). */
  setLiquidations(items: LiveLiquidation[], visible: boolean) {
    this.liquidations = items;
    this.liquidationBubbles.setData(visible ? items : [], this.bars);
  }

  /** Re-enables automatic price scaling (after the user dragged the scale). */
  autoScale() {
    this.chart.priceScale(this.side, 0).applyOptions({ autoScale: true });
  }

  /** Scrolls back to the latest candles and re-fits the price scale. */
  resetView() {
    const n = this.bars.length;
    this.chart.timeScale().setVisibleLogicalRange({ from: n - 160, to: n + 8 });
    this.autoScale();
  }

  priceScaleWidth(): number {
    if (this.destroyed) return 0;
    try {
      return this.chart.priceScale(this.side).width();
    } catch {
      // A freshly shown left scale has no axis widget until the next render.
      return 0;
    }
  }

  get scaleSide() {
    return this.side;
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
      if (b.profile) b.profile.host.detachPrimitive(b.profile.primitive);
      if (b.heatmap) b.heatmap.host.detachPrimitive(b.heatmap.primitive);
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
      let profile: BuiltIndicator["profile"];
      if (def.profile && series[0]) {
        profile = { primitive: new VolumeProfilePrimitive(), host: series[0] };
        series[0].attachPrimitive(profile.primitive);
      }
      let heatmap: BuiltIndicator["heatmap"];
      if (def.heatmap && series[0]) {
        heatmap = { primitive: new HeatmapPrimitive(), host: series[0] };
        series[0].attachPrimitive(heatmap.primitive);
      }
      this.built.push({ computed: { instance, def, params, outputs: {}, paneIndex }, series, bands, profile, heatmap });
    }

    const panes = this.chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? Math.max(2, panes.length) : 1));
    this.fillIndicators();
    this.onLayout();
  }

  private addOutputSeries(def: IndicatorDef, o: OutputDef, color: string, paneIndex: number, isVolume: boolean, hidden: boolean) {
    const base = {
      visible: !hidden,
      ...(o.noAutoscale ? { autoscaleInfoProvider: () => null } : {}),
      priceLineVisible: false,
      lastValueVisible: !def.overlay && !isVolume,
      title: "",
      priceScaleId: isVolume ? "volume" : this.side,
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
        const isLine = o.style !== "histogram" && o.style !== "dots";
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
          const next = values[i + 1];
          if (isLine && i + 1 < values.length && (next === null || !Number.isFinite(next))) {
            // A line segment takes the color of its start point; hide the one bridging a gap.
            point.color = "transparent";
          } else if (o.pointColor) {
            point.color = o.pointColor({ values, i, bar: bars[i], outputs, base: b.computed.instance.colors?.[k] ?? o.color });
          }
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
      if (b.profile) b.profile.primitive.setProfile(b.computed.instance.hidden ? null : (def.profile?.(bars, params) ?? null));
      if (b.heatmap) {
        const contrast = def.heatmapContrastKey ? params[def.heatmapContrastKey] : 1;
        b.heatmap.primitive.setHeatmap(b.computed.instance.hidden ? null : (def.heatmap?.(bars, params) ?? null), contrast);
      }
    }
    this.fillPatterns();
  }

  /** Candle patterns become series markers, formations are drawn by their primitive. */
  private fillPatterns() {
    const candles: CandlePattern[] = [];
    const formations: Formation[] = [];
    const zones: OrderBlock[] = [];
    const signals: OrderBlockSignal[] = [];
    for (const b of this.built) {
      const { def, params, instance } = b.computed;
      if (!def.patterns || instance.hidden) continue;
      const r = def.patterns(this.bars, params);
      candles.push(...r.candles);
      formations.push(...r.formations);
      zones.push(...(r.zones ?? []));
      signals.push(...(r.signals ?? []));
    }
    this.patterns.setFormations(formations);
    this.patterns.setZones(zones);
    const markers: SeriesMarker<Time>[] = candles.map((c) => ({
      time: ts(c.time),
      position: c.direction === "bullish" ? "belowBar" : "aboveBar",
      shape: c.direction === "bullish" ? "arrowUp" : c.direction === "bearish" ? "arrowDown" : "circle",
      color: c.direction === "bullish" ? THEME.up : c.direction === "bearish" ? THEME.down : "#787b86",
      text: c.name,
      size: 0.6,
    }));
    for (const sg of signals) {
      const buy = sg.side === "buy";
      markers.push({ time: ts(sg.time), position: buy ? "belowBar" : "aboveBar", shape: buy ? "arrowUp" : "arrowDown", color: buy ? "#00e676" : "#ff1744", text: `${buy ? "Buy" : "Sell"} ${sg.tf}` });
    }
    const key = JSON.stringify(markers);
    if (key === this.patternKey) return;
    this.patternKey = key;
    this.patternMarkers = markers;
    this.applyMarkers();
  }

  get computed(): ComputedIndicator[] {
    return this.built.map((b) => b.computed);
  }

  /** Top offset and height (CSS px) of every pane, for overlay legends. */
  paneLayout(): { top: number; height: number }[] {
    if (this.destroyed) return [];
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
    const own: SeriesMarker<Time>[] = this.markers
      .filter((m) => times.has(m.time))
      .map((m) => ({
        id: m.id,
        time: ts(m.time),
        position: m.position === "above" ? "aboveBar" : "belowBar",
        shape: m.shape,
        color: m.color,
        text: m.text,
      }));
    this.markersApi?.setMarkers([...own, ...this.patternMarkers].sort((a, b) => (a.time as number) - (b.time as number)));
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
