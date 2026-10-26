import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  PriceScaleMode,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Logical,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { displayBars, hollowStyle, isPriceDriven } from "../../shared/chartTypes";
import { alignCompare } from "../../shared/compare";
import { getIndicator, resolveParams, type IndicatorDef, type OutputDef } from "../../shared/indicators";
import { heikinAshi, type Bar, type Series } from "../../shared/math";
import { barIndexAt } from "../../shared/replay";
import { getExchange, tradingDays } from "../../shared/exchanges";
import { intervalSeconds, isCalendarInterval } from "../../shared/marketData";
import type { OrderBlock, OrderBlockSignal } from "../../shared/orderblocks";
import type { CandlePattern, Formation } from "../../shared/patterns";
import type { SessionBox, TimeLine } from "../../shared/sessions";
import type { StructureBreak } from "../../shared/structure";
import { resolveTimeZone, type ChartSettings } from "../chartSettings";
import type { ChartMarker, ChartState, ChartType, IndicatorInstance } from "../store";
import type { LiveLiquidation } from "../market/liquidationFeed";
import { AxisLabelsPrimitive } from "./AxisLabelsPrimitive";
import { BandFillPrimitive, type BandPoint } from "./BandFillPrimitive";
import { DrawingsPrimitive } from "./DrawingsPrimitive";
import { HeatmapPrimitive } from "./HeatmapPrimitive";
import { LiquidationBubblesPrimitive } from "./LiquidationBubblesPrimitive";
import { PatternsPrimitive } from "./PatternsPrimitive";
import { SessionsPrimitive, type SessionBand } from "./SessionsPrimitive";
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

export interface TradeLine {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
  /** Set on lines that can be dragged up and down (stop, target); reported back by `onTradeLineDrag`. */
  drag?: string;
}

export class ChartEngine {
  readonly chart: IChartApi;
  readonly drawings = new DrawingsPrimitive();
  private main: ISeriesApi<SeriesType> | null = null;
  private markersApi: ISeriesMarkersPluginApi<Time> | null = null;
  private chartType: ChartType | null = null;
  /** Candles as shown: Renko bricks or Line Break lines for those chart types, else the loaded candles. */
  private bars: Bar[] = [];
  private rawBars: Bar[] = [];
  private brickKey = "";
  private symbolKey = "";
  private indicatorKey = "";
  private built: BuiltIndicator[] = [];
  private markers: ChartMarker[] = [];
  private readonly axisLabels = new AxisLabelsPrimitive();
  private readonly liquidationBubbles = new LiquidationBubblesPrimitive();
  private readonly patterns = new PatternsPrimitive((t) => this.timeToXInterpolated(t));
  private readonly sessions = new SessionsPrimitive((t) => this.timeToXInterpolated(t));
  private exchangeIds: string[] = [];
  private sessionKey = "";
  private patternMarkers: SeriesMarker<Time>[] = [];
  private patternKey = "";
  private liquidations: LiveLiquidation[] = [];
  private side: "left" | "right" = "right";
  private settingsKey = "";
  private intervalSeconds = 3600;
  private interval = "1h";
  private tradeLines: TradeLine[] = [];
  private tradeLineApis: IPriceLine[] = [];
  private compareInput: { symbol: string; color: string; bars: Bar[] }[] = [];
  private compareSeries = new Map<string, { series: ISeriesApi<"Line">; side: string }>();
  private compareKey = "";
  private scaleSettings: ChartSettings | null = null;

