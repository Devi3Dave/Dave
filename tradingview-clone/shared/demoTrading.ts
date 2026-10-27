// Paper trading with play money: an isolated-margin demo account for every asset the app can chart.
// Amounts are in quote currency ($); positions open and close at market prices supplied by the caller.

import type { JournalTrade } from "./journal";

export type Side = "long" | "short";
export type CloseReason = "manual" | "stop" | "target" | "liquidation";

export interface DemoPosition {
  id: string;
  /** Symbol as loaded in the chart (e.g. BTCUSDT, XAUUSDT, AAPL). */
  symbol: string;
  side: Side;
  qty: number;
  entry: number;
  stop?: number;
  target?: number;
  leverage: number;
  /** Margin locked while the position is open: entry × qty ÷ leverage. */
  margin: number;
  /** Fee paid when opening (already taken from the balance). */
  openFee: number;
  /** Unix milliseconds. */
  openedAt: number;
  /** Opened in a bar replay (historical prices and times), not on the demo account. */
  replay?: boolean;
}

export interface DemoTrade extends DemoPosition {
  exit: number;
  closedAt: number;
  reason: CloseReason;
  closeFee: number;
  /** Result after both fees. */
  pnl: number;
}

export interface DemoAccount {
  version: 1;
  startBalance: number;
  /** Cash: start balance plus all closed results, minus fees. Open positions are not included. */
  balance: number;
  /** Fee per side as a fraction of the position value (0.0005 = 0.05 %). */
  feeRate: number;
  positions: DemoPosition[];
  /** Closed trades, oldest first. */
  history: DemoTrade[];
  /** Limit and stop orders waiting for their price (older saved accounts have none). */
  orders?: PendingOrder[];
  createdAt: number;
}

export type OrderType = "market" | "limit" | "stop";

/**
 * An order that opens a position once the price gets there, like TradingView's paper trading:
 * a buy limit below the price, a buy stop above it, a sell limit above, a sell stop below.
 */
export interface PendingOrder {
  id: string;
  symbol: string;
  side: Side;
  type: "limit" | "stop";
  price: number;
  qty: number;
  leverage: number;
  stop?: number;
  target?: number;
  createdAt: number;
  replay?: boolean;
}

export const START_BALANCES = [1_000, 10_000, 100_000];
export const DEFAULT_FEE_RATE = 0.0005;
export const MAX_LEVERAGE = 125;
const MAX_HISTORY = 500;

export function createAccount(startBalance = 10_000, now = Date.now(), feeRate = DEFAULT_FEE_RATE): DemoAccount {
  return { version: 1, startBalance, balance: startBalance, feeRate, positions: [], history: [], orders: [], createdAt: now };
}

const dir = (side: Side) => (side === "long" ? 1 : -1);

/** Price movement in $ before fees. */
export function unrealizedPnl(p: DemoPosition, price: number): number {
  return (price - p.entry) * dir(p.side) * p.qty;
}

/** Price at which the isolated margin is used up; null when it cannot be reached (1× long). */
export function liquidationPrice(p: Pick<DemoPosition, "side" | "entry" | "qty" | "margin">): number | null {
  if (!(p.qty > 0)) return null;
  const price = p.entry - (dir(p.side) * p.margin) / p.qty;
  return price > 0 ? price : null;
}

export function usedMargin(acc: DemoAccount): number {
  return acc.positions.reduce((a, p) => a + p.margin, 0);
}

/** Unrealized result of all open positions; positions without a known price count as unchanged. */
export function openPnl(acc: DemoAccount, prices: Record<string, number>): number {
  return acc.positions.reduce((a, p) => a + (prices[p.symbol] !== undefined ? unrealizedPnl(p, prices[p.symbol]) : 0), 0);
}

/** Account value if everything were closed now (before closing fees). */
export function equity(acc: DemoAccount, prices: Record<string, number>): number {
  return acc.balance + openPnl(acc, prices);
}

/** Money free for new positions. */
export function available(acc: DemoAccount, prices: Record<string, number>): number {
  return Math.max(0, equity(acc, prices) - usedMargin(acc));
}

