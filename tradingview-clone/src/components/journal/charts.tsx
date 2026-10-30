import { useWidth } from "../CalcCharts";
import { DOWN, GREY, UP } from "./format";

export interface SignedBar {
  label: string;
  value: number;
  sub?: string;
}

/** Bars up (green) or down (red) from a zero line, value on each bar. */
export function SignedBars({ bars, fmt, height = 200, onPick }: { bars: SignedBar[]; fmt: (v: number) => string; height?: number; onPick?: (i: number) => void }) {
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
  const labelEvery = Math.max(1, Math.ceil(36 / Math.max(1, slot)));
  return (
    <div className="calc-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          <line x1={0} x2={width} y1={zero} y2={zero} stroke={GREY} strokeWidth={1} />
          {bars.map((b, i) => {
            const h = Math.max(1, (Math.abs(b.value) / span) * plotH);
            const x = i * slot + (slot - bw) / 2;
            const y = b.value >= 0 ? zero - h : zero;
            return (
              <g key={i} className={onPick ? "calc-bar-hit" : undefined} onClick={() => onPick?.(i)}>
                <title>{`${b.label}${b.sub ? ` · ${b.sub}` : ""}: ${fmt(b.value)}`}</title>
                <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
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

/** Half ring: share of winners (green), break-even (grey) and losers (red). */
export function WinGauge({ wins, even, losses, size = 92 }: { wins: number; even: number; losses: number; size?: number }) {
  const total = wins + even + losses;
  const r = size / 2 - 7;
  const cx = size / 2;
  const cy = size / 2;
  const arc = (from: number, to: number) => {
    // Angles along the upper half, from the left (π) to the right (0).
    const a0 = Math.PI - from * Math.PI;
    const a1 = Math.PI - to * Math.PI;
    return `M${cx + r * Math.cos(a0)},${cy - r * Math.sin(a0)} A${r},${r} 0 0 1 ${cx + r * Math.cos(a1)},${cy - r * Math.sin(a1)}`;
  };
  const parts = total
    ? [
        { v: wins / total, c: UP },
        { v: even / total, c: GREY },
        { v: losses / total, c: DOWN },
      ]
    : [{ v: 1, c: GREY }];
  let at = 0;
  return (
    <svg width={size} height={size / 2 + 6} className="jz-gauge" aria-hidden>
      {parts.map((p, i) => {
        const d = p.v > 0 ? arc(at, Math.min(1, at + p.v)) : "";
        at += p.v;
        return d ? <path key={i} d={d} stroke={p.c} strokeWidth={9} fill="none" strokeLinecap="butt" opacity={total ? 1 : 0.35} /> : null;
      })}
    </svg>
  );
}

/** Two bars side by side: average win (green) against average loss (red). */
export function RatioBar({ win, loss }: { win: number; loss: number }) {
  const total = win + loss;
  const w = total > 0 ? (win / total) * 100 : 50;
  return (
    <div className="jz-ratio" aria-hidden>
      <span style={{ width: `${w}%`, background: UP }} />
      <span style={{ width: `${100 - w}%`, background: DOWN }} />
    </div>
  );
}

/** Six-axis radar for the performance score parts (0–100 each). */
export function Radar({ parts, size = 220 }: { parts: { label: string; score: number }[]; size?: number }) {
  // Wider than tall: room for the labels left and right.
  const w = size + 90;
  const cx = w / 2;
  const cy = size / 2;
  const r = size / 2 - 28;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / parts.length;
    return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v] as const;
  };
  const ring = (v: number) => parts.map((_, i) => pt(i, v).join(",")).join(" ");
  return (
    <svg width={w} height={size} viewBox={`0 0 ${w} ${size}`} style={{ maxWidth: "100%" }} className="jz-radar" role="img" aria-label="Score-Netz">
      {[0.25, 0.5, 0.75, 1].map((v) => (
        <polygon key={v} points={ring(v)} fill="none" stroke="var(--border)" />
      ))}
      {parts.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" />;
      })}
      <polygon points={parts.map((p, i) => pt(i, p.score / 100).join(",")).join(" ")} fill="rgba(41,98,255,0.28)" stroke="#5b8cff" strokeWidth={2} />
      {parts.map((p, i) => {
        const [x, y] = pt(i, 1.2);
        return (
          <text key={p.label} x={x} y={y} textAnchor={Math.abs(x - cx) < 4 ? "middle" : x < cx ? "end" : "start"} dominantBaseline="middle" className="calc-axis jz-radar-label">
            {p.label}
          </text>
        );
      })}
    </svg>
  );
}

/** Tiny cumulative line for a day card; green above zero, red below. */
export function Sparkline({ values, width = 150, height = 44 }: { values: number[]; width?: number; height?: number }) {
  const pts = [0, ...values];
  const lo = Math.min(0, ...pts);
  const hi = Math.max(0, ...pts);
  const span = hi - lo || 1;
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * (width - 4) + 2;
  const y = (v: number) => 3 + (1 - (v - lo) / span) * (height - 6);
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="jz-spark" aria-hidden>
      <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={GREY} strokeDasharray="3 3" strokeWidth={1} />
      <polyline points={pts.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={last >= 0 ? UP : DOWN} strokeWidth={2} />
    </svg>
  );
}
