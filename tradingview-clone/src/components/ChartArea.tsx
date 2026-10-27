import { useEffect, useMemo, useRef, useState } from "react";
import { brickKey as brickOptionsKey, displayBars, isPriceDriven } from "../../shared/chartTypes";
import { SOURCE_INDICATORS, indicatorLabel } from "../../shared/indicators";
import { ChartEngine, type ComputedIndicator, type PointerEvent } from "../chart/ChartEngine";
import { alertLinesFor, alertStore } from "../alerts";
import { useCompareData } from "../compare";
import { useFootprintData } from "../footprint";
import { compareCloseAt } from "../../shared/compare";
import { isSyncLeader, publishSync, setSyncLeader, subscribeSync } from "../chartSync";
import { demo, dropLevel, replayPositionsOpen, tradeLinesFor, type LineDraft } from "../demoAccount";
import { getSelectedExchanges, subscribeExchanges } from "../exchangeSelection";
import { liquidationFeed } from "../market/liquidationFeed";
import { DEFAULT_FIBEXT_LEVELS, DEFAULT_FIB_LEVELS, formatPrice } from "../chart/DrawingsPrimitive";
import { placeOnSide } from "../../shared/position";
import { SHAPES, isShapeKind, shapeDef } from "../../shared/drawingShapes";
import { activeChart, addDrawing, newId, pickReplayStart, removeIndicator, removeCompare, stepBackReplay, stepReplay, updateIndicator, updateSettings, useChart, workspace, type ChartStore, type Drawing, type Point } from "../store";
import { cloneInPlace, copyDrawing, deleteDrawing, pasteDrawing, redoDrawings, replaceDrawing, selectDrawing, selectedDrawing, trackHistory, undoDrawings, useSelectedDrawing } from "../drawingEdit";
import { shortcutLabel, useShortcuts } from "../shortcuts";
import { OPEN_GOTO_EVENT } from "./GoToDateDialog";
import { cloneDrawing, hasMovableAnchors, moveAnchor, shiftDrawing } from "../drawingOps";
import { DrawingMenu, type MenuTarget } from "./DrawingMenu";
import { FreshnessBadge } from "./FreshnessBadge";
import { publishCrosshair } from "../crosshair";
import { lastPositionDefaults } from "./PositionDialog";
import { ReplayBar } from "./ReplayBar";

interface Props {
  chart: ChartStore;
  onEngine: (slot: number, engine: ChartEngine | null) => void;
  magnet: boolean;
  onEditIndicator: (id: string) => void;
  onEditPosition: (id: string) => void;
}

/** Clicks needed per multi-point tool. */
const POINT_COUNT: Record<string, number> = {
  trendline: 2,
  ray: 2,
  zone: 2,
  fib: 2,
  measure: 2,
  fibext: 3,
  channel: 3,
  ...Object.fromEntries(SHAPES.map((s) => [s.id, s.points])),
};

