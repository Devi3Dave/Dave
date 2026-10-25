import { useEffect, useMemo, useState } from "react";
import { ASSETS, ASSET_CATEGORIES, categoryOfFutures, findAsset, resolveAsset, searchAssets, type AssetCategory, type DataSource, type SearchHit } from "../../shared/assets";
import { refreshBinanceLists, symbolFor, toggleAssetFavorite, useAssets } from "../assetStore";
import { STANDALONE } from "../config";
import { loadChart, useChartState } from "../store";
import { Menu } from "./Menu";

type Tab = "fav" | AssetCategory;
type DialogTab = "all" | Tab;

const TAB_KEY = "chartai.assetPicker.tab.v1";

const SHORT: Record<AssetCategory, string> = {
  Krypto: "Krypto",
  Aktien: "Aktien",
  "Indizes & ETFs": "Indizes",
  Edelmetalle: "Metalle",
  Rohstoffe: "Rohstoffe",
  Forex: "Forex",
};

const BADGE: Record<DataSource, { label: string; tip: string }> = {
  binance: { label: "Live", tip: "Echte Kurse live von Binance" },
  binance_futures: { label: "Perp", tip: "Echte Kurse vom Binance-Perpetual (USDT, handelt rund um die Uhr)" },
  yahoo: { label: "Yahoo", tip: "Echte Kurse von Yahoo Finance (über den Server)" },
  demo: { label: "Demo", tip: "In der iPad-Version ohne Datenquelle: es werden Demo-Daten angezeigt" },
};

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (t === "fav" || ASSET_CATEGORIES.includes(t as AssetCategory)) return t as Tab;
  } catch {
    // default
  }
  return "Krypto";
}

/** Data source of a picker entry; pairs outside the catalog are Binance spot or perpetuals. */
function useSourceOf() {
  const futuresSet = useAssets((s) => s.futuresSet);
  return (hit: SearchHit): DataSource => {
    if (hit.asset) return resolveAsset(hit.asset, STANDALONE, futuresSet).source;
    return futuresSet?.has(hit.symbol) && hit.category !== "Krypto" ? "binance_futures" : hit.symbol.endsWith("USDT") ? "binance" : STANDALONE ? "demo" : "yahoo";
  };
}

/** Favorites as search hits; pairs not in the catalog are found in the Binance lists. */
function useFavoriteHits(): SearchHit[] {
  const favorites = useAssets((s) => s.favorites);
  const futures = useAssets((s) => s.futures);
  return favorites.map((symbol) => {
    const asset = ASSETS.find((a) => a.id === symbol);
    if (asset) return { symbol, name: asset.name, category: asset.category, asset };
    const f = futures.find((x) => x.symbol === symbol);
    if (f?.tradfi) return { symbol, name: `${f.base} (Binance-Perpetual)`, category: categoryOfFutures(f) };
    return { symbol, name: symbol.endsWith("USDT") ? symbol.replace(/USDT$/, " / Tether") : "Eigenes Symbol", category: "Krypto" as AssetCategory };
  });
}

function AssetRow({ hit, onPick }: { hit: SearchHit; onPick: () => void }) {
  const symbol = useChartState((s) => s.symbol);
  const interval = useChartState((s) => s.interval);
  const fav = useAssets((s) => s.favorites.includes(hit.symbol));
  const source = useSourceOf()(hit);
  const target = symbolFor(hit.symbol, hit.asset);
  const badge = BADGE[source];
  return (
    <div className="asset-row">
      <button
        className={`asset-item ${target === symbol ? "active" : ""}`}
        onClick={() => {
          if (target !== symbol) void loadChart(target, interval);
          onPick();
        }}
      >
        <strong>{hit.name}</strong>
        <span>{target === hit.symbol ? hit.symbol : `${hit.symbol} · ${target}`}</span>
        <em className={`asset-badge ${source}`} data-tip={badge.tip}>
          {badge.label}
        </em>
      </button>
      <button
        className={`fav-star ${fav ? "on" : ""}`}
        onClick={() => toggleAssetFavorite(hit.symbol)}
        data-tip={fav ? "Aus Favoriten entfernen" : "Als Favorit speichern"}
        aria-label={fav ? "Aus Favoriten entfernen" : "Als Favorit speichern"}
        aria-pressed={fav}
      >
        {fav ? "★" : "☆"}
      </button>
    </div>
  );
}

