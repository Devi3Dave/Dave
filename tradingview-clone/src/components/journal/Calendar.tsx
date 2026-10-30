import { useMemo, useState } from "react";
import { monthWeeks, type DayResult } from "../../../shared/journalAnalytics";
import { MONTHS_LONG, money, num, today } from "./format";

const HEAD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Month calendar: each trading day green or red with its result, a week column with the week's sum. */
export function JournalCalendar({ days, noteDays, unit, onPick }: { days: DayResult[]; noteDays: Set<string>; unit: "usd" | "r"; onPick: (date: string) => void }) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const latest = days[days.length - 1]?.date ?? today();
  const [ym, setYm] = useState(() => ({ y: Number(latest.slice(0, 4)), m: Number(latest.slice(5, 7)) }));
  const weeks = monthWeeks(ym.y, ym.m);
  const step = (d: number) => setYm(({ y, m }) => (m + d < 1 ? { y: y - 1, m: 12 } : m + d > 12 ? { y: y + 1, m: 1 } : { y, m: m + d }));
  const val = (d: DayResult) => (unit === "usd" ? d.pnl : d.r);
  const fmt = (v: number) => (unit === "usd" ? money(v, Math.abs(v) >= 100 ? 0 : 2) : `${v > 0 ? "+" : ""}${num(v, 1)} R`);
  const monthDays = weeks.flat().flatMap((d) => (d && byDate.get(d) ? [byDate.get(d)!] : []));
  const monthSum = monthDays.reduce((a, d) => a + val(d), 0);
  const maxAbs = Math.max(1e-9, ...monthDays.map((d) => Math.abs(val(d))));
  const now = today();

  return (
    <div className="jz-cal">
      <div className="jz-cal-head">
        <button onClick={() => step(-1)} aria-label="Vorheriger Monat">
          ‹
        </button>
        <strong>
          {MONTHS_LONG[ym.m - 1]} {ym.y}
        </strong>
        <button onClick={() => step(1)} aria-label="Nächster Monat">
          ›
        </button>
        <button onClick={() => setYm({ y: Number(now.slice(0, 4)), m: Number(now.slice(5, 7)) })}>Heute</button>
        <div className="spacer" />
        <span className="jr-muted">Monat:</span>
        <strong className={monthSum > 0 ? "up" : monthSum < 0 ? "down" : undefined}>{monthDays.length ? fmt(monthSum) : "–"}</strong>
        <span className="jr-muted">· {monthDays.length} Handelstage</span>
      </div>
      <div className="jz-cal-grid">
        {HEAD.map((h) => (
          <div key={h} className="jz-cal-wd">
            {h}
          </div>
        ))}
        <div className="jz-cal-wd">Woche</div>
        {weeks.map((w, wi) => {
          const inWeek = w.flatMap((d) => (d && byDate.get(d) ? [byDate.get(d)!] : []));
          const sum = inWeek.reduce((a, d) => a + val(d), 0);
          return [
            ...w.map((d, i) => {
              if (!d) return <div key={`${wi}-${i}`} className="jz-cal-day out" />;
              const r = byDate.get(d);
              const v = r ? val(r) : 0;
              const cls = r ? (r.pnl > 0 ? "win" : r.pnl < 0 ? "loss" : "even") : "";
              // Stronger color for larger days, so big wins and losses stand out.
              const alpha = r ? 0.12 + 0.3 * Math.min(1, Math.abs(v) / maxAbs) : 0;
              return (
                <button
                  key={d}
                  className={`jz-cal-day ${cls} ${d === now ? "today" : ""}`}
                  style={r && r.pnl !== 0 ? { background: r.pnl > 0 ? `rgba(38,166,154,${alpha})` : `rgba(239,83,80,${alpha})` } : undefined}
                  onClick={() => onPick(d)}
                  data-tip={r ? `${r.count} Trades · ${r.wins} Gewinner` : "Kein Trade – tippen für die Tagesnotiz"}
                >
                  <span className="jz-cal-n">
                    {Number(d.slice(8, 10))}
                    {noteDays.has(d) && <i title="Notiz vorhanden">📝</i>}
                  </span>
                  {r && (
                    <>
                      <strong>{fmt(v)}</strong>
                      <em>
                        {r.count} {r.count === 1 ? "Trade" : "Trades"}
                      </em>
                      <em>{num((r.wins / r.count) * 100, 0)} %</em>
                    </>
                  )}
                </button>
              );
            }),
            <div key={`w${wi}`} className="jz-cal-week">
              <span>Woche {wi + 1}</span>
              <strong className={sum > 0 ? "up" : sum < 0 ? "down" : undefined}>{inWeek.length ? fmt(sum) : "–"}</strong>
              <em>{inWeek.length} Tage</em>
            </div>,
          ];
        })}
      </div>
    </div>
  );
}
