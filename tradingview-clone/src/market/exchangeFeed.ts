import { useSyncExternalStore } from "react";
import { feedSymbol, parseStreamMessage, parseTimeSeries, streamSymbol, timeSeriesUrl, TWELVE_DATA_WS, type FeedSymbol, type PriceEvent } from "../../shared/exchangeFeed";
import { findAsset } from "../../shared/assets";
import type { MarketData } from "../../shared/marketData";

/**
 * Exchange prices with the user's own Twelve Data key. The key is kept in this
 * device's localStorage only and sent nowhere but to Twelve Data. Without a key
 * nothing changes: stocks, indices and forex load from their usual sources.
 */
export interface FeedSettings {
  provider: "twelvedata";
  apiKey: string;
}

export interface FeedStatus {
  /** Last error from Twelve Data (wrong key, plan limit …), cleared by the next success. */
  error: string | null;
  /** Symbols the WebSocket refused (not in the plan), by stream symbol. */
  refused: string[];
}

const KEY = "chartai.exchangeFeed.v1";
const listeners = new Set<() => void>();

function read(): FeedSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { provider: "twelvedata", apiKey: "", ...(JSON.parse(raw) as Partial<FeedSettings>) };
  } catch {
    // storage unavailable
  }
  return { provider: "twelvedata", apiKey: "" };
}

let settings = read();
let status: FeedStatus = { error: null, refused: [] };
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function setStatus(patch: Partial<FeedStatus>) {
  status = { ...status, ...patch };
  emit();
}

export const feedSettings = {
  get: () => settings,
  set(patch: Partial<FeedSettings>) {
    settings = { ...settings, ...patch };
    status = { error: null, refused: [] };
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // storage unavailable - the key lasts for this session only
    }
    emit();
  },
  active: () => settings.apiKey.length > 0,
};

export function useFeedSettings(): FeedSettings {
  return useSyncExternalStore(subscribe, feedSettings.get);
}

export function useFeedStatus(): FeedStatus {
  return useSyncExternalStore(subscribe, () => status);
}

/** Exchange symbol for a chart symbol (catalog id or its Binance perpetual) while a key is set. */
export function feedFor(symbol: string): { id: string; feed: FeedSymbol } | null {
  if (!feedSettings.active()) return null;
  const asset = findAsset(symbol);
  if (asset?.category === "Krypto") return null;
  const id = asset?.id ?? symbol;
  const feed = feedSymbol(id);
  return feed ? { id, feed } : null;
}

/** Candles from Twelve Data; throws (and records the error) when the key or plan does not allow them. */
export async function loadFeedData(id: string, feed: FeedSymbol, interval: string, limit: number): Promise<MarketData> {
  try {
    const res = await fetch(timeSeriesUrl(feed, interval, limit, settings.apiKey), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Twelve Data: HTTP ${res.status}`);
    const series = parseTimeSeries(await res.json(), feed, interval, limit);
    if (series.bars.length === 0) throw new Error(`Twelve Data: keine Kerzen für ${streamSymbol(feed)}`);
    if (status.error) setStatus({ error: null });
    return { symbol: id, interval, source: "twelvedata", bars: series.bars };
  } catch (err) {
    setStatus({ error: (err as Error).message });
    throw err;
  }
}

/**
 * Live prices over Twelve Data's WebSocket. Calls `onPrice` per price; `onRefused` when the plan
 * does not stream this symbol (the chart then reloads over REST every minute instead).
 */
export function connectFeedLive(feed: FeedSymbol, onPrice: (e: PriceEvent) => void, onRefused: () => void): WebSocket {
  const name = streamSymbol(feed);
  const ws = new WebSocket(`${TWELVE_DATA_WS}?apikey=${encodeURIComponent(settings.apiKey)}`);
  let heartbeat: number | undefined;
  ws.onopen = () => {
    ws.send(JSON.stringify({ action: "subscribe", params: { symbols: name } }));
    // Twelve Data asks for a heartbeat every 10 s to keep the connection open.
    heartbeat = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ action: "heartbeat" })), 10_000);
  };
  ws.addEventListener("close", () => window.clearInterval(heartbeat));
  ws.onmessage = (ev) => {
    const msg = parseStreamMessage(String(ev.data));
    if (msg.kind === "price") onPrice(msg.event);
    else if (msg.kind === "status" && msg.failed.length && !msg.ok.length) {
      if (!status.refused.includes(name)) setStatus({ refused: [...status.refused, name] });
      onRefused();
    }
  };
  return ws;
}
