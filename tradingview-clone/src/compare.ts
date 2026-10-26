import { useEffect, useMemo, useState } from "react";
import { COMPARE_COLORS } from "../shared/compare";
import type { MarketData } from "../shared/marketData";
import { fetchMarketData, useChart, type ChartStore } from "./store";

export interface CompareLine {
  symbol: string;
  color: string;
  bars: MarketData["bars"];
  source: MarketData["source"] | null;
  error: string | null;
}

/** Compared symbols are reloaded this often (they have no live stream of their own). */
const REFRESH_MS = 30_000;

/** Candles of the symbols compared on a chart, reloaded every 30 s. */
export function useCompareData(chart: ChartStore): CompareLine[] {
  const compare = useChart(chart, (s) => s.compare);
  const interval = useChart(chart, (s) => s.interval);
  const [data, setData] = useState<Record<string, Omit<CompareLine, "symbol" | "color">>>({});

  useEffect(() => {
    if (!compare.length) return;
    let alive = true;
    const load = () =>
      compare.forEach((symbol) =>
        fetchMarketData(symbol, interval)
          .then((m) => alive && setData((d) => ({ ...d, [symbol]: { bars: m.bars, source: m.source, error: null } })))
          .catch((err: Error) => alive && setData((d) => ({ ...d, [symbol]: { bars: d[symbol]?.bars ?? [], source: d[symbol]?.source ?? null, error: err.message } }))),
      );
    // A new time frame must not show the candles of the old one.
    setData({});
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [compare.join("|"), interval]);

  return useMemo(
    () => compare.map((symbol, i) => ({ symbol, color: COMPARE_COLORS[i % COMPARE_COLORS.length], ...(data[symbol] ?? { bars: [], source: null, error: null }) })),
    [compare, data],
  );
}
