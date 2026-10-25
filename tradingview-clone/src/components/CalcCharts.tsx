import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// Small SVG charts for the calculator page: thin lines, recessive grid, crosshair + tooltip.

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function niceTicks(lo: number, hi: number, target: number): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => (hi - lo) / s <= target) ?? mag * 10;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

export interface Series {
  id: string;
  points: [number, number][];
  color: string;
  width?: number;
  dash?: string;
  opacity?: number;
  /** Shown in the tooltip under this name; series without a label are background context. */
  label?: string;
  /** Direct label at the right end of the line. */
  endLabel?: string;
}

export interface Marker {
  x: number;
  y: number;
  color: string;
  label?: string;
}

export interface RefLine {
  value: number;
  label?: string;
  color?: string;
}

interface LineChartProps {
  series: Series[];
  xDomain: [number, number];
  yDomain: [number, number];
  xFmt: (v: number) => string;
  /** Tooltip heading for an x value (defaults to xFmt). */
  xTipFmt?: (v: number) => string;
  yFmt: (v: number) => string;
  xTitle?: string;
  height?: number;
  markers?: Marker[];
  hLines?: RefLine[];
  vLines?: RefLine[];
  /** Snap the crosshair to integer x values (e.g. trade numbers). */
  integerX?: boolean;
}

const PAD = { l: 58, r: 46, t: 12, b: 34 };

export function LineChart({ series, xDomain, yDomain, xFmt, xTipFmt = xFmt, yFmt, xTitle, height = 240, markers = [], hLines = [], vLines = [], integerX }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = height - PAD.t - PAD.b;
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const xOf = (x: number) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * plotW;
  const yOf = (y: number) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * plotH;
  const clipId = useId();
  const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${xOf(x).toFixed(1)},${yOf(y).toFixed(1)}`).join("");

  const labelled = series.filter((s) => s.label);
  const nearest = (s: Series, x: number) => s.points.reduce((best, p) => (Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best), s.points[0]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let x = x0 + ((e.clientX - rect.left) / rect.width) * (x1 - x0);
    if (integerX) x = Math.round(x);
    setHoverX(Math.max(x0, Math.min(x1, x)));
  };

  let tooltip: ReactNode = null;
  if (hoverX !== null && labelled.length && width > 0) {
    const rows = labelled.map((s) => ({ s, p: nearest(s, hoverX) })).filter((r) => r.p);
    const hx = xOf(hoverX);
    const left = hx + 170 > width ? hx - 170 : hx + 12;
    tooltip = (
      <div className="calc-tip" style={{ left: Math.max(0, left), top: PAD.t }}>
        <div className="calc-tip-head">{xTipFmt(hoverX)}</div>
        {rows.map(({ s, p }) => (
          <div key={s.id} className="calc-tip-row">
            <span className="calc-swatch" style={{ background: s.color }} />
            <span>{s.label}</span>
            <strong>{yFmt(p[1])}</strong>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="calc-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img">
          {niceTicks(y0, y1, Math.max(3, plotH / 44)).map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.l} x2={PAD.l + plotW} y1={yOf(t)} y2={yOf(t)} className="calc-grid" />
              <text x={PAD.l - 6} y={yOf(t)} className="calc-axis" textAnchor="end" dominantBaseline="middle">
                {yFmt(t)}
              </text>
            </g>
          ))}
          {niceTicks(x0, x1, Math.max(3, plotW / 70)).map((t) => (
            <text key={`x${t}`} x={xOf(t)} y={PAD.t + plotH + 14} className="calc-axis" textAnchor="middle">
              {xFmt(t)}
            </text>
          ))}
          {xTitle && (
            <text x={PAD.l + plotW / 2} y={height - 3} className="calc-axis" textAnchor="middle">
              {xTitle}
            </text>
          )}
          {hLines.map((l, i) => (
            <g key={`h${i}`}>
              <line x1={PAD.l} x2={PAD.l + plotW} y1={yOf(l.value)} y2={yOf(l.value)} stroke={l.color ?? "#787b86"} strokeWidth={1} />
              {l.label && (
                <text x={PAD.l + 4} y={yOf(l.value) - 4} className="calc-axis">
                  {l.label}
                </text>
              )}
            </g>
          ))}
          {vLines.map((l, i) => (
            <g key={`v${i}`}>
              <line x1={xOf(l.value)} x2={xOf(l.value)} y1={PAD.t} y2={PAD.t + plotH} stroke={l.color ?? "#787b86"} strokeDasharray="3 3" />
              {l.label && (
                <text x={xOf(l.value) + 4} y={PAD.t + 10} className="calc-axis">
                  {l.label}
                </text>
              )}
            </g>
          ))}
          <clipPath id={clipId}>
            <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} />
          </clipPath>
          {series.map((s) => (
            <path key={s.id} clipPath={`url(#${clipId})`} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} strokeOpacity={s.opacity ?? 1} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series
            .filter((s) => s.endLabel && s.points.length && s.points[s.points.length - 1][1] <= y1 && s.points[s.points.length - 1][1] >= y0)
            .map((s) => {
              const [x, y] = s.points[s.points.length - 1];
              return (
                <text key={`e${s.id}`} x={xOf(x) + 4} y={yOf(y)} className="calc-axis" dominantBaseline="middle">
                  {s.endLabel}
                </text>
              );
            })}
          {markers.map((m, i) => (
            <g key={`m${i}`}>
              <circle cx={xOf(m.x)} cy={yOf(m.y)} r={5} fill={m.color} stroke="#131722" strokeWidth={2} />
              {m.label && (
                <text x={xOf(m.x) + 8} y={yOf(m.y) - 8} className="calc-mark-label">
                  {m.label}
                </text>
              )}
            </g>
          ))}
          {hoverX !== null &&
            labelled.map((s) => {
              const p = nearest(s, hoverX);
              return p ? <circle key={`hp${s.id}`} cx={xOf(p[0])} cy={yOf(p[1])} r={4} fill={s.color} stroke="#131722" strokeWidth={2} /> : null;
            })}
          {hoverX !== null && <line x1={xOf(hoverX)} x2={xOf(hoverX)} y1={PAD.t} y2={PAD.t + plotH} stroke="rgba(255,255,255,0.35)" strokeDasharray="4 4" />}
          <rect
            x={PAD.l}
            y={PAD.t}
            width={plotW}
            height={plotH}
            fill="transparent"
            style={{ touchAction: "pan-y" }}
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHoverX(null)}
          />
        </svg>
      )}
      {tooltip}
    </div>
  );
}

