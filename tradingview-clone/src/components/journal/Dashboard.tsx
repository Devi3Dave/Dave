import { useMemo, type ReactNode } from "react";
import { journalStats, sortTrades, tradePnl, tradeR, type JournalTrade } from "../../../shared/journal";
import { complianceStats, dailyResults, dayWinRate, MIN_SAMPLE, performanceScore, type GroupRow } from "../../../shared/journalAnalytics";
import { LineChart } from "../CalcCharts";
import { JournalCalendar } from "./Calendar";
import { Radar, RatioBar, SignedBars, WinGauge } from "./charts";
import { DOWN, fmtDate, GOLD, money, num, pct, signed, tone, UP, type JournalApi } from "./format";

const SHORT = { pf: "Profit-Faktor", wl: "Ø Gew./Verl.", dd: "Drawdown", win: "Trefferquote", rf: "Recovery", cons: "Beständigkeit" } as const;

function Kpi({ label, tip, value, valueTone, children }: { label: string; tip: string; value: string; valueTone?: string; children?: ReactNode }) {
  return (
    <div className="jz-kpi" data-tip={tip}>
      <span>{label}</span>
      <div className="jz-kpi-row">
        <strong className={valueTone}>{value}</strong>
        {children}
      </div>
    </div>
  );
}

function CompCol({ title, row, tone: t }: { title: string; row: GroupRow | null; tone: "up" | "down" }) {
  return (
    <div className={`jz-comp-col ${t}`}>
      <span className="jz-comp-title">{title}</span>
      {row ? (
        <div className="jz-mini">
          <span>Trades</span>
          <strong>{row.count}</strong>
          <span>Trefferquote</span>
          <strong>{pct(row.winRate, 0)}</strong>
          <span>Erwartungswert</span>
          <strong className={tone(row.avgR ?? row.expectancy)}>{row.avgR === null ? money(row.expectancy) : `${signed(row.avgR)} R`}</strong>
          <span>Profit-Faktor</span>
          <strong>{num(row.profitFactor)}</strong>
          <span>Netto</span>
          <strong className={tone(row.net)}>{money(row.net, 0)}</strong>
        </div>
      ) : (
        <span className="jr-muted">noch keine</span>
      )}
    </div>
  );
}

/** Rule-conform trades against those with a broken rule or a mistake: is it the strategy or the execution? */
function Compliance({ api, shown }: { api: JournalApi; shown: JournalTrade[] }) {
  const c = useMemo(() => complianceStats(shown, api.playbooks), [shown, api.playbooks]);
  const e = (r: GroupRow | null) => (r ? (r.avgR ?? r.expectancy) : null);
  const ce = e(c.clean);
  const be = e(c.broken);
  const verdict =
    !c.clean && !c.broken
      ? "Ordne Trades einem Playbook zu und hake die Regeln ab oder trag Fehler ein – dann siehst du hier, ob es an der Strategie oder an der Ausführung liegt."
      : ce !== null && ce > 0 && (be === null || be < ce)
        ? `Die Strategie hat einen Vorteil, wenn du dich an die Regeln hältst.${c.broken && c.broken.net < 0 ? ` Regelbrüche und Fehler haben dich ${num(-c.broken.net, 0)} $ gekostet.` : ""}`
        : ce !== null && ce <= 0
          ? "Auch die regelkonformen Trades verlieren im Schnitt – dann liegt es eher an der Strategie selbst, nicht an der Ausführung."
          : "Die Trades mit Fehlern laufen nicht schlechter als die regelkonformen – sammle mehr Trades, bevor du daraus etwas schließt.";
  const small = (c.clean?.count ?? 0) < MIN_SAMPLE;
  return (
    <section className="calc-card jz-comp">
      <h3>Strategie oder Ausführung?</h3>
      <div className="jz-comp-cols">
        <CompCol title="✓ Regelkonform" row={c.clean} tone="up" />
        <CompCol title="✗ Regel gebrochen / Fehler" row={c.broken} tone="down" />
      </div>
      <p className="jz-comp-verdict">{verdict}</p>
      <div className="calc-note">
        Regelkonform = Playbook mit allen Regeln abgehakt und kein Fehler eingetragen.{c.unjudged > 0 && ` ${c.unjudged} Trades ohne Checkliste und ohne Fehler zählen hier nicht.`}
        {small && (c.clean || c.broken) && ` Noch wenige regelkonforme Trades (${c.clean?.count ?? 0} von ${MIN_SAMPLE}) – die Aussage ist noch unsicher.`}
      </div>
    </section>
  );
}