export interface Order {
  symbol: string;
  side: Side;
  qty: number;
  leverage: number;
  stop?: number;
  target?: number;
}

/** Explains why stop or target are on the wrong side of the price, or returns null. */
export function checkLevels(side: Side, price: number, stop?: number, target?: number): string | null {
  const d = dir(side);
  if (stop !== undefined && (!Number.isFinite(stop) || stop <= 0 || (stop - price) * d >= 0))
    return side === "long" ? "Stop-Loss muss bei Long unter dem Kurs liegen" : "Stop-Loss muss bei Short über dem Kurs liegen";
  if (target !== undefined && (!Number.isFinite(target) || target <= 0 || (target - price) * d <= 0))
    return side === "long" ? "Take-Profit muss bei Long über dem Kurs liegen" : "Take-Profit muss bei Short unter dem Kurs liegen";
  return null;
}

/** What an order would cost: position value, margin and opening fee. */
export function orderCost(acc: Pick<DemoAccount, "feeRate">, qty: number, price: number, leverage: number) {
  const value = qty * price;
  return { value, margin: value / leverage, fee: value * acc.feeRate };
}

/** Opens a market position at `price`, or explains why not. */
export function openPosition(acc: DemoAccount, order: Order, price: number, prices: Record<string, number>, now: number, id: string): DemoAccount | string {
  if (!(price > 0) || !Number.isFinite(price)) return "Kein aktueller Kurs – bitte warten, bis der Chart geladen ist";
  if (!(order.qty > 0) || !Number.isFinite(order.qty)) return "Bitte eine Größe eintragen";
  if (!(order.leverage >= 1 && order.leverage <= MAX_LEVERAGE)) return `Hebel zwischen 1 und ${MAX_LEVERAGE}`;
  const levels = checkLevels(order.side, price, order.stop, order.target);
  if (levels) return levels;
  const { margin, fee } = orderCost(acc, order.qty, price, order.leverage);
  const free = available(acc, prices);
  if (margin + fee > free + 1e-9) return `Nicht genug Guthaben: benötigt ${round2(margin + fee)} $, frei sind ${round2(free)} $`;
  const pos: DemoPosition = {
    id,
    symbol: order.symbol,
    side: order.side,
    qty: order.qty,
    entry: price,
    stop: order.stop,
    target: order.target,
    leverage: order.leverage,
    margin,
    openFee: fee,
    openedAt: now,
  };
  if (liquidationPrice(pos) !== null && order.stop !== undefined && (liquidationPrice(pos)! - order.stop) * dir(order.side) >= 0)
    return "Der Stop-Loss liegt hinter dem Liquidationspreis – Hebel senken oder Stop näher setzen";
  return { ...acc, balance: acc.balance - fee, positions: [...acc.positions, pos] };
}

/** Closes a position at `price`; a liquidation loses exactly the margin. */
export function closePosition(acc: DemoAccount, id: string, price: number, reason: CloseReason, now: number): { account: DemoAccount; trade: DemoTrade } | null {
  const p = acc.positions.find((x) => x.id === id);
  if (!p || !(price > 0)) return null;
  const gross = reason === "liquidation" ? -p.margin : unrealizedPnl(p, price);
  const closeFee = reason === "liquidation" ? 0 : p.qty * price * acc.feeRate;
  const trade: DemoTrade = { ...p, exit: price, closedAt: now, reason, closeFee, pnl: gross - closeFee - p.openFee };
  return {
    account: {
      ...acc,
      balance: acc.balance + gross - closeFee,
      positions: acc.positions.filter((x) => x.id !== id),
      history: [...acc.history, trade].slice(-MAX_HISTORY),
    },
    trade,
  };
}

/** Changes stop-loss and take-profit of an open position (undefined removes a level). */
export function modifyPosition(acc: DemoAccount, id: string, levels: { stop?: number; target?: number }, price: number): DemoAccount | string {
  const p = acc.positions.find((x) => x.id === id);
  if (!p) return "Position nicht gefunden";
  const err = checkLevels(p.side, price, levels.stop, levels.target);
  if (err) return err;
  return { ...acc, positions: acc.positions.map((x) => (x.id === id ? { ...x, stop: levels.stop, target: levels.target } : x)) };
}

