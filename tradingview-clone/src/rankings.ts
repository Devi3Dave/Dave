import {
  paprikaUsdToEur,
  parseCoinGeckoGlobal,
  parseCoinGeckoMarkets,
  parseCoinPaprikaGlobal,
  parseCoinPaprikaTickers,
  type RankCurrency,
  type RankingData,
} from "../shared/rankings";

const SETTINGS_KEY = "chartai.rankings.v1";
export const PAGE_SIZE = 250;

export interface RankSettings {
  currency: RankCurrency;
  /** Optional free CoinGecko demo key (higher rate limit); sent as x_cg_demo_api_key. */
  geckoKey: string;
}

export function readRankSettings(): RankSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<RankSettings>;
    return { currency: s.currency === "eur" ? "eur" : "usd", geckoKey: typeof s.geckoKey === "string" ? s.geckoKey : "" };
  } catch {
    return { currency: "usd", geckoKey: "" };
  }
}

export function saveRankSettings(s: RankSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // not remembered
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => {
    throw new Error("nicht erreichbar");
  });
  if (!res.ok) throw new Error(res.status === 429 ? "Abruflimit erreicht (HTTP 429)" : `HTTP ${res.status}`);
  return res.json();
}

/** First `pages` × 250 coins from CoinGecko, plus the global figures. */
async function fromCoinGecko(currency: RankCurrency, pages: number, key: string): Promise<RankingData> {
  const auth = key ? `&x_cg_demo_api_key=${encodeURIComponent(key)}` : "";
  const base = "https://api.coingecko.com/api/v3";
  const lists = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      getJson(`${base}/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=${PAGE_SIZE}&page=${i + 1}&sparkline=true&price_change_percentage=1h,24h,7d,30d${auth}`),
    ),
  );
  const coins = lists.flatMap(parseCoinGeckoMarkets);
  if (!coins.length) throw new Error("leere Antwort");
  // The list is useful without the totals, so a failing /global only drops the header figures.
  const global = await getJson(`${base}/global${key ? `?x_cg_demo_api_key=${encodeURIComponent(key)}` : ""}`)
    .then((g) => parseCoinGeckoGlobal(g, currency))
    .catch(() => null);
  return { coins, global, source: "coingecko", currency };
}

async function fromCoinPaprika(currency: RankCurrency, pages: number): Promise<RankingData> {
  const base = "https://api.coinpaprika.com/v1";
  const raw = await getJson(`${base}/tickers?quotes=USD,EUR`);
  const coins = parseCoinPaprikaTickers(raw, currency, pages * PAGE_SIZE);
  if (!coins.length) throw new Error("leere Antwort");
  const fx = currency === "eur" ? paprikaUsdToEur(raw) : 1;
  const eth = coins.find((c) => c.id === "eth-ethereum")?.marketCap ?? null;
  const global = await getJson(`${base}/global`)
    .then((g) => parseCoinPaprikaGlobal(g, fx, eth))
    .catch(() => null);
  return { coins, global, source: "coinpaprika", currency };
}

/** CoinGecko first, CoinPaprika when CoinGecko refuses (rate limit, outage). */
export async function fetchRankings(currency: RankCurrency, pages: number, geckoKey: string): Promise<RankingData> {
  try {
    return await fromCoinGecko(currency, pages, geckoKey);
  } catch (gecko) {
    try {
      return await fromCoinPaprika(currency, pages);
    } catch (paprika) {
      throw new Error(`CoinGecko: ${(gecko as Error).message}; CoinPaprika: ${(paprika as Error).message}`);
    }
  }
}
