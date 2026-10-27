import { shapeDef } from "../../shared/drawingShapes";
import { DEFAULT_TESTER, defaultParams, getStrategy, runStrategy } from "../../shared/strategyTester";
import type Anthropic from "@anthropic-ai/sdk";
import { describeAlert, isChannelCondition } from "../../shared/alerts";
import { SOURCE_INDICATORS, computeInstances, getIndicator, indicatorLabel, resolveParams } from "../../shared/indicators";
import type { Bar } from "../../shared/math";
import { fairValueGaps } from "../../shared/fvg";
import { liquidationClusters, liquidationHeatmap } from "../../shared/liquidations";
import { withCompare } from "../../shared/compare";
import { isCryptoSymbol } from "../../shared/marketData";
import { groupLevels, groupingSteps, type Level } from "../../shared/orderbook";
import { orderBlocks } from "../../shared/orderblocks";
import { autoFibonacci, detectCandlePatterns, detectFormations } from "../../shared/patterns";
import { isValidPosition, positionStats } from "../../shared/position";
import { toolSchemas, type ToolInput, type ToolName } from "../../shared/tools";
import { alertStore, createAlert, deleteAlert } from "../alerts";
import { filterNotes, noteTitle } from "../../shared/notes";
import { createNote, getNotes } from "../notes";
import type { ChartEngine } from "../chart/ChartEngine";
import { DEFAULT_FIBEXT_LEVELS, DEFAULT_FIB_LEVELS } from "../chart/DrawingsPrimitive";
import { lastPositionDefaults } from "../components/PositionDialog";
import { liquidationFeed, liquidationTotals } from "../market/liquidationFeed";
import { orderBookFeed } from "../market/orderBookFeed";
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
  type Interval,
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

