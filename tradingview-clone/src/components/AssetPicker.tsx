import { useEffect, useMemo, useState } from "react";
import { ASSETS, ASSET_CATEGORIES, categoryOfFutures, findAsset, resolveAsset, searchAssets, type AssetCategory, type DataSource, type SearchHit } from "../../shared/assets";
import { refreshBinanceLists, refreshVenueMarkets, setCryptoForm, setCryptoVenue, setCheckOpen, setEuMode, setMicaOpen, setShowDemo, symbolFor, toggleAssetFavorite, useAssets } from "../assetStore";
import { useFeedSettings } from "../market/exchangeFeed";
import { STANDALONE } from "../config";
import { loadChart, useChartState } from "../store";
import { formatSpread, parseSpread, SPREAD_OP_LABELS } from "../../shared/spread";
import { isBlockedSymbol, KIND_LABEL, marketTag, parseVenueSymbol, pickerPerps, pickerVenues, plainSymbol, splitPair, VENUES, venueName, type VenueId } from "../../shared/venues";
import { marketLabel, searchMarkets } from "../../shared/venueMarkets";
import { isCryptoSymbol } from "../../shared/marketData";
import { availabilityIn, EU_QUOTES, isEea } from "../../shared/mica";
import type { Interval } from "../store";
import { useProxyUrl } from "../proxySettings";
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
  twelvedata: { label: "Börse", tip: "Börsenkurs von Twelve Data (mit deinem Schlüssel)" },
  venue: { label: "Börse", tip: "Echte Kurse live direkt von dieser Krypto-Börse" },
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
  const feed = useFeedSettings().apiKey.length > 0;
  useAssets((s) => `${s.venue}${s.form}${s.euMode}${!!s.markets[s.venue]}`); // the exchange, form and EU mode decide where crypto loads from
  return (hit: SearchHit): DataSource => {
    if (hit.symbol.includes(":") || (!hit.fixed && hit.category === "Krypto" && symbolFor(hit.symbol, hit.asset, true).includes(":"))) return "venue";
    if (hit.asset) return resolveAsset(hit.asset, STANDALONE, futuresSet, feed).source;
    return futuresSet?.has(hit.symbol) && hit.category !== "Krypto" ? "binance_futures" : hit.symbol.endsWith("USDT") ? "binance" : STANDALONE ? "demo" : "yahoo";
  };
}

/**
 * Whether a picker entry gets real prices. On the iPad, assets without a data source only show demo
 * candles; they stay hidden unless „Demo-Assets zeigen“ is on.
 */
function useLoadable() {
  const sourceOf = useSourceOf();
  const showDemo = useAssets((s) => s.showDemo);
  return (hit: SearchHit) => showDemo || sourceOf(hit) !== "demo";
}

/** Favorites as search hits; pairs not in the catalog are found in the Binance lists. */
function useFavoriteHits(): SearchHit[] {
  const favorites = useAssets((s) => s.favorites);
  const futures = useAssets((s) => s.futures);
  return favorites.map((symbol) => {
    const inst = parseVenueSymbol(symbol);
    if (inst) return { symbol, name: `${findAsset(symbol)?.name ?? `${inst.pair.base} / ${inst.pair.quote}`} · ${KIND_LABEL[inst.kind]}`, category: "Krypto" as AssetCategory, fixed: true };
    const asset = ASSETS.find((a) => a.id === symbol);
    if (asset) return { symbol, name: asset.name, category: asset.category, asset };
    const f = futures.find((x) => x.symbol === symbol);
    if (f?.tradfi) return { symbol, name: `${f.base} (Binance-Perpetual)`, category: categoryOfFutures(f) };
    return { symbol, name: symbol.endsWith("USDT") ? symbol.replace(/USDT$/, " / Tether") : "Eigenes Symbol", category: "Krypto" as AssetCategory };
  });
}

