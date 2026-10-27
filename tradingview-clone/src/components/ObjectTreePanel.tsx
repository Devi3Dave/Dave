import { useState } from "react";
import { getIndicator, indicatorLabel } from "../../shared/indicators";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { resolveTimeZone } from "../chartSettings";
import { useCrosshair } from "../crosshair";
import { arrange, deleteDrawing, patchDrawing, selectDrawing, showAllDrawings, toggleAllDrawingsHidden, useSelectedDrawing } from "../drawingEdit";
import { drawingName } from "../drawingOps";
import { activeChart, charts, removeIndicator, updateIndicator, useChart, useWorkspace, type ChartStore, type Drawing, type IndicatorInstance } from "../store";

interface Props {
  onEditIndicator: (id: string) => void;
}

type View = "tree" | "data";

/** TradingView's "Objektbaum und Datenfenster": everything on the active chart, and all values under the crosshair. */
export function ObjectTreePanel({ onEditIndicator }: Props) {
  const [view, setView] = useState<View>("tree");
  return (
    <div className="object-panel">
      <div className="segmented object-tabs" role="tablist">
        <button role="tab" aria-selected={view === "tree"} className={view === "tree" ? "active" : ""} onClick={() => setView("tree")}>
          Objektbaum
        </button>
        <button role="tab" aria-selected={view === "data"} className={view === "data" ? "active" : ""} onClick={() => setView("data")}>
          Datenfenster
        </button>
      </div>
      {view === "tree" ? <ObjectTree onEditIndicator={onEditIndicator} /> : <DataWindow />}
    </div>
  );
}

function ObjectTree({ onEditIndicator }: Props) {
  const slot = useWorkspace((w) => w.active);
  const chart = charts[slot];
  const symbol = useChart(chart, (s) => s.symbol);
  const interval = useChart(chart, (s) => s.interval);
  const indicators = useChart(chart, (s) => s.indicators);
  const drawings = useChart(chart, (s) => s.drawings);
  const compare = useChart(chart, (s) => s.compare);
  const selected = useSelectedDrawing(slot);
  // Topmost first, like TradingView (later drawings are painted on top).
  const ordered = drawings.slice().reverse();
  const allHidden = drawings.length > 0 && drawings.every((d) => d.hidden);

  return (
    <div className="object-tree">
      <div className="object-group-title">Chart {slot + 1}</div>
      <div className="object-row main">
        <span className="object-icon">📈</span>
        <span className="object-name">
          {symbol} · {interval}
        </span>
      </div>
      {compare.map((c) => (
        <div className="object-row" key={c}>
          <span className="object-icon">⊕</span>
          <span className="object-name">Vergleich {c}</span>
        </div>
      ))}

      <div className="object-group-title">Indikatoren ({indicators.length})</div>
      {indicators.length === 0 && <div className="object-empty">Keine Indikatoren</div>}
      {indicators.map((ind) => (
        <IndicatorRow key={ind.id} chart={chart} ind={ind} onEdit={() => onEditIndicator(ind.id)} />
      ))}

      <div className="object-group-title">
        Zeichnungen ({drawings.length})
        {drawings.length > 0 && (
          <button className="object-link" onClick={() => (allHidden ? showAllDrawings(chart) : toggleAllDrawingsHidden(chart))}>
            {allHidden ? "Alle einblenden" : "Alle ausblenden"}
          </button>
        )}
      </div>
      {drawings.length === 0 && <div className="object-empty">Keine Zeichnungen</div>}
      {ordered.map((d, i) => (
        <DrawingRow key={d.id} chart={chart} d={d} selected={selected === d.id} first={i === 0} last={i === ordered.length - 1} />
      ))}
    </div>
  );
}

function IndicatorRow({ chart, ind, onEdit }: { chart: ChartStore; ind: IndicatorInstance; onEdit: () => void }) {
  const hidden = !!ind.hidden;
  const def = getIndicator(ind.type);
  const label = def ? indicatorLabel(def, ind.params) : ind.type;
  // Indicator actions work on the active chart; the tree always shows the active one.
  const onActive = (f: () => void) => () => {
    if (activeChart() === chart) f();
  };
  return (
    <div className={`object-row ${hidden ? "muted" : ""}`}>
      <span className="object-icon">ƒ</span>
      <button className="object-name" onClick={onEdit} data-tip="Einstellungen öffnen">
        {label}
        {ind.author === "claude" && <span className="by-claude"> ✦</span>}
      </button>
      <span className="object-actions">
        <button aria-label={hidden ? "Einblenden" : "Ausblenden"} data-tip={hidden ? "Einblenden" : "Ausblenden"} onClick={onActive(() => updateIndicator(ind.id, { hidden: !hidden }))}>
          {hidden ? "◌" : "◉"}
        </button>
        <button aria-label="Entfernen" data-tip="Entfernen" onClick={onActive(() => removeIndicator(ind.id))}>
          ✕
        </button>
      </span>
    </div>
  );
}

