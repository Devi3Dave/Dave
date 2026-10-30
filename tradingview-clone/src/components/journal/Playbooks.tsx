import { useState } from "react";
import type { JournalTrade } from "../../../shared/journal";
import { MIN_SAMPLE, playbookStats, type Playbook } from "../../../shared/journalAnalytics";
import { newId, num, pct, signed, tone, type JournalApi } from "./format";

function PlaybookEditor({ initial, used, onSave, onCancel, onDelete }: { initial: Playbook; used?: number; onSave: (p: Playbook) => void; onCancel: () => void; onDelete?: () => void }) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [rules, setRules] = useState(initial.rules);
  const [confirm, setConfirm] = useState(false);
  return (
    <section className="calc-card jz-pb-edit">
      <label className="calc-field">
        <span>Name der Strategie</span>
        <div className="calc-input">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Orderblock-Retest" />
        </div>
      </label>
      <label className="calc-field">
        <span>Beschreibung</span>
        <textarea className="jz-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Wann, wo und warum handle ich diese Strategie?" />
      </label>
      <div className="calc-field">
        <span>Regeln (werden pro Trade abgehakt)</span>
        {!!used && <div className="calc-warn">Schon {used} Trades mit diesem Playbook. Ändere die Regeln nur, wenn du bewusst eine neue Version testen willst – sonst misst du ab jetzt eine andere Strategie. Besser: ein neues Playbook anlegen.</div>}
        {rules.map((r, i) => (
          <div key={r.id} className="jz-rule-row">
            <div className="calc-input">
              <input value={r.label} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
            </div>
            <button onClick={() => setRules(rules.filter((_, k) => k !== i))} aria-label="Regel entfernen">
              ✕
            </button>
          </div>
        ))}
        <button className="jz-add" onClick={() => setRules([...rules, { id: newId(), label: "" }])}>
          + Regel
        </button>
      </div>
      <div className="jr-actions">
        {onDelete &&
          (confirm ? (
            <>
              <button className="jr-danger" onClick={onDelete}>
                Playbook löschen
              </button>
              <button onClick={() => setConfirm(false)}>Nein</button>
            </>
          ) : (
            <button onClick={() => setConfirm(true)}>🗑</button>
          ))}
        <div className="spacer" />
        <button onClick={onCancel}>Abbrechen</button>
        <button
          className="jr-save"
          disabled={!name.trim()}
          onClick={() => onSave({ id: initial.id, name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), rules: rules.filter((r) => r.label.trim()).map((r) => ({ ...r, label: r.label.trim() })) })}
        >
          Speichern
        </button>
      </div>
    </section>
  );
}

/** Playbooks: own strategies with rules; per playbook the results and how well the rules were kept. */
export function Playbooks({ api, shown }: { api: JournalApi; shown: JournalTrade[] }) {
  const [editing, setEditing] = useState<Playbook | null>(null);
  const isNew = editing !== null && !api.playbooks.some((p) => p.id === editing.id);
  const save = (p: Playbook) => {
    api.setPlaybooks((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]));
    setEditing(null);
  };
  return (
    <>
      <div className="jz-bar">
        <span className="jr-muted">Ein Playbook ist eine Strategie mit festen Regeln. Ordne jedem Trade ein Playbook zu und hake ab, welche Regeln erfüllt waren – hier siehst du dann, ob sich Regeltreue auszahlt.</span>
        <div className="spacer" />
        <button className="jr-save" onClick={() => setEditing({ id: newId(), name: "", rules: [{ id: newId(), label: "" }] })}>
          + Playbook
        </button>
      </div>
      {editing && isNew && <PlaybookEditor initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
      <div className="jz-pb-grid">
        {api.playbooks.map((pb) => {
          if (editing?.id === pb.id)
            return (
              <PlaybookEditor
                key={pb.id}
                initial={pb}
                used={api.trades.filter((t) => t.playbook === pb.id).length}
                onSave={save}
                onCancel={() => setEditing(null)}
                onDelete={() => {
                  api.setPlaybooks((list) => list.filter((x) => x.id !== pb.id));
                  setEditing(null);
                }}
              />
            );
          const s = playbookStats(pb, shown);
          return (
            <section key={pb.id} className="calc-card jz-pb">
              <h3>
                📘 {pb.name}
                <div className="spacer" />
                <button onClick={() => setEditing(pb)} aria-label="Bearbeiten">
                  ✎
                </button>
              </h3>
              {pb.description && <p className="jr-muted">{pb.description}</p>}
              {s.count < MIN_SAMPLE && (
                <div className="jz-sample" data-tip={"Faustregel: erst ab etwa 30 Trades pro Setup sind die Zahlen halbwegs belastbar, besser 50–100.\nRegeln in dieser Zeit nicht ändern."}>
                  ⚠ Erst {s.count} von {MIN_SAMPLE} Trades – noch keine belastbare Aussage
                </div>
              )}
              <div className="jz-mini jz-mini-row">
                <span>Trades</span>
                <strong>{s.count}</strong>
                <span>Netto</span>
                <strong className={tone(s.net)}>{s.count ? `${signed(s.net)} $` : "–"}</strong>
                <span>Trefferquote</span>
                <strong>{s.count ? pct(s.winRate, 0) : "–"}</strong>
                <span>Profit-Faktor</span>
                <strong>{s.count ? num(s.profitFactor) : "–"}</strong>
                <span>Erwartungswert</span>
                <strong className={tone(s.expectancy)}>{s.count ? `${signed(s.expectancy)} $` : "–"}</strong>
                <span>Regeltreue</span>
                <strong>{s.adherence === null ? "–" : pct(s.adherence, 0)}</strong>
              </div>
              {s.adherence !== null && (
                <div className="jz-adherence">
                  <div>
                    <span>Alle Regeln erfüllt</span>
                    <strong>
                      {s.allRules.count} Trades · {s.allRules.count ? pct(s.allRules.winRate, 0) : "–"} Treffer
                    </strong>
                  </div>
                  <div>
                    <span>Regel gebrochen</span>
                    <strong>
                      {s.brokeRule.count} Trades · {s.brokeRule.count ? pct(s.brokeRule.winRate, 0) : "–"} Treffer
                    </strong>
                  </div>
                </div>
              )}
              {pb.rules.length > 0 && (
                <table className="jr-checklist">
                  <thead>
                    <tr>
                      <th>Regel</th>
                      <th>erfüllt</th>
                      <th>Treffer mit</th>
                      <th>ohne</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.rules.map((r) => (
                      <tr key={r.id}>
                        <td>{r.label}</td>
                        <td>{r.followed}×</td>
                        <td>{r.winWith === null ? "–" : pct(r.winWith, 0)}</td>
                        <td>{r.winWithout === null ? "–" : pct(r.winWithout, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
      {api.playbooks.length === 0 && !editing && <div className="jr-empty">Noch keine Playbooks. Leg mit „+ Playbook“ deine erste Strategie an.</div>}
    </>
  );
}