/** `onSelect` replaces loading the chart (the comparison picks a symbol this way). */
function AssetRow({ hit, onPick, onSelect }: { hit: SearchHit; onPick: () => void; onSelect?: (symbol: string) => void }) {
  const symbol = useChartState((s) => s.symbol);
  const interval = useChartState((s) => s.interval);
  const fav = useAssets((s) => s.favorites.includes(hit.symbol));
  const source = useSourceOf()(hit);
  const target = hit.fixed ? hit.symbol : symbolFor(hit.symbol, hit.asset, hit.category === "Krypto");
  const badge = source === "venue" ? { label: venueName(target.split(":")[0]), tip: `Echte Kurse live direkt von ${venueName(target.split(":")[0])}` } : BADGE[source];
  return (
    <div className="asset-row">
      <button
        className={`asset-item ${target === symbol ? "active" : ""}`}
        onClick={() => {
          if (onSelect) onSelect(target);
          else if (target !== symbol) void loadChart(target, interval);
          onPick();
        }}
      >
        <strong>
          {target === symbol && <span className="asset-check" aria-label="Gewählt">✓ </span>}
          {hit.name}
        </strong>
        <span>{target === hit.symbol || target.includes(":") ? target : `${hit.symbol} · ${target}`}</span>
        {/* Hints open to the left so they never cover the stars of the rows below. */}
        <em className={`asset-badge ${source}`} data-tip={badge.tip} data-tip-placement="left">
          {badge.label}
        </em>
      </button>
      <button
        className={`fav-star ${fav ? "on" : ""}`}
        onClick={() => toggleAssetFavorite(hit.symbol)}
        data-tip={fav ? "Aus Favoriten entfernen" : "Als Favorit speichern"}
        data-tip-placement="left"
        aria-label={fav ? "Aus Favoriten entfernen" : "Als Favorit speichern"}
        aria-pressed={fav}
      >
        {fav ? "★" : "☆"}
      </button>
    </div>
  );
}

