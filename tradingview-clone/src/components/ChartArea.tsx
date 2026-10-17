import { useEffect, useRef, useState } from "react";
import { indicatorLabel } from "../../shared/indicators";
import { ChartEngine, type ComputedIndicator, type PointerEvent } from "../chart/ChartEngine";
import { DEFAULT_FIB_LEVELS, formatPrice } from "../chart/DrawingsPrimitive";
import { addDrawing, newId, removeDrawing, removeIndicator, store, updateIndicator, useChartState, type Drawing, type Point } from "../store";

interface Props {
  onEngine: (engine: ChartEngine | null) => void;
  magnet: boolean;
  onEditIndicator: (id: string) => void;
}

const TWO_POINT_TOOLS = new Set(["trendline", "ray", "zone", "fib"]);

function makeDrawing(tool: string, a: Point, b: Point): Drawing | null {
  const base = { id: newId("user"), author: "user" as const };
  switch (tool) {
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

export function ChartArea({ onEngine, magnet, onEditIndicator }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const pendingRef = useRef<Point | null>(null);
  const firstClickRef = useRef<{ x: number; y: number } | null>(null);
  const magnetRef = useRef(magnet);
  magnetRef.current = magnet;
  const [hover, setHover] = useState<number | null>(null);
  const [layout, setLayout] = useState<{ top: number; height: number }[]>([]);
  const [computed, setComputed] = useState<ComputedIndicator[]>([]);

  const { symbol, interval, bars, source, tool, loading, error } = useChartState((s) => s);

  useEffect(() => {
    const engine = new ChartEngine(containerRef.current!);
    engineRef.current = engine;
    const refreshLayout = () => {
      setLayout(engine.paneLayout());
      setComputed(engine.computed);
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
      const currentTool = store.get().tool;
      if (pending && e && e.paneIndex === 0) {
        const p = pointAt(e);
        if (p) engine.drawings.setPreview(makeDrawing(currentTool, pending, p));
      }
    };

    engine.onClick = (e) => {
      const currentTool = store.get().tool;
      if (currentTool === "cursor" || e.paneIndex !== 0) return;
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
        pendingRef.current = null;
        engine.drawings.setPreview(null);
        store.set({ tool: "cursor" });
      };
      if (currentTool === "hline") return done({ id: newId("user"), author: "user", kind: "hline", price: p.price, color: "#ff9800", style: "solid" });
      if (currentTool === "vline") return done({ id: newId("user"), author: "user", kind: "vline", time: p.time, color: "#787b86" });
      if (currentTool === "text") {
        const text = window.prompt("Text:");
        if (text) done({ id: newId("user"), author: "user", kind: "text", at: p, text, color: "#d1d4dc" });
        return;
      }
      if (TWO_POINT_TOOLS.has(currentTool)) {
        if (!pendingRef.current) {
          pendingRef.current = p;
          firstClickRef.current = { x: e.x, y: e.y };
          return;
        }
        const first = firstClickRef.current;
        if (first && Math.hypot(first.x - e.x, first.y - e.y) < 4) return;
        const d = makeDrawing(currentTool, pendingRef.current, p);
        if (d) done(d);
      }
    };

    engine.update(store.get());
    refreshLayout();
    const unsubscribe = store.subscribe(() => {
      engine.update(store.get());
      if (!store.get().tool || !TWO_POINT_TOOLS.has(store.get().tool)) {
        pendingRef.current = null;
        engine.drawings.setPreview(null);
      }
    });
    const ro = new ResizeObserver(() => requestAnimationFrame(refreshLayout));
    ro.observe(containerRef.current!);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        pendingRef.current = null;
        engine.drawings.setPreview(null);
        store.set({ tool: "cursor" });
      }
    };
    window.addEventListener("keydown", onKey);
    onEngine(engine);
    if (import.meta.env.DEV) Object.assign(window, { __chartEngine: engine, __store: store });

    return () => {
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
      unsubscribe();
      onEngine(null);
      engine.destroy();
      engineRef.current = null;
    };
  }, [onEngine]);

  // Pane heights change when indicators are added; re-measure on hover too (pane drag-resizing has no event).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setLayout(engine.paneLayout());
    setComputed(engine.computed);
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
            {c.instance.author === "claude" && <span className="by-claude" title="Von Claude hinzugefügt">✦</span>}
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
            <button title={c.instance.hidden ? "Einblenden" : "Ausblenden"} onClick={() => updateIndicator(c.instance.id, { hidden: !c.instance.hidden })}>
              {c.instance.hidden ? "◌" : "◉"}
            </button>
            <button title="Einstellungen" onClick={() => onEditIndicator(c.instance.id)}>
              ⚙
            </button>
            <button title="Entfernen" onClick={() => removeIndicator(c.instance.id)}>
              ✕
            </button>
          </span>
        </div>
      ));

  return (
    <div className={`chart-area tool-${tool}`}>
      <div ref={containerRef} className="chart-container" />
      {layout.map((pane, i) => (
        <div key={i} className="legend" style={{ top: pane.top + 6 }}>
          {i === 0 && (
            <div className="legend-row main">
              <span className="legend-symbol">
                {symbol} · {interval} · {source === "demo" ? "DEMO-DATEN" : source?.toUpperCase()}
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
      {loading && <div className="chart-overlay">Lade {symbol} …</div>}
      {error && <div className="chart-overlay error">Fehler: {error}</div>}
    </div>
  );
}