/** A line of an open position that can be dragged in the chart. */
export type LevelHandle = "stop" | "target" | "entry";

/**
 * Stop and target after dragging a line of `p` to `price`. Stop and target lines move their level;
 * the entry line pulls out the level on the side it is dragged to (above a long: target, below: stop).
 */
export function draggedLevels(p: DemoPosition, handle: LevelHandle, price: number): { level: "stop" | "target"; stop?: number; target?: number } {
  const rounded = +price.toPrecision(6);
  const level = handle !== "entry" ? handle : (rounded - p.entry) * dir(p.side) >= 0 ? "target" : "stop";
  return { level, stop: p.stop, target: p.target, [level]: rounded };
}

/** Which level a price has reached: liquidation first, then stop, then target. */
export function triggerOf(p: DemoPosition, price: number): { reason: CloseReason; exit: number } | null {
  const d = dir(p.side);
  const liq = liquidationPrice(p);
  if (liq !== null && (price - liq) * d <= 0) return { reason: "liquidation", exit: liq };
  if (p.stop !== undefined && (price - p.stop) * d <= 0) return { reason: "stop", exit: p.stop };
  if (p.target !== undefined && (price - p.target) * d >= 0) return { reason: "target", exit: p.target };
  return null;
}

/** Explains why a limit or stop order cannot wait at `orderPrice` with the market at `market`, or returns null. */
export function checkPendingPrice(side: Side, type: "limit" | "stop", orderPrice: number, market: number): string | null {
  if (!(orderPrice > 0) || !Number.isFinite(orderPrice)) return "Bitte einen Orderpreis eintragen";
  if (!(market > 0)) return "Kein aktueller Kurs – bitte warten, bis der Chart geladen ist";
  const below = orderPrice < market;
  const buy = side === "long";
  if (type === "limit" && buy && !below) return "Ein Buy-Limit liegt unter dem aktuellen Kurs (sonst Markt-Order nehmen)";
  if (type === "limit" && !buy && below) return "Ein Sell-Limit liegt über dem aktuellen Kurs (sonst Markt-Order nehmen)";
  if (type === "stop" && buy && below) return "Ein Buy-Stop liegt über dem aktuellen Kurs";
  if (type === "stop" && !buy && !below) return "Ein Sell-Stop liegt unter dem aktuellen Kurs";
  return null;
}

/** Places a limit or stop order; stop-loss and take-profit are checked against the order price. */
export function placePendingOrder(acc: DemoAccount, order: Order & { type: "limit" | "stop"; price: number }, market: number, now: number, id: string): DemoAccount | string {
  const wrong = checkPendingPrice(order.side, order.type, order.price, market);
  if (wrong) return wrong;
  if (!(order.qty > 0) || !Number.isFinite(order.qty)) return "Bitte eine Größe eintragen";
  if (!(order.leverage >= 1 && order.leverage <= MAX_LEVERAGE)) return `Hebel zwischen 1 und ${MAX_LEVERAGE}`;
  const levels = checkLevels(order.side, order.price, order.stop, order.target);
  if (levels) return levels.replace("dem Kurs", "dem Orderpreis");
  const pending: PendingOrder = { id, symbol: order.symbol, side: order.side, type: order.type, price: order.price, qty: order.qty, leverage: order.leverage, stop: order.stop, target: order.target, createdAt: now };
  return { ...acc, orders: [...(acc.orders ?? []), pending] };
}

export function cancelPendingOrder(acc: DemoAccount, id: string): DemoAccount {
  return { ...acc, orders: (acc.orders ?? []).filter((o) => o.id !== id) };
}

/** Moves a waiting order to a new price (dragged line or edited field). */
export function movePendingOrder(acc: DemoAccount, id: string, price: number, market: number): DemoAccount | string {
  const o = (acc.orders ?? []).find((x) => x.id === id);
  if (!o) return "Order nicht gefunden";
  const rounded = +price.toPrecision(6);
  const wrong = checkPendingPrice(o.side, o.type, rounded, market) ?? checkLevels(o.side, rounded, o.stop, o.target);
  if (wrong) return wrong;
  return { ...acc, orders: (acc.orders ?? []).map((x) => (x.id === id ? { ...x, price: rounded } : x)) };
}