/** Drop-down next to the chart: popular assets by category plus favorites. */
export function AssetMenu({ onOpenSearch }: { onOpenSearch: () => void }) {
  const symbol = useChartState((s) => s.symbol);
  const [tab, setTab] = useState<Tab>(readTab);
  const favorites = useFavoriteHits();
  const name = findAsset(symbol)?.name;
  // The list of Binance perpetuals decides where stocks and metals load from on the iPad.
  useEffect(() => void refreshBinanceLists().catch(() => undefined), []);
  const pick = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // not remembered
    }
  };
  const hits: SearchHit[] =
    tab === "fav" ? favorites : ASSETS.filter((a) => a.category === tab).map((a) => ({ symbol: a.id, name: a.name, category: a.category, asset: a }));
  return (
    <Menu
      label={
        <>
          <strong>{symbol}</strong>
          {name && <span className="asset-name">{name}</span>}
          <span className="caret">▾</span>
        </>
      }
      className="asset-button"
      ariaLabel="Asset wählen"
      tip={"Asset wählen\nKrypto, Aktien, Indizes, Edelmetalle, Rohstoffe, Forex"}
    >
      {(close) => (
        <>
          <div className="asset-tabs">
            <button className={tab === "fav" ? "active" : ""} onClick={() => pick("fav")} aria-label="Favoriten">
              ★
            </button>
            {ASSET_CATEGORIES.map((c) => (
              <button key={c} className={tab === c ? "active" : ""} onClick={() => pick(c)}>
                {SHORT[c]}
              </button>
            ))}
          </div>
          {tab === "fav" && hits.length === 0 && <div className="menu-empty">Noch keine Favoriten. Mit ☆ neben einem Asset speichern.</div>}
          {hits.map((h) => (
            <AssetRow key={h.symbol} hit={h} onPick={close} />
          ))}
          <button
            className="menu-item asset-search-link"
            onClick={() => {
              close();
              onOpenSearch();
            }}
          >
            <span className="menu-icon">🔍</span>
            Alle Assets durchsuchen …
          </button>
        </>
      )}
    </Menu>
  );
}

const SECTION_LIMIT = 60;

/** Full-screen search over the catalog and every Binance pair, grouped by category, with favorites. */
export function AssetSearchDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<DialogTab>("all");
  const [loadingLists, setLoadingLists] = useState(true);
  const spot = useAssets((s) => s.spot);
  const futures = useAssets((s) => s.futures);
  const favorites = useFavoriteHits();
  const interval = useChartState((s) => s.interval);

  useEffect(() => {
    void refreshBinanceLists().finally(() => setLoadingLists(false));
  }, []);

  const hits = useMemo(() => searchAssets(query, spot, futures), [query, spot, futures]);
  const q = query.trim().toUpperCase();
  const favHits = favorites.filter((f) => !q || f.symbol.includes(q) || f.name.toUpperCase().includes(q));
  const sections: [string, SearchHit[]][] =
    tab === "fav"
      ? [["★ Favoriten", favHits]]
      : tab === "all"
        ? [
            ["★ Favoriten", favHits] as [string, SearchHit[]],
            ...ASSET_CATEGORIES.map((c) => [c, hits.filter((h) => h.category === c)] as [string, SearchHit[]]),
          ].filter(([, list]) => list.length > 0)
        : [[tab, hits.filter((h) => h.category === tab)]];
  const exact = hits.some((h) => h.symbol === q) || favHits.some((h) => h.symbol === q);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal asset-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Assets suchen</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <input
          autoFocus
          className="search"
          placeholder="Name oder Symbol, z. B. Gold, Tesla, PEPE, ^GDAXI …"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !q) return;
            const first = sections[0]?.[1][0];
            void loadChart(first ? symbolFor(first.symbol, first.asset) : q, interval);
            onClose();
          }}
        />
        <div className="asset-tabs wide">
          <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
            Alle
          </button>
          <button className={tab === "fav" ? "active" : ""} onClick={() => setTab("fav")}>
            ★ Favoriten
          </button>
          {ASSET_CATEGORIES.map((c) => (
            <button key={c} className={tab === c ? "active" : ""} onClick={() => setTab(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="indicator-list">
          {q && !exact && (
            <section>
              <h3>Eigenes Symbol</h3>
              <AssetRow hit={{ symbol: q, name: `„${q}“ direkt laden`, category: "Krypto" }} onPick={onClose} />
            </section>
          )}
          {sections.map(([title, list]) => (
            <section key={title}>
              <h3>
                {title} <span className="count">{list.length}</span>
              </h3>
              {list.length === 0 && <div className="menu-empty">{title.includes("Favoriten") ? "Noch keine Favoriten. Mit ☆ speichern." : "Nichts gefunden."}</div>}
              {list.slice(0, SECTION_LIMIT).map((h) => (
                <AssetRow key={h.symbol} hit={h} onPick={onClose} />
              ))}
              {list.length > SECTION_LIMIT && <div className="menu-empty">… {list.length - SECTION_LIMIT} weitere, Suche verfeinern</div>}
            </section>
          ))}
          {loadingLists && <div className="menu-empty">Lade alle Binance-Märkte …</div>}
        </div>
        <p className="hint">
          {STANDALONE
            ? "iPad-Version: Krypto live von Binance. Gold, Silber, Öl und viele US-Aktien kommen von Binance-Perpetuals (Perp). Für Assets mit „Demo“ gibt es hier keine Datenquelle."
            : "Krypto live von Binance, Aktien, Indizes, Rohstoffe und Forex über Yahoo Finance."}
        </p>
      </div>
    </div>
  );
}
