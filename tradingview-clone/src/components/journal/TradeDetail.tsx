import { useEffect, useState } from "react";
import { tradePnl, tradeR, tradeRisk, type JournalTrade } from "../../../shared/journal";
import { durationMin } from "../../../shared/journalAnalytics";
import { Screenshots } from "./Screenshots";
import { fmtDate, longDate, num, signed, tone, type JournalApi } from "./format";

/** 1–5 stars; tapping the set star again clears it. */
export function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="jz-stars" role="radiogroup" aria-label="Bewertung">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= value ? "on" : ""} onClick={() => onChange(n === value ? 0 : n)} aria-label={`${n} Sterne`}>
          ★
        </button>
      ))}
    </div>
  );
}

/** Chips with ✕ and a field to add more (Enter or comma); `known` are offered as suggestions. */
export function TagInput({ label, values, known, onChange, placeholder, bad }: { label: string; values: string[]; known: string[]; onChange: (v: string[]) => void; placeholder?: string; bad?: boolean }) {
  const [text, setText] = useState("");
  const listId = `jz-tags-${label}`;
  const add = (raw: string) => {
    const v = raw.trim().replace(/,$/, "").trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setText("");
  };
  return (
    <div className="calc-field jz-tags">
      <span>{label}</span>
      <div className="jz-chips">
        {values.map((v) => (
          <span key={v} className={`jz-chip ${bad ? "bad" : ""}`}>
            {v}
            <button onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`${v} entfernen`}>
              ✕
            </button>
          </span>
        ))}
        <input
          value={text}
          list={listId}
          placeholder={values.length ? "+" : placeholder}
          onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(text);
            }
          }}
          onBlur={() => text.trim() && add(text)}
        />
        <datalist id={listId}>
          {known
            .filter((k) => !values.includes(k))
            .map((k) => (
              <option key={k} value={k} />
            ))}
        </datalist>
      </div>
    </div>
  );
}

const durationText = (m: number | null) => (m === null ? "–" : m < 60 ? `${m} Min` : `${Math.floor(m / 60)} Std ${m % 60 ? `${m % 60} Min` : ""}`.trim());

