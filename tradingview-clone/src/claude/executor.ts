import type Anthropic from "@anthropic-ai/sdk";
import { getIndicator, indicatorLabel, resolveParams } from "../../shared/indicators";
import type { Bar } from "../../shared/math";
import { toolSchemas, type ToolInput, type ToolName } from "../../shared/tools";
import type { ChartEngine } from "../chart/ChartEngine";
import { DEFAULT_FIB_LEVELS } from "../chart/DrawingsPrimitive";
import {
  addDrawing,
  addIndicator,
  clearDrawings,
  loadChart,
  newId,
  removeDrawing,
  removeIndicator,
  store,
  type ChartMarker,
  type Drawing,
  type Point,
} from "../store";
import { barRows, iso, num } from "./context";

type ToolResultContent = Anthropic.Beta.BetaToolResultBlockParam["content"];

export interface ToolOutcome {
  content: ToolResultContent;
  isError: boolean;
  summary: string;
}

const ok = (summary: string, data: unknown): ToolOutcome => ({
  content: typeof data === "string" ? data : JSON.stringify(data),
  isError: false,
  summary,
});
const fail = (message: string): ToolOutcome => ({ content: message, isError: true, summary: message });

function parseTime(t: number | string): number | null {
  if (typeof t === "number") return t > 1e12 ? Math.floor(t / 1000) : t;
  if (/^\d+(\.\d+)?$/.test(t.trim())) return parseTime(Number(t));
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Snap a timestamp to the nearest bar; future times are kept on the bar grid. */
function snapTime(raw: number | string, bars: Bar[], allowFuture = true): number {
  const t = parseTime(raw);
  if (t === null) throw new Error(`Ungültiger Zeitpunkt: ${raw}`);
  const n = bars.length;
  if (n === 0) return t;
  const last = bars[n - 1].time;
  const step = n > 1 ? last - bars[n - 2].time : 60;
  if (t > last) return allowFuture ? last + Math.round((t - last) / step) * step : last;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= t) lo = mid;
    else hi = mid;
  }
  return t - bars[lo].time <= bars[hi].time - t ? bars[lo].time : bars[hi].time;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

export async function executeTool(name: string, input: unknown, engine: ChartEngine | null): Promise<ToolOutcome> {
  if (!(name in toolSchemas)) return fail(`Unbekanntes Tool: ${name}`);
  const parsed = toolSchemas[name as ToolName].schema.safeParse(input);
  if (!parsed.success) {
    return fail(`Ungültige Eingabe (${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}). Erhalten: ${JSON.stringify(input)}`);
  }
  try {
    return await run(name as ToolName, parsed.data, engine);
  } catch (err) {
    return fail((err as Error).message);
  }
}