/** Step hints for tools that need more than the obvious two taps. */
const STEP_HINTS: Record<string, string[]> = {
  fibext: ["Start der Bewegung antippen (z. B. Swing-Tief)", "Ende der Bewegung antippen (Swing-Hoch)", "Ende des Rücksetzers antippen"],
  channel: ["Start der Kanallinie antippen", "Ende der Kanallinie antippen", "Breite des Kanals antippen"],
  measure: ["Startpunkt antippen", "Endpunkt antippen"],
  brush: ["Mit gedrücktem Finger / gedrückter Maus zeichnen"],
  ...Object.fromEntries(SHAPES.filter((s) => s.points > 1).map((s) => [s.id, s.hints])),
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
  if (isShapeKind(tool)) {
    const def = shapeDef(tool);
    return { ...base, kind: "shape", shape: tool, points: pts.slice(0, def.points), color: def.color };
  }
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

  const { symbol, interval, bars: loaded, chartType, settings, source, tool, loading, error } = useChart(chart, (s) => s);
  // The legend reads the candles as drawn (Renko bricks, Line Break lines).
  const brickKey = brickOptionsKey(chartType, settings);
  const bars = useMemo(() => (brickKey ? displayBars(loaded, chartType, settings) : loaded), [loaded, brickKey]);
  const selected = useSelectedDrawing(chart.slot);
  const compareLines = useCompareData(chart);
  const footprint = useFootprintData(chart);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  /** "Parallel verschieben/kopieren" from the menu: the drawing follows the pointer until the next tap. */
  const moveRef = useRef<{ id: string; clone: boolean; from: PointerEvent } | null>(null);
  const [moving, setMoving] = useState(false);

  // Shortcuts like TradingView (keys editable in the shortcut list). The selected drawing lives in one
  // chart; paste, undo and redo act on the active chart; replay steps on the chart that is replaying.
  const isActive = () => activeChart() === chart;
  useShortcuts({
    "drawing.delete": () => {
      const sel = selectedDrawing(chart.slot);
      if (!sel) return false;
      deleteDrawing(chart, sel);
    },
    "drawing.copy": () => {
      const sel = selectedDrawing(chart.slot);
      if (!sel) return false;
      copyDrawing(chart, sel);
    },
    "drawing.clone": () => {
      const sel = selectedDrawing(chart.slot);
      if (!sel) return false;
      cloneInPlace(chart, sel);
    },
    "drawing.paste": () => (isActive() ? pasteDrawing(chart) : false),
    "edit.undo": () => (isActive() ? void undoDrawings(chart) : false),
    "edit.redo": () => (isActive() ? void redoDrawings(chart) : false),
    "replay.next": () => (chart.get().replay?.phase === "play" ? void stepReplay(chart) : false),
    "replay.prev": () => {
      if (chart.get().replay?.phase !== "play") return false;
      if (!replayPositionsOpen(chart.slot)) stepBackReplay(chart);
    },
  });
  const startMoveRef = useRef<(id: string, clone: boolean, from: PointerEvent) => void>(() => {});

  useEffect(() => {
    engineRef.current?.drawings.setSelected(selected);
  }, [selected]);

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

    /** The drawing moved by the pointer travel from `from` to `to`, keeping its shape (parallel). */
    const shifted = (d: Drawing, from: PointerEvent, to: PointerEvent): Drawing => {
      const dLogical = Math.round(to.logical - from.logical);
      const p0 = engine.priceAt(from.y);
      const p1 = engine.priceAt(to.y);
      const dPrice = p0 === null || p1 === null ? 0 : p1 - p0;
      const shiftTime = (t: number) => {
        const l = engine.drawings.timeToLogical(t);
        return dLogical === 0 || l === null ? t : (engine.logicalToTime(l + dLogical) ?? t);
      };
      return shiftDrawing(d, shiftTime, dPrice);
    };
    const findDrawing = (id: string | null) => (id ? chart.get().drawings.find((d) => d.id === id) : undefined);
    const tolerance = (touch: boolean) => (touch ? 14 : 6);

    startMoveRef.current = (id, clone, from) => {
      moveRef.current = { id, clone, from };
      setMoving(true);
      chart.set({ tool: "cursor" });
    };
    const endMove = () => {
      moveRef.current = null;
      setMoving(false);
      engine.drawings.setOverride(null);
    };

    // Dragging a drawing (mouse: any; finger: the selected one) or one of its anchor points.
    let drag: { original: Drawing; anchor: number | null; from: PointerEvent; draft: Drawing | null } | null = null;
    engine.grabDrawing = (e, touch) => {
      if (chart.get().tool !== "cursor" || chart.get().replay?.phase === "select" || moveRef.current) return false;
      const { width, height } = engine.paneSize();
      const sel = selectedDrawing(chart.slot);
      const selD = findDrawing(sel);
      const anchor = selD && !selD.locked && hasMovableAnchors(selD) ? engine.drawings.anchorAt(selD.id, e.x, e.y, width, height, touch ? 16 : 8) : null;
      const id = anchor !== null ? sel : engine.drawings.findAt(e.x, e.y, width, height, tolerance(touch));
      const d = findDrawing(id);
      if (!d || d.locked || (touch && d.id !== sel)) return false;
      drag = { original: d, anchor, from: e, draft: null };
      return true;
    };
    engine.onDrawingDrag = (phase, e) => {
      if (!drag) return;
      if (phase === "move" && e) {
        const p = drag.anchor !== null ? pointAt(e) : null;
        drag.draft = drag.anchor !== null ? (p ? moveAnchor(drag.original, drag.anchor, p) : null) : shifted(drag.original, drag.from, e);
        selectDrawing(chart.slot, drag.original.id);
        engine.drawings.setOverride(drag.draft);
        return;
      }
      if (phase === "end" && drag.draft) replaceDrawing(chart, drag.draft);
      engine.drawings.setOverride(null);
      drag = null;
    };
    engine.onContextMenu = (e, clientX, clientY) => {
      if (chart.get().tool !== "cursor" || moveRef.current) {
        // Like TradingView: a right click while drawing cancels the drawing.
        pendingRef.current = [];
        positionRef.current = null;
        engine.drawings.setPreview(null);
        endMove();
        chart.set({ tool: "cursor" });
        return;
      }
      if (chart.get().replay?.phase === "select") return;
      const { width, height } = engine.paneSize();
      const id = e && e.paneIndex === 0 ? engine.drawings.findAt(e.x, e.y, width, height, 14) : null;
      selectDrawing(chart.slot, id);
      setMenu({ id, clientX, clientY, at: e && e.paneIndex === 0 ? e : null });
    };

    engine.onCrosshair = (logical, e) => {
      setHover(logical);
      const move = moveRef.current;
      if (move) {
        const d = findDrawing(move.id);
        if (d && e && e.paneIndex === 0) engine.drawings.setOverride({ ...shifted(d, move.from, e), ...(move.clone ? { id: "move-clone" } : {}) });
        return;
      }
      if (e && e.paneIndex === 0 && chart.get().tool === "cursor") {
        const { width, height } = engine.paneSize();
        containerRef.current?.classList.toggle("drawing-hover", engine.drawings.findAt(e.x, e.y, width, height) !== null);
      }
      // Choosing the replay start: a line marks where the chart will be cut off.
      if (chart.get().replay?.phase === "select") {
        const time = e && e.paneIndex === 0 ? engine.logicalToTime(e.logical) : null;
        engine.drawings.setPreview(time === null ? null : { id: "replay-start", author: "user", kind: "vline", time, color: "#2962ff" });
        return;
      }
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
      if (chart.get().replay?.phase === "select") {
        const time = engine.logicalToTime(e.logical);
        if (time !== null) {
          engine.drawings.setPreview(null);
          pickReplayStart(chart, time);
        }
        return;
      }
      const move = moveRef.current;
      if (move) {
        const d = findDrawing(move.id);
        endMove();
        if (!d) return;
        const placed = shifted(d, move.from, e);
        const result = move.clone ? cloneDrawing(placed, newId("user")) : placed;
        replaceDrawing(chart, result);
        selectDrawing(chart.slot, result.id);
        return;
      }
      if (currentTool === "cursor") {
        // Tapping a drawing selects it; a long/short position also opens its settings.
        const { width, height } = engine.paneSize();
        const id = engine.drawings.findAt(e.x, e.y, width, height, 10);
        selectDrawing(chart.slot, id);
        if (id && findDrawing(id)?.kind === "position") editPositionRef.current(id);
        return;
      }
      if (currentTool === "erase") {
        const { width, height } = engine.paneSize();
        const id = engine.drawings.findAt(e.x, e.y, width, height, 10);
        if (id && !findDrawing(id)?.locked) deleteDrawing(chart, id);
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
        if (d?.kind === "shape" && shapeDef(d.shape).text) {
          // Callout, note and emoji ask for their text after the last tap.
          const emoji = shapeDef(d.shape).text === "emoji";
          const text = window.prompt(emoji ? "Emoji oder Symbol (z. B. ⭐ 🚀 ⚠️ ✅):" : "Text:", emoji ? "⭐" : "");
          if (!text) {
            pendingRef.current = [];
            engine.drawings.setPreview(null);
            setHint(null);
            chart.set({ tool: "cursor" });
            return;
          }
          d.text = text;
        }
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
    engine.drawings.setSelected(selectedDrawing(chart.slot));
    refreshLayout();
    const unsubscribeHistory = trackHistory(chart);
    // Starting a replay at a candle, or leaving it, jumps the view to the newest visible candles.
    let replayKey = "";
    const unsubscribe = chart.subscribe(() => {
      const s = chart.get();
      engine.update(s);
      const key = s.replay?.phase === "play" ? s.replay.id : "";
      if (key !== replayKey) {
        replayKey = key;
        engine.resetView();
      }
      const t = s.tool;
      // A selected drawing that was removed (eraser, Claude, undo) is no longer selected.
      const sel = selectedDrawing(chart.slot);
      if (sel && !s.drawings.some((d) => d.id === sel && !d.hidden)) selectDrawing(chart.slot, null);
      if (t !== "cursor" && sel) selectDrawing(chart.slot, null);
      engine.setDragMode(t === "brush");
      if (!POINT_COUNT[t]) pendingRef.current = [];
      if (!POSITION_TOOLS.has(t)) positionRef.current = null;
      if (!POINT_COUNT[t] && !POSITION_TOOLS.has(t) && !strokeRef.current && s.replay?.phase !== "select") engine.drawings.setPreview(null);
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
    // Alert levels of this symbol join them as dashed lines.
    const pushTradeLines = () => engine.setTradeLines([...tradeLinesFor(chart.get().symbol, chart.slot, lineDraft), ...(chart.get().replay ? [] : alertLinesFor(chart.get().symbol))]);
    let lineErrorTimer = 0;
    engine.onTradeLineDrag = (phase, dragId, price) => {
      lineDraft = phase === "move" ? { dragId, price } : null;
      const err = phase === "end" ? dropLevel(dragId, price, chart.slot) : null;
      pushTradeLines();
      if (phase === "move") return;
      window.clearTimeout(lineErrorTimer);
      setLineError(err);
      if (err) lineErrorTimer = window.setTimeout(() => setLineError(null), 4000);
    };
    pushTradeLines();
    const unsubscribeDemo = demo.subscribe(pushTradeLines);
    const unsubscribeDemoChart = chart.subscribe(pushTradeLines);
    const unsubscribeAlerts = alertStore.subscribe(pushTradeLines);
    // Layout sync: the chart under the pointer leads the crosshair, the active chart the time range.
    // Not ":hover": on the iPad it sticks to the last tapped chart, so a finger in another chart
    // was never sent and the charts showed different times.
    engine.onCrosshairTime = (time) => {
      if (isSyncLeader(chart.slot)) publishSync(chart.slot, { kind: "crosshair", time });
    };
    engine.onVisibleTime = (from, to) => {
      if (workspace.get().active === chart.slot) publishSync(chart.slot, { kind: "range", from, to });
    };
    const container = containerRef.current!;
    const onPointer = () => setSyncLeader(chart.slot);
    container.addEventListener("pointerdown", onPointer, { capture: true });
    container.addEventListener("pointermove", onPointer, { capture: true });
    // A lifted finger leaves the crosshair standing in this chart, so the others keep it too.
    const onLeave = (ev: globalThis.PointerEvent) => {
      if (ev.pointerType !== "touch" && isSyncLeader(chart.slot)) publishSync(chart.slot, { kind: "crosshair", time: null });
    };
    container.addEventListener("pointerleave", onLeave);
    const unsubscribeSync = subscribeSync((from, ev) => {
      if (from === chart.slot) return;
      if (ev.kind === "crosshair") engine.showCrosshairAt(ev.time);
      else engine.showTimeRange(ev.from, ev.to);
    });
    engine.setExchanges(getSelectedExchanges());
    const unsubscribeExchanges = subscribeExchanges(() => engine.setExchanges(getSelectedExchanges()));
    const ro = new ResizeObserver(() => requestAnimationFrame(refreshLayout));
    ro.observe(containerRef.current!);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      pendingRef.current = [];
      positionRef.current = null;
      engine.drawings.setPreview(null);
      endMove();
      selectDrawing(chart.slot, null);
      chart.set({ tool: "cursor" });
    };
    window.addEventListener("keydown", onKey);
    onEngine(chart.slot, engine);
    if (import.meta.env.DEV && chart.slot === 0) Object.assign(window, { __chartEngine: engine, __store: chart });

    return () => {
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
      unsubscribe();
      unsubscribeHistory();
      unsubscribeLiq();
      unsubscribeExchanges();
      unsubscribeDemo();
      unsubscribeDemoChart();
      unsubscribeAlerts();
      unsubscribeSync();
      container.removeEventListener("pointerdown", onPointer, { capture: true });
      container.removeEventListener("pointermove", onPointer, { capture: true });
      container.removeEventListener("pointerleave", onLeave);
      window.clearTimeout(lineErrorTimer);
      onEngine(chart.slot, null);
      engine.destroy();
      engineRef.current = null;
    };
  }, [onEngine, chart]);

  useEffect(() => {
    engineRef.current?.setCompare(compareLines);
  }, [compareLines, chart]);
  useEffect(() => {
    engineRef.current?.setFootprint(footprint?.bars ?? null);
  }, [footprint, chart]);

  // Replay playback: one candle per tick at the chosen speed.
  const replayPlaying = useChart(chart, (s) => s.replay?.playing ?? false);
  const replaySpeed = useChart(chart, (s) => s.replay?.speed ?? 1);
  const replaying = useChart(chart, (s) => s.replay !== null);
  useEffect(() => {
    if (!replayPlaying) return;
    const timer = window.setInterval(() => stepReplay(chart), 1000 / replaySpeed);
    return () => window.clearInterval(timer);
  }, [chart, replayPlaying, replaySpeed]);

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

  useEffect(() => publishCrosshair(chart.slot, { index: idx, bars, computed }), [chart, idx, bars, computed]);

  const legendFor = (paneIndex: number) =>
    computed
      .filter((c) => c.paneIndex === paneIndex)
      .map((c) => (
        <div className="legend-row indicator" key={c.instance.id}>
          <span className={`legend-name ${c.instance.hidden ? "muted" : ""}`}>
            {indicatorLabel(c.def, c.params)}
            {c.instance.source && (() => {
              const src = computed.find((x) => x.instance.id === c.instance.source!.id);
              return src && SOURCE_INDICATORS.has(c.def.id) ? <span className="legend-source"> auf {indicatorLabel(src.def, src.params)}</span> : null;
            })()}
            {c.instance.author === "claude" && <span className="by-claude" data-tip="Von Claude hinzugefügt">✦</span>}
          </span>
          {!c.instance.hidden &&
            c.def.outputs.map((o, k) => {
              const v = c.outputs[o.key]?.[idx];
              return o.helper || v === null || v === undefined ? null : (
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
                {symbol} · {interval} · {source === "demo" ? "DEMO-DATEN" : source === "binance_futures" ? "BINANCE PERP" : source === "venue" ? "BÖRSE DIREKT" : source?.toUpperCase()}
              </span>
              <FreshnessBadge chart={chart} />
              {replaying && <span className="legend-replay">REPLAY</span>}
              {bar && (
                <span className={up ? "up" : "down"}>
                  O {formatPrice(bar.open)} H {formatPrice(bar.high)} L {formatPrice(bar.low)} C {formatPrice(bar.close)}{" "}
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </span>
              )}
            </div>
          )}
          {i === 0 && (settings.footprint || chartType === "volume_footprint") && (
            <div className="legend-row indicator">
              <span className="legend-name">
                Footprint{" "}
                {footprint
                  ? `aus ${footprint.interval}${footprint.exact ? "" : " (Kauf/Verkauf geschätzt)"}`
                  : source === "demo"
                    ? "– nicht mit Demo-Daten"
                    : isPriceDriven(chartType)
                      ? "– nicht bei preisbasierten Charttypen"
                      : "lädt …"}
              </span>
              <span className="legend-actions">
                <button data-tip="Footprint ausschalten" aria-label="Footprint ausschalten" onClick={() => chart.set((st) => ({ settings: { ...st.settings, footprint: false }, ...(st.chartType === "volume_footprint" ? { chartType: "candles" as const } : {}) }))}>
                  ✕
                </button>
              </span>
            </div>
          )}
          {i === 0 &&
            compareLines.map((c) => {
              const v = bar ? compareCloseAt(c.bars, bar.time) : null;
              return (
                <div className="legend-row indicator" key={c.symbol}>
                  <span className="legend-name" style={{ color: c.color }}>
                    {c.symbol}
                    {c.source === "demo" && " · DEMO"}
                  </span>
                  {c.error ? <span className="down">{c.error}</span> : v !== null && <span style={{ color: c.color }}>{formatPrice(v)}</span>}
                  <span className="legend-actions">
                    <button data-tip="Vergleich entfernen" aria-label={`${c.symbol} entfernen`} onClick={() => removeCompare(c.symbol, chart)}>
                      ✕
                    </button>
                  </span>
                </div>
              );
            })}
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
            className={scaleMode === "percent" || (compareLines.length > 0 && scaleMode !== "indexed") ? "active" : ""}
            onClick={() => updateSettings({ scaleMode: scaleMode === "percent" ? "normal" : "percent" })}
            data-tip={"Prozent-Skala ein/aus\nVeränderung ab der ersten sichtbaren Kerze"}
          >
            %
          </button>
          <button onClick={() => window.dispatchEvent(new Event(OPEN_GOTO_EVENT))} aria-label="Gehe zu Datum" data-tip={`Gehe zu Datum${shortcutLabel("chart.goto") ? ` (${shortcutLabel("chart.goto")})` : ""}`}>
            📅
          </button>
          <button onClick={() => engineRef.current?.autoScale()} data-tip={"Auto-Skalierung\nPreisachse wieder an die sichtbaren Kerzen anpassen"}>
            A
          </button>
          <button onClick={() => engineRef.current?.resetView()} data-tip={"Ansicht zurücksetzen\nZu den neuesten Kerzen springen"}>
            ⟲
          </button>
        </div>
      )}
      {replaying && <ReplayBar chart={chart} />}
      {menu && (
        <DrawingMenu
          chart={chart}
          target={menu}
          onClose={() => setMenu(null)}
          onMove={(id, clone, from) => startMoveRef.current(id, clone, from)}
          onEditPosition={onEditPosition}
        />
      )}
      {moving && <div className="draw-hint">Neue Position antippen · Esc bricht ab</div>}
      {!moving && hint && <div className="draw-hint">{hint} · Esc bricht ab</div>}
      {lineError && !hint && <div className="draw-hint error">{lineError}</div>}
      {loading && <div className="chart-overlay">Lade {symbol} …</div>}
      {error && <div className="chart-overlay error">Fehler: {error}</div>}
    </div>
  );
}
