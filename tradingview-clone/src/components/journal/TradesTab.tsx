import { useMemo, useState } from "react";
import { sortTrades, tradePnl, tradeR, type JournalTrade } from "../../../shared/journal";
import { fmtDate, num, signed, tone, type JournalApi } from "./format";

type SortKey = "date" | "pnl" | "r" | "symbol";

/** The list of all trades: search, quick filters, sorting; a row opens the trade. */
export function TradesTab({ api, shown }: { api: JournalApi; shown: JournalTrade[] }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<"" | "win" | "loss">("");
  const [side, setSide] = useState<"" | "long" | "short">("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "date", desc: true });
  const pbName = (id?: string) => api.playbooks.find((p) => p.id === id)?.name;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = sortTrades(shown).filter((t) => {
      const p = tradePnl(t);
      if (result === "win" && !(p > 0)) return false;
      if (result === "loss" && !(p < 0)) return false;
      if (side && t.side !== side) return false;
      if (!needle) return true;
      return [t.symbol, t.setup, t.note, pbName(t.playbook), ...(t.tags ?? []), ...(t.mistakes ?? [])].some((s) => s?.toLowerCase().includes(needle));
    });
    const val = (t: JournalTrade): number | string => (sort.key === "pnl" ? tradePnl(t) : sort.key === "r" ? (tradeR(t) ?? -Infinity) : sort.key === "symbol" ? t.symbol : "");
    // Date order is the stored order; reversed for newest first.
    const sorted = sort.key === "date" ? list : [...list].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0));
    return sort.desc ? [...sorted].reverse() : sorted;
  }, [shown, q, result, side, sort, api.playbooks]);

  const total = rows.reduce((a, t) => a + tradePnl(t), 0);
  const th = (key: SortKey, label: string) => (
    <th className="jz-sort" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>
      {label}
      {sort.key === key ? (sort.desc ? " ▾" : " ▴") : ""}
    </th>
  );

  return (
    <section className="calc-card">
      <div className="jz-bar">
        <input className="jr-select jz-search" type="search" placeholder="Suchen: Symbol, Tag, Fehler, Notiz …" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="jr-seg">
          {(
            [
              ["", "Alle"],
              ["win", "Gewinner"],
              ["loss", "Verlierer"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={result === k ? "active" : ""} onClick={() => setResult(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="jr-seg">
          {(
            [
              ["", "Beide"],
              ["long", "Long"],
              ["short", "Short"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={side === k ? "active" : ""} onClick={() => setSide(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="jr-muted">
          {rows.length} Trades · <strong className={tone(total)}>{signed(total)} $</strong>
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="jr-empty">Keine Trades für diese Auswahl.</div>
      ) : (
        <div className="jr-table-wrap">
          <table className="calc-table jz-table">
            <thead>
              <tr>
                {th("date", "Datum")}
                <th>Zeit</th>
                {th("symbol", "Symbol")}
                <th>Richtung</th>
                <th>Einstieg</th>
                <th>Ausstieg</th>
                {th("pnl", "Ergebnis")}
                {th("r", "R")}
                <th>Playbook / Setup</th>
                <th>Tags · Fehler</th>
                <th>★</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const p = tradePnl(t);
                const r = tradeR(t);
                const manual = t.pnl !== undefined;
                return (
                  <tr key={t.id} className="jz-click" onClick={() => api.openTrade(t.id)}>
                    <td>{fmtDate(t.date)}</td>
                    <td>{t.time ?? "–"}</td>
                    <td>{t.symbol || "–"}</td>
                    <td className={t.side === "long" ? "up" : "down"}>{t.side === "long" ? "Long" : "Short"}</td>
                    <td>{manual && !t.entry ? "–" : num(t.entry)}</td>
                    <td>{manual && !t.exit ? "–" : num(t.exit)}</td>
                    <td className={tone(p)}>{signed(p)} $</td>
                    <td className={r === null ? undefined : tone(r)}>{r === null ? "–" : signed(r)}</td>
                    <td>{pbName(t.playbook) ?? t.setup ?? "–"}</td>
                    <td className="jz-chips-cell">
                      {(t.tags ?? []).map((x) => (
                        <span key={x} className="jz-chip">
                          {x}
                        </span>
                      ))}
                      {(t.mistakes ?? []).map((x) => (
                        <span key={x} className="jz-chip bad">
                          {x}
                        </span>
                      ))}
                    </td>
                    <td className="jz-star-cell">{t.rating ? "★".repeat(t.rating) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
