import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  FIB_EXTENSIONS,
  FIB_RETRACEMENTS,
  breakEvenWinRate,
  expectancy,
  fibExtension,
  fibRetracement,
  losingStreakProbability,
  positionSize,
  requiredMargin,
  simulateTrades,
  targetPrice,
} from "../../shared/calculators";
import { liquidationPrice } from "../../shared/liquidations";
import { BarChart, LineChart, niceTicks, useWidth, type Series } from "./CalcCharts";
import { BASICS, HELP, HelpBody, type Help } from "./calcHelp";

const STORAGE_KEY = "chartai.calculators.v1";
const HELP_KEY = "chartai.calculators.help";

// Start values are the examples from the strategy notes.
const DEFAULTS = {
  risk: 100,
  entry: 135.5,
  stop: 130,
  rTarget: 4,
  winRate: 30,
  avgWin: 3.8,
  avgLoss: 1,
  trades: 20,
  seed: 1,
  fibA: 100,
  fibB: 150,
  fibC: 119.1,
  notional: 29000,
  leverage: 20,
};

type Values = typeof DEFAULTS;

const SIM_PATHS = 30;
const R_STEPS = [1, 2, 3, 4, 5, 8, 10, 15];

const UP = "#26a69a";
const DOWN = "#ef5350";
const ACCENT = "#2962ff";
const GOLD = "#f5c518";
const MUTED = "#787b86";

function load(): Values {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Values>) };
  } catch {
    return DEFAULTS;
  }
}

const nf = (d: number) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (v: number, d = 2) => (Number.isFinite(v) ? nf(d).format(v) : "–");
const usd = (v: number, d = 2) => `${num(v, d)} $`;
const signed = (v: number, d = 2) => `${v > 0 ? "+" : ""}${num(v, d)}`;
const pct = (v: number, d = 1) => `${num(v * 100, d)} %`;
/** Rounds away float noise so inputs show what was typed. */
const clean = (v: number) => String(+v.toPrecision(10)).replace(".", ",");

/** Number input that keeps the typed text while editing and accepts a decimal comma. */
function NumInput({ label, value, onChange, unit, min, max, step, hint }: { label: string; value: number; onChange: (v: number) => void; unit?: string; min?: number; max?: number; step?: number; hint?: string }) {
  const [text, setText] = useState(clean(value));
  useEffect(() => {
    setText((t) => (Number(t.replace(",", ".")) === value ? t : clean(value)));
  }, [value]);
  return (
    <label className="calc-field" data-tip={hint}>
      <span>{label}</span>
      <div className="calc-input">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value.replace(",", "."));
            if (e.target.value.trim() !== "" && Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) onChange(v);
          }}
          onBlur={() => setText(clean(value))}
        />
        {unit && <em>{unit}</em>}
      </div>
      {step !== undefined && min !== undefined && max !== undefined && (
        <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} onChange={(e) => onChange(Number(e.target.value))} />
      )}
    </label>
  );
}

/** Collapsible plain-language explanation; the header button opens or closes all of them. */
function HelpBox({ help, allOpen, title = "So funktioniert's" }: { help: Help; allOpen: boolean; title?: string }) {
  const [open, setOpen] = useState(allOpen);
  useEffect(() => setOpen(allOpen), [allOpen]);
  return (
    <details className="calc-help" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>💡 {title}</summary>
      <HelpBody help={help} />
    </details>
  );
}

function Card({ n, title, formula, help, helpOpen, children }: { n: number | string; title: string; formula: ReactNode; help: Help; helpOpen: boolean; children: ReactNode }) {
  return (
    <section className="calc-card">
      <h3>
        <span className="calc-n">{n}</span>
        {title}
      </h3>
      <div className="calc-formula">{formula}</div>
      <HelpBox help={help} allOpen={helpOpen} />
      {children}
    </section>
  );
}