async function waitFor<T>(probe: () => T | null, timeoutMs: number): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = probe();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
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
      const { indicator, params, colors, source } = input as ToolInput<"add_indicator">;
      const def = getIndicator(indicator)!;
      const p = resolveParams(def, params);
      if (source) {
        if (!SOURCE_INDICATORS.has(indicator)) return fail(`${def.name} hat keine Kurs-Eingabe und lässt sich nicht auf einen Indikator setzen`);
        const from = s.indicators.find((i) => i.id === source.id);
        const fromDef = from && getIndicator(from.type);
        if (!from || !fromDef) return fail(`Kein Indikator mit id=${source.id}`);
        if (!fromDef.outputs.some((o) => o.key === source.output)) return fail(`${fromDef.name} hat keine Ausgabe ${source.output} (${fromDef.outputs.map((o) => o.key).join(", ")})`);
      }
      const inst = addIndicator(indicator, p, "claude", colors, source);
      const out = computeInstances(store.get().indicators, bars).find((c) => c.instance.id === inst.id)?.outputs ?? {};
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
      const { symbol, interval, chart_type, compare } = input as ToolInput<"set_chart">;
      if (chart_type) store.set({ chartType: chart_type });
      if (compare) store.set((st) => ({ compare: compare.reduce((list, c) => withCompare(list, c, symbol?.toUpperCase() ?? st.symbol), [] as string[]) }));
      if (symbol || interval) await loadChart(symbol?.toUpperCase() ?? s.symbol, (interval as Interval | undefined) ?? s.interval);
      const after = store.get();
      if (after.error) return fail(`Laden fehlgeschlagen: ${after.error}`);
      const last = after.bars[after.bars.length - 1];
      return ok(`Chart: ${after.symbol} ${after.interval}`, {
        symbol: after.symbol,
        interval: after.interval,
        chart_type: after.chartType,
        compare: after.compare,
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

    case "draw_fib_extension": {
      const i = input as ToolInput<"draw_fib_extension">;
      const d: Extract<Drawing, { kind: "fibext" }> = {
        id: newId("claude-fibext"),
        author: "claude",
        kind: "fibext",
        a: pt(i.start),
        b: pt(i.end),
        c: pt(i.retrace),
        levels: i.levels?.length ? i.levels : DEFAULT_FIBEXT_LEVELS,
        color: i.color ?? "auto",
      };
      addDrawing(d);
      const levels = Object.fromEntries(d.levels.map((l) => [l, num(d.c.price + (d.b.price - d.a.price) * l)]));
      return ok("Fibonacci-Extension", { id: d.id, levels });
    }

    case "draw_auto_fibonacci": {
      const { last_n = 150 } = input as ToolInput<"draw_auto_fibonacci">;
      const swing = autoFibonacci(bars, bars.length - last_n, bars.length - 1);
      if (!swing) return fail("Kein Swing gefunden");
      const d: Extract<Drawing, { kind: "fib" }> = { id: newId("claude-autofib"), author: "claude", kind: "fib", a: swing.a, b: swing.b, levels: DEFAULT_FIB_LEVELS, color: "auto", label: "Auto-Fib" };
      addDrawing(d);
      const levels = Object.fromEntries(d.levels.map((l) => [l, num(d.b.price + (d.a.price - d.b.price) * l)]));
      return ok("Auto-Fibonacci", { id: d.id, from: { time: iso(swing.a.time), price: num(swing.a.price) }, to: { time: iso(swing.b.time), price: num(swing.b.price) }, levels });
    }

    case "draw_parallel_channel": {
      const i = input as ToolInput<"draw_parallel_channel">;
      const a = pt(i.start);
      const b = pt(i.end);
      const c = pt(i.width_point);
      if (a.time === b.time) return fail("start und end brauchen verschiedene Zeitpunkte");
      const onLine = a.price + ((b.price - a.price) * (c.time - a.time)) / (b.time - a.time);
      const d: Drawing = { id: newId("claude-channel"), author: "claude", kind: "channel", a, b, offset: c.price - onLine, color: i.color ?? "#2962ff", label: i.label };
      addDrawing(d);
      return ok(`Kanal${i.label ? ` „${i.label}“` : ""}`, { id: d.id, offset: num(c.price - onLine) });
    }

    case "draw_shape": {
      const i = input as ToolInput<"draw_shape">;
      const def = shapeDef(i.shape);
      if (i.points.length !== def.points) return fail(`${def.name} braucht ${def.points} Punkt(e): ${def.hints.join(", ")}`);
      const d: Drawing = { id: newId("claude-shape"), author: "claude", kind: "shape", shape: i.shape, points: i.points.map(pt), color: i.color ?? def.color, text: i.text, label: i.label };
      addDrawing(d);
      return ok(def.name, { id: d.id });
    }

    case "backtest_strategy": {
      const i = input as ToolInput<"backtest_strategy">;
      const def = getStrategy(i.strategy);
      if (!def) return fail(`Unbekannte Strategie ${i.strategy}`);
      const params = { ...defaultParams(def), ...i.params };
      const r = runStrategy(bars, def, params, {
        capital: i.capital ?? DEFAULT_TESTER.capital,
        sizePct: i.size_percent ?? DEFAULT_TESTER.sizePct,
        commissionPct: i.commission_percent ?? DEFAULT_TESTER.commissionPct,
        direction: i.direction ?? "both",
      });
      return ok(`Backtest ${def.name}`, {
        params,
        candles: bars.length,
        net_profit: num(r.netProfit),
        net_profit_pct: num(r.netProfitPct),
        profit_factor: r.profitFactor === null ? null : num(r.profitFactor),
        max_drawdown_pct: num(r.maxDrawdownPct),
        closed_trades: r.closedTrades,
        win_rate_pct: num(r.winRate),
        avg_trade: num(r.avgTrade),
        buy_hold_pct: num(r.buyHoldPct),
        open_pnl: num(r.openPnl),
        last_trades: r.trades.slice(-10).map((t) => ({ side: t.dir === 1 ? "long" : "short", entry: iso(t.entryTime), entry_price: num(t.entryPrice), exit: t.open ? "offen" : iso(t.exitTime), exit_price: num(t.exitPrice), pnl: num(t.pnl) })),
        hint: "Der Nutzer sieht den Test im Seitenleisten-Tab 📊 Strategie.",
      });
    }

    case "get_order_blocks": {
      const { higher_tf_minutes = [240, 1440], swing = 5 } = input as ToolInput<"get_order_blocks">;
      const r = orderBlocks(bars, { swing, higher: higher_tf_minutes.map((m) => m * 60), maxZones: 6, showBroken: false });
      const last = bars[bars.length - 1]?.close ?? 0;
      return ok(`${r.zones.length} Orderblöcke, ${r.signals.length} Signale`, {
        price: num(last),
        order_blocks: r.zones.map((z) => ({
          tf: z.tf,
          side: z.side === "bull" ? "bullish (Nachfrage)" : "bearish (Angebot)",
          top: num(z.top),
          bottom: num(z.bottom),
          since: iso(z.from),
          distance_pct: num(((z.side === "bull" ? z.top : z.bottom) - last) / last * 100),
        })),
        recent_signals: r.signals.slice(-10).map((sg) => ({ time: iso(sg.time), signal: sg.side, tf: sg.tf, price: num(sg.price) })),
      });
    }

    case "get_fair_value_gaps": {
      const { min_pct = 0, mitigation = "touch" } = input as ToolInput<"get_fair_value_gaps">;
      const gaps = fairValueGaps(bars, { minPct: min_pct, mitigation, maxZones: 8, showMitigated: false });
      const last = bars[bars.length - 1]?.close ?? 0;
      return ok(`${gaps.length} offene Fair Value Gaps`, {
        price: num(last),
        fair_value_gaps: gaps.map((z) => ({
          side: z.side === "bull" ? "bullisch" : "bärisch",
          top: num(z.top),
          bottom: num(z.bottom),
          since: iso(z.from),
          distance_pct: num(((z.side === "bull" ? z.top : z.bottom) - last) / last * 100),
        })),
      });
    }

    case "get_patterns": {
      const { last_n = 100, pivot = 5, tolerance_pct = 1.5 } = input as ToolInput<"get_patterns">;
      const candles = detectCandlePatterns(bars, last_n, false);
      const formations = detectFormations(bars, pivot, tolerance_pct);
      return ok(`${candles.length} Kerzenmuster, ${formations.length} Formationen`, {
        candle_patterns: candles.map((c) => ({ time: iso(c.time), pattern: c.name, direction: c.direction })),
        formations: formations.map((f) => ({
          pattern: f.name,
          direction: f.direction,
          confirmed: f.confirmed,
          target: f.target !== undefined ? num(f.target) : undefined,
          neckline: f.neckline?.map((p) => ({ time: iso(p.time), price: num(p.price) })),
          points: f.points.map((p) => ({ time: iso(p.time), price: num(p.price), type: p.type })),
        })),
      });
    }

    case "draw_position": {
      const i = input as ToolInput<"draw_position">;
      if (!isValidPosition(i)) return fail(i.side === "long" ? "Long: Stop < Einstieg < Ziel erforderlich" : "Short: Ziel < Einstieg < Stop erforderlich");
      const last = bars[bars.length - 1];
      const step = bars.length > 1 ? last.time - bars[bars.length - 2].time : 3600;
      const from = i.start_time !== undefined ? snapTime(i.start_time, bars) : (last?.time ?? Math.floor(Date.now() / 1000));
      const to = i.end_time !== undefined ? snapTime(i.end_time, bars) : from + 20 * step;
      if (to <= from) return fail("end_time muss nach start_time liegen");
      const defaults = lastPositionDefaults();
      const d: Extract<Drawing, { kind: "position" }> = {
        id: newId("claude-pos"),
        author: "claude",
        kind: "position",
        color: i.side === "long" ? "#089981" : "#f23645",
        label: i.label,
        side: i.side,
        entry: i.entry,
        stop: i.stop,
        target: i.target,
        from,
        to,
        account: i.account_size ?? defaults.account,
        risk: i.risk_percent ?? defaults.risk,
        riskCash: i.risk_amount ?? (i.risk_percent !== undefined ? 0 : defaults.riskCash),
        leverage: i.leverage ?? defaults.leverage,
      };
      addDrawing(d);
      const st = positionStats(d, bars);
      return ok(`${i.side === "long" ? "Long" : "Short"}-Position CRV ${st.rr.toFixed(2)}`, {
        id: d.id,
        rr: num(st.rr),
        risk_pct: num(st.riskPct),
        reward_pct: num(st.rewardPct),
        qty: num(st.qty),
        risk_amount: num(st.riskAmount),
        liquidation: st.liqPrice !== null ? num(st.liqPrice) : null,
        liquidation_before_stop: st.liqBeforeStop,
        status: st.status,
      });
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

    case "get_orderbook": {
      const { market = "spot", levels = 20, group } = input as ToolInput<"get_orderbook">;
      if (!isCryptoSymbol(s.symbol)) return fail(`Kein Binance-Orderbuch für ${s.symbol}`);
      const before = orderBookFeed.get();
      const startedHere = before.symbol !== s.symbol || before.market !== market || before.status === "off";
      if (startedHere) orderBookFeed.start(s.symbol, market);
      const book = await waitFor(() => {
        const b = orderBookFeed.get();
        return b.status === "live" && b.bids.length > 0 ? b : null;
      }, 6000);
      // Leave the feed as the order book panel had it.
      if (startedHere) {
        if (before.status === "off" || !before.symbol) orderBookFeed.stop();
        else orderBookFeed.start(before.symbol, before.market);
      }
      if (!book) return fail(`Orderbuch nicht erreichbar: ${orderBookFeed.get().error ?? "Zeitüberschreitung"}`);
      const step = group ?? groupingSteps(book.bids[0][0])[2];
      const bids = groupLevels(book.bids, step, "bid").slice(0, levels);
      const asks = groupLevels(book.asks, step, "ask").slice(0, levels);
      const sum = (ls: Level[]) => ls.reduce((a, [, q]) => a + q, 0);
      const walls = (ls: Level[]) => [...ls].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, q]) => ({ price: num(p), qty: num(q), notional: num(p * q) }));
      const bv = sum(bids);
      const av = sum(asks);
      return ok(`Orderbuch ${market} gelesen`, {
        symbol: s.symbol,
        market,
        group: step,
        best_bid: num(book.bids[0][0]),
        best_ask: num(book.asks[0][0]),
        spread: num(book.asks[0][0] - book.bids[0][0]),
        bid_share_pct: num((100 * bv) / (bv + av || 1)),
        bid_walls: walls(bids),
        ask_walls: walls(asks),
        bids: bids.map(([p, q]) => [num(p), num(q)]),
        asks: asks.map(([p, q]) => [num(p), num(q)]),
      });
    }

    case "get_liquidations": {
      const inst = s.indicators.find((i) => i.type === "liqheatmap");
      const def = getIndicator("liqheatmap")!;
      const p = resolveParams(def, inst?.params);
      const hm = liquidationHeatmap(bars, p.lookback, p.rows);
      const clusters = hm ? liquidationClusters(bars, hm, 5) : { above: [], below: [] };
      const fmt = (c: { price: number; value: number; distancePct: number }) => ({ price: num(c.price), distance_pct: num(c.distancePct), est_notional: num(c.value) });
      const feed = liquidationFeed.get();
      const t5 = liquidationTotals(feed.items, 300);
      const t60 = liquidationTotals(feed.items, 3600);
      return ok("Liquidationen gelesen", {
        note: "Cluster sind Modellschätzungen (keine echten Orderdaten); Live-Liquidationen sind eine Stichprobe von Binance (max. 1/Sekunde) seit App-Start.",
        short_liquidation_clusters_above: clusters.above.map(fmt),
        long_liquidation_clusters_below: clusters.below.map(fmt),
        live_feed: feed.status,
        live_totals: { long_5m: num(t5.long), short_5m: num(t5.short), long_1h: num(t60.long), short_1h: num(t60.short) },
        recent: feed.items.slice(-15).map((l) => ({ time: iso(l.time), side: l.side, price: num(l.price), notional: num(l.notional) })),
      });
    }

    case "create_alert": {
      const i = input as ToolInput<"create_alert">;
      const channel = isChannelCondition(i.condition);
      if (channel && i.value2 === undefined) return fail("entering/exiting brauchen value2 (zweite Kanalkante)");
      let source: Parameters<typeof createAlert>[0]["source"] = { kind: "price" };
      if (i.indicator) {
        const def = getIndicator(i.indicator)!;
        const p = resolveParams(def, i.params);
        const out = def.outputs.find((o) => o.key === (i.output ?? def.outputs.find((x) => !x.helper && !x.sparse)?.key));
        if (!out) return fail(`${def.name} hat keine Ausgabe ${i.output}; verfügbar: ${def.outputs.map((o) => o.key).join(", ")}`);
        const label = indicatorLabel(def, p) + (def.outputs.length > 1 ? ` · ${out.label}` : "");
        source = { kind: "indicator", type: def.id, params: p, output: out.key, label };
      }
      const a = createAlert({
        symbol: s.symbol,
        interval: s.interval,
        source,
        condition: i.condition,
        target: channel ? { kind: "channel", top: Math.max(i.value, i.value2!), bottom: Math.min(i.value, i.value2!) } : { kind: "value", value: i.value },
        frequency: i.frequency ?? "once",
        message: i.message ?? "",
      });
      return ok(`Alarm: ${describeAlert(a)}`, { id: a.id, alert: describeAlert(a), interval: a.interval, frequency: a.frequency });
    }

    case "list_alerts": {
      const { alerts, log } = alertStore.get();
      return ok(`${alerts.length} Alarme`, {
        alerts: alerts.map((a) => ({ id: a.id, alert: describeAlert(a), interval: a.interval, frequency: a.frequency, active: a.active, message: a.message || undefined })),
        recently_fired: log.slice(-10).map((e) => ({ time: iso(Math.floor(e.at / 1000)), alert: e.text, value: num(e.value) })),
      });
    }

    case "delete_alert": {
      const { id } = input as ToolInput<"delete_alert">;
      if (!alertStore.get().alerts.some((a) => a.id === id)) return fail(`Kein Alarm mit id=${id}`);
      deleteAlert(id);
      return ok("Alarm gelöscht", "ok");
    }

    case "add_note": {
      const i = input as ToolInput<"add_note">;
      const n = createNote(i.text, i.general ? null : s.symbol);
      if (!n) return fail("Leere Notiz");
      return ok(`Notiz: ${noteTitle(n)}`, { id: n.id, symbol: n.symbol ?? "allgemein" });
    }

    case "list_notes": {
      const i = input as ToolInput<"list_notes">;
      const notes = filterNotes(getNotes(), i.all_symbols ? "all" : "symbol", s.symbol, i.query);
      return ok(`${notes.length} Notizen`, notes.slice(0, 30).map((n) => ({ symbol: n.symbol ?? "allgemein", pinned: n.pinned || undefined, updated: iso(Math.floor(n.updatedAt / 1000)), text: n.text })));
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
