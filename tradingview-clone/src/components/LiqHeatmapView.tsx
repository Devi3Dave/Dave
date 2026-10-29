import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openInterestModel, simulateLiquidations, type Heatmap } from "../../shared/liquidations";
import { isCryptoSymbol } from "../../shared/marketData";
import { parseVenueSymbol } from "../../shared/venues";
import type { Bar } from "../../shared/math";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { resolveTimeZone } from "../chartSettings";
import { fetchMarketData, fetchOpenInterest, useChartState } from "../store";

interface RangeDef {
  id: string;
  label: string;
  interval: string; // candle size = OI period
  show: number; // candles displayed
  warm: number; // extra history that only seeds the model
}

const RANGES: RangeDef[] = [
  { id: "12h", label: "12 h", interval: "5m", show: 144, warm: 288 },
  { id: "24h", label: "24 h", interval: "5m", show: 288, warm: 200 },
  { id: "3d", label: "3 T", interval: "15m", show: 288, warm: 200 },
  { id: "1w", label: "1 W", interval: "30m", show: 336, warm: 160 },
  { id: "1M", label: "1 M", interval: "2h", show: 360, warm: 140 },
  { id: "3M", label: "3 M", interval: "6h", show: 360, warm: 140 },
  { id: "6M", label: "6 M", interval: "12h", show: 360, warm: 140 },
  { id: "1y", label: "1 J", interval: "1d", show: 365, warm: 135 },
];

const ROWS = 220;
const AXIS_W = 70;
const LEGEND_W = 52;
const TIME_H = 24;
const REFRESH_MS = 60_000;

// CoinGlass-like ramp, opaque: dark purple → blue → teal → green → yellow.
const STOPS: [number, [number, number, number]][] = [
  [0, [33, 8, 58]],
  [0.2, [52, 38, 140]],
  [0.45, [36, 130, 160]],
  [0.7, [70, 190, 110]],
  [1, [250, 235, 60]],
];

function ramp(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  let k = 0;
  while (k < STOPS.length - 2 && x > STOPS[k + 1][0]) k++;
  const [t0, c0] = STOPS[k];
  const [t1, c1] = STOPS[k + 1];
  const f = (x - t0) / (t1 - t0);
  return [0, 1, 2].map((i) => Math.round(c0[i] + (c1[i] - c0[i]) * f)) as [number, number, number];
}

const short = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0));
const usd = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} Mrd. $` : v >= 1e6 ? `${(v / 1e6).toFixed(2)} Mio. $` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} Tsd. $` : `${v.toFixed(0)} $`);

function niceStep(range: number, target: number) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => range / s <= target) ?? mag * 10;
}

interface Model {
  bars: Bar[];
  hm: Heatmap;
  from: number;
  source: string;
  oiCoverage: number;
  scaleMax: number;
}

interface Hover {
  x: number;
  y: number;
}