/** Whether `price` reached the order, and at which price it fills: a limit at its price, a stop at the market (slippage past the stop). */
export function pendingFill(o: PendingOrder, price: number): number | null {
  const buy = o.side === "long";
  if (o.type === "limit") return (buy ? price <= o.price : price >= o.price) ? o.price : null;
  return (buy ? price >= o.price : price <= o.price) ? price : null;
}

/**
 * A new price of `symbol`: waiting orders that are reached open their position (an order that cannot be
 * paid any more is dropped and reported), then positions whose stop, target or liquidation price was
 * reached are closed at that level.
 */
export function applyPrice(
  acc: DemoAccount,
  symbol: string,
  price: number,
  now: number,
  prices: Record<string, number> = {},
): { account: DemoAccount; closed: DemoTrade[]; filled: DemoPosition[]; rejected: { order: PendingOrder; reason: string }[] } {
  let account = acc;
  const filled: DemoPosition[] = [];
  const rejected: { order: PendingOrder; reason: string }[] = [];
  for (const o of acc.orders ?? []) {
    if (o.symbol !== symbol) continue;
    const at = pendingFill(o, price);
    if (at === null) continue;
    const rest = cancelPendingOrder(account, o.id);
    const next = openPosition(rest, o, at, { ...prices, [symbol]: price }, now, o.id);
    if (typeof next === "string") {
      account = rest;
      rejected.push({ order: o, reason: next });
      continue;
    }
    const pos = next.positions[next.positions.length - 1];
    account = o.replay ? { ...next, positions: next.positions.map((p) => (p === pos ? { ...p, replay: true } : p)) } : next;
    filled.push(account.positions[account.positions.length - 1]);
  }
  const closed: DemoTrade[] = [];
  for (const p of account.positions) {
    if (p.symbol !== symbol) continue;
    const hit = triggerOf(p, price);
    if (!hit) continue;
    const r = closePosition(account, p.id, hit.exit, hit.reason, now);
    if (r) {
      account = r.account;
      closed.push(r.trade);
    }
  }
  return { account, closed, filled, rejected };
}

/**
 * Closes `fraction` (0–1) of a position at `price`: margin and opening fee are split in proportion,
 * the rest stays open with its stop and target. 1 (or more) closes it completely.
 */
export function closePartial(acc: DemoAccount, id: string, fraction: number, price: number, now: number): { account: DemoAccount; trade: DemoTrade } | null {
  const p = acc.positions.find((x) => x.id === id);
  if (!p || !(price > 0) || !(fraction > 0)) return null;
  if (fraction >= 0.999999) return closePosition(acc, id, price, "manual", now);
  const part: DemoPosition = { ...p, id: `${p.id}~${now.toString(36)}`, qty: p.qty * fraction, margin: p.margin * fraction, openFee: p.openFee * fraction };
  const rest: DemoPosition = { ...p, qty: p.qty - part.qty, margin: p.margin - part.margin, openFee: p.openFee - part.openFee };
  const withPart = { ...acc, positions: acc.positions.map((x) => (x.id === id ? rest : x)).concat(part) };
  return closePosition(withPart, part.id, price, "manual", now);
}

/** Size from the margin you want to put in. */
export function qtyFromMargin(amount: number, leverage: number, price: number): number {
  return price > 0 ? (amount * leverage) / price : 0;
}

/** Size so that the stop loses `riskPct` % of the account. */
export function qtyFromRisk(accountValue: number, riskPct: number, entry: number, stop: number): number {
  const dist = Math.abs(entry - stop);
  return dist > 0 ? (accountValue * riskPct) / 100 / dist : 0;
}

export interface DemoStats {
  count: number;
  wins: number;
  winRate: number;
  netPnl: number;
  fees: number;
  best: number;
  worst: number;
}

