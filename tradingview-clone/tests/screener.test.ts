import { describe, expect, it } from "vitest";
import type { Bar } from "../shared/math";
import { DEFAULT_FILTER, parseTickers, screen, technicals } from "../shared/screener";

const ticker = (symbol: string, last: number, change: number, quoteVolume: number, high = last * 1.1, low = last * 0.9, count = 100) => ({
  symbol,
  lastPrice: String(last),
  priceChangePercent: String(change),
  quoteVolume: String(quoteVolume),
  highPrice: String(high),
  lowPrice: String(low),
  count,
});

const raw = [
  ticker("BTCUSDT", 100, 2, 5e9, 110, 90),
  ticker("ETHUSDT", 50, -3, 2e9),
  ticker("PEPEUSDT", 0.001, 12, 3e8),
  ticker("TINYUSDT", 1, 40, 5e4),
  ticker("ETHBTC", 0.05, 1, 1e3),
  ticker("BTCUPUSDT", 1, 1, 1e7),
  ticker("USDCUSDT", 1, 0, 1e9),
  ticker("DEADUSDT", 0, 0, 0, 0, 0, 0),
];

describe("parseTickers", () => {
  const rows = parseTickers(raw);
  it("keeps traded USDT pairs without leveraged tokens and stablecoins", () => {
    expect(rows.map((r) => r.symbol)).toEqual(["BTCUSDT", "ETHUSDT", "PEPEUSDT", "TINYUSDT"]);
    expect(parseTickers({})).toEqual([]);
  });
  it("places the price in the 24 h range", () => {
    expect(rows[0].rangePct).toBe(50);
    expect(rows[0].base).toBe("BTC");
  });
});

describe("screen", () => {
  const rows = parseTickers(raw);
  it("filters by volume, direction and text and sorts", () => {
    expect(screen(rows, {}, DEFAULT_FILTER, "quoteVolume", true).map((r) => r.base)).toEqual(["BTC", "ETH", "PEPE"]);
    expect(screen(rows, {}, { ...DEFAULT_FILTER, minVolume: 0, direction: "gainers" }, "changePct", true).map((r) => r.base)).toEqual(["TINY", "PEPE", "BTC"]);
    expect(screen(rows, {}, { ...DEFAULT_FILTER, direction: "losers" }, "symbol", false).map((r) => r.base)).toEqual(["ETH"]);
    expect(screen(rows, {}, { ...DEFAULT_FILTER, query: "pe" }, "symbol", false).map((r) => r.base)).toEqual(["PEPE"]);
  });
  it("uses technical columns for filters and puts missing values last", () => {
    const tech = { ETHUSDT: { rsi: 25, sma50Pct: -5, sma200Pct: -10, week: -4, month: -9 }, BTCUSDT: { rsi: 75, sma50Pct: 3, sma200Pct: 20, week: 2, month: 8 } };
    expect(screen(rows, tech, { ...DEFAULT_FILTER, rsi: "oversold" }, "symbol", false).map((r) => r.base)).toEqual(["ETH"]);
    expect(screen(rows, tech, { ...DEFAULT_FILTER, trend: "above200" }, "symbol", false).map((r) => r.base)).toEqual(["BTC"]);
    expect(screen(rows, tech, DEFAULT_FILTER, "rsi", true).map((r) => r.base)).toEqual(["BTC", "ETH", "PEPE"]);
    expect(screen(rows, tech, DEFAULT_FILTER, "rsi", false).map((r) => r.base)).toEqual(["ETH", "BTC", "PEPE"]);
  });
});

describe("technicals", () => {
  const day = (i: number, close: number): Bar => ({ time: i * 86400, open: close, high: close, low: close, close, volume: 1 });
  it("measures changes and SMA distances from daily closes", () => {
    const bars = Array.from({ length: 220 }, (_, i) => day(i, 100 + i));
    const t = technicals(bars);
    expect(t.week).toBeCloseTo(((319 - 312) / 312) * 100);
    expect(t.month).toBeCloseTo(((319 - 289) / 289) * 100);
    // SMA 50 of 270…319 is 294.5.
    expect(t.sma50Pct).toBeCloseTo(((319 - 294.5) / 294.5) * 100);
    expect(t.rsi).toBe(100);
  });
  it("leaves out what the history is too short for", () => {
    const t = technicals([day(0, 1), day(1, 2)]);
    expect([t.sma200Pct, t.week]).toEqual([null, null]);
    expect(technicals([]).rsi).toBeNull();
  });
});
