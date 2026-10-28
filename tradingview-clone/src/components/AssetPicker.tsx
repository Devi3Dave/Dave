import { useEffect, useMemo, useState } from "react";
import { ASSETS, ASSET_CATEGORIES, categoryOfFutures, findAsset, resolveAsset, searchAssets, type AssetCategory, type DataSource, type SearchHit } from "../../shared/assets";
import { refreshBinanceLists, refreshVenueMarkets, setCryptoForm, setCryptoVenue, setCheckOpen, setEuMode, setMicaOpen, symbolFor, toggleAssetFavorite, useAssets } from "../assetStore";
import { useFeedSettings } from "../market/exchangeFeed";
import { STANDALONE } from "../config";
import { loadChart, useChartState } from "../store";
import { formatSpread, parseSpread, SPREAD_OP_LABELS } from "../../shared/spread";
import { isBlockedSymbol, KIND_LABEL, marketTag, parseVenueSymbol, perpSymbol, pickerPerps, pickerVenues, VENUES, venueName, venueSymbol } from "../../shared/venues";
import { marketLabel, searchMarkets } from "../../shared/venueMarkets";
import { isCryptoSymbol } from "../../shared/marketData";
import { availabilityIn, EU_QUOTES, isEea, MICA, MICA_STATUS_ICON, MICA_STATUS_LABEL } from "../../shared/mica";
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
        <strong>{hit.name}</strong>
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

