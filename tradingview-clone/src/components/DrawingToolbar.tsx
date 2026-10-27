import { useEffect, useRef, useState } from "react";
import { autoFibonacci } from "../../shared/patterns";
import type { ChartEngine } from "../chart/ChartEngine";
import { DEFAULT_FIB_LEVELS } from "../chart/DrawingsPrimitive";
import { CURSOR, ERASER, TOOL_GROUPS, groupTool, moveFavoritesBar, rememberTool, setFavoritesBar, toggleToolFavorite, toolInfo, useDrawingTools, type ToolGroup } from "../drawingTools";
import { shortcutLabel, useShortcutOverrides } from "../shortcuts";
import { addDrawing, clearDrawings, newId, store, useChartState, type Tool } from "../store";

interface Props {
  magnet: boolean;
  onToggleMagnet: () => void;
  getEngine: () => ChartEngine | null;
}

/** Fibonacci retracement over the dominant swing of the visible candles. */
function drawAutoFib(engine: ChartEngine | null) {
  const range = engine?.chart.timeScale().getVisibleLogicalRange();
  const swing = range ? autoFibonacci(store.get().bars, range.from, range.to) : null;
  if (!swing) return;
  addDrawing({ id: newId("user-autofib"), author: "user", kind: "fib", a: swing.a, b: swing.b, levels: DEFAULT_FIB_LEVELS, color: "auto", label: "Auto-Fib" });
}

/** "Trendlinie (⌥T)" in the first line of the tooltip. */
function tip(id: Tool) {
  const label = toolInfo(id).label;
  const keys = shortcutLabel(`tool.${id}`);
  if (!keys) return label;
  const [first, ...rest] = label.split("\n");
  return [`${first} (${keys})`, ...rest].join("\n");
}

function pick(id: Tool) {
  rememberTool(id);
  store.set({ tool: store.get().tool === id && id !== "cursor" ? "cursor" : id });
}

/** Group button: shows the tool last picked from the group; the corner arrow (or a long press) opens the whole group. */
function GroupButton({ group, tool, open, onOpen }: { group: ToolGroup; tool: Tool; open: boolean; onOpen: (g: ToolGroup | null, rect?: DOMRect) => void }) {
  useDrawingTools();
  const shown = group.tools.includes(tool) ? tool : groupTool(group);
  const press = useRef<number>(0);
  const longPressed = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const openHere = () => onOpen(open ? null : group, ref.current?.getBoundingClientRect());
  return (
    <div className={`tool-group ${open ? "open" : ""}`} ref={ref}>
      <button
        data-tip={open ? undefined : `${tip(shown)}\n\n▸ ${group.id}: Pfeil oder lange drücken für alle`}
        aria-label={toolInfo(shown).label.split("\n")[0]}
        className={`${tool === shown ? "active" : ""} tool-${shown}`}
        onPointerDown={() => {
          longPressed.current = false;
          press.current = window.setTimeout(() => {
            longPressed.current = true;
            openHere();
          }, 450);
        }}
        onPointerUp={() => window.clearTimeout(press.current)}
        onPointerLeave={() => window.clearTimeout(press.current)}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (longPressed.current) return;
          onOpen(null);
          pick(shown);
        }}
      >
        {toolInfo(shown).icon}
      </button>
      <button className="tool-group-caret" aria-label={`${group.id}: alle Werkzeuge`} aria-expanded={open} onClick={openHere}>
        ▸
      </button>
    </div>
  );
}

