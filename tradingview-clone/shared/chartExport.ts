// Chart data as CSV, like TradingView's "Export chart data": the candles plus every line of the indicators.
import type { Bar, Series } from "./math.js";

export interface ExportColumn {
  label: string;
  values: Series;
}

/** Semicolon separated with decimal comma (German Excel/Numbers); time as UTC ISO and unix seconds. */
export function chartCsv(bars: Bar[], columns: ExportColumn[]): string {
  const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "" : String(+v.toPrecision(12)).replace(".", ","));
  const text = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ["time", "unix", "open", "high", "low", "close", "volume", ...columns.map((c) => text(c.label))].join(";");
  const rows = bars.map((b, i) =>
    [new Date(b.time * 1000).toISOString().replace(".000Z", "Z"), String(b.time), num(b.open), num(b.high), num(b.low), num(b.close), num(b.volume), ...columns.map((c) => num(c.values[i]))].join(";"),
  );
  return [head, ...rows].join("\n");
}

/** File name like BTCUSDT_1h_2026-10-26.csv. */
export function exportName(symbol: string, interval: string, now = new Date()): string {
  return `${symbol.replace(/[^A-Za-z0-9._-]/g, "")}_${interval}_${now.toISOString().slice(0, 10)}.csv`;
}
