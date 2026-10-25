import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { journalStats, parseBackup, sortTrades, toCsv, tradePnl, tradeR, type JournalTrade, type Side } from "../../shared/journal";
import { JOURNAL_EVENT, refreshJournaled } from "../demoAccount";
import { useChartState } from "../store";
import { LineChart, useWidth } from "./CalcCharts";
import { HelpBox, Stat } from "./CalculatorView";
import type { Help } from "./calcHelp";

const STORAGE_KEY = "chartai.journal.v1";
const CALC_KEY = "chartai.calculators.v1";
const MIN_TRADES = 20;

const UP = "#26a69a";
const DOWN = "#ef5350";
const GOLD = "#f5c518";

const nf = (d: number) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (v: number, d = 2) => (Number.isFinite(v) ? nf(d).format(v) : "–");
const signed = (v: number, d = 2) => `${v > 0 ? "+" : ""}${num(v, d)}`;
const pct = (v: number, d = 1) => `${num(v * 100, d)} %`;
const tone = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : undefined);
const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : iso);
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const HELP: Help = {
  what: (
    <>
      Im Journal trägst du jeden abgeschlossenen Trade ein. Die Seite rechnet Gewinn/Verlust und das <strong>R-Multiple</strong> aus und zeigt dir in
      der Kurve, ob dein Konto mit deinen Trades wächst. Steigt die Linie über die Nulllinie, bist du profitabel.
    </>
  ),
  steps: [
    <>Datum, Symbol und Richtung wählen (das Symbol kommt aus dem aktiven Chart).</>,
    <>Einstieg, Stop-Loss und Ausstieg eintragen, dazu die Menge und Gebühren. Ohne Stop gibt es kein R, der $-Betrag zählt trotzdem.</>,
    <>Du kennst nur das Ergebnis? Trag es bei „Ergebnis $“ ein, dann werden die Preise dafür nicht gebraucht.</>,
    <>Setup und Notiz helfen später beim Auswerten: Über den Filter siehst du, welches Setup wirklich Geld bringt.</>,
  ],
  example: <>Long ab 100, Stop 95, raus bei 110, Menge 10 → +100 $ und +2 R (Risiko waren 5 × 10 = 50 $).</>,
  tip: (
    <>
      Erst ab etwa {MIN_TRADES}–30 Trades sagt die Kurve wirklich etwas aus. Die Daten liegen nur in diesem Browser – sichere sie ab und zu mit „⤓ Backup“.
    </>
  ),
};

function load(): JournalTrade[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return parseBackup(raw);
  } catch {
    return [];
  }
}

/** Risk per trade (1 R) from the calculator page, if set. */
function calcRisk(): number {
  try {
    const r = (JSON.parse(localStorage.getItem(CALC_KEY) ?? "{}") as { risk?: number }).risk;
    return typeof r === "number" && r > 0 ? r : 100;
  } catch {
    return 100;
  }
}

/** Saves a file: share sheet where available (iPad → "In Dateien sichern"), otherwise a download. */
async function saveFile(name: string, text: string, type: string) {
  const file = new File([text], name, { type });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Draft {
  date: string;
  symbol: string;
  side: Side;
  entry: string;
  stop: string;
  exit: string;
  qty: string;
  fees: string;
  pnl: string;
  setup: string;
  note: string;
}

const parseNum = (s: string) => (s.trim() === "" ? undefined : Number(s.trim().replace(/\s/g, "").replace(",", ".")));
const showNum = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "" : String(+v.toPrecision(10)).replace(".", ","));

const emptyDraft = (symbol: string, prev?: Draft): Draft => ({
  date: today(),
  symbol,
  side: prev?.side ?? "long",
  entry: "",
  stop: "",
  exit: "",
  qty: prev?.qty ?? "",
  fees: "",
  pnl: "",
  setup: prev?.setup ?? "",
  note: "",
});

const toDraft = (t: JournalTrade): Draft => ({
  date: t.date,
  symbol: t.symbol,
  side: t.side,
  entry: showNum(t.entry),
  stop: showNum(t.stop),
  exit: showNum(t.exit),
  qty: showNum(t.qty),
  fees: t.fees ? showNum(t.fees) : "",
  pnl: showNum(t.pnl),
  setup: t.setup ?? "",
  note: t.note ?? "",
});