/** All tools of a group, each with a star for the favorites bar. */
function GroupFlyout({ group, top, left, tool, onClose }: { group: ToolGroup; top: number; left: number; tool: Tool; onClose: () => void }) {
  const { favorites } = useDrawingTools();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest(".tool-group")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  // Keep the panel on screen: it opens next to the button and moves up when it would run off the bottom.
  const [y, setY] = useState(top);
  useEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setY(Math.max(8, Math.min(top, window.innerHeight - h - 8)));
  }, [top, group]);
  return (
    <div className="tool-flyout" ref={ref} style={{ top: y, left }} role="menu" aria-label={group.id}>
      <div className="tool-flyout-title">{group.id}</div>
      {group.tools.map((id) => {
        const info = toolInfo(id);
        const [name] = info.label.split("\n");
        const keys = shortcutLabel(`tool.${id}`);
        const fav = favorites.includes(id);
        return (
          <div key={id} className={`tool-flyout-row ${tool === id ? "active" : ""}`}>
            <button
              className="tool-flyout-item"
              role="menuitem"
              data-tip={info.label.split("\n").slice(1).join("\n") || undefined}
              onClick={() => {
                pick(id);
                onClose();
              }}
            >
              <span className="tool-flyout-icon">{info.icon}</span>
              <span className="tool-flyout-name">{name}</span>
              {keys && <span className="tool-flyout-keys">{keys}</span>}
            </button>
            <button className={`fav-star ${fav ? "on" : ""}`} aria-label={fav ? `${name} aus der Favoritenleiste` : `${name} in die Favoritenleiste`} data-tip={fav ? "Aus der Favoritenleiste entfernen" : "In die Favoritenleiste"} onClick={() => toggleToolFavorite(id)}>
              {fav ? "★" : "☆"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function DrawingToolbar({ magnet, onToggleMagnet, getEngine }: Props) {
  const tool = useChartState((s) => s.tool);
  const { barVisible } = useDrawingTools();
  useShortcutOverrides();
  const [flyout, setFlyout] = useState<{ group: ToolGroup; top: number; left: number } | null>(null);
  const onOpen = (g: ToolGroup | null, rect?: DOMRect) => setFlyout(g && rect ? { group: g, top: rect.top, left: rect.right + 4 } : null);
  return (
    <nav className="toolbar">
      {[CURSOR].map((t) => (
        <button key={t.id} data-tip={tip(t.id)} aria-label={t.label} className={`${tool === t.id ? "active" : ""} tool-${t.id}`} onClick={() => pick(t.id)}>
          {t.icon}
        </button>
      ))}
      {TOOL_GROUPS.map((g) => (
        <GroupButton key={g.id} group={g} tool={tool} open={flyout?.group.id === g.id} onOpen={onOpen} />
      ))}
      <button data-tip={"Auto-Fibonacci\nRetracement über den größten Swing im sichtbaren Bereich"} aria-label="Auto-Fibonacci" className="auto-fib" onClick={() => drawAutoFib(getEngine())}>
        ≣<sup>A</sup>
      </button>
      <button data-tip={tip(ERASER.id)} aria-label={ERASER.label} className={`${tool === ERASER.id ? "active" : ""} tool-erase`} onClick={() => pick(ERASER.id)}>
        {ERASER.icon}
      </button>
      <div className="toolbar-sep" />
      <button data-tip={"Magnet\nZeichenpunkte rasten an Open/High/Low/Close ein"} aria-label="Magnet" className={magnet ? "active" : ""} onClick={onToggleMagnet}>
        🧲
      </button>
      <button data-tip={"Favoritenleiste ein-/ausblenden\nWerkzeuge mit ☆ in den Gruppen hinzufügen"} aria-label="Favoritenleiste" className={barVisible ? "active" : ""} onClick={() => setFavoritesBar(!barVisible)}>
        ★
      </button>
      <button
        data-tip="Alle Zeichnungen und Marker löschen"
        aria-label="Alle Zeichnungen löschen"
        onClick={() => {
          if (window.confirm("Alle Zeichnungen und Marker löschen?")) clearDrawings("all");
        }}
      >
        🗑
      </button>
      {flyout && <GroupFlyout group={flyout.group} top={flyout.top} left={flyout.left} tool={tool} onClose={() => setFlyout(null)} />}
    </nav>
  );
}

/** TradingView's favorites toolbar: the starred drawing tools in a small bar that can be dragged anywhere. */
export function FavoritesBar() {
  const { favorites, barVisible, barPos } = useDrawingTools();
  const tool = useChartState((s) => s.tool);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  if (!barVisible) return null;
  const pos = barPos ?? { x: 70, y: 60 };
  const clamp = (x: number, y: number) => {
    const w = ref.current?.offsetWidth ?? 200;
    return { x: Math.max(0, Math.min(x, window.innerWidth - w)), y: Math.max(0, Math.min(y, window.innerHeight - 40)) };
  };
  return (
    <div className="favorites-bar" ref={ref} style={{ left: clamp(pos.x, pos.y).x, top: clamp(pos.x, pos.y).y }} aria-label="Favoritenleiste">
      <span
        className="favorites-grip"
        data-tip="Leiste verschieben"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current || !ref.current) return;
          const p = clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy);
          ref.current.style.left = `${p.x}px`;
          ref.current.style.top = `${p.y}px`;
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          moveFavoritesBar(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
          drag.current = null;
        }}
      >
        ⠿
      </span>
      {favorites.length === 0 && <span className="favorites-empty">Mit ☆ in den Werkzeuggruppen hinzufügen</span>}
      {favorites.map((id) => (
        <button key={id} data-tip={tip(id)} aria-label={toolInfo(id).label.split("\n")[0]} className={tool === id ? "active" : ""} onClick={() => pick(id)}>
          {toolInfo(id).icon}
        </button>
      ))}
      <button className="favorites-close" aria-label="Favoritenleiste schließen" data-tip="Leiste ausblenden" onClick={() => setFavoritesBar(false)}>
        ×
      </button>
    </div>
  );
}
