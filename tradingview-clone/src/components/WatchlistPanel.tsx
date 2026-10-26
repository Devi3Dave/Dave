import { useState } from "react";
import { findAsset } from "../../shared/assets";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { loadChart, useChartState } from "../store";
import { createWatchlist, deleteWatchlist, moveInWatchlist, renameWatchlist, selectWatchlist, toggleInWatchlist, useQuotes, useWatchlists } from "../watchlists";
import { AssetSearchDialog } from "./AssetPicker";

const pctText = (v: number | null) => (v === null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")} %`);

/** Side-panel tab: several named watchlists with live price and 24 h change; a tap opens the chart. */
export function WatchlistPanel({ onOpenScreener }: { onOpenScreener: () => void }) {
  const lists = useWatchlists((s) => s.lists);
  const activeId = useWatchlists((s) => s.active);
  const list = lists.find((l) => l.id === activeId) ?? lists[0];
  const symbol = useChartState((s) => s.symbol);
  const interval = useChartState((s) => s.interval);
  const quotes = useQuotes(list.symbols);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const inList = list.symbols.includes(symbol);

  return (
    <div className="dm wl">
      <section>
        <div className="al-row">
          <select value={list.id} onChange={(e) => selectWatchlist(e.target.value)} aria-label="Watchlist wählen">
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.symbols.length})
              </option>
            ))}
          </select>
          <button className="pill" onClick={() => createWatchlist("")} data-tip="Neue Watchlist" aria-label="Neue Watchlist">
            ＋
          </button>
          <button className="pill" onClick={() => setRenaming(list.name)} data-tip="Umbenennen" aria-label="Watchlist umbenennen">
            ✎
          </button>
          <button className="pill" onClick={() => deleteWatchlist(list.id)} data-tip={lists.length > 1 ? "Watchlist löschen" : "Watchlist leeren"} aria-label="Watchlist löschen">
            🗑
          </button>
        </div>
        {renaming !== null && (
          <form
            className="al-row wl-rename"
            onSubmit={(e) => {
              e.preventDefault();
              renameWatchlist(list.id, renaming);
              setRenaming(null);
            }}
          >
            <div className="calc-input">
              <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="Name" />
            </div>
            <button className="pill" type="submit">
              OK
            </button>
          </form>
        )}
        <div className="al-row wl-actions">
          <button className="pill" onClick={() => toggleInWatchlist(symbol)} data-tip={inList ? "Aus dieser Liste entfernen" : "Den aktiven Chart zu dieser Liste hinzufügen"}>
            {inList ? "★" : "☆"} {symbol}
          </button>
          <button className="pill" onClick={() => setAdding(true)}>
            ＋ Symbol
          </button>
          <button className="pill" onClick={onOpenScreener} data-tip="Krypto-Screener: alle Binance-Paare filtern und sortieren">
            📊 Screener
          </button>
        </div>
      </section>

      <section>
        {list.symbols.length === 0 && <div className="dm-muted">Noch leer. Mit ☆ den aktiven Chart hinzufügen, über „＋ Symbol“ suchen oder im Screener auswählen.</div>}
        {list.symbols.map((s, i) => {
          const q = quotes[s];
          const name = findAsset(s)?.name;
          return (
            <div key={s} className={`wl-item ${s === symbol ? "active" : ""}`}>
              <button className="wl-open" onClick={() => s !== symbol && void loadChart(s, interval)} data-tip="Im Chart öffnen">
                <strong>{s}</strong>
                {name && <span className="dm-muted dm-small"> {name}</span>}
              </button>
              <span className="wl-price">
                {q ? formatPrice(q.price) : "…"}
                {q?.demo && <span className="dm-muted dm-small"> Demo</span>}
              </span>
              <span className={`wl-change ${q?.changePct == null ? "" : q.changePct >= 0 ? "up" : "down"}`}>{q ? pctText(q.changePct) : ""}</span>
              <span className="dm-row-actions wl-row-actions">
                <button onClick={() => moveInWatchlist(s, -1)} disabled={i === 0} aria-label="Nach oben" data-tip="Nach oben">
                  ↑
                </button>
                <button onClick={() => toggleInWatchlist(s, false)} aria-label={`${s} entfernen`} data-tip="Entfernen">
                  ✕
                </button>
              </span>
            </div>
          );
        })}
        {list.symbols.length > 0 && <div className="dm-muted dm-small">Krypto: Binance 24 h · andere: Veränderung zum Vortagesschluss · alle 15 s neu</div>}
      </section>
      {adding && <AssetSearchDialog title={`Zu „${list.name}“ hinzufügen`} onSelect={(s) => toggleInWatchlist(s, true)} onClose={() => setAdding(false)} />}
    </div>
  );
}
