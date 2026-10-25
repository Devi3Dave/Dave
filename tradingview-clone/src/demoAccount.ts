import { useSyncExternalStore } from "react";
import {
  applyPrice,
  closePosition,
  createAccount,
  draggedLevels,
  journalId,
  liquidationPrice,
  modifyPosition,
  openPosition,
  parseAccount,
  toJournalTrade,
  unrealizedPnl,
  type CloseReason,
  type DemoAccount,
  type DemoTrade,
  type LevelHandle,
  type Order,
} from "../shared/demoTrading";
import { parseBackup } from "../shared/journal";
import { barPath } from "../shared/replay";
import type { TradeLine } from "./chart/ChartEngine";
import { activeChart, charts, fetchMarketData, workspace, type ChartState } from "./store";

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

/**
 * Play-money account of a running bar replay: it trades at the replayed prices and times, apart from the
 * demo account, and is dropped when the replay ends or gets a new start.
 */
export interface ReplayBook {
  /** The replay (ReplayState.id) it belongs to. */
  id: string;
  slot: number;
  symbol: string;
  account: DemoAccount;
  prices: Record<string, number>;
  /** Start of the newest candle already priced in (unix seconds). */
  lastBar: number;
  /** Replay time in unix milliseconds, used as the time of orders. */
  now: number;
}

