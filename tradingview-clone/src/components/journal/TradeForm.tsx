import { useMemo, useState, type ReactNode } from "react";
import { plannedRR, tradePnl, tradeR, type JournalTrade, type Side } from "../../../shared/journal";
import type { Playbook } from "../../../shared/journalAnalytics";
import { HelpBox } from "../CalculatorView";
import type { Help } from "../calcHelp";
import { newId, num, signed, today, tone } from "./format";
import { Screenshots } from "./Screenshots";
import { Stars, TagInput } from "./TradeDetail";

const CALC_KEY = "chartai.calculators.v1";

const HELP: Help = {
  what: (
    <>
      Hier trägst du einen abgeschlossenen Trade ein. Das Journal rechnet Gewinn/Verlust und das <strong>R-Multiple</strong> aus und ordnet den Trade
      dem Tag im Kalender zu.
    </>
  ),
  steps: [
    <>Datum, Symbol und Richtung wählen (das Symbol kommt aus dem aktiven Chart). Uhrzeiten sind freiwillig, sie füllen die Berichte nach Uhrzeit und Haltedauer.</>,
    <>Einstieg, Stop-Loss und Ausstieg eintragen, dazu Menge und Gebühren. Ohne Stop gibt es kein R, der $-Betrag zählt trotzdem.</>,
    <>Du kennst nur das Ergebnis? Trag es bei „Ergebnis $“ ein, dann werden die Preise nicht gebraucht.</>,
    <>Playbook wählen und abhaken, welche Regeln du eingehalten hast. Tags und Fehler zeigen später in den Berichten, was dich Geld kostet.</>,
  ],
  example: <>Long ab 100, Stop 95, raus bei 110, Menge 10 → +100 $ und +2 R (Risiko waren 5 × 10 = 50 $).</>,
  tip: <>Die Daten liegen in diesem Browser und reisen mit ☁ Sync auf deine anderen Geräte. Sichere sie ab und zu mit „⤓ Backup“.</>,
};

interface Draft {
  date: string;
  time: string;
  exitTime: string;
  symbol: string;
  side: Side;
  entry: string;
  stop: string;
  target: string;
  exit: string;
  qty: string;
  fees: string;
  pnl: string;
  setup: string;
  note: string;
  playbook: string;
  checks: string[];
  tags: string[];
  mistakes: string[];
  rating: number;
  images: string[];
}

const parseNum = (s: string) => (s.trim() === "" ? undefined : Number(s.trim().replace(/\s/g, "").replace(",", ".")));
const showNum = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "" : String(+v.toPrecision(10)).replace(".", ","));

const emptyDraft = (symbol: string, last?: JournalTrade): Draft => ({
  date: today(),
  time: "",
  exitTime: "",
  symbol,
  side: last?.side ?? "long",
  entry: "",
  stop: "",
  target: "",
  exit: "",
  qty: last ? showNum(last.qty || undefined) : "",
  fees: "",
  pnl: "",
  setup: last?.setup ?? "",
  note: "",
  playbook: last?.playbook ?? "",
  checks: [],
  tags: [],
  mistakes: [],
  rating: 0,
  images: [],
});

const toDraft = (t: JournalTrade): Draft => ({
  date: t.date,
  time: t.time ?? "",
  exitTime: t.exitTime ?? "",
  symbol: t.symbol,
  side: t.side,
  entry: showNum(t.entry),
  stop: showNum(t.stop),
  target: showNum(t.target),
  exit: showNum(t.exit),
  qty: showNum(t.qty),
  fees: t.fees ? showNum(t.fees) : "",
  pnl: showNum(t.pnl),
  setup: t.setup ?? "",
  note: t.note ?? "",
  playbook: t.playbook ?? "",
  checks: t.checks ?? [],
  tags: t.tags ?? [],
  mistakes: t.mistakes ?? [],
  rating: t.rating ?? 0,
  images: t.images ?? [],
});

/** Turns the form into a trade, or explains what is missing. */
function fromDraft(d: Draft, id: string, keep?: JournalTrade): JournalTrade | string {
  const values = { entry: parseNum(d.entry), stop: parseNum(d.stop), target: parseNum(d.target), exit: parseNum(d.exit), qty: parseNum(d.qty), fees: parseNum(d.fees), pnl: parseNum(d.pnl) };
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
    ...(values.target !== undefined ? { target: values.target } : {}),
    exit: values.exit ?? 0,
    qty: values.qty ?? 0,
    fees: values.fees ?? 0,
    pnl: values.pnl,
    setup: d.setup.trim() || undefined,
    note: d.note.trim() || undefined,
    ...(d.time ? { time: d.time } : {}),
    ...(d.exitTime ? { exitTime: d.exitTime } : {}),
    ...(d.playbook ? { playbook: d.playbook, checks: d.checks } : keep?.checks && !keep.playbook ? { checks: keep.checks } : {}),
    ...(d.tags.length ? { tags: d.tags } : {}),
    ...(d.mistakes.length ? { mistakes: d.mistakes } : {}),
    ...(d.rating ? { rating: d.rating } : {}),
    ...(d.images.length ? { images: d.images } : {}),
  };
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