export interface Bar {
  label: string;
  value: number;
  active?: boolean;
}

/** Vertical bars from a zero baseline, value label on top of each bar. */
export function BarChart({ bars, fmt, height = 200, onPick }: { bars: Bar[]; fmt: (v: number) => string; height?: number; onPick?: (i: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const top = 20;
  const bottom = 22;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const slot = width / Math.max(1, bars.length);
  const bw = Math.min(44, slot - 8);
  const plotH = height - top - bottom;
  return (
    <div className="calc-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          <line x1={0} x2={width} y1={top + plotH} y2={top + plotH} className="calc-grid" />
          {bars.map((b, i) => {
            const h = Math.max(1, (b.value / max) * plotH);
            const x = i * slot + (slot - bw) / 2;
            return (
              <g key={b.label} className={onPick ? "calc-bar-hit" : undefined} onClick={() => onPick?.(i)}>
                <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
                <path
                  d={`M${x},${top + plotH} V${top + plotH - h + 4} Q${x},${top + plotH - h} ${x + 4},${top + plotH - h} H${x + bw - 4} Q${x + bw},${top + plotH - h} ${x + bw},${top + plotH - h + 4} V${top + plotH} Z`}
                  fill={b.active ? "#26a69a" : "rgba(38,166,154,0.35)"}
                />
                <text x={x + bw / 2} y={top + plotH - h - 5} textAnchor="middle" className={b.active ? "calc-mark-label" : "calc-axis"}>
                  {fmt(b.value)}
                </text>
                <text x={x + bw / 2} y={height - 6} textAnchor="middle" className="calc-axis">
                  {b.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
