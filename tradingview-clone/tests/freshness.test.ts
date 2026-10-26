import { describe, expect, it } from "vitest";
import { assessFreshness, candleStart, clockFromSamples, marketNow, referenceMarket, type FreshnessInput } from "../shared/freshness";

const ms = (iso: string) => Date.parse(iso);
const sec = (iso: string) => Date.parse(iso) / 1000;
const fmt = (s: number) => new Date(s * 1000).toISOString().slice(0, 16);

const base = (patch: Partial<FreshnessInput>): FreshnessInput => ({
  symbol: "BTCUSDT",
  interval: "1h",
  source: "binance",
  lastBarTime: sec("2026-10-26T13:00:00Z"),
  deviceNow: ms("2026-10-26T13:40:00Z"),
  clock: { offsetMs: 0, rttMs: 80, source: "Binance-Serverzeit", measuredAt: ms("2026-10-26T13:39:00Z"), samples: 5 },
  tick: { eventTime: ms("2026-10-26T13:39:59Z"), receivedAt: ms("2026-10-26T13:39:59.1Z") },
  loadedAt: ms("2026-10-26T13:30:00Z"),
  rest: null,
  replay: false,
  ...patch,
});

const check = (input: FreshnessInput, id: string) => assessFreshness(input, fmt).checks.find((c) => c.id === id)!;

describe("clock sync", () => {
  it("takes the offset from the shortest round trip", () => {
    const sync = clockFromSamples(
      [
        { sentAt: 1000, serverTime: 3000, receivedAt: 1400 }, // rtt 400
        { sentAt: 2000, serverTime: 4050, receivedAt: 2100 }, // rtt 100 -> offset 4050 - 2050
      ],
      "test",
    )!;
    expect(sync.rttMs).toBe(100);
    expect(sync.offsetMs).toBe(2000);
  });

  it("flags a device clock that is several seconds off", () => {
    const clock = { offsetMs: -7000, rttMs: 60, source: "test", measuredAt: ms("2026-10-26T13:39:00Z"), samples: 5 };
    const c = check(base({ clock }), "clock");
    expect(c.level).toBe("bad");
    expect(c.detail).toContain("geht vor");
  });

  it("judges the candle with the corrected time, not the wrong device clock", () => {
    // Device clock one hour behind: the 13:00 candle is still current by server time.
    const clock = { offsetMs: 3_600_000, rttMs: 60, source: "test", measuredAt: ms("2026-10-26T12:39:00Z"), samples: 5 };
    const input = base({ deviceNow: ms("2026-10-26T12:40:00Z"), clock });
    expect(check(input, "candle").level).toBe("ok");
  });
});

