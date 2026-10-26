import { describe, expect, it } from "vitest";
import { chartCsv, exportName } from "../shared/chartExport";

describe("chartCsv", () => {
  it("writes candles and indicator lines with decimal comma", () => {
    const csv = chartCsv(
      [
        { time: 1_700_000_000, open: 1.5, high: 2, low: 1, close: 1.75, volume: 1000 },
        { time: 1_700_003_600, open: 1.75, high: 2.5, low: 1.5, close: 2.25, volume: 1200.5 },
      ],
      [{ label: "EMA 21", values: [null, 2.1] }, { label: 'Name;"x"', values: [1, 2] }],
    );
    expect(csv.split("\n")).toEqual([
      'time;unix;open;high;low;close;volume;EMA 21;"Name;""x"""',
      "2023-11-14T22:13:20Z;1700000000;1,5;2;1;1,75;1000;;1",
      "2023-11-14T23:13:20Z;1700003600;1,75;2,5;1,5;2,25;1200,5;2,1;2",
    ]);
  });
});

describe("exportName", () => {
  it("names the file after symbol, time frame and day", () => {
    expect(exportName("^GDAXI", "1h", new Date("2026-10-26T12:00:00Z"))).toBe("GDAXI_1h_2026-10-26.csv");
  });
});
