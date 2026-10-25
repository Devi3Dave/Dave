import { useEffect, useRef, useState } from "react";
import { indicatorLabel } from "../../shared/indicators";
import { ChartEngine, type ComputedIndicator, type PointerEvent } from "../chart/ChartEngine";
import { demo, dropLevel, tradeLinesFor, type LineDraft } from "../demoAccount";
import { getSelectedExchanges, subscribeExchanges } from "../exchangeSelection";
import { liquidationFeed } from "../market/liquidationFeed";
import { DEFAULT_FIBEXT_LEVELS, DEFAULT_FIB_LEVELS, formatPrice } from "../chart/DrawingsPrimitive";
import { placeOnSide } from "../../shared/position";
import { addDrawing, newId, removeDrawing, removeIndicator, updateIndicator, updateSettings, useChart, type ChartStore, type Drawing, type Point } from "../store";
import { lastPositionDefaults } from "./PositionDialog";

interface Props {
  chart: ChartStore;
  onEngine: (slot: number, engine: ChartEngine | null) => void;
  magnet: boolean;
  onEditIndicator: (id: string) => void;
  onEditPosition: (id: string) => void;
}

/** Clicks needed per multi-point tool. */
const POINT_COUNT: Record<string, number> = { trendline: 2, ray: 2, zone: 2, fib: 2, measure: 2, fibext: 3, channel: 3 };

/** Step hints for tools that need more than the obvious two taps. */
const STEP_HINTS: Record<string, string[]> = {
  fibext: ["Start der Bewegung antippen (z. B. Swing-Tief)", "Ende der Bewegung antippen (Swing-Hoch)", "Ende des Rücksetzers antippen"],
  channel: ["Start der Kanallinie antippen", "Ende der Kanallinie antippen", "Breite des Kanals antippen"],
  measure: ["Startpunkt antippen", "Endpunkt antippen"],
  brush: ["Mit gedrücktem Finger / gedrückter Maus zeichnen"],
};
const POSITION_TOOLS = new Set(["long", "short"]);

const POSITION_HINTS = ["Einstieg antippen", "Stop-Loss antippen", "Take-Profit antippen (auch Ende der Zeitspanne)"];

/** Position drawn while placing: entry fixed, then stop, then target follow the pointer. */
/** Clicked prices rounded to a sensible tick (2 decimals above 1000, 4 above 1, else 6). */
function roundPrice(p: number): number {
  const digits = Math.abs(p) >= 1000 ? 2 : Math.abs(p) >= 1 ? 4 : 6;
  return Number(p.toFixed(digits));
}

function positionDraft(chart: ChartStore, side: "long" | "short", entry: Point, stop: number | null, cursor: Point): Drawing {
  const bars = chart.get().bars;
  const step = bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 60;
  const s = stop ?? placeOnSide(side, entry.price, cursor.price, "stop");
  const risk = Math.abs(entry.price - s);
  const target = stop === null ? entry.price + (side === "long" ? 2 : -2) * risk : placeOnSide(side, entry.price, cursor.price, "target");
  const to = stop !== null && cursor.time > entry.time + step ? cursor.time : entry.time + 20 * step;
  return {
    id: newId("user-pos"),
    author: "user",
    kind: "position",
    color: side === "long" ? "#089981" : "#f23645",
    side,
    entry: roundPrice(entry.price),
    stop: roundPrice(s),
    target: roundPrice(target),
    from: entry.time,
    to,
    ...lastPositionDefaults(),
  };
}

function makeDrawing(tool: string, pts: Point[]): Drawing | null {
  const base = { id: newId("user"), author: "user" as const };
  const a = pts[0];
  const b = pts[1] ?? a;
  switch (tool) {
    case "fibext":
      return { ...base, kind: "fibext", a, b, c: pts[2] ?? b, levels: DEFAULT_FIBEXT_LEVELS, color: "auto" };
    case "channel": {
      // Offset of the third tap from the base line, measured at its time.
      const c = pts[2];
      const onLine = c && b.time !== a.time ? a.price + ((b.price - a.price) * (c.time - a.time)) / (b.time - a.time) : a.price;
      return { ...base, kind: "channel", a, b, offset: c ? c.price - onLine : 0, color: "#2962ff" };
    }
    case "measure":
      return { ...base, kind: "measure", a, b, color: "#2962ff" };
    case "trendline":
    case "ray":
      return { ...base, kind: "trendline", a, b, extend: tool === "ray" ? "right" : "none", color: "#2962ff", style: "solid", width: 2 };
    case "zone":
      return {
        ...base,
        kind: "zone",
        top: Math.max(a.price, b.price),
        bottom: Math.min(a.price, b.price),
        from: Math.min(a.time, b.time),
        to: Math.max(a.time, b.time),
        extendRight: false,
        color: "#2962ff",
      };
    case "fib":
      return { ...base, kind: "fib", a, b, levels: DEFAULT_FIB_LEVELS, color: "auto" };
  }
  return null;
}

