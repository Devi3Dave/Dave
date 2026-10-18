import { getIndicator, indicatorLabel, resolveParams } from "../../shared/indicators";
import type { Bar } from "../../shared/math";
import type { ChartEngine } from "../chart/ChartEngine";
import { positionStats } from "../../shared/position";
import { resolveTimeZone } from "../chartSettings";
import { charts, layoutCount, workspace, type ChartState, type Drawing } from "../store";

export const num = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? "–" : String(+v.toPrecision(7)));
export const iso = (t: number) => new Date(t * 1000).toISOString().replace(".000Z", "Z");

export function barRows(bars: Bar[]): string {
  return bars.map((b) => `${iso(b.time)},${b.time},${num(b.open)},${num(b.high)},${num(b.low)},${num(b.close)},${num(b.volume)}`).join("\n");
}

export function describeDrawing(d: Drawing, bars: Bar[] = []): string {
  const p = (pt: { time: number; price: number }) => `(${iso(pt.time)}, ${num(pt.price)})`;
  const tag = `id=${d.id} [${d.author === "claude" ? "von dir" : "vom Nutzer"}]${d.label ? ` "${d.label}"` : ""}`;
  switch (d.kind) {
    case "trendline":
      return `${tag} Trendlinie ${p(d.a)} -> ${p(d.b)}${d.extend !== "none" ? `, verlängert ${d.extend}` : ""}`;
    case "hline":
      return `${tag} Horizontale Linie bei ${num(d.price)}`;
    case "vline":
      return `${tag} Vertikale Linie bei ${iso(d.time)}`;
    case "zone":
      return `${tag} Zone ${num(d.bottom)}–${num(d.top)}${d.from ? ` ab ${iso(d.from)}` : ""}`;
    case "fib":
      return `${tag} Fibonacci ${p(d.a)} -> ${p(d.b)}`;
    case "text":
      return `${tag} Text "${d.text}" bei ${p(d.at)}`;
    case "position": {
      const st = positionStats(d, bars);
      return `${tag} ${d.side === "long" ? "Long" : "Short"}-Position Einstieg ${num(d.entry)}, Stop ${num(d.stop)}, Ziel ${num(d.target)} (${iso(d.from)} bis ${iso(d.to)}), CRV ${st.rr.toFixed(2)}, Konto ${num(d.account)}, Risiko ${num(d.risk)} %, Hebel ${num(d.leverage)}×, Menge ${num(st.qty)}, Status ${st.status}, PnL ${num(st.pnl)}`;
    }
  }
}

/** Snapshot of the chart that is attached to every user message. */
export function buildChartState(s: ChartState, engine: ChartEngine | null, recent = 60): string {
  const bars = s.bars;
  const last = bars[bars.length - 1];
  const lines: string[] = ["<chart_state>"];
  const ws = workspace.get();
  const count = layoutCount(ws.layout);
  if (count > 1) {
    const others = charts
      .slice(0, count)
      .map((c, i) => (i === ws.active ? null : `Chart ${i + 1}: ${c.get().symbol} ${c.get().interval}`))
      .filter(Boolean)
      .join(", ");
    lines.push(`Der Nutzer sieht ${count} Charts gleichzeitig. Dies ist der aktive Chart ${ws.active + 1}; deine Tools wirken nur auf ihn. Weitere: ${others}`);
  }
  lines.push(`Symbol: ${s.symbol} (Quelle: ${s.source ?? "?"}) | Zeiteinheit: ${s.interval} | Charttyp: ${s.chartType} | Daten in UTC, der Nutzer sieht Zeiten in ${resolveTimeZone(s.settings.timeZone)}`);
  if (!last) {
    lines.push("Keine Kursdaten geladen.", "</chart_state>");
    return lines.join("\n");
  }
  const first = bars[0];
  const hi = Math.max(...bars.map((b) => b.high));
  const lo = Math.min(...bars.map((b) => b.low));
  lines.push(
    `Geladen: ${bars.length} Kerzen von ${iso(first.time)} bis ${iso(last.time)} | Hoch ${num(hi)} | Tief ${num(lo)} | Letzter Kurs ${num(last.close)} (${(((last.close - first.close) / first.close) * 100).toFixed(2)} % seit Beginn)`,
  );
  const range = engine?.chart.timeScale().getVisibleLogicalRange();
  if (range) {
    const from = Math.max(0, Math.floor(range.from));
    const to = Math.min(bars.length - 1, Math.ceil(range.to));
    const vis = bars.slice(from, to + 1);
    if (vis.length) {
      lines.push(
        `Sichtbar im Chart: ${iso(vis[0].time)} bis ${iso(vis[vis.length - 1].time)} (${vis.length} Kerzen), Hoch ${num(Math.max(...vis.map((b) => b.high)))}, Tief ${num(Math.min(...vis.map((b) => b.low)))}`,
      );
    }
  }
  lines.push(`\nLetzte ${Math.min(recent, bars.length)} Kerzen (iso,unix,open,high,low,close,volume):`);
  lines.push(barRows(bars.slice(-recent)));

  lines.push("\nAktive Indikatoren:");
  if (s.indicators.length === 0) lines.push("- keine");
  for (const inst of s.indicators) {
    const def = getIndicator(inst.type);
    if (!def) continue;
    const params = resolveParams(def, inst.params);
    const out = def.compute(bars, params);
    const values = def.outputs
      .map((o) => {
        const arr = out[o.key] ?? [];
        return `${o.key}=${num(arr[arr.length - 1])} (vorher ${num(arr[arr.length - 2])})`;
      })
      .join(", ");
    lines.push(`- id=${inst.id} ${indicatorLabel(def, params)} [${inst.author === "claude" ? "von dir" : "vom Nutzer"}${inst.hidden ? ", ausgeblendet" : ""}]: ${values}`);
  }

  lines.push("\nZeichnungen:");
  if (s.drawings.length === 0) lines.push("- keine");
  for (const d of s.drawings) lines.push(`- ${describeDrawing(d, bars)}`);
  if (s.markers.length) {
    lines.push("\nMarker:");
    for (const m of s.markers) lines.push(`- id=${m.id} ${m.position} ${iso(m.time)} ${m.text ?? ""}`);
  }
  lines.push("</chart_state>");
  return lines.join("\n");
}
