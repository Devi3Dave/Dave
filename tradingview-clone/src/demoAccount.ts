import { useSyncExternalStore } from "react";
import {
  applyPrice,
  closePosition,
  createAccount,
  journalId,
  liquidationPrice,
  modifyPosition,
  openPosition,
  parseAccount,
  toJournalTrade,
  type CloseReason,
  type DemoAccount,
  type DemoTrade,
  type Order,
} from "../shared/demoTrading";
import { parseBackup } from "../shared/journal";
import type { TradeLine } from "./chart/ChartEngine";
import { charts, fetchMarketData } from "./store";

const KEY = "chartai.demo.v1";
const JOURNAL_KEY = "chartai.journal.v1";
/** Window event after the demo account wrote to the journal, so an open journal page reloads. */
export const JOURNAL_EVENT = "chartai:journal-changed";
const POLL_MS = 15_000;

export interface DemoSettings {
  /** Closed trades go into the journal automatically. */
  autoJournal: boolean;
  /** Entry, stop and target of open positions as lines in the chart. */
  showLines: boolean;
}

/** Something that happened without a tap (stop, target, liquidation), shown as a toast. */
export interface DemoEvent {
  id: number;
  trade: DemoTrade;
}

interface DemoState {
  account: DemoAccount;
  settings: DemoSettings;
  /** Last known price per symbol. */
  prices: Record<string, number>;
  /** Journal ids of demo trades that are already in the journal. */
  journaled: Set<string>;
  events: DemoEvent[];
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function readJournal() {
  try {
    return parseBackup(readJson(JOURNAL_KEY) ?? []);
  } catch {
    return [];
  }
}

const saved = readJson(KEY) as { account?: unknown; settings?: Partial<DemoSettings> } | null;
let state: DemoState = {
  account: parseAccount(saved?.account) ?? createAccount(),
  settings: { autoJournal: false, showLines: true, ...saved?.settings },
  prices: {},
  journaled: new Set(readJournal().map((t) => t.id)),
  events: [],
};
const listeners = new Set<() => void>();
let eventSeq = 0;

function set(patch: Partial<DemoState>) {
  const persist = patch.account !== undefined || patch.settings !== undefined;
  state = { ...state, ...patch };
  if (persist) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ account: state.account, settings: state.settings }));
    } catch {
      // storage full or blocked: the account lasts for this session
    }
  }
  listeners.forEach((l) => l());
}

