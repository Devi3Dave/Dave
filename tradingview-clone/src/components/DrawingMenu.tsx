import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PointerEvent as ChartPointer } from "../chart/ChartEngine";
import {
  arrange,
  canUndo,
  cloneInPlace,
  copyDrawing,
  deleteDrawing,
  hasClipboard,
  pasteDrawing,
  patchDrawing,
  showAllDrawings,
  undoDrawings,
} from "../drawingEdit";
import { createAlert, openAlertsPanel, targetOf } from "../alerts";
import { shortcutLabel } from "../shortcuts";
import { exportChart } from "../chartExport";
import { drawingName } from "../drawingOps";
import { useChart, type ChartStore, type Drawing, type LineStyleName } from "../store";

export interface MenuTarget {
  /** The drawing that was right-clicked / long-pressed, or null for the empty chart. */
  id: string | null;
  clientX: number;
  clientY: number;
  /** Where in the chart it opened; the start point for "Parallel verschieben". */
  at: ChartPointer | null;
}

interface Props {
  chart: ChartStore;
  target: MenuTarget;
  onClose: () => void;
  onMove: (id: string, clone: boolean, from: ChartPointer) => void;
  onEditPosition: (id: string) => void;
}

const COLORS = ["#2962ff", "#00bcd4", "#089981", "#f7c948", "#ff9800", "#f23645", "#e91e63", "#9c27b0", "#d1d4dc", "#787b86"];
const STYLES: { value: LineStyleName; label: string; tip: string }[] = [
  { value: "solid", label: "───", tip: "Durchgezogen" },
  { value: "dashed", label: "– – –", tip: "Gestrichelt" },
  { value: "dotted", label: "·····", tip: "Gepunktet" },
];
const WIDTHS = [1, 2, 3, 4];
const EXTENDS: { value: "none" | "right" | "left" | "both"; label: string }[] = [
  { value: "none", label: "Keine" },
  { value: "left", label: "Links" },
  { value: "right", label: "Rechts" },
  { value: "both", label: "Beide" },
];

const hasColor = (d: Drawing) => d.kind !== "measure" && d.kind !== "position";
const hasStyle = (d: Drawing) => d.kind === "trendline" || d.kind === "hline" || d.kind === "vline";
const hasWidth = (d: Drawing) => hasStyle(d) || d.kind === "path";
const hasLabel = (d: Drawing) => d.kind === "trendline" || d.kind === "hline" || d.kind === "vline" || d.kind === "zone" || d.kind === "channel";

function Item({ icon, children, keys, onClick, danger, disabled }: { icon: string; children: ReactNode; keys?: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button className={`menu-item ctx-item ${danger ? "danger" : ""}`} onClick={onClick} disabled={disabled}>
      <span className="menu-icon">{icon}</span>
      <span className="ctx-label">{children}</span>
      {keys && <span className="ctx-keys">{keys}</span>}
    </button>
  );
}