function Stat({ label, value, tone, big }: { label: string; value: ReactNode; tone?: "up" | "down" | "gold"; big?: boolean }) {
  return (
    <div className={`calc-stat ${big ? "big" : ""}`}>
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

/** Vertical price ladder: stop, entry and target with risk/reward zones. */
function PriceLadder({ entry, stop, target, r }: { entry: number; stop: number; target: number; r: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 220;
  const lo = Math.min(stop, target);
  const hi = Math.max(stop, target);
  const pad = (hi - lo) * 0.08 || 1;
  const yOf = (p: number) => 10 + (1 - (p - (lo - pad)) / (hi - lo + 2 * pad)) * (height - 20);
  const x0 = 60;
  const x1 = Math.max(x0 + 40, width - 150);
  const line = (p: number, color: string, text: string) => (
    <g>
      <line x1={x0} x2={x1} y1={yOf(p)} y2={yOf(p)} stroke={color} strokeWidth={2} />
      <text x={x1 + 8} y={yOf(p)} dominantBaseline="middle" className="calc-mark-label">
        {text}
      </text>
      <text x={x0 - 6} y={yOf(p)} dominantBaseline="middle" textAnchor="end" className="calc-axis">
        {num(p)}
      </text>
    </g>
  );
  return (
    <div className="calc-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          <rect x={x0} width={x1 - x0} y={Math.min(yOf(entry), yOf(target))} height={Math.abs(yOf(entry) - yOf(target))} fill={UP} fillOpacity={0.18} />
          <rect x={x0} width={x1 - x0} y={Math.min(yOf(entry), yOf(stop))} height={Math.abs(yOf(entry) - yOf(stop))} fill={DOWN} fillOpacity={0.18} />
          <text x={(x0 + x1) / 2} y={(yOf(entry) + yOf(target)) / 2} textAnchor="middle" dominantBaseline="middle" className="calc-zone-label">
            +{num(r, 1)} R
          </text>
          <text x={(x0 + x1) / 2} y={(yOf(entry) + yOf(stop)) / 2} textAnchor="middle" dominantBaseline="middle" className="calc-zone-label">
            −1 R
          </text>
          {line(target, UP, `Ziel ${num(r, 1)}R`)}
          {line(entry, "#d1d4dc", "Einstieg")}
          {line(stop, DOWN, "Stop-Loss")}
        </svg>
      )}
    </div>
  );
}

/** Impulse A→B, pullback to C and the projected extension, with all Fibonacci levels. */
function FibChart({ a, b, c }: { a: number; b: number; c: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 300;
  const ret = fibRetracement(a, b);
  const ext = fibExtension(a, b, c);
  const prices = [a, b, c, ...ext.map((l) => l.price)];
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = (hi - lo) * 0.05 || 1;
  const yOf = (p: number) => 10 + (1 - (p - (lo - pad)) / (hi - lo + 2 * pad)) * (height - 20);
  const left = 56;
  const right = Math.max(left + 120, width - 118);
  const span = right - left;
  const xA = left + span * 0.04;
  const xB = left + span * 0.34;
  const xC = left + span * 0.5;
  const xT = left + span * 0.96;
  const t1618 = ext.find((l) => l.ratio === 1.618)!.price;
  return (
    <div className="calc-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          {niceTicks(lo - pad, hi + pad, 6).map((t) => (
            <g key={t}>
              <line x1={left} x2={right} y1={yOf(t)} y2={yOf(t)} className="calc-grid" />
              <text x={left - 6} y={yOf(t)} textAnchor="end" dominantBaseline="middle" className="calc-axis">
                {num(t, Math.abs(hi - lo) < 10 ? 2 : 0)}
              </text>
            </g>
          ))}
          {ret.map((l) => (
            <g key={`r${l.ratio}`}>
              <line x1={xA} x2={xC + 30} y1={yOf(l.price)} y2={yOf(l.price)} stroke={l.ratio === 0.618 ? GOLD : ACCENT} strokeOpacity={l.ratio === 0.618 ? 1 : 0.6} strokeWidth={l.ratio === 0.618 ? 2 : 1} />
            </g>
          ))}
          {ext.map((l) => (
            <g key={`e${l.ratio}`}>
              <line x1={xC} x2={right} y1={yOf(l.price)} y2={yOf(l.price)} stroke={UP} strokeOpacity={l.ratio === 1 ? 0.4 : 0.85} strokeDasharray={l.ratio === 1 ? "3 3" : undefined} />
              <text x={right + 6} y={yOf(l.price)} dominantBaseline="middle" className="calc-mark-label">
                {num(l.ratio, 3)} · {num(l.price)}
              </text>
            </g>
          ))}
          <path d={`M${xA},${yOf(a)} L${xB},${yOf(b)} L${xC},${yOf(c)}`} fill="none" stroke="#d1d4dc" strokeWidth={2} strokeLinejoin="round" />
          <path d={`M${xC},${yOf(c)} L${xT},${yOf(t1618)}`} fill="none" stroke={UP} strokeWidth={2} strokeDasharray="6 4" />
          {[
            [xA, a, "A"],
            [xB, b, "B"],
            [xC, c, "C"],
          ].map(([x, p, name]) => (
            <g key={name as string}>
              <circle cx={x as number} cy={yOf(p as number)} r={5} fill="#d1d4dc" stroke="#131722" strokeWidth={2} />
              <text x={(x as number) - 8} y={yOf(p as number) + (name === "B" ? -10 : 16)} className="calc-mark-label">
                {name}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export function CalculatorView({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState<Values>(load);
  const [helpOpen, setHelpOpen] = useState(() => {
    try {
      return localStorage.getItem(HELP_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggleHelp = () => {
    setHelpOpen((o) => {
      try {
        localStorage.setItem(HELP_KEY, o ? "0" : "1");
      } catch {
        // not remembered
      }
      return !o;
    });
  };
  const set = <K extends keyof Values>(k: K) => (value: Values[K]) => setV((s) => ({ ...s, [k]: value }));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {
      // not remembered
    }
  }, [v]);

  // 1. Position size
  const dist = Math.abs(v.entry - v.stop);
  const side = v.entry >= v.stop ? "long" : "short";
  const units = positionSize(v.risk, v.entry, v.stop);
  const posValue = units * v.entry;
  const target = targetPrice(v.entry, v.stop, v.rTarget);

  // 2. Expectancy
  const wr = v.winRate / 100;
  const exp = expectancy(wr, v.avgWin, v.avgLoss);
  const be = breakEvenWinRate(v.avgWin, v.avgLoss);
  const sims = useMemo(
    () => Array.from({ length: SIM_PATHS }, (_, i) => simulateTrades(Math.round(v.trades), wr, v.avgWin, v.avgLoss, v.seed * 1000 + i)),
    [v.trades, wr, v.avgWin, v.avgLoss, v.seed],
  );
  const main = sims[0];
  const finals = sims.map((s) => s.equity[s.equity.length - 1] * v.risk);
  const streakN = Math.min(10, Math.max(3, Math.round(main.longestLosingStreak)));
  const streakP = losingStreakProbability(streakN, Math.round(v.trades), wr);

  const expCurves: Series[] = useMemo(() => {
    const curve = (w: number) => Array.from({ length: 101 }, (_, i) => [i, expectancy(i / 100, w, v.avgLoss)] as [number, number]);
    const refs = [1, 2, 4].filter((w) => Math.abs(w - v.avgWin) > 0.05);
    return [
      ...refs.map((w) => ({ id: `r${w}`, points: curve(w), color: MUTED, width: 1, opacity: 0.6, endLabel: Math.abs(w - v.avgWin) > 0.5 ? `${w}R` : undefined })),
      { id: "cur", points: curve(v.avgWin), color: ACCENT, width: 2.5, label: `Ø Gewinn ${num(v.avgWin, 1)}R`, endLabel: `${num(v.avgWin, 1)}R` },
    ];
  }, [v.avgWin, v.avgLoss]);

  const equitySeries: Series[] = useMemo(() => {
    const toUsd = (eq: number[]) => eq.map((e, i) => [i, e * v.risk] as [number, number]);
    return [
      ...sims.slice(1).map((s, i) => ({ id: `s${i}`, points: toUsd(s.equity), color: ACCENT, width: 1, opacity: 0.18 })),
      { id: "exp", points: main.equity.map((_, i) => [i, exp * i * v.risk] as [number, number]), color: GOLD, width: 1.5, dash: "6 4", label: "Erwartet" },
      { id: "main", points: toUsd(main.equity), color: ACCENT, width: 2.5, label: "Simulation" },
    ];
  }, [sims, main, v.risk, v.trades, exp]);
  const eqAll = sims.flatMap((s) => s.equity).map((e) => e * v.risk);
  const eqLo = Math.min(0, ...eqAll, exp * v.trades * v.risk);
  const eqHi = Math.max(v.risk, ...eqAll, exp * v.trades * v.risk);

  // 4. Fibonacci
  const ret = fibRetracement(v.fibA, v.fibB);
  const ext = fibExtension(v.fibA, v.fibB, v.fibC);
  const impulse = v.fibB - v.fibA;

  // 5. Leverage
  const margin = requiredMargin(v.notional, v.leverage);
  const liq = v.leverage > 1 ? liquidationPrice(v.entry, v.leverage, side) : null;
  const liqBeforeStop = liq !== null && (side === "long" ? liq >= v.stop : liq <= v.stop);
  const levCurve: Series[] = useMemo(
    () => [{ id: "m", points: Array.from({ length: 125 }, (_, i) => [i + 1, requiredMargin(v.notional, i + 1)] as [number, number]), color: ACCENT, label: "Margin" }],
    [v.notional],
  );

  const xPct = (x: number) => `${num(x, 0)} %`;

  return (
    <div className="heatmap-view calc-view">
      <div className="heatmap-head">
        <strong>Trading-Rechner</strong>
        <span className="heatmap-symbol">Positionsgröße · Erwartungswert · R-Multiple · Fibonacci · Hebel</span>
        <div className="spacer" />
        <button className={helpOpen ? "active" : ""} onClick={toggleHelp} data-tip="Alle Erklärungen ein- oder ausklappen">
          💡 Erklärungen {helpOpen ? "aus" : "ein"}
        </button>
        <button onClick={() => setV(DEFAULTS)} data-tip="Alle Werte auf die Beispiele aus den Quellen zurücksetzen">
          ↺ Beispielwerte
        </button>
        <button className="pill" onClick={onClose} data-tip="Zurück zum Chart">
          ✕ Chart
        </button>
      </div>

      <div className="calc-body">
        <p className="calc-intro">
          Day-Trading als mathematisches System: Jeder Trade riskiert genau <strong>1 R</strong> (hier {usd(v.risk, 0)}). Alle Felder sind editierbar,
          Werte werden im Browser gespeichert. Das Risiko pro Trade gilt für alle Rechner.
        </p>
        <div className="calc-basics">
          <HelpBox help={BASICS} allOpen={helpOpen} title="Grundidee: Was ist 1 R?" />
        </div>

        <div className="calc-grid-cards">
          <Card n={1} title="Positionsgröße" help={HELP.position} helpOpen={helpOpen} formula={<>Positionsgröße = Risiko ÷ |Einstieg − Stop-Loss|</>}>
            <div className="calc-examples">
              <span>Beispiele:</span>
              <button onClick={() => setV((s) => ({ ...s, entry: 135.5, stop: 130, risk: 100 }))}>135,50 / 130,00</button>
              <button onClick={() => setV((s) => ({ ...s, entry: 153.52, stop: 150.52, risk: 100 }))}>153,52 / 150,52</button>
            </div>
            <div className="calc-inputs">
              <NumInput label="Einstiegspreis" value={v.entry} onChange={set("entry")} unit="$" min={0} />
              <NumInput label="Stop-Loss" value={v.stop} onChange={set("stop")} unit="$" min={0} />
              <NumInput label="Risiko pro Trade (1 R)" value={v.risk} onChange={set("risk")} unit="$" min={0} hint="Gilt für alle Rechner" />
            </div>
            <div className="calc-stats">
              <Stat big label="Positionsgröße" value={dist > 0 ? `${num(units)} Einheiten` : "Stop = Einstieg"} tone="gold" />
              <Stat label="Richtung" value={side === "long" ? "Long ▲" : "Short ▼"} tone={side === "long" ? "up" : "down"} />
              <Stat label="Stop-Abstand" value={`${usd(dist)} (${pct(dist / v.entry, 2)})`} />
              <Stat label="Positionswert" value={usd(posValue)} />
              <Stat label={`Ziel bei ${num(v.rTarget, 1)}R`} value={usd(target)} tone="up" />
            </div>
            {dist > 0 && <PriceLadder entry={v.entry} stop={v.stop} target={target} r={v.rTarget} />}
          </Card>

          <Card
            n={2}
            title="Erwartungswert (Edge)" help={HELP.expectancy} helpOpen={helpOpen}
            formula={<>E = Trefferquote × Ø Gewinn (R) − Verlustquote × Ø Verlust (R)</>}
          >
            <div className="calc-inputs">
              <NumInput label="Trefferquote" value={v.winRate} onChange={set("winRate")} unit="%" min={0} max={100} step={1} />
              <NumInput label="Ø Gewinn pro Win" value={v.avgWin} onChange={set("avgWin")} unit="R" min={0} max={15} step={0.1} />
              <NumInput label="Ø Verlust pro Loss" value={v.avgLoss} onChange={set("avgLoss")} unit="R" min={0} />
              <NumInput label="Risiko pro Trade (1 R)" value={v.risk} onChange={set("risk")} unit="$" min={0} />
            </div>
            <div className="calc-calc">
              ({num(wr)} × {num(v.avgWin, 1)}R) − ({num(1 - wr)} × {num(v.avgLoss, 1)}R) = {num(wr * v.avgWin)}R − {num((1 - wr) * v.avgLoss)}R ={" "}
              <strong className={exp >= 0 ? "up" : "down"}>{signed(exp)} R</strong>
            </div>
            <div className="calc-stats">
              <Stat big label="Erwartungswert pro Trade" value={`${signed(exp)} R = ${signed(exp * v.risk)} $`} tone={exp >= 0 ? "up" : "down"} />
              <Stat label="Verlustquote" value={pct(1 - wr, 0)} />
              <Stat label="Break-even-Trefferquote" value={pct(be)} />
              <Stat label={`Erwartet nach ${Math.round(v.trades)} Trades`} value={`${signed(exp * v.trades * v.risk, 0)} $`} tone={exp >= 0 ? "up" : "down"} />
            </div>
            <div className="calc-chart-title">Erwartungswert je Trade (R) abhängig von der Trefferquote</div>
            <LineChart
              series={expCurves}
              xDomain={[0, 100]}
              yDomain={[-v.avgLoss, Math.max(4, Math.min(15, v.avgWin))]}
              xFmt={xPct}
              yFmt={(y) => `${num(y, 1)}R`}
              xTitle="Trefferquote"
              hLines={[{ value: 0, label: "Break-even" }]}
              vLines={[{ value: be * 100, label: `${num(be * 100, 1)} %`, color: GOLD }]}
              markers={[{ x: v.winRate, y: exp, color: exp >= 0 ? UP : DOWN, label: `${signed(exp)}R` }]}
            />
          </Card>

          <Card n="2b" title="Simulation einer Trade-Serie" help={HELP.simulation} helpOpen={helpOpen} formula={<>{SIM_PATHS} zufällige Serien mit Trefferquote {num(v.winRate, 0)} %, +{num(v.avgWin, 1)}R / −{num(v.avgLoss, 1)}R</>}>
            <div className="calc-inputs">
              <NumInput label="Anzahl Trades" value={v.trades} onChange={(x) => set("trades")(Math.round(x))} min={1} max={500} step={1} />
              <label className="calc-field">
                <span>Zufall</span>
                <button className="pill calc-dice" onClick={() => set("seed")(v.seed + 1)} data-tip="Neue zufällige Serien erzeugen">
                  🎲 Neu würfeln
                </button>
              </label>
            </div>
            <div className="calc-stats">
              <Stat big label="Ergebnis hervorgehobene Serie" value={`${signed(finals[0], 0)} $`} tone={finals[0] >= 0 ? "up" : "down"} />
              <Stat label="Gewinner" value={`${main.wins} von ${Math.round(v.trades)} (${pct(main.wins / Math.max(1, v.trades), 0)})`} />
              <Stat label="Max. Drawdown" value={`−${num(main.maxDrawdown, 1)}R = −${usd(main.maxDrawdown * v.risk, 0)}`} tone="down" />
              <Stat label="Längste Verlustserie" value={`${main.longestLosingStreak} Trades`} />
              <Stat label={`Chance auf ≥ ${streakN} Verluste in Folge`} value={pct(streakP)} />
              <Stat label={`Spanne aller ${SIM_PATHS} Serien`} value={`${signed(Math.min(...finals), 0)} … ${signed(Math.max(...finals), 0)} $`} />
              <Stat label="Serien im Plus" value={`${finals.filter((f) => f > 0).length} von ${SIM_PATHS}`} />
            </div>
            <div className="calc-chart-title">Equity-Kurve in $ (blau: Simulation, gelb gestrichelt: Erwartungswert)</div>
            <LineChart
              series={equitySeries}
              xDomain={[0, Math.round(v.trades)]}
              yDomain={[eqLo, eqHi]}
              xFmt={(x) => `Trade ${num(x, 0)}`}
              yFmt={(y) => num(y, 0)}
              xTitle="Trade-Nummer"
              hLines={[{ value: 0 }]}
              integerX
              height={260}
            />
          </Card>

          <Card n={3} title="R-Multiple & Gewinn" help={HELP.rmultiple} helpOpen={helpOpen} formula={<>Gewinn = R-Multiple × Risiko · Zielpreis = Einstieg + R × (Einstieg − Stop)</>}>
            <div className="calc-inputs">
              <NumInput label="Take-Profit (R-Multiple)" value={v.rTarget} onChange={set("rTarget")} unit="R" min={0.5} max={15} step={0.5} hint={"Standard: 1:4 (4R)\n15-Minuten-Struktur: 8R bis 15R"} />
              <NumInput label="Risiko pro Trade (1 R)" value={v.risk} onChange={set("risk")} unit="$" min={0} />
            </div>
            <div className="calc-stats">
              <Stat big label={`Gewinn bei 1:${num(v.rTarget, 1)}`} value={usd(v.rTarget * v.risk, 0)} tone="up" />
              <Stat label="Zielpreis (Einstieg/Stop aus 1)" value={usd(target)} />
              <Stat label="Break-even-Trefferquote" value={pct(breakEvenWinRate(v.rTarget, 1))} />
            </div>
            <div className="calc-chart-title">Gewinn in $ je R-Multiple (Balken antippen zum Übernehmen)</div>
            <BarChart
              bars={R_STEPS.map((r) => ({ label: `${r}R`, value: r * v.risk, active: r === v.rTarget }))}
              fmt={(x) => num(x, 0)}
              onPick={(i) => set("rTarget")(R_STEPS[i])}
            />
          </Card>

          <Card n={4} title="Fibonacci" help={HELP.fibonacci} helpOpen={helpOpen} formula={<>Retracement = B − Stufe × (B − A) · Extension = C + Faktor × (B − A)</>}>
            <div className="calc-inputs">
              <NumInput label="A: Impuls-Start" value={v.fibA} onChange={set("fibA")} unit="$" />
              <NumInput label="B: Impuls-Ende" value={v.fibB} onChange={set("fibB")} unit="$" />
              <NumInput label="C: Rücklauf" value={v.fibC} onChange={set("fibC")} unit="$" hint="Tiefpunkt der Korrektur, von dem aus die Extension gemessen wird" />
            </div>
            <div className="calc-examples">
              <span>C setzen auf:</span>
              {[0.382, 0.5, 0.618].map((r) => (
                <button key={r} onClick={() => set("fibC")(+(v.fibB - r * impulse).toFixed(4))}>
                  {num(r * 100, 1)} %
                </button>
              ))}
            </div>
            <div className="calc-stats">
              <Stat label="Impulsspanne (B − A)" value={`${signed(impulse)} $ (${impulse >= 0 ? "aufwärts" : "abwärts"})`} />
              <Stat label="C liegt bei" value={impulse !== 0 ? `${num(((v.fibB - v.fibC) / impulse) * 100, 1)} % Retracement` : "–"} />
            </div>
            <div className="calc-fib-tables">
              <table className="calc-table">
                <thead>
                  <tr>
                    <th>Retracement</th>
                    <th>Preis</th>
                  </tr>
                </thead>
                <tbody>
                  {ret.map((l) => (
                    <tr key={l.ratio} className={l.ratio === 0.618 ? "gold" : undefined}>
                      <td>
                        {num(l.ratio * 100, 1)} %{l.ratio === 0.618 && " ★"}
                      </td>
                      <td>{num(l.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="calc-table">
                <thead>
                  <tr>
                    <th>Extension</th>
                    <th>Ziel</th>
                  </tr>
                </thead>
                <tbody>
                  {ext.map((l) => (
                    <tr key={l.ratio}>
                      <td>{num(l.ratio, 3)} ×</td>
                      <td className="up">{num(l.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <FibChart a={v.fibA} b={v.fibB} c={v.fibC} />
            <div className="calc-note">
              ★ 61,8 % = Golden Ratio. Stufen: {FIB_RETRACEMENTS.slice(1, -1).map((r) => `${num(r * 100, 1)} %`).join(", ")}. Ziele: {FIB_EXTENSIONS.slice(1).map((r) => num(r, 3)).join(" / ")} × Impulsspanne.
            </div>
          </Card>

          <Card n={5} title="Hebel & Margin" help={HELP.leverage} helpOpen={helpOpen} formula={<>Benötigtes Kapital (Margin) = Positionswert ÷ Hebel</>}>
            <div className="calc-inputs">
              <NumInput label="Positionswert" value={v.notional} onChange={set("notional")} unit="$" min={0} />
              <NumInput label="Hebel" value={v.leverage} onChange={set("leverage")} unit="x" min={1} max={125} step={1} />
            </div>
            <div className="calc-examples">
              <span>Positionswert:</span>
              <button onClick={() => set("notional")(29000)}>Beispiel 29.000 $</button>
              <button onClick={() => set("notional")(+posValue.toFixed(2))} disabled={!(posValue > 0)}>
                aus Rechner 1 ({usd(posValue, 0)})
              </button>
            </div>
            <div className="calc-stats">
              <Stat big label="Benötigte Margin" value={usd(margin)} tone="gold" />
              <Stat label="Margin in % des Positionswerts" value={pct(1 / v.leverage, 2)} />
              {liq !== null && <Stat label={`Liquidation ca. (${side === "long" ? "Long" : "Short"} ab ${num(v.entry)})`} value={usd(liq)} tone="down" />}
              {liq !== null && <Stat label="Abstand bis Liquidation" value={pct(Math.abs(v.entry - liq) / v.entry, 2)} />}
            </div>
            {liqBeforeStop && <div className="calc-warn">⚠ Bei {num(v.leverage, 0)}x Hebel liegt die Liquidation vor deinem Stop-Loss ({num(v.stop)}). Hebel senken oder Stop enger setzen.</div>}
            <div className="calc-chart-title">Benötigte Margin in $ je Hebel</div>
            <LineChart
              series={levCurve}
              xDomain={[1, 125]}
              yDomain={[0, v.notional]}
              xFmt={(x) => `${num(x, 0)}x`}
              yFmt={(y) => num(y, 0)}
              xTitle="Hebel"
              integerX
              markers={[{ x: v.leverage, y: margin, color: GOLD, label: usd(margin, 0) }]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
