import { useMemo, type ReactNode } from "react";
import { journalStats, sortTrades, tradePnl, tradeR, type JournalTrade } from "../../../shared/journal";
import { dailyResults, dayWinRate, performanceScore } from "../../../shared/journalAnalytics";
import { LineChart } from "../CalcCharts";
import { JournalCalendar } from "./Calendar";
import { Radar, RatioBar, SignedBars, WinGauge } from "./charts";
import { DOWN, fmtDate, GOLD, money, num, pct, signed, tone, UP, type JournalApi } from "./format";

const MIN_TRADES = 20;
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
            {filtered && <> mit diesem Filter</>}.{stats.count < MIN_TRADES && <span className="jr-muted"> Aussagekräftig wird es ab etwa {MIN_TRADES} Trades.</span>}
          </>
        )}
      </div>

      <div className="jz-kpis">
        <Kpi label="Netto-Ergebnis" tip={"Summe aller Trades nach Gebühren"} value={money(stats.netPnl)} valueTone={tone(stats.netPnl)}>
          <em className="jr-muted">{stats.count} Trades</em>
        </Kpi>
        <Kpi label="Erwartungswert" tip={"Ø Ergebnis pro Trade = Netto-Ergebnis ÷ Anzahl Trades"} value={stats.count ? money(stats.expectancy) : "–"} valueTone={tone(stats.expectancy)}>
          {stats.avgR !== null && <em className="jr-muted">{signed(stats.avgR)} R</em>}
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
                <strong className={stats.maxDrawdown > 0 ? "down" : undefined}>{stats.maxDrawdown > 0 ? `−${num(stats.maxDrawdown)} $` : "–"}</strong>
                <span>Bester Tag</span>
                <strong className="up">{bestDay && bestDay.pnl > 0 ? `${money(bestDay.pnl, 0)} · ${fmtDate(bestDay.date)}` : "–"}</strong>
                <span>Schlechtester Tag</span>
                <strong className="down">{worstDay && worstDay.pnl < 0 ? `${money(worstDay.pnl, 0)} · ${fmtDate(worstDay.date)}` : "–"}</strong>
                <span>Längste Verlustserie</span>
                <strong>{stats.longestLosingStreak} Trades</strong>
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