export function LiqHeatmapView({ onClose }: { onClose: () => void }) {
  const symbol = useChartState((s) => s.symbol);
  const timeZone = useChartState((s) => s.settings.timeZone);
  const [rangeId, setRangeId] = useState("24h");
  const [contrast, setContrast] = useState(0.55);
  const [threshold, setThreshold] = useState(0.06);
  const [model, setModel] = useState<Model | null>(null);
  const [status, setStatus] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const [hover, setHover] = useState<Hover | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const range = RANGES.find((r) => r.id === rangeId)!;
  // Other exchanges (KRAKEN:BTCUSD.P …) load their candles like the chart does (through the own relay
  // where the exchange blocks the browser); open interest exists only for Binance futures (fapi).
  const venue = parseVenueSymbol(symbol) !== null;
  const crypto = isCryptoSymbol(symbol) || venue;

  const load = useCallback(async () => {
    if (!crypto) {
      setStatus({ loading: false, error: null });
      return;
    }
    setStatus((s) => ({ ...s, loading: true }));
    try {
      const [md, oi] = await Promise.all([
        fetchMarketData(symbol, range.interval, range.show + range.warm),
        venue ? Promise.resolve(null) : fetchOpenInterest(symbol, range.interval, 500).catch(() => null),
      ]);
      const bars = md.bars;
      if (bars.length < 10) throw new Error("Zu wenige Kursdaten");
      const from = Math.max(0, bars.length - range.show);
      const shown = bars.slice(from);
      const lo = Math.min(...shown.map((b) => b.low));
      const hi = Math.max(...shown.map((b) => b.high));
      const pad = Math.max((hi - lo) * 0.6, lo * 0.04);
      const om = oi && oi.length > 1 ? openInterestModel(bars, oi) : null;
      const hm = simulateLiquidations(bars, {
        fromIndex: from,
        rows: ROWS,
        priceLow: lo - pad,
        priceHigh: hi + pad,
        inflow: om?.inflow,
        retention: om?.retention,
      });
      if (!hm) throw new Error("Heatmap konnte nicht berechnet werden");
      // Scale to the 99.5th percentile so a single hot cell doesn't wash out the rest.
      const values = Array.from(hm.grid).filter((v) => v > 0).sort((a, b) => a - b);
      const scaleMax = values.length ? values[Math.floor(values.length * 0.995)] : 1;
      const source = `${md.source === "demo" ? "Demo-Daten · " : ""}${om && om.coverage > 0 ? "Open Interest + Volumen" : "nur Volumen"}`;
      setModel({ bars, hm, from, source, oiCoverage: om?.coverage ?? 0, scaleMax });
      setStatus({ loading: false, error: null });
    } catch (err) {
      setStatus({ loading: false, error: (err as Error).message });
    }
  }, [symbol, range, crypto, venue]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Heatmap cells rendered once per model/contrast into an offscreen canvas (1 px per cell).
  const cells = useMemo(() => {
    if (!model) return null;
    const { hm, scaleMax } = model;
    const cols = hm.grid.length / hm.rows;
    const off = document.createElement("canvas");
    off.width = cols;
    off.height = hm.rows;
    const ctx = off.getContext("2d")!;
    const img = ctx.createImageData(cols, hm.rows);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < hm.rows; r++) {
        const v = hm.grid[c * hm.rows + r];
        let t = v > 0 ? Math.min(1, v / scaleMax) ** contrast : 0;
        if (t < threshold) t = 0;
        const [R, G, B] = ramp(t);
        const o = ((hm.rows - 1 - r) * cols + c) * 4;
        img.data[o] = R;
        img.data[o + 1] = G;
        img.data[o + 2] = B;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return off;
  }, [model, contrast, threshold]);

  // Draw everything.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model || !cells || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { bars, hm, from, scaleMax } = model;
    const plotW = size.w - AXIS_W - LEGEND_W;
    const plotH = size.h - TIME_H;
    const cols = hm.grid.length / hm.rows;
    const priceHigh = hm.priceLow + hm.rows * hm.priceStep;
    const yOf = (p: number) => ((priceHigh - p) / (priceHigh - hm.priceLow)) * plotH;
    const xOf = (c: number) => ((c + 0.5) / cols) * plotW;

    ctx.fillStyle = "#131722";
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cells, 0, 0, plotW, plotH);

    // Price line.
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let c = 0; c < cols; c++) {
      const b = bars[from + c];
      const x = xOf(c);
      const y = yOf(b.close);
      if (c === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Price axis.
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#131722";
    ctx.fillRect(plotW, 0, AXIS_W + LEGEND_W, size.h);
    const pStep = niceStep(priceHigh - hm.priceLow, Math.max(4, plotH / 48));
    ctx.fillStyle = "#b2b5be";
    for (let p = Math.ceil(hm.priceLow / pStep) * pStep; p <= priceHigh; p += pStep) {
      const y = yOf(p);
      ctx.fillText(formatPrice(p), plotW + 6, y);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(0, Math.round(y), plotW, 1);
      ctx.fillStyle = "#b2b5be";
    }
    const last = bars[bars.length - 1];
    const ly = yOf(last.close);
    ctx.fillStyle = "#f5c518";
    ctx.fillRect(plotW, ly - 9, AXIS_W - 4, 18);
    ctx.fillStyle = "#131722";
    ctx.fillText(formatPrice(last.close), plotW + 6, ly);

    // Time axis.
    const tz = resolveTimeZone(timeZone);
    const intraday = bars[from + 1].time - bars[from].time < 86400;
    const tfmt = new Intl.DateTimeFormat("de-DE", intraday ? { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { timeZone: tz, day: "2-digit", month: "2-digit", year: "2-digit" });
    ctx.fillStyle = "#131722";
    ctx.fillRect(0, plotH, plotW, TIME_H);
    ctx.fillStyle = "#b2b5be";
    ctx.textAlign = "center";
    const every = Math.max(1, Math.round(cols / Math.max(2, plotW / 110)));
    for (let c = every; c < cols; c += every) ctx.fillText(tfmt.format(new Date(bars[from + c].time * 1000)), xOf(c), plotH + TIME_H / 2);
    ctx.textAlign = "left";

    // Legend (color bar with notional labels).
    const lx = plotW + AXIS_W + 4;
    const lTop = 16;
    const lH = plotH - 32;
    for (let i = 0; i < lH; i++) {
      const [R, G, B] = ramp(1 - i / lH);
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.fillRect(lx, lTop + i, 10, 1);
    }
    ctx.fillStyle = "#b2b5be";
    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
    const legendValue = (f: number) => short(scaleMax * f ** (1 / contrast));
    ctx.fillText(legendValue(1), lx + 13, lTop + 4);
    ctx.fillText(legendValue(0.5), lx + 13, lTop + lH / 2);
    ctx.fillText("0", lx + 13, lTop + lH - 2);

    // Crosshair + tooltip.
    if (hover && hover.x < plotW && hover.y < plotH) {
      const c = Math.max(0, Math.min(cols - 1, Math.floor((hover.x / plotW) * cols)));
      const r = Math.max(0, Math.min(hm.rows - 1, Math.floor(((plotH - hover.y) / plotH) * hm.rows)));
      const price = hm.priceLow + (r + 0.5) * hm.priceStep;
      const value = hm.grid[c * hm.rows + r];
      const bar = bars[from + c];
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hover.x, 0);
      ctx.lineTo(hover.x, plotH);
      ctx.moveTo(0, hover.y);
      ctx.lineTo(plotW, hover.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const lines = [
        new Intl.DateTimeFormat("de-DE", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(bar.time * 1000)),
        `Preis: ${formatPrice(price)}`,
        `Liquidationen ≈ ${usd(value)}`,
        `Kurs damals: ${formatPrice(bar.close)}`,
      ];
      ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
      const h = lines.length * 17 + 10;
      const tx = hover.x + 14 + w > plotW ? hover.x - 14 - w : hover.x + 14;
      const ty = Math.min(plotH - h - 4, Math.max(4, hover.y - h / 2));
      ctx.fillStyle = "rgba(19,23,34,0.92)";
      ctx.fillRect(tx, ty, w, h);
      ctx.strokeStyle = "#2a2e39";
      ctx.strokeRect(tx, ty, w, h);
      lines.forEach((l, i) => {
        ctx.fillStyle = i === 2 ? "#f5c518" : "#d1d4dc";
        ctx.fillText(l, tx + 8, ty + 14 + i * 17);
      });
    }
  }, [model, cells, size, hover, timeZone, contrast]);

  const onPointer = (e: React.PointerEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div className="heatmap-view">
      <div className="heatmap-head">
        <strong>Liquidations-Heatmap</strong>
        <span className="heatmap-symbol">{symbol}</span>
        <div className="segmented">
          {RANGES.map((r) => (
            <button key={r.id} className={r.id === rangeId ? "active" : ""} onClick={() => setRangeId(r.id)} data-tip={`Zeitraum ${r.label} (${r.interval}-Kerzen)`}>
              {r.label}
            </button>
          ))}
        </div>
        <label className="heatmap-slider" data-tip={"Kontrast\nNiedriger = mehr schwache Zonen sichtbar"}>
          Kontrast
          <input type="range" min={0.2} max={1.5} step={0.05} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} />
        </label>
        <label className="heatmap-slider" data-tip={"Schwelle\nBlendet schwache Zonen aus"}>
          Schwelle
          <input type="range" min={0} max={0.5} step={0.01} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </label>
        {model && (
          <span
            className="heatmap-model"
            data-tip={`Modell: ${model.source}${model.oiCoverage > 0 ? `\nOpen Interest für ${(model.oiCoverage * 100).toFixed(0)} % des Zeitraums (Binance Futures, max. 30 Tage)` : ""}\nGeschätzt aus 10×/25×/50×/100× Hebel – keine echten Orderdaten.`}
          >
            {model.source}
          </span>
        )}
        <div className="spacer" />
        <button onClick={() => void load()} data-tip="Neu laden (lädt auch automatisch jede Minute)" aria-label="Neu laden">
          ⟳
        </button>
        <button className="pill" onClick={onClose} data-tip="Zurück zum Chart">
          ✕ Chart
        </button>
      </div>
      <div className="heatmap-canvas" ref={wrapRef}>
        {!crypto ? (
          <div className="panel-empty">Die Liquidations-Heatmap gibt es für Krypto-Paare (z. B. BTCUSDT, KRAKEN:BTCUSD.P).</div>
        ) : (
          <canvas
            ref={canvasRef}
            style={{ width: size.w, height: size.h }}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setHover(null)}
          />
        )}
        {status.loading && !model && <div className="chart-overlay">Lade Heatmap …</div>}
        {status.error && <div className="chart-overlay error">Fehler: {status.error}</div>}
      </div>
    </div>
  );
}