describe("candle freshness", () => {
  it("is ok when the last candle is the one forming now", () => {
    const r = assessFreshness(base({}), fmt);
    expect(r.level).toBe("ok");
    expect(r.summary).toBe("Live");
  });

  it("is bad when candles are missing on a 24/7 market", () => {
    expect(check(base({ lastBarTime: sec("2026-10-26T10:00:00Z") }), "candle").level).toBe("bad");
  });

  it("accepts the previous candle right after a new one started", () => {
    const input = base({ deviceNow: ms("2026-10-26T14:00:10Z"), tick: { eventTime: ms("2026-10-26T14:00:09Z"), receivedAt: ms("2026-10-26T14:00:09Z") } });
    expect(check(input, "candle").level).toBe("ok");
  });

  it("does not expect new stock candles at the weekend", () => {
    // Saturday: NYSE closed, the last 1h candle of Friday is current.
    const input = base({ symbol: "JPM", source: "yahoo", lastBarTime: sec("2026-10-23T19:00:00Z"), deviceNow: ms("2026-10-24T12:00:00Z"), tick: null });
    expect(check(input, "candle").level).toBe("ok");
    expect(check(input, "market").detail).toContain("geschlossen");
  });

  it("does not expect a candle on an exchange holiday", () => {
    // 25 Dec 2026 (Friday): Xetra closed, Thursday 24 Dec is a holiday too.
    const input = base({ symbol: "SAP.DE", source: "yahoo", interval: "1d", lastBarTime: sec("2026-12-23T00:00:00Z"), deviceNow: ms("2026-12-25T12:00:00Z"), tick: null });
    expect(check(input, "candle").level).toBe("ok");
  });

  it("tolerates the usual exchange delay of Yahoo but not more", () => {
    const now = ms("2026-10-26T15:00:00Z"); // Nasdaq open
    const delayed = base({ symbol: "MSFT", source: "yahoo", interval: "5m", lastBarTime: sec("2026-10-26T14:45:00Z"), deviceNow: now, tick: null });
    expect(check(delayed, "candle").level).toBe("warn");
    const stale = { ...delayed, lastBarTime: sec("2026-10-26T13:45:00Z") };
    expect(check(stale, "candle").level).toBe("bad");
  });

  it("aligns weekly candles to Monday like Binance", () => {
    expect(candleStart("1w", sec("2026-10-28T10:00:00Z"))).toBe(sec("2026-10-26T00:00:00Z"));
  });

  it("never proves demo data", () => {
    const r = assessFreshness(base({ source: "demo", tick: null }), fmt);
    expect(r.level).toBe("bad");
    expect(r.summary).toBe("Demo");
  });
});

describe("live ticks and REST cross-check", () => {
  it("warns about a stalled stream", () => {
    expect(check(base({ tick: { eventTime: ms("2026-10-26T13:38:30Z"), receivedAt: ms("2026-10-26T13:38:30Z") } }), "tick").level).toBe("warn");
    expect(check(base({ tick: { eventTime: ms("2026-10-26T13:30:00Z"), receivedAt: ms("2026-10-26T13:30:00Z") } }), "tick").level).toBe("bad");
  });

  it("compares the chart with a fresh REST answer", () => {
    const rest = { at: ms("2026-10-26T13:39:50Z"), restTime: sec("2026-10-26T13:00:00Z"), restClose: 100, chartTime: sec("2026-10-26T13:00:00Z"), chartClose: 100.05 };
    expect(check(base({ rest }), "rest").level).toBe("ok");
    expect(check(base({ rest: { ...rest, chartTime: sec("2026-10-26T12:00:00Z") } }), "rest").level).toBe("bad");
  });
});

describe("reference market", () => {
  it("maps assets to their exchange", () => {
    expect(referenceMarket("TSLAUSDT", "binance_futures")).toMatchObject({ kind: "exchange", label: "Nasdaq" });
    expect(referenceMarket("SAP.DE", "yahoo")).toMatchObject({ kind: "exchange", label: "Xetra" });
    expect(referenceMarket("BTCUSDT", "binance").kind).toBe("24/7");
    expect(referenceMarket("EURUSD=X", "yahoo").kind).toBe("24/5");
  });

  it("closes 24/5 markets at the weekend", () => {
    const fx = referenceMarket("EURUSD=X", "yahoo");
    const sat = marketNow(fx, sec("2026-10-24T12:00:00Z"));
    expect(sat.open).toBe(false);
    expect(sat.lastTrade).toBe(sec("2026-10-23T21:00:00Z") - 1); // Friday 17:00 New York (EDT)
    expect(marketNow(fx, sec("2026-10-26T12:00:00Z")).open).toBe(true);
  });
});

describe("daily candles of exchanges", () => {
  it("reads the candle date in the exchange's time zone", () => {
    // Sources stamp a Xetra day candle at 00:00 Berlin, i.e. 23:00 UTC of the day before.
    const input = base({ symbol: "SAP.DE", source: "yahoo", interval: "1d", lastBarTime: sec("2026-10-25T23:00:00Z"), deviceNow: ms("2026-10-26T12:00:00Z"), tick: null });
    expect(check(input, "candle").level).toBe("ok");
  });
});
