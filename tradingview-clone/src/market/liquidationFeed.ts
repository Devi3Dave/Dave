import { useSyncExternalStore } from "react";

export interface LiveLiquidation {
  time: number; // unix seconds
  price: number;
  qty: number;
  notional: number;
  side: "long" | "short"; // which side was liquidated
}

export type FeedStatus = "off" | "connecting" | "live" | "error";

interface State {
  symbol: string | null;
  status: FeedStatus;
  items: LiveLiquidation[];
}

const MAX_ITEMS = 300;

/**
 * Real liquidations from Binance USDⓈ-M Futures (`<symbol>@forceOrder`). Binance pushes
 * at most the latest liquidation per symbol and second, so this is a sample, not every order.
 */
class LiquidationFeed {
  private state: State = { symbol: null, status: "off", items: [] };
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: number | undefined;
  private listeners = new Set<() => void>();

  get = () => this.state;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  start(symbol: string) {
    if (this.state.symbol === symbol && this.ws) return;
    this.stop();
    this.set({ symbol, status: "connecting", items: [] });
    this.connect(symbol);
  }

  stop() {
    window.clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    if (this.state.status !== "off") this.set({ symbol: null, status: "off" });
  }

  private connect(symbol: string) {
    const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@forceOrder`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      if (this.ws === ws) this.set({ status: "live" });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      const o = JSON.parse(ev.data)?.o;
      if (!o) return;
      const price = Number(o.ap) || Number(o.p);
      const qty = Number(o.z) || Number(o.q);
      const item: LiveLiquidation = {
        time: Math.floor(Number(o.T) / 1000),
        price,
        qty,
        notional: price * qty,
        // A forced SELL closes a long position, a forced BUY closes a short.
        side: o.S === "SELL" ? "long" : "short",
      };
      this.set({ items: [...this.state.items, item].slice(-MAX_ITEMS) });
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.set({ status: "error" });
      // Reconnect with backoff (1s, 2s, 4s … max 30s).
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.retryTimer = window.setTimeout(() => {
        if (this.state.symbol === symbol) this.connect(symbol);
      }, delay);
    };
  }
}

export const liquidationFeed = new LiquidationFeed();

export function useLiquidationFeed(): State {
  return useSyncExternalStore(liquidationFeed.subscribe, liquidationFeed.get);
}

/** Totals of liquidated notional over the last `seconds`. */
export function liquidationTotals(items: LiveLiquidation[], seconds: number) {
  const since = Date.now() / 1000 - seconds;
  let long = 0;
  let short = 0;
  for (const l of items) {
    if (l.time < since) continue;
    if (l.side === "long") long += l.notional;
    else short += l.notional;
  }
  return { long, short };
}
