import { useMemo, useState } from "react";
import { type JournalTrade } from "../../../shared/journal";
import { compliance, MIN_SAMPLE, DURATION_BUCKETS, durationBucket, groupStats, hourOf, R_BUCKETS, rBucket, WEEKDAYS, weekdayOf, type GroupRow } from "../../../shared/journalAnalytics";
import { SignedBars } from "./charts";
import { MONTHS, num, pct, signed, tone, type JournalApi } from "./format";

interface Dim {
  id: string;
  label: string;
  keys: (t: JournalTrade) => string | string[] | null;
  /** Fixed order of the groups (else by result). */
  order?: string[];
  /** Explains why trades are missing from this report. */
  needs?: string;
}

/** Breakdown reports like TradeZella's: result by weekday, hour, symbol, playbook, tag, mistake, duration … */
export function Reports({ api, shown, unit }: { api: JournalApi; shown: JournalTrade[]; unit: "usd" | "r" }) {
  const dims: Dim[] = useMemo(
    () => [
      { id: "weekday", label: "Wochentag", keys: (t) => weekdayOf(t.date), order: WEEKDAYS },
      { id: "hour", label: "Uhrzeit (Einstieg)", keys: hourOf, order: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")} Uhr`), needs: "Uhrzeit Einstieg" },
      { id: "month", label: "Monat", keys: (t) => t.date.slice(0, 7), order: [...new Set(shown.map((t) => t.date.slice(0, 7)))].sort() },
      { id: "symbol", label: "Symbol", keys: (t) => t.symbol || null },
      { id: "side", label: "Long / Short", keys: (t) => (t.side === "long" ? "Long" : "Short"), order: ["Long", "Short"] },
      { id: "playbook", label: "Playbook", keys: (t) => api.playbooks.find((p) => p.id === t.playbook)?.name ?? "ohne Playbook" },
      { id: "setup", label: "Setup", keys: (t) => t.setup || null, needs: "Setup" },
      { id: "tags", label: "Tags", keys: (t) => t.tags ?? null, needs: "Tags" },
      {
        id: "rules",
        label: "Regeltreue",
        keys: (t) => {
          const c = compliance(t, api.playbooks);
          return c === "clean" ? "regelkonform" : c === "broken" ? "Regel gebrochen / Fehler" : null;
        },
        order: ["regelkonform", "Regel gebrochen / Fehler"],
        needs: "Playbook mit abgehakten Regeln oder Fehler",
      },
      { id: "mistakes", label: "Fehler", keys: (t) => (t.mistakes?.length ? t.mistakes : "ohne Fehler") },
      { id: "duration", label: "Haltedauer", keys: durationBucket, order: DURATION_BUCKETS, needs: "beide Uhrzeiten" },
      { id: "r", label: "R-Verteilung", keys: rBucket, order: R_BUCKETS, needs: "Stop-Loss" },
      { id: "rating", label: "Bewertung", keys: (t) => (t.rating ? "★".repeat(t.rating) : null), order: ["★", "★★", "★★★", "★★★★", "★★★★★"], needs: "Sterne-Bewertung" },
    ],
    [shown, api.playbooks],
  );
  const [dimId, setDimId] = useState("weekday");
  const dim = dims.find((d) => d.id === dimId) ?? dims[0];
  const rows = useMemo(() => groupStats(shown, dim.keys, dim.order), [shown, dim]);
  const covered = useMemo(() => shown.filter((t) => {
    const k = dim.keys(t);
    return k !== null && !(Array.isArray(k) && k.length === 0);
  }).length, [shown, dim]);
  const label = (k: string) => (dim.id === "month" ? `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}` : k);
  const value = (r: GroupRow) => (unit === "usd" ? r.net : r.totalR);
  const best = rows.length ? rows.reduce((a, r) => (value(r) > value(a) ? r : a)) : null;
  const worst = rows.length ? rows.reduce((a, r) => (value(r) < value(a) ? r : a)) : null;

  return (
    <>
      <div className="jz-report-tabs">
        {dims.map((d) => (
          <button key={d.id} className={d.id === dim.id ? "active" : ""} onClick={() => setDimId(d.id)}>
            {d.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="jr-empty">{dim.needs ? `Für diesen Bericht brauchen die Trades: ${dim.needs}. Trag es im Trade (tippen → ✎ Bearbeiten) nach.` : "Keine Trades für diese Auswahl."}</div>
      ) : (
        <>
          {best && worst && best !== worst && (
            <div className="jr-verdict">
              Am besten: <strong className={tone(value(best))}>{label(best.key)}</strong> ({signed(value(best), unit === "usd" ? 0 : 1)}
              {unit === "usd" ? " $" : " R"}) · am schlechtesten: <strong className={tone(value(worst))}>{label(worst.key)}</strong> ({signed(value(worst), unit === "usd" ? 0 : 1)}
              {unit === "usd" ? " $" : " R"})
              {dim.needs && covered < shown.length && <span className="jr-muted"> · {shown.length - covered} Trades ohne {dim.needs} fehlen hier</span>}
            </div>
          )}
          <section className="calc-card">
            <h3>Ergebnis nach {dim.label}</h3>
            <div className="calc-chart-title">{unit === "usd" ? "Netto-Ergebnis in $" : "Summe R (nur Trades mit Stop)"}</div>
            <SignedBars bars={rows.map((r) => ({ label: label(r.key), sub: `${r.count} Trades`, value: value(r) }))} fmt={(v) => signed(v, unit === "usd" ? 0 : 1)} height={240} />
            {rows.some((r) => r.count < MIN_SAMPLE) && <div className="calc-note">⚠ = weniger als {MIN_SAMPLE} Trades: Zufall spielt dort noch eine große Rolle, nicht zu viel hineinlesen.</div>}
            <div className="jr-table-wrap">
              <table className="calc-table jz-table">
                <thead>
                  <tr>
                    <th>{dim.label}</th>
                    <th>Trades</th>
                    <th>Trefferquote</th>
                    <th>Netto</th>
                    <th>Profit-Faktor</th>
                    <th>Ø pro Trade</th>
                    <th>Ø R</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className={r.count < MIN_SAMPLE ? "jz-few" : undefined}>
                      <td>{label(r.key)}</td>
                      <td>
                        {r.count}
                        {r.count < MIN_SAMPLE && <span title={`unter ${MIN_SAMPLE} Trades: noch nicht belastbar`}> ⚠</span>}
                      </td>
                      <td>{pct(r.winRate, 0)}</td>
                      <td className={tone(r.net)}>{signed(r.net)} $</td>
                      <td>{num(r.profitFactor)}</td>
                      <td className={tone(r.expectancy)}>{signed(r.expectancy)} $</td>
                      <td className={r.avgR === null ? undefined : tone(r.avgR)}>{r.avgR === null ? "–" : signed(r.avgR)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
