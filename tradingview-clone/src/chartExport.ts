import { chartCsv, exportName, type ExportColumn } from "../shared/chartExport";
import { displayBars } from "../shared/chartTypes";
import { getIndicator, indicatorLabel, resolveParams } from "../shared/indicators";
import { saveFile } from "./saveFile";
import type { ChartStore } from "./store";

/** The chart's candles as drawn (Renko bricks, replay up to the current candle) with every visible indicator line. */
export function chartCsvOf(chart: ChartStore): string {
  const s = chart.get();
  const bars = displayBars(s.bars, s.chartType, s.settings);
  const columns: ExportColumn[] = [];
  for (const inst of s.indicators) {
    const def = getIndicator(inst.type);
    if (!def || inst.hidden) continue;
    const params = resolveParams(def, inst.params);
    const out = def.compute(bars, params);
    const name = indicatorLabel(def, params);
    for (const o of def.outputs) {
      if (o.helper || !out[o.key]) continue;
      columns.push({ label: def.outputs.length > 1 ? `${name} ${o.label}` : name, values: out[o.key] });
    }
  }
  return chartCsv(bars, columns);
}

/** Saves the chart data as a CSV file (iPad: share sheet → "In Dateien sichern"). */
export function exportChart(chart: ChartStore): Promise<void> {
  const s = chart.get();
  // The byte order mark makes Excel read the umlauts in indicator names correctly.
  return saveFile(exportName(s.symbol, s.interval), `﻿${chartCsvOf(chart)}`, "text/csv");
}