async function run(name: ToolName, input: unknown, engine: ChartEngine | null): Promise<ToolOutcome> {
  const s = store.get();
  const bars = s.bars;
  const pt = (p: { time: number | string; price: number }): Point => ({ time: snapTime(p.time, bars), price: p.price });

  switch (name) {
    case "get_chart_data": {
      const { last_n = 150 } = input as ToolInput<"get_chart_data">;
      const rows = bars.slice(-last_n);
      return ok(`${rows.length} Kerzen gelesen`, `${s.symbol} ${s.interval}, iso,unix,open,high,low,close,volume\n${barRows(rows)}`);
    }

    case "get_indicator_values": {
      const { indicator, params, last_n = 30 } = input as ToolInput<"get_indicator_values">;
      const def = getIndicator(indicator)!;
      const p = resolveParams(def, params);
      const out = def.compute(bars, p);
      const start = Math.max(0, bars.length - last_n);
      const header = ["iso", ...def.outputs.map((o) => o.key)].join(",");
      const rows = bars.slice(start).map((b, k) => [iso(b.time), ...def.outputs.map((o) => num(out[o.key]?.[start + k]))].join(","));
      return ok(`${indicatorLabel(def, p)} berechnet`, `${indicatorLabel(def, p)}\n${header}\n${rows.join("\n")}`);
    }

    case "add_indicator": {
      const { indicator, params, colors } = input as ToolInput<"add_indicator">;
      const def = getIndicator(indicator)!;
      const p = resolveParams(def, params);
      const inst = addIndicator(indicator, p, "claude", colors);
      const out = def.compute(bars, p);
      const latest = Object.fromEntries(def.outputs.map((o) => [o.key, num(out[o.key]?.[bars.length - 1])]));
      return ok(`${indicatorLabel(def, p)} hinzugefügt`, { id: inst.id, label: indicatorLabel(def, p), panel: def.overlay ? "overlay" : "eigenes Panel", latest });
    }

    case "remove_indicator": {
      const { id } = input as ToolInput<"remove_indicator">;
      if (id !== "all" && !s.indicators.some((i) => i.id === id)) return fail(`Kein Indikator mit id=${id}`);
      removeIndicator(id);
      return ok(id === "all" ? "Alle Indikatoren entfernt" : `Indikator ${id} entfernt`, "ok");
    }

    case "set_chart": {
      const { symbol, interval, chart_type } = input as ToolInput<"set_chart">;
      if (chart_type) store.set({ chartType: chart_type });
      if (symbol || interval) await loadChart(symbol?.toUpperCase() ?? s.symbol, interval ?? s.interval);
      const after = store.get();
      if (after.error) return fail(`Laden fehlgeschlagen: ${after.error}`);
      const last = after.bars[after.bars.length - 1];
      return ok(`Chart: ${after.symbol} ${after.interval}`, {
        symbol: after.symbol,
        interval: after.interval,
        chart_type: after.chartType,
        source: after.source,
        bars: after.bars.length,
        last: last ? { time: iso(last.time), close: last.close } : null,
      });
    }

    case "draw_trendline": {
      const i = input as ToolInput<"draw_trendline">;
      const d: Drawing = {
        id: newId("claude-trend"),
        author: "claude",
        kind: "trendline",
        a: pt(i.start),
        b: pt(i.end),
        extend: i.extend ?? "none",
        color: i.color ?? "#2962ff",
        style: i.line_style ?? "solid",
        width: i.width ?? 2,
        label: i.label,
      };
      addDrawing(d);
      return ok(`Trendlinie${i.label ? ` „${i.label}“` : ""}`, { id: d.id });
    }

    case "draw_horizontal_line": {
      const i = input as ToolInput<"draw_horizontal_line">;
      const d: Drawing = { id: newId("claude-hline"), author: "claude", kind: "hline", price: i.price, color: i.color ?? "#ff9800", style: i.line_style ?? "solid", label: i.label };
      addDrawing(d);
      return ok(`Linie ${num(i.price)}${i.label ? ` „${i.label}“` : ""}`, { id: d.id });
    }

    case "draw_vertical_line": {
      const i = input as ToolInput<"draw_vertical_line">;
      const d: Drawing = { id: newId("claude-vline"), author: "claude", kind: "vline", time: snapTime(i.time, bars), color: i.color ?? "#787b86", label: i.label };
      addDrawing(d);
      return ok(`Vertikale Linie${i.label ? ` „${i.label}“` : ""}`, { id: d.id });
    }

    case "draw_zone": {
      const i = input as ToolInput<"draw_zone">;
      const d: Drawing = {
        id: newId("claude-zone"),
        author: "claude",
        kind: "zone",
        top: Math.max(i.top, i.bottom),
        bottom: Math.min(i.top, i.bottom),
        from: i.start_time !== undefined ? snapTime(i.start_time, bars) : undefined,
        to: i.end_time !== undefined ? snapTime(i.end_time, bars) : undefined,
        extendRight: i.extend_right ?? i.end_time === undefined,
        color: i.color ?? "#2962ff",
        label: i.label,
      };
      addDrawing(d);
      return ok(`Zone ${num(d.bottom)}–${num(d.top)}${i.label ? ` „${i.label}“` : ""}`, { id: d.id });
    }

    case "draw_fibonacci": {
      const i = input as ToolInput<"draw_fibonacci">;
      const d: Extract<Drawing, { kind: "fib" }> = {
        id: newId("claude-fib"),
        author: "claude",
        kind: "fib",
        a: pt(i.start),
        b: pt(i.end),
        levels: i.levels?.length ? i.levels : DEFAULT_FIB_LEVELS,
        color: i.color ?? "auto",
      };
      addDrawing(d);
      const levels = Object.fromEntries(d.levels.map((l) => [l, num(d.b.price + (d.a.price - d.b.price) * l)]));
      return ok("Fibonacci-Retracement", { id: d.id, levels });
    }

    case "add_text": {
      const i = input as ToolInput<"add_text">;
      const d: Drawing = { id: newId("claude-text"), author: "claude", kind: "text", at: pt(i), text: i.text, color: i.color ?? "#d1d4dc" };
      addDrawing(d);
      return ok(`Text „${i.text}“`, { id: d.id });
    }

    case "add_markers": {
      const { markers } = input as ToolInput<"add_markers">;
      const created: ChartMarker[] = markers.map((m) => ({
        id: newId("claude-marker"),
        author: "claude",
        time: snapTime(m.time, bars, false),
        position: m.position,
        shape: m.shape ?? (m.position === "below" ? "arrowUp" : "arrowDown"),
        color: m.color ?? (m.position === "below" ? "#26a69a" : "#ef5350"),
        text: m.text,
      }));
      store.set((st) => ({ markers: [...st.markers, ...created] }));
      return ok(`${created.length} Marker gesetzt`, { ids: created.map((m) => m.id) });
    }

    case "remove_drawing": {
      const { id } = input as ToolInput<"remove_drawing">;
      return removeDrawing(id) ? ok(`Zeichnung ${id} entfernt`, "ok") : fail(`Keine Zeichnung mit id=${id}`);
    }

    case "clear_drawings": {
      const { scope } = input as ToolInput<"clear_drawings">;
      clearDrawings(scope);
      return ok(scope === "all" ? "Alle Zeichnungen gelöscht" : "Claudes Zeichnungen gelöscht", "ok");
    }

    case "take_screenshot": {
      if (!engine) return fail("Chart nicht bereit");
      await nextFrame();
      const data = engine.screenshot().split(",")[1];
      return {
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
          { type: "text", text: "Aktueller Chart-Screenshot." },
        ],
        isError: false,
        summary: "Screenshot erstellt",
      };
    }
  }
}
