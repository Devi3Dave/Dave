import { useEffect, useState, useSyncExternalStore } from "react";
import { isCryptoSymbol } from "../shared/marketData";
import { parseTickers, type ScreenerRow } from "../shared/screener";
import { fetchMarketData, newId } from "./store";

/** A named list of symbols, as TradingView's watchlists. */
export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

interface State {
  lists: Watchlist[];
  active: string;
}

const KEY = "chartai.watchlists.v1";
const DEFAULT: State = { lists: [{ id: "wl-default", name: "Watchlist", symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"] }], active: "wl-default" };

function load(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null;
    if (v && Array.isArray(v.lists) && v.lists.length) {
      const lists = v.lists
        .filter((l) => l && typeof l.id === "string" && Array.isArray(l.symbols))
        .map((l) => ({ id: l.id, name: String(l.name ?? "Watchlist"), symbols: l.symbols.filter((s) => typeof s === "string") }));
      if (lists.length) return { lists, active: lists.some((l) => l.id === v.active) ? v.active : lists[0].id };
    }
  } catch {
    // default
  }
  return DEFAULT;
}

let state = load();
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // not remembered
  }
  listeners.forEach((l) => l());
}

export function useWatchlists<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

export const activeWatchlist = (): Watchlist => state.lists.find((l) => l.id === state.active) ?? state.lists[0];

export function selectWatchlist(id: string) {
  if (state.lists.some((l) => l.id === id)) set({ ...state, active: id });
}

export function createWatchlist(name: string): Watchlist {
  const list = { id: newId("wl"), name: name.trim() || `Liste ${state.lists.length + 1}`, symbols: [] };
  set({ lists: [...state.lists, list], active: list.id });
  return list;
}

export function renameWatchlist(id: string, name: string) {
  if (name.trim()) set({ ...state, lists: state.lists.map((l) => (l.id === id ? { ...l, name: name.trim() } : l)) });
}

/** The last list cannot be deleted; it is emptied instead. */
export function deleteWatchlist(id: string) {
  const lists = state.lists.filter((l) => l.id !== id);
  if (!lists.length) return set({ lists: state.lists.map((l) => ({ ...l, symbols: [] })), active: state.active });
  set({ lists, active: state.active === id ? lists[0].id : state.active });
}

/** Adds to (or with `on` false removes from) a list, the active one by default. */
export function toggleInWatchlist(symbol: string, on?: boolean, id = state.active) {
  const s = symbol.trim().toUpperCase();
  set({
    ...state,
    lists: state.lists.map((l) => {
      if (l.id !== id) return l;
      const has = l.symbols.includes(s);
      const want = on ?? !has;
      return want === has ? l : { ...l, symbols: want ? [...l.symbols, s] : l.symbols.filter((x) => x !== s) };
    }),
  });
}

export function moveInWatchlist(symbol: string, delta: number, id = state.active) {
  set({
    ...state,
    lists: state.lists.map((l) => {
      const i = l.symbols.indexOf(symbol);
      const j = i + delta;
      if (l.id !== id || i < 0 || j < 0 || j >= l.symbols.length) return l;
      const symbols = [...l.symbols];
      [symbols[i], symbols[j]] = [symbols[j], symbols[i]];
      return { ...l, symbols };
    }),
  });
}

// ---------------- Quotes ----------------

const TICKER_URLS = ["https://api.binance.com/api/v3/ticker/24hr", "https://data-api.binance.vision/api/v3/ticker/24hr"];

/** 24 h statistics of Binance spot pairs: all of them, or only `symbols`. */
export async function fetchTickers(symbols?: string[]): Promise<ScreenerRow[]> {
  const query = symbols ? `?symbols=${encodeURIComponent(JSON.stringify(symbols))}` : "";
  let lastError: unknown;
  for (const url of TICKER_URLS) {
    try {
      const res = await fetch(url + query, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
      return parseTickers(await res.json());
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export interface Quote {
  price: number;
  changePct: number | null;
  demo: boolean;
}

/** Price and 24 h change: Binance tickers for USDT pairs, otherwise the last two daily candles (change to the previous close). */
async function loadQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  const crypto = symbols.filter((s) => s.endsWith("USDT") && isCryptoSymbol(s));
  if (crypto.length) {
    try {
      for (const r of await fetchTickers(crypto)) out[r.symbol] = { price: r.price, changePct: r.changePct, demo: false };
    } catch {
      // falls back to candles below
    }
  }
  await Promise.all(
    symbols
      .filter((s) => !out[s])
      .map(async (s) => {
        try {
          const d = await fetchMarketData(s, "1d", 2);
          const last = d.bars[d.bars.length - 1];
          const prev = d.bars[d.bars.length - 2];
          if (last) out[s] = { price: last.close, changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : null, demo: d.source === "demo" };
        } catch {
          // no quote
        }
      }),
  );
  return out;
}

/** Quotes of a list of symbols, reloaded every 15 s. */
export function useQuotes(symbols: string[]): Record<string, Quote> {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const key = symbols.join("|");
  useEffect(() => {
    if (!symbols.length) return;
    let alive = true;
    const run = () => void loadQuotes(symbols).then((q) => alive && setQuotes((old) => ({ ...old, ...q })));
    run();
    const t = window.setInterval(run, 15_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [key]);
  return quotes;
}
