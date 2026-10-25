import { describe, expect, it } from "vitest";
import {
  applyPrice,
  available,
  closePosition,
  createAccount,
  demoStats,
  equity,
  liquidationPrice,
  modifyPosition,
  openPosition,
  parseAccount,
  qtyFromMargin,
  qtyFromRisk,
  toJournalTrade,
  type DemoAccount,
  type Order,
} from "../shared/demoTrading";
import { tradePnl } from "../shared/journal";

const order = (o: Partial<Order>): Order => ({ symbol: "BTCUSDT", side: "long", qty: 1, leverage: 1, ...o });

function open(acc: DemoAccount, o: Partial<Order>, price: number, id = "p1"): DemoAccount {
  const next = openPosition(acc, order(o), price, {}, 1000, id);
  if (typeof next === "string") throw new Error(next);
  return next;
}

describe("demo trading account", () => {
  it("opens and closes a long with fees", () => {
    const acc = createAccount(10_000, 0, 0.001);
    const a1 = open(acc, { qty: 10 }, 100);
    expect(a1.balance).toBeCloseTo(10_000 - 1); // 0.1 % of 1000 $
    expect(a1.positions[0].margin).toBe(1000);
    expect(equity(a1, { BTCUSDT: 110 })).toBeCloseTo(9_999 + 100);
    expect(available(a1, { BTCUSDT: 110 })).toBeCloseTo(9_099);
    const r = closePosition(a1, "p1", 110, "manual", 2000)!;
    expect(r.trade.closeFee).toBeCloseTo(1.1);
    expect(r.trade.pnl).toBeCloseTo(100 - 1 - 1.1);
    expect(r.account.balance).toBeCloseTo(10_000 + 97.9);
    expect(r.account.positions).toHaveLength(0);
    expect(r.account.history).toHaveLength(1);
  });

  it("earns on a short when the price falls", () => {
    const a1 = open(createAccount(1000, 0, 0), { side: "short", qty: 2 }, 50);
    const r = closePosition(a1, "p1", 40, "manual", 1)!;
    expect(r.trade.pnl).toBe(20);
    expect(r.account.balance).toBe(1020);
  });

  it("uses leverage for margin and refuses orders without enough money", () => {
    const acc = createAccount(1000, 0, 0);
    const a1 = open(acc, { qty: 1, leverage: 10 }, 5000);
    expect(a1.positions[0].margin).toBe(500);
    expect(openPosition(a1, order({ qty: 1, leverage: 5 }), 5000, {}, 0, "p2")).toMatch(/Nicht genug Guthaben/);
    expect(openPosition(acc, order({ qty: 0 }), 100, {}, 0, "x")).toMatch(/Größe/);
    expect(openPosition(acc, order({}), NaN, {}, 0, "x")).toMatch(/Kurs/);
  });

  it("checks that stop and target are on the right side", () => {
    const acc = createAccount(10_000, 0, 0);
    expect(openPosition(acc, order({ stop: 105 }), 100, {}, 0, "x")).toMatch(/Stop-Loss/);
    expect(openPosition(acc, order({ target: 95 }), 100, {}, 0, "x")).toMatch(/Take-Profit/);
    expect(openPosition(acc, order({ side: "short", stop: 95 }), 100, {}, 0, "x")).toMatch(/Stop-Loss/);
    expect(typeof openPosition(acc, order({ side: "short", stop: 105, target: 90 }), 100, {}, 0, "x")).toBe("object");
    // 50× long: liquidation at 98, a stop at 97 would never be reached.
    expect(openPosition(acc, order({ leverage: 50, stop: 97 }), 100, {}, 0, "x")).toMatch(/Liquidationspreis/);
  });

  it("computes liquidation prices for isolated margin", () => {
    expect(liquidationPrice({ side: "long", entry: 100, qty: 1, margin: 10 })).toBeCloseTo(90);
    expect(liquidationPrice({ side: "short", entry: 100, qty: 1, margin: 10 })).toBeCloseTo(110);
    expect(liquidationPrice({ side: "long", entry: 100, qty: 1, margin: 100 })).toBeNull();
  });

  it("closes positions at stop, target and liquidation", () => {
    let acc = createAccount(10_000, 0, 0);
    acc = open(acc, { stop: 95, target: 120 }, 100, "a");
    acc = open(acc, { side: "short", stop: 110, target: 90 }, 100, "b");
    acc = open(acc, { symbol: "ETHUSDT" }, 100, "c");

    let r = applyPrice(acc, "BTCUSDT", 101, 5);
    expect(r.closed).toHaveLength(0);

    r = applyPrice(acc, "BTCUSDT", 94, 5);
    expect(r.closed.map((t) => [t.id, t.reason, t.exit])).toEqual([["a", "stop", 95]]);
    expect(r.account.positions.map((p) => p.id)).toEqual(["b", "c"]);

    r = applyPrice(r.account, "BTCUSDT", 89, 6);
    expect(r.closed.map((t) => [t.id, t.reason, t.exit, t.pnl])).toEqual([["b", "target", 90, 10]]);

    let lev = open(createAccount(1000, 0, 0), { qty: 1, leverage: 10 }, 100, "l");
    const liq = applyPrice(lev, "BTCUSDT", 89, 1);
    expect(liq.closed[0].reason).toBe("liquidation");
    expect(liq.closed[0].pnl).toBeCloseTo(-10);
    expect(liq.account.balance).toBeCloseTo(990);
    lev = liq.account;
    expect(lev.positions).toHaveLength(0);
  });

  it("moves stop and target of an open position", () => {
    const acc = open(createAccount(10_000, 0, 0), { stop: 90 }, 100);
    const moved = modifyPosition(acc, "p1", { stop: 100, target: 130 }, 110);
    expect(typeof moved).toBe("object");
    expect((moved as DemoAccount).positions[0]).toMatchObject({ stop: 100, target: 130 });
    expect(modifyPosition(acc, "p1", { stop: 115 }, 110)).toMatch(/Stop-Loss/);
  });

  it("sizes orders from margin or risk", () => {
    expect(qtyFromMargin(1000, 5, 100)).toBe(50);
    expect(qtyFromRisk(10_000, 1, 100, 95)).toBe(20);
    expect(qtyFromRisk(10_000, 1, 100, 100)).toBe(0);
  });

  it("summarizes history and turns trades into journal entries", () => {
    let acc = open(createAccount(10_000, 0, 0.0005), { qty: 10, stop: 95 }, 100, "w");
    acc = closePosition(acc, "w", 110, "target", Date.UTC(2026, 9, 25, 12))!.account;
    acc = open(acc, { qty: 10 }, 100, "l");
    acc = closePosition(acc, "l", 98, "manual", Date.UTC(2026, 9, 25, 13))!.account;
    const s = demoStats(acc.history);
    expect(s.count).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.netPnl).toBeCloseTo(acc.balance - 10_000);

    const j = toJournalTrade(acc.history[0]);
    expect(j).toMatchObject({ id: "demo-w", symbol: "BTCUSDT", side: "long", entry: 100, stop: 95, exit: 110, qty: 10, setup: "Demo" });
    expect(tradePnl(j)).toBeCloseTo(acc.history[0].pnl);
  });

  it("restores a saved account and rejects broken data", () => {
    const acc = open(createAccount(5000, 0, 0), { stop: 90 }, 100);
    const restored = parseAccount(JSON.parse(JSON.stringify(acc)));
    expect(restored).toEqual(acc);
    expect(parseAccount(null)).toBeNull();
    expect(parseAccount({ balance: "x" })).toBeNull();
    expect(parseAccount({ startBalance: 1, balance: 1, positions: [{ id: 3 }] })?.positions).toEqual([]);
  });
});
