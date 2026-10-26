import { useEffect, useState } from "react";
import { isValidPosition, positionStats, type PositionInput } from "../../shared/position";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { removeDrawing, updateDrawing, useChartState } from "../store";

const DEFAULTS_KEY = "chartai.position.v1";

type Defaults = Pick<PositionInput, "account" | "risk" | "leverage" | "riskCash">;

/** Account size, risk and leverage of the last edited position, used for new ones. */
export function lastPositionDefaults(): Defaults {
  try {
    const saved = JSON.parse(localStorage.getItem(DEFAULTS_KEY) ?? "{}") as Partial<Defaults>;
    return { account: saved.account ?? 10000, risk: saved.risk ?? 1, leverage: saved.leverage ?? 1, riskCash: saved.riskCash ?? 0 };
  } catch {
    return { account: 10000, risk: 1, leverage: 1, riskCash: 0 };
  }
}

function saveDefaults(d: Defaults) {
  try {
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d));
  } catch {
    // not remembered
  }
}

/** Number input that keeps the typed text while editing and only commits valid numbers. */
function NumField({ label, value, onChange, step, min }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  const [text, setText] = useState(String(+value.toPrecision(10)));
  useEffect(() => setText(String(+value.toPrecision(10))), [value]);
  return (
    <label>
      {label}
      <input
        type="number"
        inputMode="decimal"
        value={text}
        step={step ?? "any"}
        min={min}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value.replace(",", "."));
          if (e.target.value !== "" && Number.isFinite(v) && (min === undefined || v >= min)) onChange(v);
        }}
      />
    </label>
  );
}

const money = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const pct = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 2 })} %`;
const qtyFmt = (v: number) => v.toLocaleString("de-DE", { maximumSignificantDigits: 6 });

const STATUS_TEXT = {
  invalid: "Ungültig: Stop und Ziel müssen auf verschiedenen Seiten des Einstiegs liegen",
  running: "Läuft",
  target: "Ziel erreicht",
  stop: "Stop ausgelöst",
  expired: "Zeitspanne abgelaufen",
};

export function PositionDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useChartState((s) => s.drawings.find((x) => x.id === id));
  const bars = useChartState((s) => s.bars);
  if (!d || d.kind !== "position") return null;
  const stats = positionStats(d, bars);
  const patch = (p: Partial<PositionInput>) => {
    updateDrawing(id, { ...p, ...(p.side ? { color: p.side === "long" ? "#089981" : "#f23645" } : {}) });
    if (p.account !== undefined || p.risk !== undefined || p.leverage !== undefined || p.riskCash !== undefined) {
      saveDefaults({ account: p.account ?? d.account, risk: p.risk ?? d.risk, leverage: p.leverage ?? d.leverage, riskCash: p.riskCash ?? d.riskCash ?? 0 });
    }
  };
  const flip = (side: "long" | "short") => {
    if (side === d.side) return;
    // Mirror stop and target around the entry so the position stays valid.
    patch({ side, stop: 2 * d.entry - d.stop, target: 2 * d.entry - d.target });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{d.side === "long" ? "Long-Position" : "Short-Position"}</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="segmented">
          <button className={d.side === "long" ? "active long" : ""} onClick={() => flip("long")}>
            Long
          </button>
          <button className={d.side === "short" ? "active short" : ""} onClick={() => flip("short")}>
            Short
          </button>
        </div>
        <div className="settings-grid">
          <NumField label="Einstieg" value={d.entry} onChange={(entry) => patch({ entry })} min={0} />
          <NumField label="Stop-Loss" value={d.stop} onChange={(stop) => patch({ stop })} min={0} />
          <NumField label="Take-Profit" value={d.target} onChange={(target) => patch({ target })} min={0} />
          <NumField label="Hebel ×" value={d.leverage} onChange={(leverage) => patch({ leverage: Math.max(1, leverage) })} step={1} min={1} />
          <NumField label="Kontogröße" value={d.account} onChange={(account) => patch({ account })} min={0} />
          {/* Either sets the risk: a percentage of the account, or a fixed amount (0 = use the percentage). */}
          <NumField label="Risiko %" value={d.riskCash ? (d.riskCash / Math.max(d.account, 1e-9)) * 100 : d.risk} onChange={(risk) => patch({ risk, riskCash: 0 })} step={0.1} min={0} />
          <NumField label="Risiko fest (Betrag)" value={d.riskCash ?? 0} onChange={(riskCash) => patch({ riskCash })} step={10} min={0} />
        </div>
        <dl className={`position-stats ${isValidPosition(d) ? "" : "invalid"}`}>
          <dt>Chance/Risiko</dt>
          <dd>
            <strong>{stats.rr.toLocaleString("de-DE", { maximumFractionDigits: 2 })} : 1</strong>
          </dd>
          <dt>Ziel</dt>
          <dd className="up">
            +{pct(stats.rewardPct)} · +{money(stats.rewardAmount)}
          </dd>
          <dt>Risiko</dt>
          <dd className="down">
            −{pct(stats.riskPct)} · −{money(stats.riskAmount)}
          </dd>
          <dt>Menge</dt>
          <dd>{qtyFmt(stats.qty)}</dd>
          <dt>Positionswert</dt>
          <dd>{money(stats.notional)}</dd>
          <dt>Marge</dt>
          <dd className={stats.margin > d.account ? "down" : ""}>
            {money(stats.margin)}
            {stats.margin > d.account ? " (mehr als das Konto)" : ""}
          </dd>
          {stats.liqPrice !== null && (
            <>
              <dt>Liquidation</dt>
              <dd className={stats.liqBeforeStop ? "down" : ""}>
                ≈ {formatPrice(stats.liqPrice)}
                {stats.liqBeforeStop ? " – vor dem Stop!" : ""}
              </dd>
            </>
          )}
          <dt>Status</dt>
          <dd>
            {STATUS_TEXT[stats.status]}
            {stats.status !== "invalid" && stats.exitPrice !== null && (
              <span className={stats.pnl >= 0 ? "up" : "down"}>
                {" "}
                · {stats.pnl >= 0 ? "+" : "−"}
                {money(Math.abs(stats.pnl))}
              </span>
            )}
          </dd>
        </dl>
        <p className="hint">Menge = Risiko ÷ Abstand zum Stop; Risiko = fester Betrag oder Kontogröße × Risiko %. Gebühren und Funding sind nicht berücksichtigt; die Liquidation ist eine Schätzung (Isolated, 0,5 % Wartungsmarge).</p>
        <div className="dialog-actions">
          <button
            className="danger"
            onClick={() => {
              removeDrawing(id);
              onClose();
            }}
          >
            Löschen
          </button>
          <button className="primary" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