/** Exchange and form crypto loads from, like TradingView's source filter: one drop-down and Spot / Perp. */
function MarketBar() {
  const venue = useAssets((s) => s.venue);
  const form = useAssets((s) => s.form);
  const euMode = useAssets((s) => s.euMode);
  const country = useAssets((s) => s.country);
  const onlyAllowed = useAssets((s) => s.onlyAllowed);
  // A relay set or cleared changes which exchanges are offered.
  useProxyUrl();
  const info = VENUES.find((v) => v.id === venue);
  const perps = pickerPerps(venue);
  const noSpot = info?.noSpot;
  const spotOn = (form === "spot" || !perps) && !noSpot;
  const perpOn = (form === "perp" || !!noSpot) && perps;
  // The EU mode picks the EUR or USDC pair from the exchange's market list.
  useEffect(() => {
    if (euMode) void refreshVenueMarkets(venue).catch(() => undefined);
  }, [euMode, venue]);
  // Only exchanges this browser can load (blocked ones need the own proxy), and in the EEA optionally only allowed ones.
  const filter = onlyAllowed && isEea(country);
  const shown = pickerVenues().filter((v) => !filter || v.id === venue || availabilityIn(country, v.id).spot === "yes");
  return (
    <div className="market-bar" role="group" aria-label="Krypto-Börse">
      <label className="market-venue" data-tip="Von welcher Börse Krypto kommt">
        <span>Börse</span>
        <select value={venue} onChange={(e) => setCryptoVenue(e.target.value as VenueId)}>
          {shown.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <div className="segmented">
        <button className={spotOn ? "active" : ""} onClick={() => setCryptoForm("spot")} disabled={!!noSpot} aria-pressed={spotOn} data-tip={noSpot ?? "Spot-Paar (BTCUSDT)"}>
          Spot
        </button>
        <button
          className={perpOn ? "active" : ""}
          onClick={() => setCryptoForm("perp")}
          disabled={!perps}
          aria-pressed={perpOn}
          data-tip={perps ? "Perpetual-Kontrakt der Börse (BTCUSDT.P). Futures mit Laufzeit über die Suche, z. B. „btc futures“" : `${venueName(venue)} hat hier keine ladbaren Perpetuals`}
        >
          Perp
        </button>
      </div>
      {euMode && (
        <span className="market-eu" data-tip="EU-Modus an: EUR- und USDC-Paare statt USDT (⚙ zum Ausschalten)">
          🇪🇺 EUR/USDC
        </span>
      )}
    </div>
  );
}

/**
 * Turns the EU mode on or off and moves the loaded crypto spot pair along (BTCUSDT → BTCEUR and back), so the switch
 * shows at once. Returns a line saying what happened, or why nothing changed.
 */
async function switchEuMode(next: boolean, symbol: string, interval: Interval, venue: VenueId, form: string): Promise<string> {
  setEuMode(next);
  const inst = parseVenueSymbol(symbol);
  const crypto = inst ? inst.kind : isCryptoSymbol(symbol) ? "spot" : null;
  const what = next ? "EUR- und USDC-Paare an" : "Wieder USDT-Paare";
  if (!crypto) return `${what}. Gilt nur für Krypto-Spot: wähle unter Krypto ein Asset, es lädt dann z. B. als BTC/EUR.`;
  if (crypto !== "spot" || form === "perp") return `${what}. Perps und Futures laufen in USDT oder USD, dafür gibt es keine EUR-Paare; die Umstellung wirkt unter Spot.`;
  if ((inst ? inst.venue.id : "BINANCE") !== venue) return `${what} für ${venueName(venue)}. Das geladene Paar ist von einer anderen Börse und bleibt.`;
  await Promise.all([refreshVenueMarkets(venue).catch(() => undefined), refreshBinanceLists().catch(() => undefined)]);
  const base = (inst ? inst.pair : splitPair(symbol))?.base;
  if (!base) return what;
  const target = symbolFor(`${base}USDT`, undefined, true);
  const pair = splitPair(plainSymbol(target));
  const label = pair ? `${pair.base}/${pair.quote}` : target;
  if (next && pair && !EU_QUOTES.includes(pair.quote)) return `${what}, aber ${venueName(venue)} hat für ${base} kein EUR- oder USDC-Paar; der Chart bleibt bei ${label}.`;
  if (target !== symbol) await loadChart(target, interval);
  return `${what}: Chart zeigt jetzt ${label} bei ${venueName(venue)}.`;
}

/** ⚙ next to the categories: rarely used settings, so the picker itself stays calm. */
function PickerSettings({ onAction }: { onAction: () => void }) {
  const euMode = useAssets((s) => s.euMode);
  const showDemo = useAssets((s) => s.showDemo);
  const venue = useAssets((s) => s.venue);
  const form = useAssets((s) => s.form);
  const symbol = useChartState((s) => s.symbol);
  const interval = useChartState((s) => s.interval);
  const [euNote, setEuNote] = useState<string | null>(null);
  return (
    <div className="picker-settings">
      <button
        className="menu-item"
        onClick={() => {
          setEuNote("Stelle um …");
          void switchEuMode(!euMode, symbol, interval, venue, form).then(setEuNote, () => setEuNote(null));
        }}
        aria-pressed={euMode}
      >
        <span className="menu-icon">🇪🇺</span>
        <span className="picker-settings-text">
          EUR- und USDC-Paare statt USDT (MiCA)
          <small>Krypto-Spot lädt das Euro-Paar, sonst USDC, z. B. BTC/EUR statt BTC/USDT</small>
        </span>
        <span className="picker-settings-check">{euMode ? "✓" : ""}</span>
      </button>
      {euNote && <div className="picker-settings-note">{euNote}</div>}
      <button
        className="menu-item"
        onClick={() => {
          onAction();
          setMicaOpen(true);
        }}
      >
        <span className="menu-icon">ℹ️</span>
        <span className="picker-settings-text">MiCA-Info: Lizenzen der Börsen, Wohnsitzland</span>
      </button>
      <button
        className="menu-item"
        onClick={() => {
          onAction();
          setCheckOpen(true);
        }}
      >
        <span className="menu-icon">🩺</span>
        <span className="picker-settings-text">Verbindungstest und eigener Proxy</span>
      </button>
      {STANDALONE && (
        <button className="menu-item" onClick={() => setShowDemo(!showDemo)} aria-pressed={showDemo}>
          <span className="menu-icon">🧪</span>
          <span className="picker-settings-text">Demo-Assets zeigen (ohne echte Kurse)</span>
          <span className="picker-settings-check">{showDemo ? "✓" : ""}</span>
        </button>
      )}
    </div>
  );
}

function GearButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button className={`picker-gear ${open ? "active" : ""}`} onClick={onToggle} aria-expanded={open} aria-label="Weitere Einstellungen" data-tip="EU-Paare, MiCA-Info, Verbindungstest und Proxy">
      ⚙
    </button>
  );
}