/** TradingView-like context menu for a drawing (right click on the Mac, long press on the iPad). */
export function DrawingMenu({ chart, target, onClose, onMove, onEditPosition }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.clientX, top: target.clientY });
  const d = useChart(chart, (s) => (target.id ? s.drawings.find((x) => x.id === target.id) : undefined));
  const hiddenCount = useChart(chart, (s) => s.drawings.filter((x) => x.hidden).length);
  const drawingCount = useChart(chart, (s) => s.drawings.length);
  // After a long press the finger lifts over the menu; only taps that start in the menu count.
  const armed = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const touchGap = 12;
    let left = target.clientX + 2;
    let top = target.clientY + 2;
    if (left + width > window.innerWidth - 8) left = Math.max(8, target.clientX - width - touchGap);
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
    setPos({ left, top });
  }, [target, d?.kind]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onWheel = () => onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  /** Runs a menu action and closes the menu. */
  const act = (f: () => void, keepOpen = false) => () => {
    if (!armed.current) return;
    f();
    if (!keepOpen) onClose();
  };
  const patch = (p: Partial<Drawing>) => d && patchDrawing(chart, d.id, p);

  const body = d ? (
    <>
      <div className="menu-title ctx-title">
        {drawingName(d)}
        {d.author === "claude" && <span className="by-claude">✦ Claude</span>}
      </div>

      {hasColor(d) && !d.locked && (
        <div className="ctx-colors">
          {(d.kind === "fib" || d.kind === "fibext") && (
            <button className={`ctx-swatch auto ${d.color === "auto" ? "active" : ""}`} data-tip="Automatische Farben je Level" aria-label="Automatische Farben" onClick={act(() => patch({ color: "auto" }), true)}>
              A
            </button>
          )}
          {COLORS.map((c) => (
            <button key={c} className={`ctx-swatch ${d.color.toLowerCase() === c ? "active" : ""}`} style={{ background: c }} aria-label={`Farbe ${c}`} onClick={act(() => patch({ color: c }), true)} />
          ))}
          <label className="ctx-swatch custom" data-tip="Eigene Farbe">
            +
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(d.color) ? d.color : "#2962ff"} onChange={(e) => armed.current && patch({ color: e.target.value })} />
          </label>
        </div>
      )}

      {hasStyle(d) && !d.locked && (
        <div className="ctx-segment">
          {STYLES.map((s) => (
            <button key={s.value} className={("style" in d ? d.style : undefined) === s.value || (!("style" in d && d.style) && s.value === "solid") ? "active" : ""} data-tip={s.tip} aria-label={s.tip} onClick={act(() => patch({ style: s.value } as Partial<Drawing>), true)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {hasWidth(d) && !d.locked && (
        <div className="ctx-segment">
          {WIDTHS.map((w) => {
            const current = "width" in d ? (d.width ?? 1.5) : 1.5;
            return (
              <button key={w} className={Math.round(current) === w ? "active" : ""} aria-label={`Linienstärke ${w}`} onClick={act(() => patch({ width: w } as Partial<Drawing>), true)}>
                <span className="ctx-width" style={{ height: w }} />
              </button>
            );
          })}
        </div>
      )}
      {d.kind === "trendline" && !d.locked && (
        <div className="ctx-segment labeled">
          <span>Verlängern</span>
          {EXTENDS.map((x) => (
            <button key={x.value} className={d.extend === x.value ? "active" : ""} onClick={act(() => patch({ extend: x.value } as Partial<Drawing>), true)}>
              {x.label}
            </button>
          ))}
        </div>
      )}
      {d.kind === "zone" && !d.locked && (
        <Item icon={d.extendRight ? "☑" : "☐"} onClick={act(() => patch({ extendRight: !d.extendRight } as Partial<Drawing>), true)}>
          Nach rechts verlängern
        </Item>
      )}

      <div className="ctx-sep" />
      {targetOf(d) && (
        <Item
          icon="🔔"
          onClick={act(() => {
            const s = chart.get();
            createAlert({
              symbol: s.symbol,
              interval: s.interval,
              source: { kind: "price" },
              condition: d.kind === "zone" ? "entering" : "crossing",
              target: targetOf(d)!,
              frequency: "once",
              message: d.label ?? "",
              drawing: { slot: chart.slot, id: d.id },
            });
            openAlertsPanel();
          })}
        >
          Alarm hinzufügen
        </Item>
      )}
      {d.kind === "position" && (
        <Item icon="⚙" onClick={act(() => onEditPosition(d.id))}>
          Einstellungen …
        </Item>
      )}
      {d.kind === "text" && !d.locked && (
        <Item
          icon="✎"
          onClick={act(() => {
            const text = window.prompt("Text:", d.text);
            if (text) patch({ text } as Partial<Drawing>);
          })}
        >
          Text bearbeiten …
        </Item>
      )}
      {hasLabel(d) && !d.locked && (
        <Item
          icon="🏷"
          onClick={act(() => {
            const label = window.prompt("Beschriftung (leer = keine):", d.label ?? "");
            if (label !== null) patch({ label: label.trim() || undefined });
          })}
        >
          Beschriftung …
        </Item>
      )}
      {target.at && !d.locked && (
        <Item icon="⇅" onClick={act(() => onMove(d.id, false, target.at!))}>
          Parallel verschieben
        </Item>
      )}
      {target.at && (
        <Item icon="⇉" onClick={act(() => onMove(d.id, true, target.at!))}>
          Parallel kopieren
        </Item>
      )}
      <Item icon="⧉" keys={shortcutLabel("drawing.clone")} onClick={act(() => cloneInPlace(chart, d.id))}>
        Klonen
      </Item>
      <Item icon="⎘" keys={shortcutLabel("drawing.copy")} onClick={act(() => copyDrawing(chart, d.id))}>
        Kopieren
      </Item>
      {hasClipboard() && (
        <Item icon="📋" keys={shortcutLabel("drawing.paste")} onClick={act(() => pasteDrawing(chart))}>
          Einfügen
        </Item>
      )}

      <div className="ctx-sep" />
      <div className="menu-title">Anordnen</div>
      <div className="ctx-grid">
        <button onClick={act(() => arrange(chart, d.id, "front"))}>⤒ Vordergrund</button>
        <button onClick={act(() => arrange(chart, d.id, "forward"))}>↑ Nach vorne</button>
        <button onClick={act(() => arrange(chart, d.id, "backward"))}>↓ Nach hinten</button>
        <button onClick={act(() => arrange(chart, d.id, "back"))}>⤓ Hintergrund</button>
      </div>

      <div className="ctx-sep" />
      <Item icon={d.locked ? "🔓" : "🔒"} onClick={act(() => patch({ locked: !d.locked || undefined }), true)}>
        {d.locked ? "Entsperren" : "Sperren"}
      </Item>
      <Item icon="👁" onClick={act(() => patch({ hidden: true }))}>
        Ausblenden
      </Item>
      {canUndo(chart) && (
        <Item icon="↶" keys={shortcutLabel("edit.undo")} onClick={act(() => undoDrawings(chart))}>
          Rückgängig
        </Item>
      )}
      <Item icon="🗑" keys={shortcutLabel("drawing.delete")} danger onClick={act(() => deleteDrawing(chart, d.id))}>
        Entfernen
      </Item>
    </>
  ) : (
    <>
      <div className="menu-title ctx-title">Chart</div>
      <Item icon="⇩" onClick={act(() => void exportChart(chart))}>
        Chartdaten als CSV
      </Item>
      <Item icon="📋" keys={shortcutLabel("drawing.paste")} disabled={!hasClipboard()} onClick={act(() => pasteDrawing(chart))}>
        Zeichnung einfügen
      </Item>
      {canUndo(chart) && (
        <Item icon="↶" keys={shortcutLabel("edit.undo")} onClick={act(() => undoDrawings(chart))}>
          Rückgängig
        </Item>
      )}
      {hiddenCount > 0 && (
        <Item icon="👁" onClick={act(() => showAllDrawings(chart))}>
          Ausgeblendete einblenden ({hiddenCount})
        </Item>
      )}
      {drawingCount > 0 && (
        <Item
          icon="🗑"
          danger
          onClick={act(() => {
            if (window.confirm(`Alle ${drawingCount} Zeichnungen in diesem Chart entfernen?`)) chart.set({ drawings: [] });
          })}
        >
          Alle Zeichnungen entfernen
        </Item>
      )}
    </>
  );

  return (
    <div
      ref={ref}
      className="menu-panel ctx-menu"
      style={pos}
      role="menu"
      onPointerDown={() => (armed.current = true)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {body}
    </div>
  );
}
