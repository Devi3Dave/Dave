import { Fragment, useEffect, useMemo, useState } from "react";
import { chartSymbols, DEFAULT_RANK_FILTER, rankList, sampleRanking, volumeShare, type CoinRow, type RankFilter, type RankingData, type RankSort } from "../../shared/rankings";
import { fetchRankings, PAGE_SIZE, readRankSettings, saveRankSettings, type RankSettings } from "../rankings";
import { loadChart, useChartState } from "../store";
import { fetchTickers, toggleInWatchlist, useWatchlists } from "../watchlists";

/** CoinGecko allows about 30 calls a minute without a key, so the list refreshes every 2 minutes. */
const REFRESH_MS = 120_000;
const MAX_PAGES = 4;

const SOURCE_LABEL: Record<RankingData["source"], string> = {
  coingecko: "CoinGecko",
  coinpaprika: "CoinPaprika",
  sample: "Beispieldaten",
};

const de = (v: number, digits: number) => v.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (v: number | null, digits = 2) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${de(v, digits)} %`);
const tone = (v: number | null) => (v == null ? "" : v >= 0 ? "up" : "down");

/** Large amounts the way German sites write them: Bio. (10¹²), Mrd. (10⁹), Mio. (10⁶). */
function big(v: number | null, unit = ""): string {
  if (v == null) return "–";
  const u = unit ? ` ${unit}` : "";
  if (Math.abs(v) >= 1e12) return `${de(v / 1e12, 2)} Bio.${u}`;
  if (Math.abs(v) >= 1e9) return `${de(v / 1e9, 2)} Mrd.${u}`;
  if (Math.abs(v) >= 1e6) return `${de(v / 1e6, 2)} Mio.${u}`;
  return `${de(v, 0)}${u}`;
}

function price(v: number, cur: string): string {
  if (v >= 1) return `${de(v, 2)} ${cur}`;
  // Small coins keep four significant digits (0,00001234).
  return `${v.toLocaleString("de-DE", { maximumSignificantDigits: 4 })} ${cur}`;
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="dm-muted">–</span>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points.map((p, i) => `${((i / (points.length - 1)) * 100).toFixed(1)},${(28 - ((p - min) / span) * 26).toFixed(1)}`).join(" ");
  return (
    <svg className={`rk-spark ${points[points.length - 1] >= points[0] ? "up" : "down"}`} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={d} />
    </svg>
  );
}

const COLUMNS: { key: RankSort; label: string; tip: string; wide?: boolean }[] = [
  { key: "rank", label: "#", tip: "Rang nach Marktkapitalisierung" },
  { key: "name", label: "Name", tip: "Coin" },
  { key: "price", label: "Kurs", tip: "Aktueller Kurs" },
  { key: "change1h", label: "1 h", tip: "Veränderung über 1 Stunde", wide: true },
  { key: "change24h", label: "24 h", tip: "Veränderung über 24 Stunden" },
  { key: "change7d", label: "7 T", tip: "Veränderung über 7 Tage" },
  { key: "change30d", label: "30 T", tip: "Veränderung über 30 Tage", wide: true },
  { key: "marketCap", label: "Marktkap.", tip: "Marktkapitalisierung: Kurs × Umlaufmenge" },
  { key: "volume", label: "Volumen 24 h", tip: "Handelsvolumen der letzten 24 Stunden über alle Börsen" },
  { key: "volumeShare", label: "Vol./MK", tip: "Volumen im Verhältnis zur Marktkapitalisierung", wide: true },
  { key: "circulating", label: "Umlauf", tip: "Umlaufende Menge", wide: true },
];

function Detail({ c, cur }: { c: CoinRow; cur: string }) {
  const rows: [string, string][] = [
    ["Umlauf", c.circulating == null ? "–" : `${big(c.circulating)} ${c.symbol}`],
    ["Gesamtmenge", c.totalSupply == null ? "–" : `${big(c.totalSupply)} ${c.symbol}`],
    ["Maximalmenge", c.maxSupply == null ? "unbegrenzt / unbekannt" : `${big(c.maxSupply)} ${c.symbol}`],
    ["Voll verwässert (FDV)", big(c.fdv, cur)],
    ["24-h-Hoch / -Tief", c.high24h == null || c.low24h == null ? "–" : `${price(c.high24h, cur)} / ${price(c.low24h, cur)}`],
    ["Allzeithoch", c.ath == null ? "–" : `${price(c.ath, cur)} (${pct(c.athChangePct, 1)})`],
  ];
  if (c.maxSupply && c.circulating) rows.splice(3, 0, ["Im Umlauf von max.", `${de((c.circulating / c.maxSupply) * 100, 1)} %`]);
  return (
    <div className="rk-detail">
      {rows.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <strong>{v}</strong>
        </div>
      ))}
    </div>
  );
}

/** Full-screen crypto ranking like CoinMarketCap: coins by market cap, total market and dominance. */
export function RankingsView({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<RankSettings>(readRankSettings);
  const [pages, setPages] = useState(1);
  const [data, setData] = useState<RankingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [listed, setListed] = useState<Set<string> | null>(null);
  const [filter, setFilter] = useState<RankFilter>(DEFAULT_RANK_FILTER);
  const [sort, setSort] = useState<RankSort>("rank");
  const [desc, setDesc] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState(settings.geckoKey);
  const interval = useChartState((s) => s.interval);
  const watch = useWatchlists((s) => s.lists.find((l) => l.id === s.active) ?? s.lists[0]);

  useEffect(() => saveRankSettings(settings), [settings]);

  useEffect(() => {
    let alive = true;
    const run = () => {
      setLoading(true);
      fetchRankings(settings.currency, pages, settings.geckoKey)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
          setLoadedAt(Date.now());
        })
        .catch((err: Error) => {
          if (!alive) return;
          setError(err.message);
          // Keep real figures that are already shown; only an empty page falls back to examples.
          setData((d) => (d && d.source !== "sample" && d.currency === settings.currency ? d : sampleRanking(settings.currency)));
        })
        .finally(() => alive && setLoading(false));
    };
    run();
    const t = window.setInterval(run, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [settings.currency, settings.geckoKey, pages]);

  // Binance's pairs decide which coins can open a chart.
  useEffect(() => {
    fetchTickers()
      .then((rows) => setListed(new Set(rows.map((r) => r.symbol))))
      .catch(() => setListed(null));
  }, []);

  const coins = data?.coins ?? [];
  const symbols = useMemo(() => chartSymbols(coins, listed), [coins, listed]);
  const watched = useMemo(() => new Set(watch.symbols), [watch.symbols]);
  const list = useMemo(() => rankList(coins, filter, sort, desc, watched, symbols), [coins, filter, sort, desc, watched, symbols]);
  // Gainers and losers sort by the 24 h change unless a column was picked (as rankList does).
  const ranked = (filter.view === "gainers" || filter.view === "losers") && sort === "rank";
  const shownSort = ranked ? "change24h" : sort;
  const shownDesc = ranked ? filter.view === "gainers" : desc;
  const cur = settings.currency === "eur" ? "€" : "$";
  const g = data?.global ?? null;
  const patch = (p: Partial<RankFilter>) => setFilter((f) => ({ ...f, ...p }));
  const sortBy = (key: RankSort) => {
    if (key === sort) setDesc((d) => !d);
    else {
      setSort(key);
      setDesc(key !== "rank" && key !== "name");
    }
  };
  const openChart = (pair: string) => {
    void loadChart(pair, interval);
    onClose();
  };

  return (
    <div className="heatmap-view calc-view sc-view rk-view">
      <div className="heatmap-head">
        <strong>Krypto-Rankings</strong>
        <span className="heatmap-symbol">
          {coins.length} Coins nach Marktkapitalisierung · Quelle {data ? SOURCE_LABEL[data.source] : "…"}
          {loadedAt && data?.source !== "sample" && ` · Stand ${new Date(loadedAt).toLocaleTimeString("de-DE")}`}
          {loading && " · lädt …"}
        </span>
        <div className="spacer" />
        <div className="jr-seg">
          {(["usd", "eur"] as const).map((c) => (
            <button key={c} className={settings.currency === c ? "active" : ""} onClick={() => setSettings((s) => ({ ...s, currency: c }))}>
              {c.toUpperCase()}
            </button>
          ))}
        </div>
        <button className="pill" onClick={onClose} data-tip="Zurück zum Chart">
          ✕ Chart
        </button>
      </div>
      <div className="rk-global">
        <div data-tip="Summe der Marktkapitalisierung aller Kryptowährungen">
          <span>Gesamtmarkt</span>
          <strong>{big(g?.marketCap ?? null, cur)}</strong>
          <em className={tone(g?.marketCapChange24h ?? null)}>{pct(g?.marketCapChange24h ?? null)}</em>
        </div>
        <div data-tip="Handelsvolumen aller Kryptowährungen in 24 Stunden">
          <span>Volumen 24 h</span>
          <strong>{big(g?.volume ?? null, cur)}</strong>
        </div>
        <div data-tip="Anteil von Bitcoin an der gesamten Marktkapitalisierung">
          <span>BTC-Dominanz</span>
          <strong>{g?.btcDominance == null ? "–" : `${de(g.btcDominance, 1)} %`}</strong>
        </div>
        <div data-tip="Anteil von Ethereum an der gesamten Marktkapitalisierung">
          <span>ETH-Dominanz</span>
          <strong>{g?.ethDominance == null ? "–" : `${de(g.ethDominance, 1)} %`}</strong>
        </div>
        <div data-tip="Gelistete Kryptowährungen bei der Quelle">
          <span>Coins</span>
          <strong>{g?.coins == null ? "–" : de(g.coins, 0)}</strong>
        </div>
      </div>
      <div className="sc-filters">
        <div className="calc-input sc-search">
          <input placeholder="Suchen, z. B. Solana" value={filter.query} onChange={(e) => patch({ query: e.target.value })} aria-label="Suchen" />
        </div>
        <div className="jr-seg">
          {(
            [
              ["all", "Alle"],
              ["gainers", "Gewinner"],
              ["losers", "Verlierer"],
              ["watch", "★ Watchlist"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} className={filter.view === v ? "active" : ""} onClick={() => patch({ view: v })}>
              {l}
            </button>
          ))}
        </div>
        {pages < MAX_PAGES && data?.source !== "sample" && (
          <button className="pill" onClick={() => setPages((p) => p + 1)} disabled={loading} data-tip={`Die nächsten ${PAGE_SIZE} Coins nachladen`}>
            Top {(pages + 1) * PAGE_SIZE} laden
          </button>
        )}
        <button className={`pill ${settings.geckoKey ? "active" : ""}`} onClick={() => setKeyOpen((o) => !o)} data-tip="Eigener CoinGecko-Schlüssel (optional) für mehr Abrufe">
          🔑 Schlüssel
        </button>
      </div>
      {keyOpen && (
        <div className="sc-filters rk-key">
          <span>
            Ohne Schlüssel reicht CoinGeckos freier Zugang. Mit einem kostenlosen Demo-Schlüssel (coingecko.com → Developer Dashboard) gibt es mehr Abrufe. Er bleibt nur in diesem Browser.
          </span>
          <div className="calc-input">
            <input placeholder="CG-…" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} aria-label="CoinGecko-Demo-Schlüssel" autoComplete="off" />
          </div>
          <button
            className="pill"
            onClick={() => {
              setSettings((s) => ({ ...s, geckoKey: keyDraft.trim() }));
              setKeyOpen(false);
            }}
          >
            Speichern
          </button>
          {settings.geckoKey && (
            <button
              className="pill"
              onClick={() => {
                setKeyDraft("");
                setSettings((s) => ({ ...s, geckoKey: "" }));
              }}
            >
              Entfernen
            </button>
          )}
        </div>
      )}
      <div className="calc-body">
        {error && (
          <div className="chart-overlay error sc-error">
            {data?.source === "sample" ? "Keine Quelle erreichbar, es werden Beispieldaten gezeigt" : "Aktualisieren fehlgeschlagen, es bleibt der letzte Stand"} ({error})
          </div>
        )}
        {filter.view === "watch" && list.length === 0 && <div className="dm-muted">Noch kein Coin in „{watch.name}“. Mit ☆ vormerken.</div>}
        <table className="calc-table sc-table rk-table">
          <thead>
            <tr>
              <th />
              {COLUMNS.map((c) => (
                <th key={c.key} className={`${c.key === shownSort ? "sorted" : ""} ${c.wide ? "tech" : ""}`} onClick={() => sortBy(c.key)} data-tip={c.tip}>
                  {c.label}
                  {c.key === shownSort ? (shownDesc ? " ▾" : " ▴") : ""}
                </th>
              ))}
              <th className="tech" data-tip="Kursverlauf der letzten 7 Tage">
                7 Tage
              </th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 500).map((c) => {
              const pair = symbols.get(c.id);
              const starred = pair ? watch.symbols.includes(pair) : false;
              const share = volumeShare(c);
              return (
                <Fragment key={c.id}>
                  <tr className={open === c.id ? "rk-open" : ""}>
                    <td>
                      {pair && (
                        <button className={`fav-star ${starred ? "on" : ""}`} onClick={() => toggleInWatchlist(pair)} aria-label={starred ? "Aus Watchlist entfernen" : "Zur Watchlist"} data-tip={`${starred ? "Aus" : "Zu"} „${watch.name}“`}>
                          {starred ? "★" : "☆"}
                        </button>
                      )}
                    </td>
                    <td className="rk-rank">{c.rank}</td>
                    <td>
                      <div className="rk-name">
                        {c.image && <img src={c.image} alt="" loading="lazy" width={18} height={18} />}
                        <button className="rk-coin" onClick={() => setOpen((o) => (o === c.id ? null : c.id))} data-tip="Details: Umlauf, Maximalmenge, Allzeithoch">
                          {c.name}
                        </button>
                        {pair ? (
                          <button className="dm-sym" onClick={() => openChart(pair)} data-tip={`${pair} im Chart öffnen`}>
                            {c.symbol}
                          </button>
                        ) : (
                          <span className="rk-sym" data-tip="Kein Binance-USDT-Paar, daher kein Chart">
                            {c.symbol}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>{price(c.price, cur)}</td>
                    <td className={`tech ${tone(c.change1h)}`}>{pct(c.change1h, 1)}</td>
                    <td className={tone(c.change24h)}>{pct(c.change24h, 1)}</td>
                    <td className={tone(c.change7d)}>{pct(c.change7d, 1)}</td>
                    <td className={`tech ${tone(c.change30d)}`}>{pct(c.change30d, 1)}</td>
                    <td>{big(c.marketCap, cur)}</td>
                    <td>{big(c.volume, cur)}</td>
                    <td className="tech">{share == null ? "–" : `${de(share, 1)} %`}</td>
                    <td className="tech">{c.circulating == null ? "–" : `${big(c.circulating)} ${c.symbol}`}</td>
                    <td className="tech">
                      <Sparkline points={c.sparkline} />
                    </td>
                  </tr>
                  {open === c.id && (
                    <tr className="rk-detail-row">
                      <td colSpan={COLUMNS.length + 2}>
                        <Detail c={c} cur={cur} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {list.length > 500 && <div className="dm-muted">… {list.length - 500} weitere, Suche verfeinern</div>}
        <p className="hint">
          Quelle: {data?.source === "coinpaprika" ? "CoinPaprika API (Ersatz, weil CoinGecko nicht antwortete)" : data?.source === "sample" ? "Beispieldaten, keine echten Kurse" : "CoinGecko API (coins/markets und global)"}, alle 2 Minuten neu. Rang
          und Marktkapitalisierung wie bei CoinMarketCap (Kurs × Umlaufmenge), die Werte der Anbieter weichen leicht voneinander ab. CoinMarketCap selbst lässt keine Abfragen direkt aus dem Browser zu und braucht einen Schlüssel, deshalb kommen die Zahlen von CoinGecko,
          bei Ausfall von CoinPaprika. Gewinner und Verlierer ohne Stablecoins und mit mindestens {big(filter.minVolume, cur)} Volumen. Klick aufs Kürzel öffnet das Binance-USDT-Paar im Chart.
        </p>
      </div>
    </div>
  );
}