  onCrosshair: (logical: number | null, point: PointerEvent | null) => void = () => {};
  onClick: (e: PointerEvent) => void = () => {};
  onLayout: () => void = () => {};
  /** Freehand drawing (brush): pointer down → moves → up, while chart panning is off. */
  onDrag: (phase: "start" | "move" | "end", e: PointerEvent) => void = () => {};
  private dragMode = false;
  /** Dragging a trade line to `price` ("cancel": the browser took the touch over, nothing to save). */
  onTradeLineDrag: (phase: "move" | "end" | "cancel", dragId: string, price: number) => void = () => {};
  /** Asked on pointer down: true takes the pointer to move a drawing (`touch`: finger or pen) instead of panning. */
  grabDrawing: (e: PointerEvent, touch: boolean) => boolean = () => false;
  /** Moving a grabbed drawing ("cancel": nothing to save). */
  onDrawingDrag: (phase: "move" | "end" | "cancel", e: PointerEvent | null) => void = () => {};
  /** Right click, or a long press with the finger; `e` is null outside the panes (price scale). */
  onContextMenu: (e: PointerEvent | null, clientX: number, clientY: number) => void = () => {};
  /** The user moved the crosshair to the candle at `time` (null: left the chart), for syncing other charts. */
  onCrosshairTime: (time: number | null) => void = () => {};
  /** The visible time range changed (scroll, zoom), for syncing other charts. */
  onVisibleTime: (from: number, to: number) => void = () => {};
  /** Set while another chart moves this one, so the change is not sent back. */
  private syncing = false;

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
      if (!this.syncing) this.onCrosshairTime(p.logical === undefined || !p.point ? null : this.logicalToTime(Math.round(p.logical)));
    });
    this.chart.timeScale().subscribeVisibleTimeRangeChange((r) => {
      if (r && !this.syncing) this.onVisibleTime(r.from as number, r.to as number);
    });
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.scheduleVisibleProfiles());
    // Own click detection: the library folds two quick clicks into a double
    // click, which would swallow the second point of a two-point drawing.
    let down: { x: number; y: number } | null = null;
    let dragging = false;
    const toEvent = (ev: { clientX: number; clientY: number }): PointerEvent | null => {
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
    // Trade lines (stop, target) are dragged with mouse or finger. The chart listens to mouse
    // and touch events, which come after the pointer event, so those are kept away from it.
    let lineDrag: { id: string; pointerId: number } | null = null;
    let drawingDrag: { pointerId: number } | null = null;
    // Long press (finger) opens the context menu, like a right click with the mouse.
    let press: { timer: number; x: number; y: number } | null = null;
    let pressedAt = 0;
    const cancelPress = () => {
      if (press) window.clearTimeout(press.timer);
      press = null;
    };
    const linePrice = (ev: globalThis.PointerEvent) => {
      const top = this.paneLayout()[0]?.top ?? 0;
      return this.main?.coordinateToPrice(ev.clientY - container.getBoundingClientRect().top - top) ?? null;
    };
    const keepFromChart = (ev: Event) => {
      if (!lineDrag && !drawingDrag) return;
      ev.stopPropagation();
      if (ev.cancelable) ev.preventDefault();
    };
    for (const type of ["mousedown", "touchstart", "touchmove"]) container.addEventListener(type, keepFromChart, { capture: true, passive: false });
    container.addEventListener("pointerdown", (ev) => {
      down = { x: ev.clientX, y: ev.clientY };
      cancelPress();
      if (ev.pointerType !== "mouse" && ev.isPrimary && !this.dragMode) {
        const at = { clientX: ev.clientX, clientY: ev.clientY };
        press = {
          x: ev.clientX,
          y: ev.clientY,
          timer: window.setTimeout(() => {
            press = null;
            down = null;
            pressedAt = Date.now();
            if (drawingDrag) {
              drawingDrag = null;
              container.classList.remove("drawing-dragging");
              this.onDrawingDrag("cancel", null);
            }
            this.onContextMenu(toEvent(at), at.clientX, at.clientY);
          }, 550),
        };
      }
      const hit = this.dragMode || ev.button > 0 ? null : this.tradeLineAt(ev.clientY - container.getBoundingClientRect().top, ev.pointerType === "mouse" ? 6 : 16);
      if (hit) {
        lineDrag = { id: hit, pointerId: ev.pointerId };
        down = null;
        container.setPointerCapture(ev.pointerId);
        container.classList.add("trade-line-dragging");
        return;
      }
      if (!this.dragMode) {
        const e = ev.button === 0 ? toEvent(ev) : null;
        if (e && e.paneIndex === 0 && this.grabDrawing(e, ev.pointerType !== "mouse")) {
          drawingDrag = { pointerId: ev.pointerId };
          container.setPointerCapture(ev.pointerId);
          container.classList.add("drawing-dragging");
        }
        return;
      }
      const e = toEvent(ev);
      if (!e || e.paneIndex !== 0) return;
      dragging = true;
      container.setPointerCapture(ev.pointerId);
      this.onDrag("start", e);
    });
    container.addEventListener("pointermove", (ev) => {
      if (press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) cancelPress();
      if (drawingDrag) {
        const e = ev.pointerId === drawingDrag.pointerId ? toEvent(ev) : null;
        if (e && e.paneIndex === 0) this.onDrawingDrag("move", e);
        return;
      }
      if (lineDrag) {
        const price = ev.pointerId === lineDrag.pointerId ? linePrice(ev) : null;
        if (price !== null && price > 0) this.onTradeLineDrag("move", lineDrag.id, price);
        return;
      }
      if (ev.pointerType === "mouse" && !this.dragMode)
        container.classList.toggle("trade-line-hover", this.tradeLineAt(ev.clientY - container.getBoundingClientRect().top, 6) !== null);
      if (!dragging) return;
      const e = toEvent(ev);
      if (e && e.paneIndex === 0) this.onDrag("move", e);
    });
    const endLineDrag = (ev: globalThis.PointerEvent, phase: "end" | "cancel") => {
      if (!lineDrag || ev.pointerId !== lineDrag.pointerId) return false;
      const { id } = lineDrag;
      lineDrag = null;
      container.classList.remove("trade-line-dragging");
      const price = linePrice(ev);
      this.onTradeLineDrag(phase === "end" && price !== null && price > 0 ? "end" : "cancel", id, price ?? 0);
      return true;
    };
    const endDrawingDrag = (ev: globalThis.PointerEvent, phase: "end" | "cancel") => {
      if (!drawingDrag || ev.pointerId !== drawingDrag.pointerId) return false;
      drawingDrag = null;
      container.classList.remove("drawing-dragging");
      const e = toEvent(ev);
      const moved = !!down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4;
      // A tap on a drawing without moving it is still a click (selects, opens position settings).
      this.onDrawingDrag(phase === "end" && moved && e ? "end" : "cancel", e);
      return moved;
    };
    container.addEventListener("pointercancel", (ev) => {
      cancelPress();
      if (endDrawingDrag(ev, "cancel")) return;
      endLineDrag(ev, "cancel");
    });
    container.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      // Some touch browsers send their own context menu event after the long press.
      if (Date.now() - pressedAt < 1000) return;
      this.onContextMenu(toEvent(ev), ev.clientX, ev.clientY);
    });
    container.addEventListener("pointerup", (ev) => {
      cancelPress();
      if (endDrawingDrag(ev, "end")) {
        down = null;
        return;
      }
      if (endLineDrag(ev, "end")) return;
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
    // Safari on the Mac reports a trackpad pinch as gesture events (Chrome sends ctrl+wheel,
    // which the chart handles itself): zoom the time axis around the fingers instead of the page.
    // On the iPad the chart gets the pinch as touches, so there it only stops the page zoom.
    let pinch: { from: number; to: number; anchor: number } | null = null;
    const onGesture = (ev: Event) => {
      ev.preventDefault();
      const g = ev as Event & { scale: number; clientX: number; type: string };
      if (navigator.maxTouchPoints > 0 || this.dragMode || this.destroyed) return;
      const ts = this.chart.timeScale();
      if (g.type === "gesturestart") {
        const range = ts.getVisibleLogicalRange();
        const x = g.clientX - container.getBoundingClientRect().left - (this.side === "left" ? this.priceScaleWidth() : 0);
        const anchor = ts.coordinateToLogical(Math.max(0, Math.min(ts.width(), x)));
        pinch = range && anchor !== null ? { from: range.from, to: range.to, anchor } : null;
      } else if (g.type === "gesturechange" && pinch && g.scale > 0) {
        const { from, to, anchor } = pinch;
        if ((to - from) / g.scale < 5) return;
        ts.setVisibleLogicalRange({ from: anchor - (anchor - from) / g.scale, to: anchor + (to - anchor) / g.scale });
      } else pinch = null;
    };
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) container.addEventListener(type, onGesture, { passive: false });
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
    this.main?.detachPrimitive(this.sessions);
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
    this.intervalSeconds = intervalSeconds(s.interval);
    this.interval = s.interval;

    const symbolKey = `${s.symbol}|${s.interval}`;
    const prev = this.rawBars;
    const brickKey = isPriceDriven(s.chartType) ? `${s.settings.renkoBox}|${s.settings.renkoAtr}|${s.settings.lineBreakLines}` : "";
    const barsChanged = s.bars !== prev || typeChanged || brickKey !== this.brickKey;
    // Bricks and lines can change anywhere on a new price, so they are always redrawn.
    const isTick =
      !typeChanged &&
      !brickKey &&
      symbolKey === this.symbolKey &&
      prev.length > 0 &&
      s.bars.length - prev.length <= 1 &&
      s.bars.length >= prev.length &&
      s.bars[0]?.time === prev[0]?.time;
    if (barsChanged) {
      this.rawBars = s.bars;
      this.brickKey = brickKey;
      this.bars = displayBars(s.bars, s.chartType, s.settings);
    }

    if (barsChanged) {
      if (isTick) this.tickMain();
      else this.setMainData();
      if ((symbolKey !== this.symbolKey || typeChanged) && this.bars.length > 0) {
        this.symbolKey = symbolKey;
        this.showDefaultRange();
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
    this.axisLabels.setData(this.bars, {
      // Months have no fixed length, so the countdown would be wrong there; bricks do not close on time.
      countdown: s.settings.countdown && !isCalendarInterval(s.interval) && !s.replay && !brickKey,
      highLow: s.settings.highLowLabels,
      lastPriceLabel: s.settings.lastPriceLabel,
      intervalSeconds: this.intervalSeconds,
      upColor: THEME.up,
      downColor: THEME.down,
    });

    this.drawings.setData(s.drawings, this.bars);
    this.refreshSessions();
    this.liquidationBubbles.setData(s.settings.liveLiquidations ? this.liquidations : [], this.bars);
    if (s.markers !== this.markers || barsChanged) {
      this.markers = s.markers;
      this.applyMarkers();
    }
    this.syncCompare();
  }

  /** Symbols drawn over the chart for comparison; the price scale shows percent while there are any. */
  setCompare(lines: { symbol: string; color: string; bars: Bar[] }[]) {
    this.compareInput = lines;
    this.syncCompare();
  }

  private syncCompare() {
    // Renko and Line Break have a made-up time axis, other symbols cannot be placed on it.
    const lines = this.chartType && isPriceDriven(this.chartType) ? [] : this.compareInput;
    const bars = this.bars;
    const last = (b: Bar[]) => b[b.length - 1];
    const key = [this.side, bars[0]?.time, last(bars)?.time, ...lines.map((l) => `${l.symbol}:${l.color}:${l.bars.length}:${last(l.bars)?.time}:${last(l.bars)?.close}`)].join("|");
    if (key === this.compareKey) return;
    this.compareKey = key;
    const hadLines = this.compareSeries.size > 0;
    for (const [symbol, c] of this.compareSeries) {
      if (c.side === this.side && lines.some((l) => l.symbol === symbol)) continue;
      this.chart.removeSeries(c.series);
      this.compareSeries.delete(symbol);
    }
    for (const l of lines) {
      let c = this.compareSeries.get(l.symbol);
      if (!c) {
        const series = this.chart.addSeries(LineSeries, { color: l.color, lineWidth: 2, priceScaleId: this.side, title: l.symbol, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false }, 0);
        c = { series, side: this.side };
        this.compareSeries.set(l.symbol, c);
      }
      c.series.applyOptions({ color: l.color });
      c.series.setData(alignCompare(bars, l.bars).map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    }
    if (hadLines !== this.compareSeries.size > 0) this.applyScaleMode();
  }

  private createMainSeries(type: ChartType) {
    if (this.main) {
      this.main.detachPrimitive(this.drawings);
      this.main.detachPrimitive(this.axisLabels);
      this.main.detachPrimitive(this.liquidationBubbles);
      this.main.detachPrimitive(this.patterns);
      this.main.detachPrimitive(this.sessions);
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
      case "step_line":
        this.main = this.chart.addSeries(LineSeries, { ...common, color: "#2962ff", lineWidth: 2, lineType: LineType.WithSteps });
        break;
      case "baseline":
        // Green above, red below the base level (set from the data in setMainData).
        this.main = this.chart.addSeries(BaselineSeries, {
          ...common,
          topLineColor: THEME.up,
          topFillColor1: "rgba(38,166,154,0.28)",
          topFillColor2: "rgba(38,166,154,0.05)",
          bottomLineColor: THEME.down,
          bottomFillColor1: "rgba(239,83,80,0.05)",
          bottomFillColor2: "rgba(239,83,80,0.28)",
          lineWidth: 2,
        });
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
    this.main.attachPrimitive(this.sessions);
    this.markersApi = createSeriesMarkers(this.main, []);
    // Price lines belong to the series; the new one gets them again.
    this.tradeLineApis = [];
    this.drawTradeLines();
  }

  /** Demo-account positions: entry, stop-loss and take-profit as labelled price lines. */
  setTradeLines(lines: TradeLine[]) {
    const key = (l: TradeLine[]) => l.map((x) => `${x.price}|${x.color}|${x.title}|${x.dashed}|${x.drag}`).join(";");
    if (key(lines) === key(this.tradeLines)) return;
    this.tradeLines = lines;
    this.drawTradeLines();
  }

  /** The draggable trade line within `tolerance` px of `y` (from the chart's top), the closest one. */
  private tradeLineAt(y: number, tolerance: number): string | null {
    if (!this.main) return null;
    const top = this.paneLayout()[0]?.top ?? 0;
    let best: string | null = null;
    let bestDist = tolerance;
    for (const l of this.tradeLines) {
      const ly = l.drag ? this.main.priceToCoordinate(l.price) : null;
      if (ly === null || Math.abs(ly + top - y) > bestDist) continue;
      bestDist = Math.abs(ly + top - y);
      best = l.drag!;
    }
    return best;
  }

  private drawTradeLines() {
    if (!this.main || this.destroyed) return;
    for (const l of this.tradeLineApis) this.main.removePriceLine(l);
    this.tradeLineApis = this.tradeLines.map((l) =>
      this.main!.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: l.title }),
    );
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
    this.scaleSettings = st;
    this.applyScaleMode();
    this.main?.applyOptions({ lastValueVisible: st.lastPriceLabel, priceLineVisible: st.lastPriceLine });
    this.onLayout();
  }

  /** Scale mode and inversion only for the price pane; indicator panes stay linear. Compared symbols need percent (or indexed). */
  private applyScaleMode() {
    const st = this.scaleSettings;
    if (!st) return;
    const mode = this.compareSeries.size > 0 && (st.scaleMode === "normal" || st.scaleMode === "log") ? "percent" : st.scaleMode;
    this.chart.priceScale(this.side, 0).applyOptions({
      mode: { normal: PriceScaleMode.Normal, log: PriceScaleMode.Logarithmic, percent: PriceScaleMode.Percentage, indexed: PriceScaleMode.IndexedTo100 }[mode],
      invertScale: st.invertScale,
    });
  }

  /** Exchanges whose trading sessions are shaded behind the candles. */
  setExchanges(ids: string[]) {
    this.exchangeIds = ids;
    this.refreshSessions();
  }

  /** Like drawings.timeToX, but between bars (logicalToCoordinate gives 0 for some fractional logicals). */
  private timeToXInterpolated(time: number): number | null {
    const logical = this.drawings.timeToLogical(time);
    if (logical === null) return null;
    const scale = this.chart.timeScale();
    const lo = Math.floor(logical);
    const xa = scale.logicalToCoordinate(lo as Logical);
    const xb = scale.logicalToCoordinate((lo + 1) as Logical);
    return xa === null || xb === null ? null : xa + (xb - xa) * (logical - lo);
  }

  private refreshSessions() {
    const bars = this.bars;
    // Daily and weekly candles already are whole sessions.
    // Renko and Line Break have no regular time axis to lay sessions on.
    const intraday = this.intervalSeconds < 86400 && bars.length > 1 && !this.brickKey;
    const from = intraday ? bars[0].time : 0;
    // A bit beyond the last candle so the next open is visible in the right margin.
    const to = intraday ? bars[bars.length - 1].time + Math.max(86400, 40 * this.intervalSeconds) : 0;
    const key = intraday ? `${this.exchangeIds.join(",")}|${from}|${Math.floor(to / 3600)}` : "";
    if (key === this.sessionKey) return;
    this.sessionKey = key;
    const bands: SessionBand[] = [];
    if (intraday) {
      this.exchangeIds.forEach((id, row) => {
        const ex = getExchange(id);
        if (!ex) return;
        for (const day of tradingDays(ex, from, to)) {
          day.parts.forEach((p, i) =>
            bands.push({
              start: p.start,
              end: p.end,
              color: ex.color,
              label: i === 0 ? ex.short : undefined,
              row,
              openEdge: i === 0,
              closeEdge: i === day.parts.length - 1,
            }),
          );
        }
      });
    }
    this.sessions.setBands(bands);
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
    this.showDefaultRange();
    this.autoScale();
  }

  /** The latest ~160 candles; "all" shows the whole history, short histories keep a readable candle width. */
  private showDefaultRange() {
    const n = this.bars.length;
    const from = this.interval === "all" ? -1 : n - Math.max(40, Math.min(160, n + 2));
    this.chart.timeScale().setVisibleLogicalRange({ from, to: n + (this.interval === "all" ? 2 : 8) });
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

  private toMainPoint(bars: Bar[], i: number) {
    const b = bars[i];
    const t = this.chartType;
    if (t === "line" || t === "area" || t === "step_line" || t === "baseline") return { time: ts(b.time), value: b.close };
    const ohlc = { time: ts(b.time), open: b.open, high: b.high, low: b.low, close: b.close };
    return t === "hollow_candles" ? { ...ohlc, ...hollowStyle(bars, i, THEME.up, THEME.down) } : ohlc;
  }

  private setMainData() {
    const bars = this.displayBars();
    if (this.chartType === "baseline" && bars.length) {
      // Like TradingView's default base level: the price at the start of the view, here ~160 candles back.
      this.main?.applyOptions({ baseValue: { type: "price", price: bars[Math.max(0, bars.length - 160)].close } });
    }
    this.main?.setData(bars.map((_, i) => this.toMainPoint(bars, i)));
  }

  private tickMain() {
    const bars = this.displayBars();
    if (bars.length) this.main?.update(this.toMainPoint(bars, bars.length - 1));
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
      // Profiles without lines of their own (visible range, sessions, TPO) hang on the price series.
      const profileHost = series[0] ?? (def.overlay ? this.main : null);
      if (def.profile && profileHost) {
        profile = { primitive: new VolumeProfilePrimitive(def.profileAnchor ?? "right", def.outputs.length === 0), host: profileHost };
        profileHost.attachPrimitive(profile.primitive);
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
      visible: !hidden && !o.helper,
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

  /** Bar indices on screen (all bars before the first layout). */
  private visibleBars(): { from: number; to: number } {
    const r = this.chart.timeScale().getVisibleLogicalRange();
    const last = this.bars.length - 1;
    if (!r) return { from: 0, to: last };
    return { from: Math.max(0, Math.ceil(r.from)), to: Math.min(last, Math.floor(r.to)) };
  }

  private visibleFrame = 0;

  /** Visible-range profiles follow scrolling and zooming, at most once per frame. */
  private scheduleVisibleProfiles() {
    if (this.visibleFrame || !this.built.some((b) => b.profile && b.computed.def.visibleRange)) return;
    this.visibleFrame = requestAnimationFrame(() => {
      this.visibleFrame = 0;
      if (this.destroyed) return;
      const view = this.visibleBars();
      for (const b of this.built) {
        const { def, params, instance } = b.computed;
        if (b.profile && def.visibleRange) b.profile.primitive.setProfile(instance.hidden ? null : (def.profile?.(this.bars, params, view) ?? null));
      }
    });
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
      if (b.profile) b.profile.primitive.setProfile(b.computed.instance.hidden ? null : (def.profile?.(bars, params, this.visibleBars()) ?? null));
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
    const structure: StructureBreak[] = [];
    const sessions: SessionBox[] = [];
    const timeLines: TimeLine[] = [];
    for (const b of this.built) {
      const { def, params, instance } = b.computed;
      if (!def.patterns || instance.hidden) continue;
      const r = def.patterns(this.bars, params);
      candles.push(...r.candles);
      formations.push(...r.formations);
      zones.push(...(r.zones ?? []));
      signals.push(...(r.signals ?? []));
      structure.push(...(r.structure ?? []));
      sessions.push(...(r.sessions ?? []));
      timeLines.push(...(r.timeLines ?? []));
    }
    this.patterns.setFormations(formations);
    this.patterns.setZones(zones);
    this.patterns.setStructure(structure);
    this.patterns.setSessions(sessions, timeLines);
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

  /** Shows the crosshair at the candle containing `time` (from another chart); null hides it. */
  showCrosshairAt(time: number | null) {
    if (this.destroyed || !this.main) return;
    this.syncing = true;
    try {
      const i = time === null ? -1 : barIndexAt(this.bars, time);
      if (i < 0) this.chart.clearCrosshairPosition();
      else this.chart.setCrosshairPosition(this.bars[i].close, this.bars[i].time as UTCTimestamp, this.main);
    } finally {
      this.syncing = false;
    }
  }

  /** Scrolls and zooms to the same time range as another chart. */
  showTimeRange(from: number, to: number) {
    if (this.destroyed || this.bars.length < 2 || !(to > from)) return;
    this.syncing = true;
    try {
      this.chart.timeScale().setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp });
    } catch {
      // range outside the loaded candles
    } finally {
      // The library reports the change on the next frame.
      requestAnimationFrame(() => (this.syncing = false));
    }
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
