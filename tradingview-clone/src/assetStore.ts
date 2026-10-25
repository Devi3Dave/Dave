import { useSyncExternalStore } from "react";
import { findAsset, parseFuturesInfo, parseSpotTickers, resolveAsset, type Asset, type FuturesSymbol } from "../shared/assets";
import { STANDALONE } from "./config";

const FAV_KEY = "chartai.assetFavorites.v1";
const LISTS_KEY = "chartai.binanceSymbols.v1";
const LISTS_MAX_AGE = 12 * 3600 * 1000;

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
}

const cached = loadLists();
let state: AssetState = {
  favorites: loadFavorites(),
  spot: cached?.spot ?? [],
  futures: cached?.futures ?? [],
  futuresSet: cached?.futures.length ? new Set(cached.futures.map((f) => f.symbol)) : null,
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

/** Symbol to load for a picker entry: catalog assets may switch to their Binance perpetual. */
export function symbolFor(symbol: string, asset?: Asset): string {
  const a = asset ?? findAsset(symbol);
  return a ? resolveAsset(a, STANDALONE, state.futuresSet).symbol : symbol;
}