export const demo = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useDemo<T>(select: (s: DemoState) => T): T {
  return useSyncExternalStore(demo.subscribe, () => select(state));
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function afterClose(trades: DemoTrade[], announce: boolean) {
  if (!trades.length) return;
  if (announce) set({ events: [...state.events, ...trades.map((trade) => ({ id: ++eventSeq, trade }))].slice(-5) });
  if (state.settings.autoJournal) addToJournal(trades);
}

/** Opens a market position at the last known price of the symbol. Returns an error text or null. */
export function placeOrder(order: Order): string | null {
  const price = state.prices[order.symbol];
  const next = openPosition(state.account, order, price, state.prices, Date.now(), newId());
  if (typeof next === "string") return next;
  set({ account: next });
  return null;
}

export function closeDemoPosition(id: string, reason: CloseReason = "manual"): DemoTrade | null {
  const p = state.account.positions.find((x) => x.id === id);
  const price = p && state.prices[p.symbol];
  if (!p || !price) return null;
  const r = closePosition(state.account, id, price, reason, Date.now());
  if (!r) return null;
  set({ account: r.account });
  afterClose([r.trade], false);
  return r.trade;
}

/** Closes every position that has a price; returns how many were closed. */
export function closeAllPositions(): number {
  let n = 0;
  for (const p of state.account.positions) if (closeDemoPosition(p.id)) n++;
  return n;
}

export function setLevels(id: string, levels: { stop?: number; target?: number }): string | null {
  const p = state.account.positions.find((x) => x.id === id);
  const price = p && state.prices[p.symbol];
  if (!p || !price) return "Kein aktueller Kurs";
  const next = modifyPosition(state.account, id, levels, price);
  if (typeof next === "string") return next;
  set({ account: next });
  return null;
}

export function resetAccount(startBalance: number) {
  set({ account: createAccount(startBalance, Date.now(), state.account.feeRate), events: [] });
}

export function setFeeRate(feeRate: number) {
  set({ account: { ...state.account, feeRate } });
}

export function updateDemoSettings(patch: Partial<DemoSettings>) {
  set({ settings: { ...state.settings, ...patch } });
}

export function dismissEvent(id: number) {
  set({ events: state.events.filter((e) => e.id !== id) });
}

/** Appends closed demo trades to the journal (once each). Returns how many were added. */
export function addToJournal(trades: DemoTrade[]): number {
  const journal = readJournal();
  const known = new Set(journal.map((t) => t.id));
  const added = trades.filter((t) => !known.has(journalId(t))).map(toJournalTrade);
  if (added.length) {
    try {
      localStorage.setItem(JOURNAL_KEY, JSON.stringify([...journal, ...added]));
    } catch {
      return 0;
    }
    window.dispatchEvent(new Event(JOURNAL_EVENT));
  }
  set({ journaled: new Set([...known, ...added.map((t) => t.id)]) });
  return added.length;
}

/** A new price for a symbol: stops, targets and liquidations of its positions are checked. */
export function updatePrice(symbol: string, price: number) {
  if (!(price > 0) || state.prices[symbol] === price) return;
  const prices = { ...state.prices, [symbol]: price };
  const { account, closed } = applyPrice(state.account, symbol, price, Date.now());
  set(closed.length ? { prices, account } : { prices });
  afterClose(closed, true);
}

const lastUpdate = new Map<string, number>();

let started = false;

/** Follows the prices of all charts (live via their streams) and polls symbols that no chart shows. */
export function startDemoFeed() {
  if (started) return;
  started = true;
  for (const chart of charts) {
    const push = () => {
      const s = chart.get();
      // While loading, the bars still belong to the previous symbol.
      if (s.loading || s.error || !s.bars.length) return;
      lastUpdate.set(s.symbol, Date.now());
      updatePrice(s.symbol, s.bars[s.bars.length - 1].close);
    };
    chart.subscribe(push);
    push();
  }
  const poll = async () => {
    const symbols = [...new Set(state.account.positions.map((p) => p.symbol))].filter((s) => Date.now() - (lastUpdate.get(s) ?? 0) > POLL_MS);
    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const data = await fetchMarketData(symbol, "1m", 2);
          const last = data.bars[data.bars.length - 1];
          // Demo data has no real price; a fresh demo series would jump away from the chart's.
          if (last && !(data.source === "demo" && state.prices[symbol] !== undefined)) {
            lastUpdate.set(symbol, Date.now());
            updatePrice(symbol, last.close);
          }
        } catch {
          // next round
        }
      }),
    );
  };
  void poll();
  window.setInterval(() => void poll(), POLL_MS);
  // The journal may have been edited (trades deleted) on its own page.
  window.addEventListener("storage", (e) => {
    if (e.key === JOURNAL_KEY) set({ journaled: new Set(readJournal().map((t) => t.id)) });
  });
}

/** Re-reads which demo trades are in the journal (after the journal page changed it). */
export function refreshJournaled() {
  set({ journaled: new Set(readJournal().map((t) => t.id)) });
}

const qtyText = (q: number) => String(+q.toPrecision(4)).replace(".", ",");

/** Price lines for the open demo positions of a symbol (empty when lines are switched off). */
export function tradeLinesFor(symbol: string): TradeLine[] {
  if (!state.settings.showLines) return [];
  return state.account.positions
    .filter((p) => p.symbol === symbol)
    .flatMap((p) => {
      const lines: TradeLine[] = [{ price: p.entry, color: p.side === "long" ? "#26a69a" : "#ef5350", title: `Demo ${p.side === "long" ? "Long" : "Short"} ${qtyText(p.qty)}` }];
      if (p.stop !== undefined) lines.push({ price: p.stop, color: "#ef5350", title: "SL", dashed: true });
      if (p.target !== undefined) lines.push({ price: p.target, color: "#26a69a", title: "TP", dashed: true });
      const liq = p.leverage > 1 ? liquidationPrice(p) : null;
      if (liq !== null) lines.push({ price: liq, color: "#f5c518", title: "Liq", dashed: true });
      return lines;
    });
}
