import { useSyncExternalStore } from "react";
import { findAsset, parseFuturesInfo, parseSpotTickers, resolveAsset, type Asset, type FuturesSymbol } from "../shared/assets";
import { STANDALONE } from "./config";
import { feedSettings } from "./market/exchangeFeed";
import { perpSymbol, VENUES, venueSymbol, type VenueId } from "../shared/venues";
import { loadVenueMarkets, type Market } from "../shared/venueMarkets";

const FAV_KEY = "chartai.assetFavorites.v1";
const LISTS_KEY = "chartai.binanceSymbols.v1";
const LISTS_MAX_AGE = 12 * 3600 * 1000;
const VENUE_KEY = "chartai.cryptoVenue.v1";
const FORM_KEY = "chartai.cryptoForm.v1";
const MARKETS_KEY = "chartai.venueMarkets.v1.";

/** How crypto picked from the catalog trades: spot pair or the exchange's usual perpetual (BTCUSDT.P). */
export type CryptoForm = "spot" | "perp";

function loadForm(): CryptoForm {
  try {
    return localStorage.getItem(FORM_KEY) === "perp" ? "perp" : "spot";
  } catch {
    return "spot";
  }
}

interface MarketList {
  time: number;
  markets: Market[];
  /** Lists the exchange did not deliver (blocked or down). */
  failed: string[];
}

function loadMarketList(venue: VenueId): MarketList | null {
  try {
    const v = JSON.parse(localStorage.getItem(MARKETS_KEY + venue) ?? "null") as MarketList | null;
    return v && Array.isArray(v.markets) ? v : null;
  } catch {
    return null;
  }
}

function loadVenue(): VenueId {
  try {
    const v = localStorage.getItem(VENUE_KEY);
    if (VENUES.some((x) => x.id === v)) return v as VenueId;
  } catch {
    // default
  }
  return "BINANCE";
}

function loadFavorites(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface Lists {
  time: number;
  spot: string[];
  futures: FuturesSymbol[];
}

function loadLists(): Lists | null {
  try {
    const v = JSON.parse(localStorage.getItem(LISTS_KEY) ?? "null") as Lists | null;
    return v && Array.isArray(v.spot) && Array.isArray(v.futures) ? v : null;
  } catch {
    return null;
  }
}

interface AssetState {
  /** Starred symbols (catalog ids or Binance pairs), in the order they were added. */
  favorites: string[];
  spot: string[];
  futures: FuturesSymbol[];
  /** Listed perpetuals, null until Binance answered once. */
  futuresSet: Set<string> | null;
  /** Exchange that crypto picked in the picker loads from (BINANCE: the plain Binance pair). */
  venue: VenueId;
  form: CryptoForm;
  /** Every market (spot, perpetual, future) of the exchanges asked so far. */
  markets: Partial<Record<VenueId, MarketList>>;
}

const cached = loadLists();
let state: AssetState = {
  favorites: loadFavorites(),
  spot: cached?.spot ?? [],
  futures: cached?.futures ?? [],
  futuresSet: cached?.futures.length ? new Set(cached.futures.map((f) => f.symbol)) : null,
  venue: loadVenue(),
  form: loadForm(),
  markets: {},
};
const listeners = new Set<() => void>();

function set(patch: Partial<AssetState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useAssets<T>(select: (s: AssetState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

export function toggleAssetFavorite(symbol: string) {
  const favorites = state.favorites.includes(symbol) ? state.favorites.filter((f) => f !== symbol) : [...state.favorites, symbol];
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
  } catch {
    // not remembered
  }
  set({ favorites });
}

export function setCryptoVenue(venue: VenueId) {
  try {
    localStorage.setItem(VENUE_KEY, venue);
  } catch {
    // not remembered
  }
  set({ venue });
}

export function setCryptoForm(form: CryptoForm) {
  try {
    localStorage.setItem(FORM_KEY, form);
  } catch {
    // not remembered
  }
  set({ form });
}

const marketsLoading = new Map<VenueId, Promise<void>>();

/** Loads every market of an exchange for the search (cached for 12 hours). */
export function refreshVenueMarkets(venue: VenueId): Promise<void> {
  const have = state.markets[venue] ?? loadMarketList(venue);
  if (have && !state.markets[venue]) set({ markets: { ...state.markets, [venue]: have } });
  if (have && Date.now() - have.time < LISTS_MAX_AGE && have.failed.length === 0) return Promise.resolve();
  let p = marketsLoading.get(venue);
  if (!p) {
    p = (async () => {
      const got = await loadVenueMarkets(venue, (url) => getJson([url]));
      // A list that failed keeps what was there before.
      const markets = got.failed.length && have ? [...got.markets, ...have.markets.filter((m) => !got.markets.some((g) => g.symbol === m.symbol))] : got.markets;
      const next: MarketList = { time: Date.now(), markets, failed: got.failed };
      set({ markets: { ...state.markets, [venue]: next } });
      try {
        localStorage.setItem(MARKETS_KEY + venue, JSON.stringify(next));
      } catch {
        // too large or blocked: fetched again next time
      }
    })().finally(() => marketsLoading.delete(venue));
    marketsLoading.set(venue, p);
  }
  return p;
}

async function getJson(urls: string[]): Promise<unknown> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) return await res.json();
      lastError = new Error(`${url} -> HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

let refreshing: Promise<void> | null = null;

/** Fetches the Binance spot pairs and perpetuals (cached for 12 hours) so the search finds every listed market. */
export function refreshBinanceLists(): Promise<void> {
  if (cached && Date.now() - cached.time < LISTS_MAX_AGE && state.futuresSet) return Promise.resolve();
  refreshing ??= (async () => {
    const [spot, futures] = await Promise.allSettled([
      getJson(["https://api.binance.com/api/v3/ticker/price", "https://data-api.binance.vision/api/v3/ticker/price"]).then(parseSpotTickers),
      getJson(["https://fapi.binance.com/fapi/v1/exchangeInfo"]).then((j) => parseFuturesInfo(j as { symbols?: [] })),
    ]);
    const next: Lists = {
      time: Date.now(),
      spot: spot.status === "fulfilled" && spot.value.length ? spot.value : state.spot,
      futures: futures.status === "fulfilled" && futures.value.length ? futures.value : state.futures,
    };
    set({ spot: next.spot, futures: next.futures, futuresSet: next.futures.length ? new Set(next.futures.map((f) => f.symbol)) : state.futuresSet });
    if (spot.status === "fulfilled" && futures.status === "fulfilled") {
      try {
        localStorage.setItem(LISTS_KEY, JSON.stringify(next));
      } catch {
        // too large or blocked: fetched again next time
      }
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Symbol to load for a picker entry: catalog assets may switch to their Binance perpetual, and crypto
 * (`crypto`) loads from the exchange and form chosen in the picker (BTCUSDT → COINBASE:BTCUSD, BYBIT:BTCUSDT.P). Symbols that
 * already name an exchange stay as they are.
 */
export function symbolFor(symbol: string, asset?: Asset, crypto = false): string {
  if (symbol.includes(":")) return symbol;
  const perp = crypto && state.form === "perp" ? perpSymbol(state.venue, symbol) : null;
  if (perp) return perp;
  if (crypto && state.venue !== "BINANCE") return venueSymbol(state.venue, symbol);
  const a = asset ?? findAsset(symbol);
  return a ? resolveAsset(a, STANDALONE, state.futuresSet, feedSettings.active()).symbol : symbol;
}
