import { useMemo, useState } from "react";
import { INDICATORS, getIndicator, resolveParams, type IndicatorCategory, type IndicatorDef } from "../../shared/indicators";
import { toggleFavorite, useFavorites } from "../favorites";
import { addIndicator, updateIndicator, useChartState } from "../store";

const CATEGORY_ORDER: IndicatorCategory[] = ["Krypto", "Muster", "Gleitende Durchschnitte", "Trend", "Momentum", "Volatilität", "Volumen"];

export function IndicatorDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return INDICATORS.filter((d) => !q || d.name.toLowerCase().includes(q) || d.id.includes(q) || d.description.toLowerCase().includes(q));
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
  const def = inst ? getIndicator(inst.type) : undefined;
  if (!inst || !def) return null;
  const params = resolveParams(def, inst.params);

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
          {def.outputs.map((o, k) => (
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
      </div>
    </div>
  );
}
