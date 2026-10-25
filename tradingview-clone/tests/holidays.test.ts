import { describe, expect, it } from "vitest";
import { getExchange, holidayName, marketStatus, tradingDays, upcomingHolidays } from "../shared/exchanges";
import { easter, holidayOn, holidaysOf } from "../shared/holidays";

const sec = (iso: string) => Date.parse(iso) / 1000;
const weekdays = (cal: Parameters<typeof holidaysOf>[0], y: number) =>
  [...holidaysOf(cal, y).keys()].filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())).sort();

describe("exchange holidays", () => {
  it("computes Easter", () => {
    expect(easter(2024)).toBe("2024-03-31");
    expect(easter(2026)).toBe("2026-04-05");
    expect(easter(2027)).toBe("2027-03-28");
  });

  it("matches the NYSE calendar with weekend observance", () => {
    expect(weekdays("us", 2026)).toEqual([
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
      "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    ]);
    // New Year on a Saturday (2022) is not made up on the Friday before.
    expect(holidayOn("us", "2021-12-31")).toBeUndefined();
  });

  it("knows the Xetra and SIX closing days", () => {
    expect(weekdays("de", 2026)).toEqual(["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-24", "2026-12-25", "2026-12-31"]);
    expect(holidayOn("ch", "2026-05-14")).toBe("Auffahrt");
    expect(holidayOn("ch", "2026-05-25")).toBe("Pfingstmontag");
  });

  it("moves UK and Australian Christmas holidays off the weekend", () => {
    // 2027: 25th is a Saturday, 26th a Sunday.
    expect(holidayOn("uk", "2027-12-27")).toBe("Weihnachten");
    expect(holidayOn("uk", "2027-12-28")).toBe("Boxing Day");
    expect(holidayOn("au", "2026-12-28")).toBe("Boxing Day");
  });

  it("handles Japanese substitute and in-between holidays", () => {
    expect(holidayOn("jp", "2026-05-06")).toContain("Ersatz");
    expect(holidayOn("jp", "2026-09-22")).toBe("Volksfeiertag");
    expect(holidayOn("jp", "2026-03-20")).toBe("Frühlingsanfang");
  });

  it("finds lunar holidays in Asia", () => {
    expect(holidayOn("hk", "2026-02-17")).toBe("Chinesisches Neujahr");
    expect(holidayOn("hk", "2026-04-07")).toBe("Ching Ming"); // Sunday + Easter Monday collision
    expect(weekdays("cn", 2026).filter((d) => d.startsWith("2026-02"))).toEqual([
      "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-23",
    ]);
    expect(holidayOn("kr", "2026-09-25")).toBe("Chuseok");
    expect(holidayOn("kr", "2026-08-17")).toBe("Befreiungstag");
    expect(holidayOn("sg", "2026-06-01")).toBe("Vesak");
  });

  it("uses the NSE list and computed Islamic dates", () => {
    expect(holidayOn("in", "2026-11-10")).toBe("Diwali Balipratipada");
    expect(holidayOn("in", "2026-05-28")).toBe("Bakri Id");
    expect(holidayOn("in", "2025-03-31")).toBe("Id-ul-Fitr");
  });
});

describe("closed days in the exchange hours", () => {
  const nyse = getExchange("nyse")!;

  it("drops holidays from the chart sessions", () => {
    const days = tradingDays(nyse, sec("2026-11-23T00:00:00Z"), sec("2026-11-28T23:00:00Z"));
    expect(days.map((d) => d.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27"]);
    const xetra = tradingDays(getExchange("xetra")!, sec("2026-12-21T00:00:00Z"), sec("2027-01-04T23:00:00Z"));
    expect(xetra.map((d) => d.date)).toEqual(["2026-12-21", "2026-12-22", "2026-12-23", "2026-12-28", "2026-12-29", "2026-12-30", "2027-01-04"]);
  });

  it("shows a holiday as closed and points to the next trading day", () => {
    const status = marketStatus(nyse, sec("2026-11-26T16:00:00Z"));
    expect(status.phase).toBe("closed");
    expect(status.day?.date).toBe("2026-11-27");
    expect(holidayName(nyse, "2026-11-26")).toBe("Thanksgiving");
    // Shanghai stays shut through the National Day week.
    expect(marketStatus(getExchange("sse")!, sec("2026-10-01T02:00:00Z")).day?.date).toBe("2026-10-08");
  });

  it("lists upcoming weekday holidays", () => {
    expect(upcomingHolidays(nyse, sec("2026-11-20T12:00:00Z"))).toEqual([{ date: "2026-11-26", name: "Thanksgiving" }]);
  });
});