/** Exchange and form crypto loads from, like TradingView's exchange filter (BINANCE:BTCUSDT, COINBASE:BTCUSD, BYBIT:BTCUSDT.P …), with the MiCA status of each exchange. */
function VenueTabs() {
  const venue = useAssets((s) => s.venue);
  const form = useAssets((s) => s.form);
  const euMode = useAssets((s) => s.euMode);
  const country = useAssets((s) => s.country);
  const onlyAllowed = useAssets((s) => s.onlyAllowed);
  // A relay set or cleared changes which exchanges are offered.
  useProxyUrl();
  const offered = pickerVenues();
  const info = VENUES.find((v) => v.id === venue);
  const perps = pickerPerps(venue);
  const noSpot = info?.noSpot;
  const spotOn = (form === "spot" || !perps) && !noSpot;
  // The EU mode picks the EUR or USDC pair from the exchange's market list.
  useEffect(() => {
    if (euMode) void refreshVenueMarkets(venue).catch(() => undefined);
  }, [euMode, venue]);
  const filter = onlyAllowed && isEea(country);
  const shown = offered.filter((v) => !filter || v.id === venue || availabilityIn(country, v.id).spot === "yes");
  return (
    <div className="asset-tabs venue-tabs" role="group" aria-label="Krypto-Börse">
      <span className="venue-label">Börse</span>
      {shown.map((v) => {
        const status = MICA[v.id].status;
        return (
          <button
            key={v.id}
            className={venue === v.id ? "active" : ""}
            onClick={() => setCryptoVenue(v.id)}
            aria-pressed={venue === v.id}
            data-tip={`${v.id === "BINANCE" ? "Krypto von Binance (wie bisher)" : `Krypto direkt von ${v.name} laden, z. B. ${v.noSpot ? perpSymbol(v.id, "BTCUSDT") : venueSymbol(v.id, "BTCUSDT")}`}\n${MICA_STATUS_ICON[status]} ${MICA_STATUS_LABEL[status]}`}
          >
            {v.name}
            <span className={`mica-dot ${status}`} aria-label={MICA_STATUS_LABEL[status]}>
              {MICA_STATUS_ICON[status]}
            </span>
          </button>
        );
      })}
      {filter && shown.length < offered.length && <span className="venue-label">+{offered.length - shown.length} ausgeblendet</span>}
      <span className="venue-label venue-form-label">Form</span>
      <button className={spotOn ? "active" : ""} onClick={() => setCryptoForm("spot")} disabled={!!noSpot} aria-pressed={spotOn} data-tip={noSpot ?? "Spot-Paar (BTCUSDT)"}>
        Spot
      </button>
      <button
        className={(form === "perp" || noSpot) && perps ? "active" : ""}
        onClick={() => setCryptoForm("perp")}
        disabled={!perps}
        aria-pressed={(form === "perp" || !!noSpot) && perps}
        data-tip={perps ? "Perpetual-Kontrakt der Börse (BTCUSDT.P). Futures mit Laufzeit über 🔍 suchen, z. B. „btc futures“" : info?.perpBlocked ? `${venueName(venue)}-Perpetuals lassen sich im Browser nicht laden` : `${venueName(venue)} hat keine öffentlichen Perpetuals`}
      >
        Perp
      </button>
      <span className="venue-label venue-form-label">EU</span>
      <button
        className={euMode ? "active" : ""}
        onClick={() => setEuMode(!euMode)}
        aria-pressed={euMode}
        data-tip={euMode ? "EU-Modus an: EUR- und USDC-Paare statt USDT (MiCA)" : "EU-Modus: EUR- und USDC-Paare statt USDT bevorzugen (MiCA)"}
      >
        🇪🇺 EUR/USDC
      </button>
      <button onClick={() => setMicaOpen(true)} data-tip="Welche Börse ist MiCA-lizenziert, was ist in deinem Land erlaubt">
        MiCA-Info
      </button>
      <button onClick={() => setCheckOpen(true)} data-tip="Prüfen, welche Börse sich aus diesem Browser laden lässt (Kerzen, Live-Kurse, Marktliste)">
        🩺 Test
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
  const hits: SearchHit[] =
    tab === "fav" ? favorites : ASSETS.filter((a) => a.category === tab).map((a) => ({ symbol: a.id, name: a.name, category: a.category, asset: a }));
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
          {(tab === "Krypto" || tab === "fav") && <VenueTabs />}
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

  const hits = useMemo(() => searchAssets(query, spot, futures), [query, spot, futures]);
  const q = query.trim().toUpperCase();
  const proxyUrl = useProxyUrl();
  const marketHits: SearchHit[] = useMemo(
    () => (q && venueList ? searchMarkets(venueList.markets, query, euMode ? EU_QUOTES : undefined).filter((m) => !isBlockedSymbol(m.symbol)).map((m) => ({ symbol: m.symbol, name: marketLabel(m), category: "Krypto" as AssetCategory, fixed: true })) : []),
    [q, query, venueList, euMode, proxyUrl],
  );
  const favHits = favorites.filter((f) => !q || f.symbol.includes(q) || f.name.toUpperCase().includes(q));
  const crypto = tab === "all" || tab === "Krypto";
  const marketsTitle = `Alle Märkte bei ${venueName(venue)}`;
  const sections: [string, SearchHit[]][] =
    tab === "fav"
      ? [["★ Favoriten", favHits]]
      : tab === "all"
        ? [
            ["★ Favoriten", favHits] as [string, SearchHit[]],
            [marketsTitle, marketHits] as [string, SearchHit[]],
            ...ASSET_CATEGORIES.map((c) => [c, hits.filter((h) => h.category === c)] as [string, SearchHit[]]),
          ].filter(([, list]) => list.length > 0)
        : tab === "Krypto" && marketHits.length
          ? [[marketsTitle, marketHits], [tab, hits.filter((h) => h.category === tab)]]
          : [[tab, hits.filter((h) => h.category === tab)]];
  const exact = hits.some((h) => h.symbol === q) || favHits.some((h) => h.symbol === q) || marketHits.some((h) => h.symbol === q);
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
        <input
          autoFocus
          className="search"
          placeholder="Name oder Symbol, z. B. Gold, Tesla, btc perp, eth futures, KRAKEN:BTCEUR, BYBIT:BTCUSDT.P …"
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
        {(tab === "all" || tab === "fav" || tab === "Krypto") && <VenueTabs />}
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
          {q && !exact && !spread && (
            <section>
              <h3>Eigenes Symbol</h3>
              <AssetRow hit={{ symbol: q, name: `„${q}“ direkt laden`, category: "Krypto" }} onPick={onClose} onSelect={onSelect} />
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
          {loadingLists && <div className="menu-empty">Lade alle Binance-Märkte …</div>}
          {crypto && loadingMarkets && !venueList && <div className="menu-empty">Lade alle Märkte von {venueName(venue)} (Spot, Perpetuals, Futures) …</div>}
          {crypto && q && venueList && venueList.failed.length > 0 && (
            <div className="menu-empty">
              {venueName(venue)}: {venueList.failed.length} von den Marktlisten nicht erreichbar, die Suche ist unvollständig. Symbole wie {venue}:BTCUSDT.P lassen sich trotzdem direkt eintippen.
            </div>
          )}
        </div>
        <p className="hint">
          {STANDALONE
            ? "iPad-Version: Krypto live von Binance. Gold, Silber, Öl und viele US-Aktien kommen von Binance-Perpetuals (Perp). Für Assets mit „Demo“ gibt es hier keine Datenquelle."
            : "Krypto live von Binance, Aktien, Indizes, Rohstoffe und Forex über Yahoo Finance."}
          {" Krypto-Börse: oben wählen, von welcher Börse Krypto kommt (Binance, Coinbase, Kraken, Bybit, OKX, Bitstamp, Bitfinex, Bitget, KuCoin, Deribit, BitMEX) und ob als Spot oder Perpetual. ✓/⏳/✕ zeigt, ob die Börse MiCA-lizenziert ist (MiCA-Info: Wohnsitzland, Quellen, Stand). 🇪🇺 EUR/USDC lädt statt USDT das Euro- oder USDC-Paar. Die Suche zeigt alle Märkte der gewählten Börse: Spot-Paare, Perpetuals (.P), Futures mit Laufzeit und Optionen (Deribit, OKX, Binance), z. B. „btc perp“, „eth futures“ oder „btc call 100000“. Direkt eintippen geht auch: COINBASE:BTCUSD, BINANCE:BTCUSDT.P, OKX:BTC-USD-260327, DERIBIT:BTC-27MAR26-100000-C."}
          {" Spread-Charts: zwei Symbole mit / - + * verbinden, z. B. BTCUSDT/ETHUSDT oder GC=F / SI=F, oder den Preisunterschied zweier Börsen: COINBASE:BTCUSD - BINANCE:BTCUSDT."}
          {" Mit einem eigenen Twelve-Data-Schlüssel (Aktualitäts-Nachweis → Börsenkurs einrichten) kommen Aktien, Indizes und Forex als Börsenkurs („Börse“)."}
        </p>
      </div>
    </div>
  );
}