export function ChartArea({ chart, onEngine, magnet, onEditIndicator, onEditPosition }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const pendingRef = useRef<Point[]>([]);
  const strokeRef = useRef<{ points: Point[]; x: number; y: number } | null>(null);
  const firstClickRef = useRef<{ x: number; y: number } | null>(null);
  const positionRef = useRef<{ entry: Point; stop: number | null } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  /** Why a dragged stop/target line was not saved; shown for a few seconds. */
  const [lineError, setLineError] = useState<string | null>(null);
  const editPositionRef = useRef(onEditPosition);
  editPositionRef.current = onEditPosition;
  const magnetRef = useRef(magnet);
  magnetRef.current = magnet;
  const [hover, setHover] = useState<number | null>(null);
  const [layout, setLayout] = useState<{ top: number; height: number }[]>([]);
  const [scale, setScale] = useState<{ side: "left" | "right"; width: number }>({ side: "right", width: 0 });
  const scaleMode = useChart(chart, (s) => s.settings.scaleMode);
  const [computed, setComputed] = useState<ComputedIndicator[]>([]);

  const { symbol, interval, bars, source, tool, loading, error } = useChart(chart, (s) => s);

  useEffect(() => {
    const engine = new ChartEngine(containerRef.current!);
    engineRef.current = engine;
    const refreshLayout = () => {
      // A frame queued before the chart was removed (layout change) must not touch the disposed chart.
      if (engineRef.current !== engine) return;
      setLayout(engine.paneLayout());
      setComputed(engine.computed);
      setScale({ side: engine.scaleSide, width: engine.priceScaleWidth() });
    };
    engine.onLayout = () => requestAnimationFrame(refreshLayout);

    const pointAt = (e: PointerEvent): Point | null => {
      const time = engine.logicalToTime(e.logical);
      let price = engine.priceAt(e.y);
      if (time === null || price === null) return null;
      if (magnetRef.current) price = engine.snapPrice(e.logical, price, e.y);
      return { time, price };
    };

    engine.onCrosshair = (logical, e) => {
      setHover(logical);
      const pending = pendingRef.current;
      const currentTool = chart.get().tool;
      const pos = positionRef.current;
      if (pos && e && e.paneIndex === 0 && (currentTool === "long" || currentTool === "short")) {
        const p = pointAt(e);
        if (p) engine.drawings.setPreview(positionDraft(chart, currentTool, pos.entry, pos.stop, p));
      }
      if (pending.length && e && e.paneIndex === 0) {
        const p = pointAt(e);
        if (p) engine.drawings.setPreview(makeDrawing(currentTool, [...pending, p]));
      }
    };

    engine.onClick = (e) => {
      const currentTool = chart.get().tool;
      if (e.paneIndex !== 0) return;
      if (currentTool === "cursor") {
        // Tapping a long/short position opens its settings.
        const { width, height } = engine.paneSize();
        const id = engine.drawings.findAt(e.x, e.y, width, height);
        if (id && chart.get().drawings.find((d) => d.id === id)?.kind === "position") editPositionRef.current(id);
        return;
      }
      if (currentTool === "erase") {
        const { width, height } = engine.paneSize();
        const id = engine.drawings.findAt(e.x, e.y, width, height);
        if (id) removeDrawing(id);
        return;
      }
      const p = pointAt(e);
      if (!p) return;
      const done = (d: Drawing) => {
        addDrawing(d);
        pendingRef.current = [];
        positionRef.current = null;
        setHint(null);
        engine.drawings.setPreview(null);
        chart.set({ tool: "cursor" });
      };
      if (currentTool === "hline") return done({ id: newId("user"), author: "user", kind: "hline", price: p.price, color: "#ff9800", style: "solid" });
      if (currentTool === "vline") return done({ id: newId("user"), author: "user", kind: "vline", time: p.time, color: "#787b86" });
      if (currentTool === "text") {
        const text = window.prompt("Text:");
        if (text) done({ id: newId("user"), author: "user", kind: "text", at: p, text, color: "#d1d4dc" });
        return;
      }
      if (currentTool === "long" || currentTool === "short") {
        const pos = positionRef.current;
        if (!pos) {
          positionRef.current = { entry: p, stop: null };
          firstClickRef.current = { x: e.x, y: e.y };
          setHint(POSITION_HINTS[1]);
          return;
        }
        const first = firstClickRef.current;
        if (first && Math.hypot(first.x - e.x, first.y - e.y) < 4) return;
        firstClickRef.current = { x: e.x, y: e.y };
        if (pos.stop === null) {
          pos.stop = placeOnSide(currentTool, pos.entry.price, p.price, "stop");
          setHint(POSITION_HINTS[2]);
          return;
        }
        const d = positionDraft(chart, currentTool, pos.entry, pos.stop, p);
        done(d);
        editPositionRef.current(d.id);
        return;
      }
      const needed = POINT_COUNT[currentTool];
      if (needed) {
        const last = firstClickRef.current;
        if (pendingRef.current.length && last && Math.hypot(last.x - e.x, last.y - e.y) < 4) return;
        pendingRef.current = [...pendingRef.current, p];
        firstClickRef.current = { x: e.x, y: e.y };
        if (pendingRef.current.length < needed) {
          setHint(STEP_HINTS[currentTool]?.[pendingRef.current.length] ?? null);
          return;
        }
        const d = makeDrawing(currentTool, pendingRef.current);
        if (d) done(d);
      }
    };

    // Brush: freehand strokes while the tool is active (chart panning is off meanwhile).
    engine.onDrag = (phase, e) => {
      const time = engine.logicalToTime(e.logical);
      const price = engine.priceAt(e.y);
      const stroke = strokeRef.current;
      if (phase === "start") {
        strokeRef.current = time !== null && price !== null ? { points: [{ time, price }], x: e.x, y: e.y } : null;
        return;
      }
      if (!stroke) return;
      if (time !== null && price !== null && Math.hypot(e.x - stroke.x, e.y - stroke.y) >= 3) {
        stroke.points.push({ time, price });
        stroke.x = e.x;
        stroke.y = e.y;
      }
      const d: Drawing = { id: newId("user-path"), author: "user", kind: "path", points: stroke.points.slice(), width: 2, color: "#f7c948" };
      if (phase === "move") engine.drawings.setPreview(d);
      else {
        strokeRef.current = null;
        engine.drawings.setPreview(null);
        if (d.kind === "path" && d.points.length > 1) addDrawing(d);
      }
    };

    engine.update(chart.get());
    refreshLayout();
    const unsubscribe = chart.subscribe(() => {
      engine.update(chart.get());
      const t = chart.get().tool;
      engine.setDragMode(t === "brush");
      if (!POINT_COUNT[t]) pendingRef.current = [];
      if (!POSITION_TOOLS.has(t)) positionRef.current = null;
      if (!POINT_COUNT[t] && !POSITION_TOOLS.has(t) && !strokeRef.current) engine.drawings.setPreview(null);
      setHint(
        POSITION_TOOLS.has(t)
          ? POSITION_HINTS[positionRef.current ? (positionRef.current.stop === null ? 1 : 2) : 0]
          : (STEP_HINTS[t]?.[pendingRef.current.length] ?? null),
      );
    });
    // The feed follows the active chart's symbol; other charts must not show its liquidations.
    const pushLiquidations = () => {
      const feed = liquidationFeed.get();
      engine.setLiquidations(feed.symbol === chart.get().symbol ? feed.items : [], chart.get().settings.liveLiquidations);
    };
    const unsubscribeLiq = liquidationFeed.subscribe(pushLiquidations);
    // Open demo positions of this chart's symbol.
    // A stop or target line being dragged: shown at the finger, saved on release.
    let lineDraft: LineDraft | null = null;
    const pushTradeLines = () => engine.setTradeLines(tradeLinesFor(chart.get().symbol, lineDraft));
    let lineErrorTimer = 0;
    engine.onTradeLineDrag = (phase, dragId, price) => {
      lineDraft = phase === "move" ? { dragId, price } : null;
      const err = phase === "end" ? dropLevel(dragId, price) : null;
      pushTradeLines();
      if (phase === "move") return;
      window.clearTimeout(lineErrorTimer);
      setLineError(err);
      if (err) lineErrorTimer = window.setTimeout(() => setLineError(null), 4000);
    };
    pushTradeLines();
    const unsubscribeDemo = demo.subscribe(pushTradeLines);
    const unsubscribeDemoChart = chart.subscribe(pushTradeLines);
    engine.setExchanges(getSelectedExchanges());
    const unsubscribeExchanges = subscribeExchanges(() => engine.setExchanges(getSelectedExchanges()));
    const ro = new ResizeObserver(() => requestAnimationFrame(refreshLayout));
    ro.observe(containerRef.current!);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        pendingRef.current = [];
        positionRef.current = null;
        engine.drawings.setPreview(null);
        chart.set({ tool: "cursor" });
      }
    };
    window.addEventListener("keydown", onKey);
    onEngine(chart.slot, engine);
    if (import.meta.env.DEV && chart.slot === 0) Object.assign(window, { __chartEngine: engine, __store: chart });

    return () => {
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
      unsubscribe();
      unsubscribeLiq();
      unsubscribeExchanges();
      unsubscribeDemo();
      unsubscribeDemoChart();
      window.clearTimeout(lineErrorTimer);
      onEngine(chart.slot, null);
      engine.destroy();
      engineRef.current = null;
    };
  }, [onEngine, chart]);

  // Pane heights change when indicators are added; re-measure on hover too (pane drag-resizing has no event).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setLayout(engine.paneLayout());
    setComputed(engine.computed);
    setScale({ side: engine.scaleSide, width: engine.priceScaleWidth() });
  }, [hover, bars]);

  const idx = hover !== null && hover >= 0 && hover < bars.length ? hover : bars.length - 1;
  const bar = bars[idx];
  const prev = bars[idx - 1];
  const change = bar && prev ? ((bar.close - prev.close) / prev.close) * 100 : 0;
  const up = bar ? bar.close >= bar.open : true;

  const legendFor = (paneIndex: number) =>
    computed
      .filter((c) => c.paneIndex === paneIndex)
      .map((c) => (
        <div className="legend-row indicator" key={c.instance.id}>
          <span className={`legend-name ${c.instance.hidden ? "muted" : ""}`}>
            {indicatorLabel(c.def, c.params)}
            {c.instance.author === "claude" && <span className="by-claude" data-tip="Von Claude hinzugefügt">✦</span>}
          </span>
          {!c.instance.hidden &&
            c.def.outputs.map((o, k) => {
              const v = c.outputs[o.key]?.[idx];
              return v === null || v === undefined ? null : (
                <span key={o.key} style={{ color: c.instance.colors?.[k] ?? o.color }}>
                  {formatPrice(v)}
                </span>
              );
            })}
          <span className="legend-actions">
            <button data-tip={c.instance.hidden ? "Einblenden" : "Ausblenden"} aria-label={c.instance.hidden ? "Einblenden" : "Ausblenden"} onClick={() => updateIndicator(c.instance.id, { hidden: !c.instance.hidden })}>
              {c.instance.hidden ? "◌" : "◉"}
            </button>
            <button data-tip="Einstellungen: Parameter und Farben" aria-label="Einstellungen" onClick={() => onEditIndicator(c.instance.id)}>
              ⚙
            </button>
            <button data-tip="Indikator entfernen" aria-label="Entfernen" onClick={() => removeIndicator(c.instance.id)}>
              ✕
            </button>
          </span>
        </div>
      ));

  return (
    <div className={`chart-area tool-${tool}`}>
      <div ref={containerRef} className="chart-container" />
      {layout.map((pane, i) => (
        <div key={i} className="legend" style={{ top: pane.top + 6, left: scale.side === "left" ? scale.width + 8 : 8 }}>
          {i === 0 && (
            <div className="legend-row main">
              <span className="legend-symbol">
                {symbol} · {interval} · {source === "demo" ? "DEMO-DATEN" : source === "binance_futures" ? "BINANCE PERP" : source?.toUpperCase()}
              </span>
              {bar && (
                <span className={up ? "up" : "down"}>
                  O {formatPrice(bar.open)} H {formatPrice(bar.high)} L {formatPrice(bar.low)} C {formatPrice(bar.close)}{" "}
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </span>
              )}
            </div>
          )}
          {legendFor(i)}
        </div>
      ))}
      {layout[0] && (
        <div
          className="scale-bar"
          style={{ top: layout[0].top + layout[0].height - 28, ...(scale.side === "right" ? { right: scale.width + 6 } : { right: 6 }) }}
        >
          <button
            className={scaleMode === "log" ? "active" : ""}
            onClick={() => updateSettings({ scaleMode: scaleMode === "log" ? "normal" : "log" })}
            data-tip={"Logarithmische Skala ein/aus\nGleiche Prozentbewegungen sind gleich hoch"}
          >
            log
          </button>
          <button
            className={scaleMode === "percent" ? "active" : ""}
            onClick={() => updateSettings({ scaleMode: scaleMode === "percent" ? "normal" : "percent" })}
            data-tip={"Prozent-Skala ein/aus\nVeränderung ab der ersten sichtbaren Kerze"}
          >
            %
          </button>
          <button onClick={() => engineRef.current?.autoScale()} data-tip={"Auto-Skalierung\nPreisachse wieder an die sichtbaren Kerzen anpassen"}>
            A
          </button>
          <button onClick={() => engineRef.current?.resetView()} data-tip={"Ansicht zurücksetzen\nZu den neuesten Kerzen springen"}>
            ⟲
          </button>
        </div>
      )}
      {hint && <div className="draw-hint">{hint} · Esc bricht ab</div>}
      {lineError && !hint && <div className="draw-hint error">{lineError}</div>}
      {loading && <div className="chart-overlay">Lade {symbol} …</div>}
      {error && <div className="chart-overlay error">Fehler: {error}</div>}
    </div>
  );
}