/** Categories that have at least one loadable asset (on the iPad some only have demo data). */
function useCategories(): AssetCategory[] {
  const loadable = useLoadable();
  return ASSET_CATEGORIES.filter((c) => c === "Krypto" || ASSETS.some((a) => a.category === c && loadable({ symbol: a.id, name: a.name, category: a.category, asset: a })));
}

/** Drop-down next to the chart: popular assets by category plus favorites. */
export function AssetMenu({ onOpenSearch }: { onOpenSearch: () => void }) {
  const symbol = useChartState((s) => s.symbol);
  const [stored, setTab] = useState<Tab>(readTab);
  const [gear, setGear] = useState(false);
  const favorites = useFavoriteHits();
  const loadable = useLoadable();
  const categories = useCategories();
  // A category without loadable assets is hidden; fall back to crypto.
  const tab: Tab = stored === "fav" || categories.includes(stored) ? stored : "Krypto";
  const name = findAsset(symbol)?.name;
  // Exchange and form of what is loaded, so the choice is clear at a glance (Kraken · Spot · BTC/USD).
  const tag = marketTag(symbol)?.split(" · ").slice(0, 2).join(" · ") ?? (isCryptoSymbol(symbol) ? "Binance · Spot" : null);
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
  const hits: SearchHit[] = (
    tab === "fav" ? favorites : ASSETS.filter((a) => a.category === tab).map((a) => ({ symbol: a.id, name: a.name, category: a.category, asset: a }))
  ).filter(loadable);
  return (
    <Menu
      label={
        <>
          <strong>{symbol}</strong>
          {name && <span className="asset-name">{name}</span>}
          {tag && <span className="asset-market">{tag}</span>}
          <span className="caret">▾</span>
        </>
      }
      className="asset-button"
      ariaLabel="Asset wählen"
      tip={"Asset wählen\nKrypto, Aktien, Indizes, Edelmetalle, Rohstoffe, Forex"}
    >
      {(close) => (
        <>
          <button
            className="asset-search-field"
            onClick={() => {
              close();
              onOpenSearch();
            }}
          >
            <span className="menu-icon">🔍</span>
            Suchen …
          </button>
          <div className="asset-tabs-bar">
            <div className="asset-tabs">
              <button className={tab === "fav" ? "active" : ""} onClick={() => pick("fav")} aria-label="Favoriten">
                ★
              </button>
              {categories.map((c) => (
                <button key={c} className={tab === c ? "active" : ""} onClick={() => pick(c)}>
                  {SHORT[c]}
                </button>
              ))}
            </div>
            <GearButton open={gear} onToggle={() => setGear(!gear)} />
          </div>
          {gear && <PickerSettings onAction={close} />}
          {(tab === "Krypto" || tab === "fav") && <MarketBar />}
          {tab === "fav" && hits.length === 0 && <div className="menu-empty">Noch keine Favoriten. Mit ☆ neben einem Asset speichern.</div>}
          {hits.map((h) => (
            <AssetRow key={h.symbol} hit={h} onPick={close} />
          ))}
        </>
      )}
    </Menu>
  );
}

const SECTION_LIMIT = 60;