export function demoStats(history: DemoTrade[]): DemoStats {
  const pnls = history.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0).length;
  return {
    count: pnls.length,
    wins,
    winRate: pnls.length ? wins / pnls.length : 0,
    netPnl: pnls.reduce((a, b) => a + b, 0),
    fees: history.reduce((a, t) => a + t.openFee + t.closeFee, 0),
    best: pnls.length ? Math.max(...pnls) : 0,
    worst: pnls.length ? Math.min(...pnls) : 0,
  };
}

export const REASON_LABELS: Record<CloseReason, string> = {
  manual: "Manuell geschlossen",
  stop: "Stop-Loss",
  target: "Take-Profit",
  liquidation: "Liquidiert",
};

const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Journal entry for a closed demo trade (setup "Demo", so the journal can filter it). */
export function toJournalTrade(t: DemoTrade): JournalTrade {
  return {
    id: journalId(t),
    date: localDate(t.closedAt),
    symbol: t.symbol,
    side: t.side,
    entry: t.entry,
    stop: t.stop,
    exit: t.exit,
    qty: t.qty,
    fees: t.openFee + t.closeFee,
    // A liquidation loses the margin, which the price difference does not show exactly.
    pnl: t.reason === "liquidation" ? t.pnl : undefined,
    setup: t.replay ? "Replay" : "Demo",
    note: `${t.replay ? "Replay-Training" : "Demo-Konto"} · ${REASON_LABELS[t.reason]}${t.leverage > 1 ? ` · ${t.leverage}× Hebel` : ""}`,
  };
}

export const journalId = (t: DemoTrade) => `demo-${t.id}`;

const round2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parsePosition(raw: unknown): DemoPosition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.symbol !== "string" || !finite(r.qty) || !finite(r.entry) || !finite(r.leverage) || !finite(r.margin)) return null;
  return {
    id: r.id,
    symbol: r.symbol,
    side: r.side === "short" ? "short" : "long",
    qty: r.qty,
    entry: r.entry,
    stop: finite(r.stop) ? r.stop : undefined,
    target: finite(r.target) ? r.target : undefined,
    leverage: r.leverage,
    margin: r.margin,
    openFee: finite(r.openFee) ? r.openFee : 0,
    openedAt: finite(r.openedAt) ? r.openedAt : 0,
  };
}

/** Restores a saved account; null when the data is unusable. */
export function parseAccount(json: unknown): DemoAccount | null {
  if (!json || typeof json !== "object") return null;
  const r = json as Record<string, unknown>;
  if (!finite(r.startBalance) || !finite(r.balance)) return null;
  const positions = (Array.isArray(r.positions) ? r.positions : []).map(parsePosition).filter((p): p is DemoPosition => !!p);
  const history = (Array.isArray(r.history) ? r.history : []).flatMap((raw): DemoTrade[] => {
    const p = parsePosition(raw);
    const t = raw as Record<string, unknown>;
    if (!p || !finite(t.exit) || !finite(t.pnl)) return [];
    const reason = (["manual", "stop", "target", "liquidation"] as const).find((x) => x === t.reason) ?? "manual";
    return [{ ...p, exit: t.exit, pnl: t.pnl, reason, closedAt: finite(t.closedAt) ? t.closedAt : 0, closeFee: finite(t.closeFee) ? t.closeFee : 0 }];
  });
  const orders = (Array.isArray(r.orders) ? r.orders : []).flatMap((raw): PendingOrder[] => {
    const p = parsePosition({ margin: 0, entry: (raw as { price?: unknown })?.price, ...(raw as object) });
    const o = raw as Record<string, unknown>;
    if (!p || !finite(o.price) || (o.type !== "limit" && o.type !== "stop")) return [];
    return [{ id: p.id, symbol: p.symbol, side: p.side, type: o.type, price: o.price, qty: p.qty, leverage: p.leverage, stop: p.stop, target: p.target, createdAt: finite(o.createdAt) ? o.createdAt : 0 }];
  });
  return {
    version: 1,
    startBalance: r.startBalance,
    balance: r.balance,
    orders,
    feeRate: finite(r.feeRate) && r.feeRate >= 0 ? r.feeRate : DEFAULT_FEE_RATE,
    positions,
    history,
    createdAt: finite(r.createdAt) ? r.createdAt : 0,
  };
}