function DrawingRow({ chart, d, selected, first, last }: { chart: ChartStore; d: Drawing; selected: boolean; first: boolean; last: boolean }) {
  const text = d.label ?? (d.kind === "text" ? d.text : d.kind === "shape" ? d.text : undefined);
  return (
    <div className={`object-row ${d.hidden ? "muted" : ""} ${selected ? "selected" : ""}`}>
      <span className="object-swatch" style={{ background: d.color === "auto" ? "linear-gradient(135deg,#f23645,#4caf50,#2962ff)" : d.color }} />
      <button className="object-name" onClick={() => selectDrawing(chart.slot, d.hidden ? null : d.id)} data-tip="Im Chart auswählen">
        {drawingName(d)}
        {text && <span className="object-sub"> „{text}“</span>}
        {d.author === "claude" && <span className="by-claude"> ✦</span>}
      </button>
      <span className="object-actions">
        <button aria-label="Nach oben" data-tip="Nach vorne" disabled={first} onClick={() => arrange(chart, d.id, "forward")}>
          ↑
        </button>
        <button aria-label="Nach unten" data-tip="Nach hinten" disabled={last} onClick={() => arrange(chart, d.id, "backward")}>
          ↓
        </button>
        <button aria-label={d.locked ? "Entsperren" : "Sperren"} data-tip={d.locked ? "Entsperren" : "Sperren"} className={d.locked ? "on" : ""} onClick={() => patchDrawing(chart, d.id, { locked: !d.locked })}>
          {d.locked ? "🔒" : "🔓"}
        </button>
        <button aria-label={d.hidden ? "Einblenden" : "Ausblenden"} data-tip={d.hidden ? "Einblenden" : "Ausblenden"} onClick={() => patchDrawing(chart, d.id, { hidden: !d.hidden })}>
          {d.hidden ? "◌" : "◉"}
        </button>
        <button aria-label="Löschen" data-tip={d.locked ? "Gesperrt" : "Löschen"} disabled={d.locked} onClick={() => deleteDrawing(chart, d.id)}>
          ✕
        </button>
      </span>
    </div>
  );
}

function DataWindow() {
  const slot = useWorkspace((w) => w.active);
  const chart = charts[slot];
  const symbol = useChart(chart, (s) => s.symbol);
  const tz = useChart(chart, (s) => resolveTimeZone(s.settings.timeZone));
  const data = useCrosshair(slot);
  const bar = data?.bars[data.index];
  if (!data || !bar) return <div className="object-empty">Keine Kursdaten</div>;
  const prev = data.bars[data.index - 1];
  const change = prev ? bar.close - prev.close : 0;
  const date = new Date(bar.time * 1000).toLocaleString("de-DE", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const row = (label: string, value: string, color?: string) => (
    <div className="data-row" key={label}>
      <span>{label}</span>
      <span style={color ? { color } : undefined}>{value}</span>
    </div>
  );
  return (
    <div className="data-window">
      <div className="object-group-title">{symbol}</div>
      {row("Datum", date)}
      {row("Eröffnung", formatPrice(bar.open))}
      {row("Hoch", formatPrice(bar.high))}
      {row("Tief", formatPrice(bar.low))}
      {row("Schluss", formatPrice(bar.close), bar.close >= bar.open ? "var(--up)" : "var(--down)")}
      {prev && row("Veränderung", `${change >= 0 ? "+" : ""}${formatPrice(change)} (${change >= 0 ? "+" : ""}${((change / prev.close) * 100).toLocaleString("de-DE", { maximumFractionDigits: 2 })} %)`, change >= 0 ? "var(--up)" : "var(--down)")}
      {row("Volumen", bar.volume.toLocaleString("de-DE", { maximumFractionDigits: 2 }))}
      {data.computed
        .filter((c) => !c.instance.hidden)
        .map((c) => {
          const outs = c.def.outputs.filter((o) => !o.helper);
          if (!outs.length) return null;
          return (
            <div key={c.instance.id}>
              <div className="object-group-title">{indicatorLabel(c.def, c.params)}</div>
              {outs.map((o) => {
                const v = c.outputs[o.key]?.[data.index];
                const k = c.def.outputs.indexOf(o);
                return row(o.label, v === null || v === undefined || !Number.isFinite(v) ? "–" : formatPrice(v), c.instance.colors?.[k] ?? o.color);
              })}
            </div>
          );
        })}
      <div className="object-hint">Werte unter dem Fadenkreuz, ohne Fadenkreuz die letzte Kerze.</div>
    </div>
  );
}