/** Full-screen search over the catalog and every Binance pair, grouped by category, with favorites. */
export function AssetSearchDialog({ onClose, onSelect, title = "Assets suchen" }: { onClose: () => void; onSelect?: (symbol: string) => void; title?: string }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<DialogTab>("all");
  const [loadingLists, setLoadingLists] = useState(true);
  const spot = useAssets((s) => s.spot);
  const futures = useAssets((s) => s.futures);
  const favorites = useFavoriteHits();
  const interval = useChartState((s) => s.interval);
  const venue = useAssets((s) => s.venue);
  const venueList = useAssets((s) => s.markets[venue]);
  const euMode = useAssets((s) => s.euMode);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [gear, setGear] = useState(false);
  const loadable = useLoadable();
  const categories = useCategories();
  const symbol = useChartState((s) => s.symbol);
  const current = findAsset(symbol)?.name;
  const currentTag = marketTag(symbol)?.split(" · ").slice(0, 2).join(" · ") ?? (isCryptoSymbol(symbol) ? "Binance · Spot" : null);

  useEffect(() => {
    void refreshBinanceLists().finally(() => setLoadingLists(false));
  }, []);
  // Every spot pair, perpetual and future of the chosen exchange, for the search.
  useEffect(() => {
    setLoadingMarkets(true);
    void refreshVenueMarkets(venue)
      .catch(() => undefined)
      .finally(() => setLoadingMarkets(false));
  }, [venue]);

  const found = useMemo(() => searchAssets(query, spot, futures), [query, spot, futures]);
  const hits = found.filter(loadable);
  const q = query.trim().toUpperCase();
  const proxyUrl = useProxyUrl();
  const marketHits: SearchHit[] = useMemo(
    () => (q && venueList ? searchMarkets(venueList.markets, query, euMode ? EU_QUOTES : undefined).filter((m) => !isBlockedSymbol(m.symbol)).map((m) => ({ symbol: m.symbol, name: marketLabel(m), category: "Krypto" as AssetCategory, fixed: true })) : []),
    [q, query, venueList, euMode, proxyUrl],
  );
  const favHits = favorites.filter((f) => loadable(f) && (!q || f.symbol.includes(q) || f.name.toUpperCase().includes(q)));
  const crypto = tab === "all" || tab === "Krypto";
  const marketsTitle = `Alle Märkte bei ${venueName(venue)}`;
  const sections: [string, SearchHit[]][] =
    tab === "fav"
      ? [["★ Favoriten", favHits]]
      : tab === "all"
        ? [
            ["★ Favoriten", favHits] as [string, SearchHit[]],
            [marketsTitle, marketHits] as [string, SearchHit[]],
            ...categories.map((c) => [c, hits.filter((h) => h.category === c)] as [string, SearchHit[]]),
          ].filter(([, list]) => list.length > 0)
        : tab === "Krypto" && marketHits.length
          ? [[marketsTitle, marketHits], [tab, hits.filter((h) => h.category === tab)]]
          : [[tab, hits.filter((h) => h.category === tab)]];
  const ownHit: SearchHit = { symbol: q, name: `„${q}“ direkt laden`, category: "Krypto" };
  const exact = found.some((h) => h.symbol === q) || favHits.some((h) => h.symbol === q) || marketHits.some((h) => h.symbol === q);
  const spread = parseSpread(q);
  const select = (target: string) => (onSelect ? onSelect(target) : void loadChart(target, interval));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal asset-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="asset-current" aria-label="Gewähltes Asset">
          <span className="asset-check">✓</span>
          <strong>{symbol}</strong>
          {current && <span>{current}</span>}
          {currentTag && <span className="asset-market">{currentTag}</span>}
        </div>
        <input
          autoFocus
          className="search"
          placeholder="Name oder Symbol, z. B. Gold, Tesla, btc perp"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !q) return;
            const first = sections[0]?.[1][0];
            select(spread ? formatSpread(spread) : first ? (first.fixed ? first.symbol : symbolFor(first.symbol, first.asset, first.category === "Krypto")) : q);
            onClose();
          }}
        />
        <div className="asset-tabs-bar">
          <div className="asset-tabs scroll wide">
            <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
              Alle
            </button>
            <button className={tab === "fav" ? "active" : ""} onClick={() => setTab("fav")}>
              ★ Favoriten
            </button>
            {categories.map((c) => (
              <button key={c} className={tab === c ? "active" : ""} onClick={() => setTab(c)}>
                {c}
              </button>
            ))}
          </div>
          <GearButton open={gear} onToggle={() => setGear(!gear)} />
        </div>
        {gear && <PickerSettings onAction={onClose} />}
        {(tab === "all" || tab === "fav" || tab === "Krypto") && <MarketBar />}
        <div className="indicator-list">
          {spread && (
            <section>
              <h3>Spread-Chart</h3>
              <div className="asset-row">
                <button
                  className="asset-item"
                  onClick={() => {
                    select(formatSpread(spread));
                    onClose();
                  }}
                >
                  <strong>{formatSpread(spread)}</strong>
                  <span>{SPREAD_OP_LABELS[spread.op]} aus beiden Kursen, Kerze für Kerze</span>
                </button>
              </div>
            </section>
          )}
          {q && !exact && !spread && loadable(ownHit) && (
            <section>
              <h3>Eigenes Symbol</h3>
              <AssetRow hit={ownHit} onPick={onClose} onSelect={onSelect} />
            </section>
          )}
          {sections.map(([title, list]) => (
            <section key={title}>
              <h3>
                {title} <span className="count">{list.length}</span>
              </h3>
              {list.length === 0 && <div className="menu-empty">{title.includes("Favoriten") ? "Noch keine Favoriten. Mit ☆ speichern." : "Nichts gefunden."}</div>}
              {list.slice(0, SECTION_LIMIT).map((h) => (
                <AssetRow key={h.symbol} hit={h} onPick={onClose} onSelect={onSelect} />
              ))}
              {list.length > SECTION_LIMIT && <div className="menu-empty">… {list.length - SECTION_LIMIT} weitere, Suche verfeinern</div>}
            </section>
          ))}
          {q && found.length > hits.length && (
            <div className="menu-empty">
              {found.length - hits.length} ohne echte Kurse ausgeblendet ({found.filter((h) => !loadable(h)).slice(0, 3).map((h) => h.name).join(", ")}). Zeigen: ⚙ → Demo-Assets zeigen, oder unter Aktualitäts-Nachweis einen Börsenkurs einrichten.
            </div>
          )}
          {loadingLists && <div className="menu-empty">Lade alle Binance-Märkte …</div>}
          {crypto && loadingMarkets && !venueList && <div className="menu-empty">Lade alle Märkte von {venueName(venue)} (Spot, Perpetuals, Futures) …</div>}
          {crypto && q && venueList && venueList.failed.length > 0 && (
            <div className="menu-empty">
              Nicht alle Marktlisten von {venueName(venue)} sind erreichbar, manche Märkte fehlen in der Suche.
            </div>
          )}
        </div>
        <details className="hint asset-tips">
          <summary>Suchtipps</summary>
          <p>
          {STANDALONE
            ? "iPad-Version: Krypto live von Binance. Gold, Silber, Öl und viele US-Aktien kommen von Binance-Perpetuals (Perp). Assets ohne Datenquelle sind ausgeblendet (⚙ → Demo-Assets zeigen)."
            : "Krypto live von Binance, Aktien, Indizes, Rohstoffe und Forex über Yahoo Finance."}
          {" Krypto: oben Börse und Spot oder Perp wählen; ⚙ hat EUR/USDC-Paare, MiCA-Info und den Verbindungstest mit Proxy. Die Suche zeigt alle Märkte der gewählten Börse: Spot-Paare, Perpetuals (.P), Futures mit Laufzeit und Optionen (Deribit, OKX, Binance), z. B. „btc perp“, „eth futures“ oder „btc call 100000“. Direkt eintippen geht auch: COINBASE:BTCUSD, BINANCE:BTCUSDT.P, OKX:BTC-USD-260327, DERIBIT:BTC-27MAR26-100000-C."}
          {" Spread-Charts: zwei Symbole mit / - + * verbinden, z. B. BTCUSDT/ETHUSDT oder GC=F / SI=F, oder den Preisunterschied zweier Börsen: COINBASE:BTCUSD - BINANCE:BTCUSDT."}
          {" Mit einem eigenen Twelve-Data-Schlüssel (Aktualitäts-Nachweis → Börsenkurs einrichten) kommen Aktien, Indizes und Forex als Börsenkurs („Börse“)."}
          </p>
        </details>
      </div>
    </div>
  );
}