export function TradeDetail({
  trade,
  api,
  ordered,
  onOpenChart,
  onDelete,
  onClose,
}: {
  trade: JournalTrade;
  api: JournalApi;
  /** All trades in time order, for ‹ › navigation. */
  ordered: JournalTrade[];
  onOpenChart: (symbol: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(trade.note ?? "");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setNote(trade.note ?? "");
    setConfirm(false);
  }, [trade.id, trade.note]);

  const p = tradePnl(trade);
  const r = tradeR(trade);
  const risk = tradeRisk(trade);
  const manual = trade.pnl !== undefined;
  const pb = api.playbooks.find((x) => x.id === trade.playbook);
  const knownTags = [...new Set(api.trades.flatMap((t) => t.tags ?? []))].sort();
  const knownMistakes = [...new Set(api.trades.flatMap((t) => t.mistakes ?? []))].sort();
  const i = ordered.findIndex((t) => t.id === trade.id);
  const patch = (fields: Partial<JournalTrade>) => {
    const next = { ...trade, ...fields };
    for (const k of Object.keys(fields) as (keyof JournalTrade)[]) {
      const v = next[k];
      if (v === undefined || v === "" || v === 0 || (Array.isArray(v) && v.length === 0 && k !== "checks")) delete next[k];
    }
    api.updateTrade(next);
  };
  const saveNote = () => note.trim() !== (trade.note ?? "") && patch({ note: note.trim() || undefined });

  const rows: [string, string][] = [
    ["Datum", fmtDate(trade.date)],
    ["Uhrzeit", trade.time ? `${trade.time}${trade.exitTime ? ` – ${trade.exitTime}` : ""}` : "–"],
    ["Haltedauer", durationText(durationMin(trade))],
    ["Einstieg", manual && !trade.entry ? "–" : num(trade.entry)],
    ["Stop-Loss", trade.stop === undefined ? "–" : num(trade.stop)],
    ["Ausstieg", manual && !trade.exit ? "–" : num(trade.exit)],
    ["Menge", manual && !trade.qty ? "–" : num(trade.qty, 4).replace(/,?0+$/, "")],
    ["Gebühren", `${num(trade.fees || 0)} $`],
    ["Risiko (1 R)", risk > 0 ? `${num(risk)} $` : "–"],
    ["Setup", trade.setup || "–"],
  ];

  return (
    <div className="jz-modal-back" onClick={onClose}>
      <section className="calc-card jz-modal jz-detail" onClick={(e) => e.stopPropagation()}>
        <h3>
          <button disabled={i <= 0} onClick={() => api.openTrade(ordered[i - 1].id)} aria-label="Vorheriger Trade">
            ‹
          </button>
          <span>
            {trade.symbol || "Trade"} <span className={trade.side === "long" ? "up" : "down"}>{trade.side === "long" ? "Long ▲" : "Short ▼"}</span>
          </span>
          <button disabled={i < 0 || i >= ordered.length - 1} onClick={() => api.openTrade(ordered[i + 1].id)} aria-label="Nächster Trade">
            ›
          </button>
          <div className="spacer" />
          <button onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </h3>
        <div className="jz-detail-head">
          <div>
            <span className="jr-muted">Netto-Ergebnis</span>
            <strong className={`jz-big ${tone(p)}`}>{signed(p)} $</strong>
          </div>
          <div>
            <span className="jr-muted">R-Multiple</span>
            <strong className={`jz-big ${r === null ? "" : tone(r)}`}>{r === null ? "–" : `${signed(r)} R`}</strong>
          </div>
          <button className="jz-link" onClick={() => api.openDay(trade.date)} data-tip="Alle Trades und die Notiz dieses Tages">
            📅 {longDate(trade.date)}
          </button>
        </div>
        <div className="jz-detail-grid">
          {rows.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </div>

        <div className="jz-detail-sec">
          <label className="calc-field">
            <span>Playbook</span>
            <select className="jr-select" value={trade.playbook ?? ""} onChange={(e) => patch({ playbook: e.target.value || undefined, checks: e.target.value ? [] : undefined })}>
              <option value="">– keins –</option>
              {api.playbooks.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {pb && pb.rules.length > 0 && (
            <div className="jr-checks">
              {pb.rules.map((rule) => {
                const on = trade.checks?.includes(rule.id) ?? false;
                return (
                  <label key={rule.id}>
                    <input type="checkbox" checked={on} onChange={() => patch({ checks: on ? (trade.checks ?? []).filter((k) => k !== rule.id) : [...(trade.checks ?? []), rule.id] })} /> {rule.label}
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div className="jz-detail-sec jz-two">
          <TagInput label="Tags" values={trade.tags ?? []} known={knownTags} onChange={(v) => patch({ tags: v })} placeholder="Tag hinzufügen" />
          <TagInput label="Fehler" values={trade.mistakes ?? []} known={knownMistakes} onChange={(v) => patch({ mistakes: v })} placeholder="Fehler hinzufügen" bad />
        </div>
        <div className="jz-detail-sec">
          <Screenshots ids={trade.images ?? []} onChange={(v) => patch({ images: v })} chartShot={api.chartShot} />
        </div>
        <div className="jz-detail-sec">
          <div className="calc-field">
            <span>Bewertung der Ausführung</span>
            <Stars value={trade.rating ?? 0} onChange={(v) => patch({ rating: v || undefined })} />
          </div>
          <label className="calc-field">
            <span>Notiz zum Trade</span>
            <textarea className="jz-textarea" rows={4} value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} placeholder="Warum rein, warum raus, was habe ich gelernt?" />
          </label>
        </div>
        <div className="jr-actions">
          {confirm ? (
            <>
              <span className="jr-muted">Wirklich löschen?</span>
              <button className="jr-danger" onClick={() => onDelete(trade.id)}>
                Löschen
              </button>
              <button onClick={() => setConfirm(false)}>Nein</button>
            </>
          ) : (
            <>
              <button onClick={() => setConfirm(true)}>🗑 Löschen</button>
              <div className="spacer" />
              {trade.symbol && <button onClick={() => onOpenChart(trade.symbol)}>📈 Im Chart öffnen</button>}
              <button
                className="jr-save"
                onClick={() => {
                  saveNote();
                  api.editTrade({ ...trade, note: note.trim() || undefined });
                }}
              >
                ✎ Bearbeiten
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
