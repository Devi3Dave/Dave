import { useEffect, useMemo, useState } from "react";
import { tradePnl, tradeR, type JournalTrade } from "../../../shared/journal";
import { dailyResults, groupStats, type DayResult } from "../../../shared/journalAnalytics";
import { Sparkline } from "./charts";
import { longDate, money, num, pct, signed, tone, type JournalApi } from "./format";

const PAGE = 15;

function DayNote({ date, api }: { date: string; api: JournalApi }) {
  const saved = api.notes.days[date] ?? "";
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const save = () => {
    if (text === saved) return;
    api.setNotes((n) => {
      const days = { ...n.days };
      if (text.trim()) days[date] = text;
      else delete days[date];
      return { ...n, days };
    });
  };
  return <textarea className="jz-textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} placeholder="Tagesnotiz: Stimmung, Plan, was lief gut oder schlecht …" />;
}

function DayCard({ day, date, api, open }: { day: DayResult | null; date: string; api: JournalApi; open: boolean }) {
  const [expanded, setExpanded] = useState(open);
  useEffect(() => setExpanded(open), [open]);
  const trades = day?.trades ?? [];
  const g = trades.length ? groupStats(trades, () => "")[0] : null;
  let cum = 0;
  const path = trades.map((t) => (cum += tradePnl(t)));
  const fees = trades.reduce((a, t) => a + (t.pnl === undefined ? t.fees || 0 : 0), 0);
  return (
    <section className={`calc-card jz-day ${open ? "focus" : ""}`} id={`jz-day-${date}`}>
      <button className="jz-day-head" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        <span className="jz-caret">{expanded ? "▾" : "▸"}</span>
        <strong>{longDate(date)}</strong>
        {day && <strong className={`jz-day-pnl ${tone(day.pnl)}`}>{money(day.pnl)}</strong>}
        {api.notes.days[date] && <span title="Notiz vorhanden">📝</span>}
      </button>
      <div className="jz-day-sum">
        {trades.length > 0 && <Sparkline values={path} />}
        <div className="jz-mini jz-mini-row">
          <span>Trades</span>
          <strong>{trades.length}</strong>
          <span>Gewinner / Verlierer</span>
          <strong>
            <span className="up">{day?.wins ?? 0}</span> / <span className="down">{day?.losses ?? 0}</span>
          </strong>
          <span>Trefferquote</span>
          <strong>{g ? pct(g.winRate, 0) : "–"}</strong>
          <span>Profit-Faktor</span>
          <strong>{g ? num(g.profitFactor) : "–"}</strong>
          <span>R</span>
          <strong className={tone(day?.r ?? 0)}>{day ? `${signed(day.r, 1)} R` : "–"}</strong>
          <span>Gebühren</span>
          <strong>{num(fees)} $</strong>
        </div>
      </div>
      {expanded && (
        <>
          {trades.length > 0 && (
            <div className="jr-table-wrap">
              <table className="calc-table jz-table">
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Symbol</th>
                    <th>Richtung</th>
                    <th>Ergebnis</th>
                    <th>R</th>
                    <th>Playbook / Setup</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t: JournalTrade) => {
                    const p = tradePnl(t);
                    const r = tradeR(t);
                    return (
                      <tr key={t.id} className="jz-click" onClick={() => api.openTrade(t.id)}>
                        <td>{t.time ?? "–"}</td>
                        <td>{t.symbol || "–"}</td>
                        <td className={t.side === "long" ? "up" : "down"}>{t.side === "long" ? "Long" : "Short"}</td>
                        <td className={tone(p)}>{signed(p)} $</td>
                        <td className={r === null ? undefined : tone(r)}>{r === null ? "–" : signed(r)}</td>
                        <td>{api.playbooks.find((x) => x.id === t.playbook)?.name ?? t.setup ?? "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <DayNote date={date} api={api} />
        </>
      )}
    </section>
  );
}

/** Day view: one card per trading day with its result, curve, trades and the day's journal note. */
export function DayView({ api, shown, focus, onFocus }: { api: JournalApi; shown: JournalTrade[]; focus: string | null; onFocus: (d: string | null) => void }) {
  const days = useMemo(() => dailyResults(shown).reverse(), [shown]);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    if (focus) document.getElementById(`jz-day-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus]);
  if (focus) {
    const day = days.find((d) => d.date === focus) ?? null;
    return (
      <>
        <div className="jz-bar">
          <button onClick={() => onFocus(null)}>‹ Alle Tage</button>
          <input type="date" className="jr-select" value={focus} onChange={(e) => e.target.value && onFocus(e.target.value)} />
        </div>
        <DayCard day={day} date={focus} api={api} open />
        {!day && <div className="jr-empty">An diesem Tag gibt es keine Trades. Du kannst trotzdem eine Notiz schreiben, z. B. warum du nicht gehandelt hast.</div>}
      </>
    );
  }
  return (
    <>
      <div className="jz-bar">
        <span className="jr-muted">{days.length} Handelstage · neuester oben · tippe einen Tag zum Aufklappen</span>
        <div className="spacer" />
        <input type="date" className="jr-select" onChange={(e) => e.target.value && onFocus(e.target.value)} data-tip="Zu einem Tag springen" />
      </div>
      {days.length === 0 && <div className="jr-empty">Noch keine Handelstage.</div>}
      {days.slice(0, limit).map((d, i) => (
        <DayCard key={d.date} day={d} date={d.date} api={api} open={i === 0} />
      ))}
      {days.length > limit && (
        <button className="jz-more" onClick={() => setLimit((l) => l + PAGE)}>
          Weitere {Math.min(PAGE, days.length - limit)} Tage laden
        </button>
      )}
    </>
  );
}