export function Dashboard({ api, shown, unit, filtered }: { api: JournalApi; shown: JournalTrade[]; unit: "usd" | "r"; filtered: boolean }) {
  const stats = useMemo(() => journalStats(shown), [shown]);
  const days = useMemo(() => dailyResults(shown), [shown]);
  const score = useMemo(() => performanceScore(shown), [shown]);
  const recent = useMemo(() => sortTrades(shown).slice(-8).reverse(), [shown]);
  const noteDays = useMemo(() => new Set(Object.keys(api.notes.days)), [api.notes.days]);
  const even = stats.count - stats.wins - stats.losses;
  const dwr = dayWinRate(days);
  const winDays = days.filter((d) => d.pnl > 0).length;
  const lossDays = days.filter((d) => d.pnl < 0).length;
  const pf = stats.profitFactor;
  const wl = stats.avgLoss > 0 ? stats.avgWin / stats.avgLoss : stats.avgWin > 0 ? Infinity : 0;
  const dv = (d: (typeof days)[number]) => (unit === "usd" ? d.pnl : d.r);
  let cum = 0;
  const cumDays = days.map((d, i) => [i + 1, (cum += dv(d))] as [number, number]);
  const curve: [number, number][] = [[0, 0], ...cumDays];
  const ys = curve.map((c) => c[1]);
  const yLo = Math.min(0, ...ys);
  const yHi = Math.max(0, ...ys);
  const yPad = (yHi - yLo) * 0.08 || (unit === "usd" ? 50 : 1);
  const final = ys[ys.length - 1];
  const fmtV = (v: number, d = 0) => (unit === "usd" ? signed(v, d) : `${signed(v, 1)}R`);
  const bestDay = days.reduce<(typeof days)[number] | null>((a, d) => (!a || d.pnl > a.pnl ? d : a), null);
  const worstDay = days.reduce<(typeof days)[number] | null>((a, d) => (!a || d.pnl < a.pnl ? d : a), null);

  const profitable = stats.netPnl > 0;
  return (
    <>
      <div className={`jr-verdict ${stats.count ? (profitable ? "up" : "down") : ""}`}>
        {stats.count === 0 ? (
          <>Noch keine Trades{filtered ? " für diese Auswahl" : ""}. Trag deinen ersten Trade mit „+ Trade“ ein oder importiere eine CSV-Datei deiner Börse.</>
        ) : (
          <>
            {profitable ? "✅ Du bist profitabel" : stats.netPnl === 0 ? "➖ Genau bei null" : "❌ Noch nicht profitabel"}: <strong className={tone(stats.netPnl)}>{money(stats.netPnl)}</strong>
            {stats.rCount > 0 && <> ({signed(stats.totalR, 1)} R)</>} nach {stats.count} {stats.count === 1 ? "Trade" : "Trades"} an {days.length} {days.length === 1 ? "Tag" : "Tagen"}
            {filtered && <> mit diesem Filter</>}.{stats.count < MIN_SAMPLE && <span className="jr-muted"> Noch {MIN_SAMPLE - stats.count} Trades bis zur Faustregel von {MIN_SAMPLE} – erst dann sind die Zahlen halbwegs belastbar.</span>}
          </>
        )}
      </div>

      <div className="jz-kpis">
        <Kpi label="Netto-Ergebnis" tip={"Summe aller Trades nach Gebühren"} value={money(stats.netPnl)} valueTone={tone(stats.netPnl)}>
          <em className="jr-muted">{stats.count} Trades</em>
        </Kpi>
        <Kpi
          label="Erwartungswert"
          tip={"Ø Ergebnis pro Trade\n= Trefferquote × Ø Gewinn − Verlustquote × Ø Verlust\nin R: nur Trades mit Stop · klar über 0 = die Strategie hat einen Vorteil"}
          value={stats.count ? (unit === "r" && stats.avgR !== null ? `${signed(stats.avgR)} R` : money(stats.expectancy)) : "–"}
          valueTone={tone(unit === "r" && stats.avgR !== null ? stats.avgR : stats.expectancy)}
        >
          {stats.avgR !== null && <em className="jr-muted">{unit === "r" ? money(stats.expectancy) : `${signed(stats.avgR)} R`}</em>}
        </Kpi>
        <Kpi label="Profit-Faktor" tip={"Summe Gewinne ÷ Summe Verluste\nüber 1 = profitabel"} value={stats.count ? num(pf) : "–"} valueTone={stats.count ? (pf >= 1 ? "up" : "down") : undefined}>
          <WinGauge wins={stats.grossProfit} even={0} losses={stats.grossLoss} size={70} />
        </Kpi>
        <Kpi label="Trefferquote" tip={"Anteil der Trades mit Gewinn\ngrün Gewinner · grau ±0 · rot Verlierer"} value={stats.count ? pct(stats.winRate, 0) : "–"}>
          <div className="jz-gauge-box">
            <WinGauge wins={stats.wins} even={even} losses={stats.losses} size={70} />
            <em>
              <b className="up">{stats.wins}</b> <b>{even}</b> <b className="down">{stats.losses}</b>
            </em>
          </div>
        </Kpi>
        <Kpi label="Tage im Plus" tip={"Anteil der Handelstage, die mit Gewinn endeten"} value={days.length ? pct(dwr, 0) : "–"}>
          <div className="jz-gauge-box">
            <WinGauge wins={winDays} even={days.length - winDays - lossDays} losses={lossDays} size={70} />
            <em>
              <b className="up">{winDays}</b> <b className="down">{lossDays}</b>
            </em>
          </div>
        </Kpi>
        <Kpi label="Ø Gewinn / Ø Verlust" tip={"Durchschnittlicher Gewinner geteilt durch durchschnittlichen Verlierer"} value={stats.count ? num(wl) : "–"}>
          <div className="jz-ratio-box">
            <RatioBar win={stats.avgWin} loss={stats.avgLoss} />
            <em>
              <b className="up">{num(stats.avgWin, 0)} $</b> <b className="down">−{num(stats.avgLoss, 0)} $</b>
            </em>
          </div>
        </Kpi>
      </div>

      {stats.count > 0 && (
        <div className="jz-row3">
          <Compliance api={api} shown={shown} />
          <section className="calc-card jz-score">
            <h3>Journal-Score</h3>
            {score && (
              <>
                <div className="jz-score-body">
                  <Radar parts={score.parts.map((p) => ({ label: SHORT[p.key], score: p.score }))} />
                  <div className="jz-score-total">
                    <strong className={score.total >= 60 ? "up" : score.total >= 40 ? "gold" : "down"}>{num(score.total, 0)}</strong>
                    <span className="jr-muted">von 100</span>
                    <div className="jz-score-bar">
                      <span style={{ width: `${score.total}%` }} />
                    </div>
                  </div>
                </div>
                <ul className="jz-score-parts">
                  {score.parts.map((p) => (
                    <li key={p.key} data-tip={`${p.rule}\nGewicht ${num(p.weight * 100, 0)} %`}>
                      <span>{p.label}</span>
                      <strong>{num(p.score, 0)}</strong>
                    </li>
                  ))}
                </ul>
                <div className="calc-note">Aufbau wie der Zella Score von TradeZella (6 Kennzahlen, gleiche Gewichte). Drei Schwellen nennt TradeZella nicht öffentlich, dort steht unsere eigene – tippe eine Zeile für die Formel.</div>
              </>
            )}
          </section>
          <section className="calc-card">
            <h3>Kumuliertes Ergebnis pro Tag</h3>
            <div className="calc-chart-title">Summe nach jedem Handelstag{unit === "r" ? " in R" : " in $"}</div>
            <LineChart
              series={[{ id: "eq", points: curve, color: final >= 0 ? UP : DOWN, width: 2.5, label: "Kumuliert", endLabel: fmtV(final) }]}
              xDomain={[0, Math.max(1, days.length)]}
              yDomain={[yLo - yPad, yHi + yPad]}
              xFmt={(x) => (x === 0 ? "Start" : days[x - 1] ? fmtDate(days[x - 1].date).slice(0, 5) : "")}
              xTipFmt={(x) => (x === 0 ? "Start" : days[x - 1] ? fmtDate(days[x - 1].date) : "")}
              yFmt={(v) => (unit === "usd" ? num(v, 0) : `${num(v, 1)}R`)}
              hLines={[{ value: 0, label: "Break-even" }]}
              integerX
              height={250}
            />
          </section>
          <section className="calc-card">
            <h3>Ergebnis je Tag</h3>
            <div className="calc-chart-title">Grün = Tag im Plus, rot = im Minus · tippen öffnet den Tag</div>
            <SignedBars bars={days.slice(-40).map((d) => ({ label: fmtDate(d.date).slice(0, 5), sub: `${d.count} Trades`, value: dv(d) }))} fmt={(v) => fmtV(v)} height={250} onPick={(i) => api.openDay(days.slice(-40)[i].date)} />
          </section>
        </div>
      )}

      <div className="jz-row2">
        <section className="calc-card">
          <h3>Kalender</h3>
          <JournalCalendar days={days} noteDays={noteDays} unit={unit} onPick={api.openDay} />
        </section>
        <div className="jz-side">
          <section className="calc-card">
            <h3>Letzte Trades</h3>
            {recent.length ? (
              <ul className="jz-recent">
                {recent.map((t) => {
                  const p = tradePnl(t);
                  const r = tradeR(t);
                  return (
                    <li key={t.id}>
                      <button onClick={() => api.openTrade(t.id)}>
                        <span>{fmtDate(t.date)}</span>
                        <strong>{t.symbol || "–"}</strong>
                        <span className={t.side === "long" ? "up" : "down"}>{t.side === "long" ? "L" : "S"}</span>
                        <strong className={tone(p)}>{signed(p)} $</strong>
                        <span className="jr-muted">{r === null ? "" : `${signed(r, 1)}R`}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="jr-empty">Noch keine Trades.</div>
            )}
          </section>
          {stats.count > 0 && (
            <section className="calc-card">
              <h3>Weitere Kennzahlen</h3>
              <div className="jz-mini">
                <span>Max. Drawdown</span>
                <strong className={stats.maxDrawdown > 0 ? "down" : undefined}>
                  {stats.maxDrawdown > 0 ? `−${num(stats.maxDrawdown, 0)} $` : "–"}
                  {stats.maxDrawdownR > 0 && ` · −${num(stats.maxDrawdownR, 1)} R`}
                </strong>
                <span>Bester Tag</span>
                <strong className="up">{bestDay && bestDay.pnl > 0 ? `${money(bestDay.pnl, 0)} · ${fmtDate(bestDay.date)}` : "–"}</strong>
                <span>Schlechtester Tag</span>
                <strong className="down">{worstDay && worstDay.pnl < 0 ? `${money(worstDay.pnl, 0)} · ${fmtDate(worstDay.date)}` : "–"}</strong>
                <span>Längste Verlustserie</span>
                <strong>{stats.longestLosingStreak} Trades</strong>
                <span>Längste Gewinnserie</span>
                <strong>{stats.longestWinningStreak} Trades</strong>
                <span>Bester / schlechtester Trade</span>
                <strong>
                  <span className="up">{signed(stats.best, 0)}</span> / <span className="down">{signed(stats.worst, 0)}</span> $
                </strong>
                <span>Gebühren gesamt</span>
                <strong style={{ color: GOLD }}>{num(shown.reduce((a, t) => a + (t.pnl === undefined ? t.fees || 0 : 0), 0))} $</strong>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