export function TradeForm({
  editing,
  chartSymbol,
  last,
  trades,
  playbooks,
  firstTime,
  chartShot,
  onSave,
  onClose,
}: {
  /** Trade to change; null for a new one. */
  editing: JournalTrade | null;
  chartSymbol: string;
  last?: JournalTrade;
  trades: JournalTrade[];
  playbooks: Playbook[];
  firstTime: boolean;
  chartShot: () => string | null;
  onSave: (t: JournalTrade, isNew: boolean) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => (editing ? toDraft(editing) : emptyDraft(chartSymbol, last)));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const preview = useMemo(() => {
    const t = fromDraft(draft, "preview");
    return typeof t === "string" ? null : { pnl: tradePnl(t), r: tradeR(t), rr: plannedRR(t) };
  }, [draft]);

  const symbols = useMemo(() => [...new Set([chartSymbol, ...trades.map((t) => t.symbol).filter(Boolean)])].sort(), [trades, chartSymbol]);
  const setups = useMemo(() => [...new Set(trades.map((t) => t.setup).filter((s): s is string => !!s))].sort(), [trades]);
  const knownTags = useMemo(() => [...new Set(trades.flatMap((t) => t.tags ?? []))].sort(), [trades]);
  const knownMistakes = useMemo(() => [...new Set(trades.flatMap((t) => t.mistakes ?? []))].sort(), [trades]);

  const entryN = parseNum(draft.entry);
  const stopN = parseNum(draft.stop);
  const risk1R = calcRisk();
  const qtyFromRisk = entryN !== undefined && stopN !== undefined && Math.abs(entryN - stopN) > 0 ? risk1R / Math.abs(entryN - stopN) : null;
  const pb = playbooks.find((p) => p.id === draft.playbook);

  const save = () => {
    const t = fromDraft(draft, editing?.id ?? newId(), editing ?? undefined);
    if (typeof t === "string") {
      setError(t);
      return;
    }
    onSave(t, !editing);
  };

  return (
    <div className="jz-modal-back" onClick={onClose}>
      <section className="calc-card jr-form jz-modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          {editing ? "✎ Trade bearbeiten" : "+ Trade eintragen"}
          <div className="spacer" />
          <button onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </h3>
        <HelpBox help={HELP} allOpen={firstTime} title="So trägst du einen Trade ein" />
        <div className="calc-inputs">
          <Field label="Datum">
            <TextInput type="date" value={draft.date} onChange={set("date")} />
          </Field>
          <Field label="Uhrzeit Einstieg">
            <TextInput type="time" value={draft.time} onChange={set("time")} />
          </Field>
          <Field label="Uhrzeit Ausstieg">
            <TextInput type="time" value={draft.exitTime} onChange={set("exitTime")} />
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
          <Field label="Take-Profit">
            <TextInput decimal value={draft.target} onChange={set("target")} unit="$" placeholder="geplant" />
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

        <div className="jz-form-extra">
          <label className="calc-field">
            <span>Playbook</span>
            <select className="jr-select" value={draft.playbook} onChange={(e) => setDraft((d) => ({ ...d, playbook: e.target.value, checks: [] }))}>
              <option value="">– keins –</option>
              {playbooks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {pb && pb.rules.length > 0 && (
            <div className="jr-checks">
              {pb.rules.map((r) => (
                <label key={r.id}>
                  <input type="checkbox" checked={draft.checks.includes(r.id)} onChange={(e) => set("checks")(e.target.checked ? [...draft.checks, r.id] : draft.checks.filter((k) => k !== r.id))} /> {r.label}
                </label>
              ))}
            </div>
          )}
          <TagInput label="Tags" values={draft.tags} known={knownTags} onChange={set("tags")} placeholder="z. B. London-Open" />
          <TagInput label="Fehler" values={draft.mistakes} known={knownMistakes} onChange={set("mistakes")} placeholder="z. B. FOMO, Stop verschoben" bad />
          <div className="calc-field">
            <span>Bewertung</span>
            <Stars value={draft.rating} onChange={set("rating")} />
          </div>
        </div>

        <Screenshots ids={draft.images} onChange={set("images")} chartShot={chartShot} />
        <datalist id="jr-symbols">
          {symbols.map((s) => (
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
                {preview.rr !== null && <span className="jr-muted"> · geplant 1 : {num(preview.rr, 1)}</span>}
              </>
            ) : (
              <span className="jr-muted">Ergebnis erscheint beim Eintippen</span>
            )}
          </div>
          <button onClick={onClose}>Abbrechen</button>
          <button className="jr-save" onClick={save}>
            {editing ? "Änderungen speichern" : "Trade speichern"}
          </button>
        </div>
        {error && <div className="calc-warn">{error}</div>}
      </section>
    </div>
  );
}
