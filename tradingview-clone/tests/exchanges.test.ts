import { describe, expect, it } from "vitest";
import { clock, dayShift, getExchange, marketStatus, nextClockChange, tradingDays, zonedToUtc } from "../shared/exchanges";

const sec = (iso: string) => Date.parse(iso) / 1000;
const nyse = getExchange("nyse")!;

describe("exchange hours", () => {
  it("converts wall time to UTC across daylight saving", () => {
    // New York: EDT (UTC-4) until 1 Nov 2026, then EST (UTC-5).
    expect(zonedToUtc(2026, 10, 30, 9, 30, "America/New_York")).toBe(Date.parse("2026-10-30T13:30:00Z"));
    expect(zonedToUtc(2026, 11, 2, 9, 30, "America/New_York")).toBe(Date.parse("2026-11-02T14:30:00Z"));
    expect(zonedToUtc(2026, 7, 1, 9, 0, "Europe/Berlin")).toBe(Date.parse("2026-07-01T07:00:00Z"));
  });

  it("shows NYSE at 14:30 Berlin in the week between the two clock changes", () => {
    const days = tradingDays(nyse, sec("2026-10-19T00:00:00Z"), sec("2026-11-06T23:00:00Z"));
    const at = (date: string) => days.find((d) => d.date === date)!;
    expect(clock(at("2026-10-23").open, "Europe/Berlin")).toBe("15:30");
    expect(clock(at("2026-10-26").open, "Europe/Berlin")).toBe("14:30");
    expect(clock(at("2026-11-02").open, "Europe/Berlin")).toBe("15:30");
    expect(clock(at("2026-11-02").close, "Europe/Berlin")).toBe("22:00");
  });

  it("skips weekends and splits lunch breaks", () => {
    const days = tradingDays(getExchange("hkex")!, sec("2026-10-24T00:00:00Z"), sec("2026-10-26T23:00:00Z"));
    expect(days.map((d) => d.date)).toEqual(["2026-10-26"]);
    expect(days[0].parts).toHaveLength(2);
    expect(clock(days[0].parts[0].end, "Asia/Hong_Kong")).toBe("12:00");
  });

  it("reports open, lunch and closed phases", () => {
    expect(marketStatus(nyse, sec("2026-10-26T14:00:00Z")).phase).toBe("open");
    const closed = marketStatus(nyse, sec("2026-10-25T10:00:00Z"));
    expect(closed.phase).toBe("closed");
    expect(closed.next).toBe(sec("2026-10-26T13:30:00Z"));
    expect(marketStatus(getExchange("tse")!, sec("2026-10-26T03:00:00Z")).phase).toBe("lunch");
  });

  it("finds the next shift on the viewer's clock", () => {
    const change = nextClockChange(nyse, sec("2026-10-25T10:00:00Z"), "Europe/Berlin");
    expect(change).toEqual({ date: "2026-11-02", open: "15:30", close: "22:00" });
  });

  it("knows when the viewer's date differs from the exchange's", () => {
    // Tokio opens at 09:00 JST = 20:00 the evening before in New York.
    const [day] = tradingDays(getExchange("tse")!, sec("2026-10-26T00:00:00Z"), sec("2026-10-26T04:00:00Z"));
    expect(day.date).toBe("2026-10-26");
    expect(clock(day.open, "America/New_York")).toBe("20:00");
    expect(dayShift(day.open, day.date, "America/New_York")).toBe(-1);
    expect(dayShift(day.open, day.date, "Asia/Tokyo")).toBe(0);
  });
});