interface DemoState {
  account: DemoAccount;
  settings: DemoSettings;
  /** Last known price per symbol. */
  prices: Record<string, number>;
  /** Journal ids of demo trades that are already in the journal. */
  journaled: Set<string>;
  events: DemoEvent[];
  replay: ReplayBook | null;
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
  replay: null,
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

/** "replay" when the chart in `slot` runs a replay with its own account, else the demo account. */
type BookKind = "live" | "replay";
const bookOf = (slot: number): BookKind => (state.replay?.slot === slot ? "replay" : "live");
/** Order ticket and position list act on the active chart's account. */
const currentBook = (): BookKind => bookOf(activeChart().slot);

function readBook(kind: BookKind): { account: DemoAccount; prices: Record<string, number>; now: number } {
  return kind === "replay" && state.replay ? state.replay : { account: state.account, prices: state.prices, now: Date.now() };
}

function writeAccount(kind: BookKind, account: DemoAccount) {
  if (kind === "replay") {
    if (state.replay) set({ replay: { ...state.replay, account } });
  } else set({ account });
}

/** The replay account when the active chart replays, else null. */
export const activeReplayBook = (): ReplayBook | null => (currentBook() === "replay" ? state.replay : null);

const subscribeView = (l: () => void) => {
  const offs = [demo.subscribe(l), workspace.subscribe(l)];
  return () => offs.forEach((off) => off());
};

/** Account and prices the demo panel shows: the replay account while the active chart replays. */
export function useDemoBook<T>(select: (b: { account: DemoAccount; prices: Record<string, number> }) => T): T {
  return useSyncExternalStore(subscribeView, () => select(activeReplayBook() ?? state));
}

/** Open positions in the replay account of the chart `slot` (stepping back is blocked then). */
export const replayPositionsOpen = (slot: number) => state.replay?.slot === slot && state.replay.account.positions.length > 0;

export function useReplayBook(): ReplayBook | null {
  return useSyncExternalStore(subscribeView, activeReplayBook);
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function afterClose(trades: DemoTrade[], announce: boolean) {
  if (!trades.length) return;
  if (announce) set({ events: [...state.events, ...trades.map((trade) => ({ id: ++eventSeq, trade }))].slice(-5) });
  // Replay trades go into the journal only by hand.
  const live = trades.filter((t) => !t.replay);
  if (state.settings.autoJournal && live.length) addToJournal(live);
}

/** Opens a market position at the last known price of the symbol. Returns an error text or null. */
export function placeOrder(order: Order): string | null {
  const kind = currentBook();
  const book = readBook(kind);
  if (kind === "replay" && order.symbol !== state.replay?.symbol) return `Im Replay ist nur ${state.replay?.symbol} handelbar`;
  const price = book.prices[order.symbol];
  const next = openPosition(book.account, order, price, book.prices, book.now, newId());
  if (typeof next === "string") return next;
  // Marked so closed replay trades are told apart from demo trades (journal, toasts).
  writeAccount(kind, kind === "replay" ? { ...next, positions: next.positions.map((p) => (book.account.positions.includes(p) ? p : { ...p, replay: true })) } : next);
  return null;
}

function closeIn(kind: BookKind, id: string, reason: CloseReason): DemoTrade | null {
  const book = readBook(kind);
  const p = book.account.positions.find((x) => x.id === id);
  const price = p && book.prices[p.symbol];
  if (!p || !price) return null;
  const r = closePosition(book.account, id, price, reason, book.now);
  if (!r) return null;
  writeAccount(kind, r.account);
  afterClose([r.trade], false);
  return r.trade;
}

export function closeDemoPosition(id: string, reason: CloseReason = "manual"): DemoTrade | null {
  return closeIn(currentBook(), id, reason);
}

/** Closes every position that has a price; returns how many were closed. */
export function closeAllPositions(): number {
  const kind = currentBook();
  let n = 0;
  for (const p of readBook(kind).account.positions) if (closeIn(kind, p.id, "manual")) n++;
  return n;
}

function setLevelsIn(kind: BookKind, id: string, levels: { stop?: number; target?: number }): string | null {
  const book = readBook(kind);
  const p = book.account.positions.find((x) => x.id === id);
  const price = p && book.prices[p.symbol];
  if (!p || !price) return "Kein aktueller Kurs";
  const next = modifyPosition(book.account, id, levels, price);
  if (typeof next === "string") return next;
  writeAccount(kind, next);
  return null;
}

export function setLevels(id: string, levels: { stop?: number; target?: number }): string | null {
  return setLevelsIn(currentBook(), id, levels);
}

export function resetAccount(startBalance: number) {
  const kind = currentBook();
  const book = readBook(kind);
  writeAccount(kind, createAccount(startBalance, book.now, book.account.feeRate));
  set({ events: [] });
}

export function setFeeRate(feeRate: number) {
  const kind = currentBook();
  writeAccount(kind, { ...readBook(kind).account, feeRate });
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

/**
 * Follows a replaying chart: a new start gets a fresh replay account (start balance and fees of the demo
 * account); every revealed candle is run through from open via high/low to close, so stops and targets
 * inside it are hit.
 */
function syncReplay(slot: number, s: ChartState) {
  const r = s.replay;
  const book = state.replay;
  if (!r || r.phase !== "play" || s.loading || !s.bars.length) {
    // The replay ended or waits for a new start: its account is gone.
    if (book?.slot === slot && (!r || r.phase !== "play")) set({ replay: null });
    return;
  }
  const last = s.bars[s.bars.length - 1];
  if (!book || book.id !== r.id || book.slot !== slot) {
    set({
      replay: {
        id: r.id,
        slot,
        symbol: s.symbol,
        account: createAccount(state.account.startBalance, last.time * 1000, state.account.feeRate),
        prices: { [s.symbol]: last.close },
        lastBar: last.time,
        now: last.time * 1000,
      },
    });
    return;
  }
  if (last.time === book.lastBar && book.prices[book.symbol] === last.close) return;
  // Stepped back (only without open positions): the hidden candles count again when they come back.
  if (last.time < book.lastBar) {
    set({ replay: { ...book, prices: { ...book.prices, [book.symbol]: last.close }, lastBar: last.time, now: last.time * 1000 } });
    return;
  }
  let account = book.account;
  const closed: DemoTrade[] = [];
  for (const bar of s.bars.slice(-50)) {
    if (bar.time <= book.lastBar) continue;
    for (const price of barPath(bar)) {
      const res = applyPrice(account, book.symbol, price, bar.time * 1000);
      account = res.account;
      closed.push(...res.closed);
    }
  }
  set({ replay: { ...book, account, prices: { ...book.prices, [book.symbol]: last.close }, lastBar: Math.max(book.lastBar, last.time), now: last.time * 1000 } });
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
      syncReplay(chart.slot, s);
      // A replaying chart shows old prices; demo positions of its asset are polled meanwhile.
      if (s.replay) return;
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
const pnlText = (v: number) => {
  const digits = Math.abs(v) >= 100 ? 0 : 2;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} $`;
};

/** A stop or target line being dragged in the chart, not saved yet. */
export interface LineDraft {
  dragId: string;
  price: number;
}

const dragIdOf = (positionId: string, handle: LevelHandle) => `${positionId}:${handle}`;

function parseDragId(dragId: string): { id: string; handle: LevelHandle } | null {
  const i = dragId.lastIndexOf(":");
  const handle = dragId.slice(i + 1);
  if (i < 0 || (handle !== "stop" && handle !== "target" && handle !== "entry")) return null;
  return { id: dragId.slice(0, i), handle };
}

/** Saves the level of a dragged line (stop, target, or a new one pulled from the entry line). Returns an error text or null. */
export function dropLevel(dragId: string, price: number, slot: number): string | null {
  const kind = bookOf(slot);
  const d = parseDragId(dragId);
  const p = d && readBook(kind).account.positions.find((x) => x.id === d.id);
  if (!d || !p) return "Position nicht gefunden";
  const { stop, target } = draggedLevels(p, d.handle, price);
  return setLevelsIn(kind, p.id, { stop, target });
}

/** Price lines for the open positions of a symbol in the chart `slot` (empty when lines are switched off). */
export function tradeLinesFor(symbol: string, slot: number, draft?: LineDraft | null): TradeLine[] {
  if (!state.settings.showLines) return [];
  const d = draft ? parseDragId(draft.dragId) : null;
  const replay = bookOf(slot) === "replay";
  return readBook(bookOf(slot)).account.positions
    .filter((p) => p.symbol === symbol)
    .flatMap((pos) => {
      let p = pos;
      let dragging: "stop" | "target" | null = null;
      if (d && draft && d.id === p.id) {
        const { level, stop, target } = draggedLevels(p, d.handle, draft.price);
        p = { ...p, stop, target };
        dragging = level;
      }
      const lines: TradeLine[] = [
        {
          price: p.entry,
          color: p.side === "long" ? "#26a69a" : "#ef5350",
          title: `${replay ? "Replay" : "Demo"} ${p.side === "long" ? "Long" : "Short"} ${qtyText(p.qty)}`,
          // Pulls out a missing stop or target; with both set, the entry line stays put (and the chart pans there).
          drag: p.stop === undefined || p.target === undefined ? dragIdOf(p.id, "entry") : undefined,
        },
      ];
      if (p.stop !== undefined)
        lines.push({ price: p.stop, color: "#ef5350", title: `SL ${pnlText(unrealizedPnl(p, p.stop))}`, dashed: dragging !== "stop", drag: dragIdOf(p.id, "stop") });
      if (p.target !== undefined)
        lines.push({ price: p.target, color: "#26a69a", title: `TP ${pnlText(unrealizedPnl(p, p.target))}`, dashed: dragging !== "target", drag: dragIdOf(p.id, "target") });
      const liq = p.leverage > 1 ? liquidationPrice(p) : null;
      if (liq !== null) lines.push({ price: liq, color: "#f5c518", title: "Liq", dashed: true });
      return lines;
    });
}
