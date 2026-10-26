import { useEffect, useState } from "react";
import { footprintInterval } from "../shared/footprint";
import { intervalSeconds } from "../shared/marketData";
import type { Bar } from "../shared/math";
import { fetchMarketData, useChart, type ChartStore } from "./store";

/** The lower time frame is reloaded this often while the footprint is on. */
const REFRESH_MS = 20_000;

export interface FootprintData {
  interval: string;
  bars: Bar[];
  /** The source has real taker-buy volume (Binance); otherwise buying and selling are estimated from the candle. */
  exact: boolean;
}

/** Lower-time-frame candles for the footprint of a chart (the newest 1000), or null when it is off or not possible. */
export function useFootprintData(chart: ChartStore): FootprintData | null {
  const on = useChart(chart, (s) => s.settings.footprint);
  const symbol = useChart(chart, (s) => s.symbol);
  const interval = useChart(chart, (s) => s.interval);
  const source = useChart(chart, (s) => s.source);
  const [data, setData] = useState<FootprintData | null>(null);
  const sub = footprintInterval(intervalSeconds(interval));

  useEffect(() => {
    setData(null);
    if (!on || !sub || !source || source === "demo") return;
    let alive = true;
    const load = () =>
      fetchMarketData(symbol, sub, 1000)
        .then((m) => alive && m.source !== "demo" && setData({ interval: sub, bars: m.bars, exact: m.source === "binance" || m.source === "binance_futures" }))
        .catch(() => undefined);
    void load();
    const t = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [on, symbol, sub, source]);

  return on ? data : null;
}
