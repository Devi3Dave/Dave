import { useMemo, useState } from "react";
import { INDICATORS, SOURCE_INDICATORS, getIndicator, indicatorLabel, resolveParams, type IndicatorCategory, type IndicatorDef } from "../../shared/indicators";
import { REFERENCE_KIND_LABEL, REFERENCE_KIND_TIP, indicatorReference } from "../../shared/indicatorReferences";
import { toggleFavorite, useFavorites } from "../favorites";
import { addIndicator, updateIndicator, useChartState } from "../store";

const CATEGORY_ORDER: IndicatorCategory[] = ["Krypto", "Muster", "Gleitende Durchschnitte", "Trend", "Momentum", "Volatilität", "Volumen"];

export function IndicatorDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return INDICATORS.filter((d) => !q || d.name.toLowerCase().includes(q) || d.id.includes(q) || d.description.toLowerCase().includes(q) || !!indicatorReference(d.id)?.source.toLowerCase().includes(q));
  }, [query]);
  const favorites = useFavorites();
  const favoriteDefs = favorites.map((id) => filtered.find((d) => d.id === id)).filter((d): d is IndicatorDef => !!d);
  const categories = CATEGORY_ORDER.filter((c) => filtered.some((d) => d.category === c));
  const item = (d: IndicatorDef, section: string) => {
    const fav = favorites.includes(d.id);
    return (
      <div className="indicator-row" key={`${section}-${d.id}`}>
        <button
          className="indicator-item"
          onClick={() => {
            addIndicator(d.id, resolveParams(d), "user");
            onClose();
          }}
        >
          <strong>{d.name}</strong>
          <span>{d.description}</span>
          <Reference id={d.id} />
          <em>{d.overlay ? "Overlay" : "Panel"}</em>
        </button>
        <button
          className={`fav-star ${fav ? "on" : ""}`}
          onClick={() => toggleFavorite(d.id)}
          data-tip={fav ? "Aus Favoriten entfernen" : "Als Favorit markieren\nErscheint oben und im ★-Menü"}
          aria-label={fav ? "Aus Favoriten entfernen" : "Als Favorit markieren"}
          aria-pressed={fav}
        >
          {fav ? "★" : "☆"}
        </button>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Indikatoren</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <input autoFocus className="search" placeholder="Suchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="indicator-list">
          {favoriteDefs.length > 0 && (
            <section>
              <h3>★ Favoriten</h3>
              {favoriteDefs.map((d) => item(d, "fav"))}
            </section>
          )}
          {categories.map((cat) => (
            <section key={cat}>
              <h3>{cat}</h3>
              {filtered.filter((d) => d.category === cat).map((d) => item(d, cat))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function IndicatorSettings({ id, onClose }: { id: string; onClose: () => void }) {
  const inst = useChartState((s) => s.indicators.find((i) => i.id === id));
  const all = useChartState((s) => s.indicators);
  const def = inst ? getIndicator(inst.type) : undefined;
  if (!inst || !def) return null;
  const params = resolveParams(def, inst.params);
  // Lines of the indicators above this one can be its input (TradingView's "Source").
  const sources = SOURCE_INDICATORS.has(def.id)
    ? all.slice(0, all.indexOf(inst)).flatMap((other) => {
        const d = getIndicator(other.type);
        if (!d) return [];
        const name = indicatorLabel(d, resolveParams(d, other.params));
        const lines = d.outputs.filter((o) => !o.helper && !o.sparse);
        return lines.map((o) => ({ value: `${other.id}:${o.key}`, label: lines.length > 1 ? `${name} · ${o.label}` : name }));
      })
    : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{def.name}</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="settings-grid">
          {sources.length > 0 && (
            <label>
              Quelle
              <select
                value={inst.source ? `${inst.source.id}:${inst.source.output}` : ""}
                onChange={(e) => {
                  const [sid, output] = e.target.value.split(":");
                  updateIndicator(id, { source: e.target.value ? { id: sid, output } : undefined });
                }}
              >
                <option value="">Schlusskurs</option>
                {sources.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {def.params.map((p) => (
            <label key={p.key}>
              {p.label}
              <input
                type="number"
                value={params[p.key]}
                min={p.min}
                max={p.max}
                step={p.step ?? 1}
                onChange={(e) => updateIndicator(id, { params: { ...inst.params, [p.key]: Number(e.target.value) } })}
              />
            </label>
          ))}
          {def.outputs.map((o, k) => o.helper ? null : (
            <label key={o.key}>
              Farbe {o.label}
              <input
                type="color"
                value={(inst.colors?.[k] ?? o.color).slice(0, 7)}
                onChange={(e) => {
                  const colors = def.outputs.map((out, j) => inst.colors?.[j] ?? out.color);
                  colors[k] = e.target.value;
                  updateIndicator(id, { colors });
                }}
              />
            </label>
          ))}
        </div>
        <p className="hint">{def.description}</p>
        <Reference id={def.id} />
      </div>
    </div>
  );
}

/** "Quelle: …" line with a badge saying how the formula is backed (TA-Lib checked, original, approximation …). */
function Reference({ id }: { id: string }) {
  const ref = indicatorReference(id);
  if (!ref) return null;
  return (
    <small className="indicator-source">
      <b className={`ref-${ref.kind}`} data-tip={REFERENCE_KIND_TIP[ref.kind]}>
        {REFERENCE_KIND_LABEL[ref.kind]}
      </b>{" "}
      Quelle: {ref.source}
    </small>
  );
}