/** Turns the form into a trade, or explains what is missing. */
function fromDraft(d: Draft, id: string): JournalTrade | string {
  const values = { entry: parseNum(d.entry), stop: parseNum(d.stop), exit: parseNum(d.exit), qty: parseNum(d.qty), fees: parseNum(d.fees), pnl: parseNum(d.pnl) };
  const bad = Object.entries(values).find(([, v]) => v !== undefined && !Number.isFinite(v));
  if (bad) return "Bitte nur Zahlen in die Preisfelder eintragen";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "Bitte ein Datum wählen";
  const pricesComplete = values.entry !== undefined && values.exit !== undefined && values.qty !== undefined;
  if (!pricesComplete && values.pnl === undefined) return "Einstieg, Ausstieg und Menge eintragen – oder direkt das Ergebnis in $";
  return {
    id,
    date: d.date,
    symbol: d.symbol.trim().toUpperCase(),
    side: d.side,
    entry: values.entry ?? 0,
    stop: values.stop,
    exit: values.exit ?? 0,
    qty: values.qty ?? 0,
    fees: values.fees ?? 0,
    pnl: values.pnl,
    setup: d.setup.trim() || undefined,
    note: d.note.trim() || undefined,
  };
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`calc-field ${wide ? "jr-wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, unit, placeholder, decimal, list, type = "text" }: { value: string; onChange: (v: string) => void; unit?: string; placeholder?: string; decimal?: boolean; list?: string; type?: string }) {
  return (
    <div className="calc-input">
      <input type={type} inputMode={decimal ? "decimal" : undefined} value={value} placeholder={placeholder} list={list} onChange={(e) => onChange(e.target.value)} />
      {unit && <em>{unit}</em>}
    </div>
  );
}

interface SignedBar {
  label: string;
  value: number;
  sub?: string;
}

/** Bars up (green) or down (red) from a zero line, value on each bar. */
function SignedBars({ bars, fmt, height = 200 }: { bars: SignedBar[]; fmt: (v: number) => string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(1e-9, ...bars.map((b) => b.value));
  const min = Math.min(0, ...bars.map((b) => b.value));
  const top = 18;
  // Room for the value labels under negative bars.
  const bottom = min < 0 ? 36 : 22;
  const plotH = height - top - bottom;
  const span = Math.max(1e-9, Math.max(0, max) - min);
  const zero = top + (Math.max(0, max) / span) * plotH;
  const slot = width / Math.max(1, bars.length);
  const bw = Math.max(2, Math.min(36, slot - 4));
  const showValues = slot >= 34;
  const labelEvery = Math.max(1, Math.ceil(28 / Math.max(1, slot)));
  return (
    <div className="calc-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          <line x1={0} x2={width} y1={zero} y2={zero} stroke="#787b86" strokeWidth={1} />
          {bars.map((b, i) => {
            const h = Math.max(1, (Math.abs(b.value) / span) * plotH);
            const x = i * slot + (slot - bw) / 2;
            const y = b.value >= 0 ? zero - h : zero;
            return (
              <g key={i}>
                <title>{`${b.label}${b.sub ? ` · ${b.sub}` : ""}: ${fmt(b.value)}`}</title>
                <rect x={x} y={y} width={bw} height={h} rx={Math.min(3, bw / 3)} fill={b.value >= 0 ? UP : DOWN} fillOpacity={0.85} />
                {showValues && (
                  <text x={x + bw / 2} y={b.value >= 0 ? y - 4 : y + h + 11} textAnchor="middle" className="calc-axis">
                    {fmt(b.value)}
                  </text>
                )}
                {i % labelEvery === 0 && (
                  <text x={x + bw / 2} y={height - 5} textAnchor="middle" className="calc-axis">
                    {b.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function JournalView({ onClose }: { onClose: () => void }) {
  const chartSymbol = useChartState((s) => s.symbol);
  const [trades, setTrades] = useState<JournalTrade[]>(load);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(chartSymbol));
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [unit, setUnit] = useState<"usd" | "r">("usd");
  const [filter, setFilter] = useState("");
  const [helpOpen] = useState(() => trades.length === 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
      refreshJournaled();
    } catch {
      setError("Speichern im Browser fehlgeschlagen – bitte ein Backup exportieren");
    }
  }, [trades]);

  // Demo trades taken over from the demo account while this page is open.
  useEffect(() => {
    const reload = () => setTrades(load());
    window.addEventListener(JOURNAL_EVENT, reload);
    return () => window.removeEventListener(JOURNAL_EVENT, reload);
  }, []);

  // Ask the browser not to evict the journal when storage runs low.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const preview = useMemo(() => {
    const t = fromDraft(draft, "preview");
    return typeof t === "string" ? null : { pnl: tradePnl(t), r: tradeR(t) };
  }, [draft]);

  const entryN = parseNum(draft.entry);
  const stopN = parseNum(draft.stop);
  const risk1R = calcRisk();
  const qtyFromRisk = entryN !== undefined && stopN !== undefined && Math.abs(entryN - stopN) > 0 ? risk1R / Math.abs(entryN - stopN) : null;

  const save = () => {
    const t = fromDraft(draft, editId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    if (typeof t === "string") {
      setError(t);
      return;
    }
    setError(null);
    setTrades((list) => (editId ? list.map((x) => (x.id === editId ? t : x)) : [...list, t]));
    setNotice(editId ? "Trade geändert" : `Trade gespeichert: ${signed(tradePnl(t))} $`);
    setEditId(null);
    setDraft(emptyDraft(t.symbol || chartSymbol, draft));
  };

  const startEdit = (t: JournalTrade) => {
    setEditId(t.id);
    setDraft(toDraft(t));
    setError(null);
    setNotice(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const cancelEdit = () => {
    setEditId(null);
    setError(null);
    setDraft(emptyDraft(chartSymbol, draft));
  };

  const remove = (id: string) => {
    setTrades((list) => list.filter((t) => t.id !== id));
    setConfirmDelete(null);
    if (editId === id) cancelEdit();
  };

  const restore = async (file: File) => {
    try {
      const restored = parseBackup(JSON.parse(await file.text()));
      const known = new Set(trades.map((t) => t.id));
      const added = restored.filter((t) => !known.has(t.id));
      setTrades((list) => [...list, ...added]);
      setNotice(`${added.length} Trades importiert${restored.length > added.length ? `, ${restored.length - added.length} waren schon vorhanden` : ""}`);
      setError(null);
    } catch (e) {
      setError(`Backup konnte nicht gelesen werden: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // Filter options: symbols and setups that occur in the journal.
  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol).filter(Boolean))].sort(), [trades]);
  const setups = useMemo(() => [...new Set(trades.map((t) => t.setup).filter((s): s is string => !!s))].sort(), [trades]);
  const shown = useMemo(() => {
    if (!filter) return trades;
    const [kind, value] = filter.split(":", 2) as ["sym" | "setup", string];
    return trades.filter((t) => (kind === "sym" ? t.symbol === value : t.setup === value));
  }, [trades, filter]);
  const stats = useMemo(() => journalStats(shown), [shown]);
  const ordered = useMemo(() => sortTrades(shown), [shown]);

  const curve = unit === "usd" ? stats.equity : stats.equityR;
  const final = curve[curve.length - 1];
  const fmtY = unit === "usd" ? (v: number) => num(v, 0) : (v: number) => `${num(v, 1)}R`;
  const yLo = Math.min(0, ...curve);
  const yHi = Math.max(0, ...curve);
  const yPad = (yHi - yLo) * 0.08 || (unit === "usd" ? 50 : 1);
  let peak = -Infinity;
  const peakSeries = curve.map((v, i) => [i, (peak = Math.max(peak, v))] as [number, number]);

  const months = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const t of ordered) {
      const key = t.date.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + (unit === "usd" ? tradePnl(t) : (tradeR(t) ?? 0)));
    }
    return [...byMonth.entries()].map(([k, v]) => ({ label: `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`, value: v }));
  }, [ordered, unit]);

  const perTrade = ordered.map((t, i) => ({ label: String(i + 1), sub: `${fmtDate(t.date)} ${t.symbol}`, value: unit === "usd" ? tradePnl(t) : (tradeR(t) ?? 0) }));

  const profitable = stats.netPnl > 0;
  const verdict =
    stats.count === 0 ? (
      <>Noch keine Trades. Trag deinen ersten Trade unten ein – danach siehst du hier, ob du profitabel bist.</>
    ) : (
      <>
        {profitable ? "✅ Du bist profitabel" : stats.netPnl === 0 ? "➖ Genau bei null" : "❌ Noch nicht profitabel"}: <strong className={tone(stats.netPnl)}>{signed(stats.netPnl)} $</strong>
        {stats.rCount > 0 && <> ({signed(stats.totalR, 1)} R)</>} nach {stats.count} {stats.count === 1 ? "Trade" : "Trades"}
        {filter && <> mit diesem Filter</>}.
        {stats.count < MIN_TRADES && <span className="jr-muted"> Noch wenige Trades – aussagekräftig wird es ab etwa {MIN_TRADES}.</span>}
      </>
    );

  const pf = stats.profitFactor;

  return (
    <div className="heatmap-view calc-view jr-view">
      <div className="heatmap-head">
        <strong>Trading-Journal</strong>
        <span className="heatmap-symbol">
          {trades.length} {trades.length === 1 ? "Trade" : "Trades"} gespeichert
        </span>
        <div className="spacer" />
        <button onClick={() => void saveFile(`journal-${today()}.csv`, `﻿${toCsv(trades)}`, "text/csv")} disabled={!trades.length} data-tip="Alle Trades als Tabelle (Excel, Numbers)">
          ⇩ CSV
        </button>
        <button onClick={() => void saveFile(`journal-backup-${today()}.json`, JSON.stringify({ version: 1, trades }, null, 2), "application/json")} disabled={!trades.length} data-tip={"Sicherung aller Trades als Datei\nauf dem iPad: „In Dateien sichern“"}>
          ⤓ Backup
        </button>
        <button onClick={() => fileRef.current?.click()} data-tip="Trades aus einer Backup-Datei wieder einlesen (bestehende bleiben erhalten)">
          ⤒ Wiederherstellen
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void restore(f);
            e.target.value = "";
          }}
        />
        <button className="pill" onClick={onClose} data-tip="Zurück zum Chart">
          ✕ Chart
        </button>
      </div>

      <div className="calc-body">
        <div className={`jr-verdict ${stats.count ? (profitable ? "up" : "down") : ""}`}>{verdict}</div>

        <div className="jr-layout">
          <section className="calc-card jr-chart-card">
            <h3>
              Equity-Kurve
              <div className="spacer" />
              {(symbols.length > 1 || setups.length > 0) && (
                <select className="jr-select" value={filter} onChange={(e) => setFilter(e.target.value)} data-tip="Nur ein Symbol oder Setup auswerten">
                  <option value="">Alle Trades</option>
                  {symbols.length > 1 && (
                    <optgroup label="Symbol">
                      {symbols.map((s) => (
                        <option key={s} value={`sym:${s}`}>
                          {s}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {setups.length > 0 && (
                    <optgroup label="Setup">
                      {setups.map((s) => (
                        <option key={s} value={`setup:${s}`}>
                          {s}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              )}
              <div className="jr-seg">
                <button className={unit === "usd" ? "active" : ""} onClick={() => setUnit("usd")}>
                  $
                </button>
                <button className={unit === "r" ? "active" : ""} onClick={() => setUnit("r")} data-tip="In R: Ergebnis geteilt durch das Risiko (nur Trades mit Stop-Loss)">
                  R
                </button>
              </div>
            </h3>
            <div className="calc-chart-title">
              Kumuliertes Ergebnis nach jedem Trade{unit === "r" ? " in R" : " in $"} · über der Nulllinie = profitabel
            </div>
            {stats.count ? (
              <LineChart
                series={[
                  { id: "peak", points: peakSeries, color: GOLD, width: 1, dash: "4 4", opacity: 0.6 },
                  { id: "eq", points: curve.map((v, i) => [i, v] as [number, number]), color: final >= 0 ? UP : DOWN, width: 2.5, label: "Kontostand", endLabel: unit === "usd" ? signed(final, 0) : `${signed(final, 1)}R` },
                ]}
                xDomain={[0, Math.max(1, stats.count)]}
                yDomain={[yLo - yPad, yHi + yPad]}
                xFmt={(x) => (x === 0 ? "Start" : num(x, 0))}
                xTipFmt={(x) => (x === 0 ? "Start" : `Trade ${num(x, 0)}${ordered[x - 1] ? ` · ${fmtDate(ordered[x - 1].date)} ${ordered[x - 1].symbol}` : ""}`)}
                yFmt={fmtY}
                xTitle="Trade-Nummer"
                hLines={[{ value: 0, label: "Break-even" }]}
                integerX
                height={280}
              />
            ) : (
              <div className="jr-empty">Hier erscheint deine Kurve, sobald du Trades einträgst.</div>
            )}
            <div className="calc-note">Gelb gestrichelt: bisheriger Höchststand – der Abstand darunter ist dein Drawdown.</div>

            <div className="calc-stats">
              <Stat label="Trefferquote" value={stats.count ? `${pct(stats.winRate, 0)} (${stats.wins}/${stats.count})` : "–"} />
              <Stat label="Profit-Faktor" value={stats.count ? (pf === Infinity ? "∞" : num(pf)) : "–"} tone={stats.count ? (pf >= 1 ? "up" : "down") : undefined} />
              <Stat label="Ø pro Trade" value={stats.count ? `${signed(stats.expectancy)} $${stats.avgR !== null ? ` · ${signed(stats.avgR)} R` : ""}` : "–"} tone={tone(stats.expectancy)} />
              <Stat label="Ø Gewinn / Ø Verlust" value={stats.count ? `${num(stats.avgWin)} / ${num(stats.avgLoss)} $` : "–"} />
              <Stat label="Max. Drawdown" value={stats.maxDrawdown > 0 ? `−${num(stats.maxDrawdown)} $` : "–"} tone={stats.maxDrawdown > 0 ? "down" : undefined} />
              <Stat label="Längste Verlustserie" value={stats.count ? `${stats.longestLosingStreak} Trades` : "–"} />
              <Stat label="Bester / schlechtester" value={stats.count ? `${signed(stats.best)} / ${signed(stats.worst)} $` : "–"} />
              <Stat label="Gebühren gesamt" value={`${num(shown.reduce((a, t) => a + (t.pnl === undefined ? t.fees || 0 : 0), 0))} $`} />
            </div>
          </section>

          <section className="calc-card jr-form" ref={formRef}>
            <h3>{editId ? "✎ Trade bearbeiten" : "+ Trade eintragen"}</h3>
            <HelpBox help={HELP} allOpen={helpOpen} title="So führst du dein Journal" />
            <div className="calc-inputs">
              <Field label="Datum">
                <TextInput type="date" value={draft.date} onChange={set("date")} />
              </Field>
              <Field label="Symbol">
                <TextInput value={draft.symbol} onChange={set("symbol")} list="jr-symbols" placeholder={chartSymbol} />
              </Field>
              <Field label="Richtung">
                <div className="jr-seg jr-side">
                  <button className={draft.side === "long" ? "active up" : ""} onClick={() => set("side")("long")}>
                    Long ▲
                  </button>
                  <button className={draft.side === "short" ? "active down" : ""} onClick={() => set("side")("short")}>
                    Short ▼
                  </button>
                </div>
              </Field>
              <Field label="Einstieg">
                <TextInput decimal value={draft.entry} onChange={set("entry")} unit="$" />
              </Field>
              <Field label="Stop-Loss">
                <TextInput decimal value={draft.stop} onChange={set("stop")} unit="$" placeholder="für R" />
              </Field>
              <Field label="Ausstieg">
                <TextInput decimal value={draft.exit} onChange={set("exit")} unit="$" />
              </Field>
              <Field label="Menge">
                <TextInput decimal value={draft.qty} onChange={set("qty")} placeholder="Stück" />
              </Field>
              <Field label="Gebühren">
                <TextInput decimal value={draft.fees} onChange={set("fees")} unit="$" placeholder="0" />
              </Field>
              <Field label="Ergebnis $ (optional)">
                <TextInput decimal value={draft.pnl} onChange={set("pnl")} unit="$" placeholder={draft.pnl === "" && preview ? num(preview.pnl) : "statt Preise"} />
              </Field>
              <Field label="Setup">
                <TextInput value={draft.setup} onChange={set("setup")} list="jr-setups" placeholder="z. B. Orderblock" />
              </Field>
              <Field label="Notiz" wide>
                <TextInput value={draft.note} onChange={set("note")} placeholder="Was lief gut, was nicht?" />
              </Field>
            </div>
            <datalist id="jr-symbols">
              {[...new Set([chartSymbol, ...symbols])].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <datalist id="jr-setups">
              {setups.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {qtyFromRisk !== null && (
              <div className="calc-examples">
                <span>Menge:</span>
                <button onClick={() => set("qty")(showNum(+qtyFromRisk.toPrecision(6)))} data-tip="Risiko pro Trade aus dem Rechner ÷ Abstand Einstieg–Stop">
                  aus 1 R = {num(risk1R, 0)} $ → {num(qtyFromRisk, 4)}
                </button>
              </div>
            )}
            <div className="jr-actions">
              <div className="jr-preview">
                {preview ? (
                  <>
                    Ergebnis <strong className={tone(preview.pnl)}>{signed(preview.pnl)} $</strong>
                    {preview.r !== null && <strong className={tone(preview.r)}> · {signed(preview.r)} R</strong>}
                  </>
                ) : (
                  <span className="jr-muted">Ergebnis erscheint beim Eintippen</span>
                )}
              </div>
              {editId && <button onClick={cancelEdit}>Abbrechen</button>}
              <button className="jr-save" onClick={save}>
                {editId ? "Änderungen speichern" : "Trade speichern"}
              </button>
            </div>
            {error && <div className="calc-warn">{error}</div>}
            {notice && <div className="jr-notice">{notice}</div>}
          </section>
        </div>

        {stats.count > 0 && (
          <div className="calc-grid-cards jr-bars">
            <section className="calc-card">
              <h3>Ergebnis je Trade</h3>
              <div className="calc-chart-title">Grün = Gewinn, rot = Verlust{unit === "r" ? " (in R)" : " (in $)"}</div>
              <SignedBars bars={perTrade} fmt={(v) => (unit === "usd" ? signed(v, 0) : signed(v, 1))} />
            </section>
            <section className="calc-card">
              <h3>Ergebnis je Monat</h3>
              <div className="calc-chart-title">Summe aller Trades im Monat{unit === "r" ? " (in R)" : " (in $)"}</div>
              <SignedBars bars={months} fmt={(v) => (unit === "usd" ? signed(v, 0) : signed(v, 1))} />
            </section>
          </div>
        )}

        {stats.count > 0 && (
          <section className="calc-card jr-list">
            <h3>Alle Trades{filter && " (gefiltert)"}</h3>
            <div className="jr-table-wrap">
              <table className="calc-table jr-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Datum</th>
                    <th>Symbol</th>
                    <th>Richtung</th>
                    <th>Einstieg</th>
                    <th>Stop</th>
                    <th>Ausstieg</th>
                    <th>Menge</th>
                    <th>Ergebnis</th>
                    <th>R</th>
                    <th>Setup / Notiz</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ordered
                    .map((t, i) => ({ t, i }))
                    .reverse()
                    .map(({ t, i }) => {
                      const p = tradePnl(t);
                      const r = tradeR(t);
                      const manual = t.pnl !== undefined;
                      return (
                        <tr key={t.id} className={editId === t.id ? "jr-editing" : undefined}>
                          <td>{i + 1}</td>
                          <td>{fmtDate(t.date)}</td>
                          <td>{t.symbol || "–"}</td>
                          <td className={t.side === "long" ? "up" : "down"}>{t.side === "long" ? "Long" : "Short"}</td>
                          <td>{manual && !t.entry ? "–" : num(t.entry)}</td>
                          <td>{t.stop === undefined ? "–" : num(t.stop)}</td>
                          <td>{manual && !t.exit ? "–" : num(t.exit)}</td>
                          <td>{manual && !t.qty ? "–" : num(t.qty, 4).replace(/,?0+$/, "")}</td>
                          <td className={tone(p)}>{signed(p)} $</td>
                          <td className={r === null ? undefined : tone(r)}>{r === null ? "–" : signed(r)}</td>
                          <td className="jr-note">{[t.setup, t.note].filter(Boolean).join(" · ") || "–"}</td>
                          <td className="jr-row-actions">
                            {confirmDelete === t.id ? (
                              <>
                                <button className="jr-danger" onClick={() => remove(t.id)}>
                                  Löschen
                                </button>
                                <button onClick={() => setConfirmDelete(null)}>✕</button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => startEdit(t)} data-tip="Bearbeiten">
                                  ✎
                                </button>
                                <button onClick={() => setConfirmDelete(t.id)} data-tip="Löschen">
                                  🗑
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
