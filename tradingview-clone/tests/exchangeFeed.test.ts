import { describe, expect, it } from "vitest";
import { assessFreshness, type FreshnessInput } from "../shared/freshness";
import { applyPrice, feedInterval, feedSymbol, parseStreamMessage, parseTimeSeries, streamSymbol, tickBucket, timeSeriesUrl } from "../shared/exchangeFeed";

const sec = (iso: string) => Date.parse(iso) / 1000;
const ms = (iso: string) => Date.parse(iso);

describe("feed symbols", () => {
  it("maps catalog ids to Twelve Data", () => {
    expect(feedSymbol("AAPL")).toEqual({ symbol: "AAPL", kind: "stock" });
    expect(feedSymbol("SAP.DE")).toEqual({ symbol: "SAP", exchange: "XETR", kind: "stock" });
    expect(streamSymbol(feedSymbol("VOW3.DE")!)).toBe("VOW3:XETR");
    expect(feedSymbol("EURUSD=X")).toEqual({ symbol: "EUR/USD", kind: "forex" });
    expect(feedSymbol("^GDAXI")).toEqual({ symbol: "DAX", kind: "index" });
  });

  it("leaves crypto and futures to their sources", () => {
    expect(feedSymbol("BTCUSDT")).toBeNull();
    expect(feedSymbol("GC=F")).toBeNull();
    expect(feedSymbol("DX-Y.NYB")).toBeNull();
  });

  it("builds a UTC time_series request", () => {
    const url = new URL(timeSeriesUrl(feedSymbol("SAP.DE")!, "1h", 500, "k"));
    expect(url.pathname).toBe("/time_series");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ symbol: "SAP", exchange: "XETR", interval: "1h", outputsize: "500", timezone: "UTC", order: "ASC", apikey: "k" });
    expect(feedInterval("12h")).toEqual({ interval: "1h", aggregate: true });
    expect(feedInterval("3M")).toEqual({ interval: "1month", aggregate: true });
  });
});

describe("time_series answers", () => {
  const values = [
    { datetime: "2026-10-26 13:30:00", open: "10", high: "12", low: "9", close: "11", volume: "100" },
    { datetime: "2026-10-26 14:30:00", open: "11", high: "13", low: "10", close: "12", volume: "50" },
  ];

  it("reads candles in UTC", () => {
    const s = parseTimeSeries({ status: "ok", meta: { type: "Common Stock", exchange: "NASDAQ" }, values }, feedSymbol("AAPL")!, "1h", 1000);
    expect(s.exchange).toBe("NASDAQ");
    expect(s.bars.map((b) => b.time)).toEqual([sec("2026-10-26T13:30:00Z"), sec("2026-10-26T14:30:00Z")]);
    expect(s.bars[0]).toMatchObject({ open: 10, high: 12, low: 9, close: 11, volume: 100 });
    const daily = parseTimeSeries({ status: "ok", meta: { type: "Physical Currency" }, values: [{ datetime: "2026-10-23", open: "1", high: "1", low: "1", close: "1" }] }, feedSymbol("EURUSD=X")!, "1d", 10);
    expect(daily.bars[0].time).toBe(sec("2026-10-23T00:00:00Z"));
  });

  it("refuses errors and an ETF that shares the index ticker", () => {
    expect(() => parseTimeSeries({ status: "error", code: 401, message: "Invalid API key" }, feedSymbol("AAPL")!, "1h", 10)).toThrow(/Invalid API key/);
    expect(() => parseTimeSeries({ status: "ok", meta: { type: "ETF" }, values }, feedSymbol("^GDAXI")!, "1h", 10)).toThrow(/kein Index/);
  });
});

describe("live prices", () => {
  it("parses price events and refused subscriptions", () => {
    expect(parseStreamMessage('{"event":"price","symbol":"AAPL","price":201.5,"timestamp":1761489000,"day_volume":1200}')).toEqual({
      kind: "price",
      event: { symbol: "AAPL", price: 201.5, time: 1761489000000, dayVolume: 1200 },
    });
    expect(parseStreamMessage('{"event":"subscribe-status","status":"error","success":[],"fails":[{"symbol":"SAP:XETR"}]}')).toEqual({ kind: "status", ok: [], failed: ["SAP:XETR"] });
    expect(parseStreamMessage("nonsense").kind).toBe("other");
  });

  it("continues the half-hour grid of US candles", () => {
    const last = { time: sec("2026-10-26T14:30:00Z"), open: 1, high: 1, low: 1, close: 1, volume: 0 };
    expect(tickBucket("1h", sec("2026-10-26T15:10:00Z"), last)).toBe(sec("2026-10-26T14:30:00Z"));
    expect(tickBucket("1h", sec("2026-10-26T15:31:00Z"), last)).toBe(sec("2026-10-26T15:30:00Z"));
    // Next morning, opening bell.
    expect(tickBucket("1h", sec("2026-10-27T13:30:05Z"), last)).toBe(sec("2026-10-27T13:30:00Z"));
    expect(tickBucket("1d", sec("2026-10-27T15:00:00Z"), last)).toBe(sec("2026-10-27T00:00:00Z"));
  });

  it("updates the forming candle and opens the next one", () => {
    const bars = [{ time: sec("2026-10-26T14:30:00Z"), open: 10, high: 11, low: 9, close: 10, volume: 5 }];
    const a = applyPrice(bars, "1h", 12, ms("2026-10-26T15:00:00Z"), 3);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ high: 12, close: 12, volume: 8 });
    const b = applyPrice(a, "1h", 8, ms("2026-10-26T15:30:01Z"));
    expect(b).toHaveLength(2);
    expect(b[1]).toMatchObject({ time: sec("2026-10-26T15:30:00Z"), open: 8, close: 8 });
    expect(bars[0].close).toBe(10);
  });
});

describe("freshness proof with the exchange feed", () => {
  const input = (patch: Partial<FreshnessInput>): FreshnessInput => ({
    symbol: "AAPL",
    interval: "1m",
    source: "twelvedata",
    lastBarTime: sec("2026-10-26T15:39:00Z"),
    deviceNow: ms("2026-10-26T15:39:30Z"),
    clock: { offsetMs: 0, rttMs: 80, source: "test", measuredAt: ms("2026-10-26T15:39:00Z"), samples: 5 },
    tick: { eventTime: ms("2026-10-26T15:39:28Z"), receivedAt: ms("2026-10-26T15:39:28.3Z") },
    loadedAt: ms("2026-10-26T15:30:00Z"),
    rest: null,
    replay: false,
    ...patch,
  });
  const fmt = (s: number) => new Date(s * 1000).toISOString().slice(0, 16);

  it("shows Börsenkurs while ticks arrive during trading hours", () => {
    const r = assessFreshness(input({}), fmt);
    expect(r.summary).toBe("Börsenkurs");
    expect(r.checks.find((c) => c.id === "market")!.detail).toMatch(/Börsen-Feed \(Twelve Data\)/);
  });

  it("does not ask for ticks while the exchange is closed", () => {
    const r = assessFreshness(input({ deviceNow: ms("2026-10-25T12:00:00Z"), lastBarTime: sec("2026-10-24T19:59:00Z"), tick: null }), fmt);
    expect(r.checks.find((c) => c.id === "tick")!.level).toBe("info");
  });

  it("flags a delayed feed by the age of its ticks", () => {
    const r = assessFreshness(input({ tick: { eventTime: ms("2026-10-26T15:24:30Z"), receivedAt: ms("2026-10-26T15:39:29Z") } }), fmt);
    expect(r.checks.find((c) => c.id === "tick")!.level).toBe("bad");
  });
});
