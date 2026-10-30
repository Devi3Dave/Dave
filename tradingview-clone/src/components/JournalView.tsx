import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseBackup, sortTrades, toCsv, tradePnl, type JournalTrade } from "../../shared/journal";
import type { ChartEngine } from "../chart/ChartEngine";
import { deleteImage, imagesFor, restoreImages } from "../journalImages";
import { DEFAULT_PLAYBOOKS, parseNotes, parsePlaybooks, parseTradesCsv, type JournalNotes, type Playbook } from "../../shared/journalAnalytics";
import { JOURNAL_EVENT, refreshJournaled } from "../demoAccount";
import { saveFile } from "../saveFile";
import { loadChart, useChartState } from "../store";
import { Dashboard } from "./journal/Dashboard";
import { DayView } from "./journal/DayView";
import { isoOf, signed, today, type JournalApi } from "./journal/format";
import { Notebook } from "./journal/Notebook";
import { Playbooks } from "./journal/Playbooks";
import { Reports } from "./journal/Reports";
import { TradeDetail } from "./journal/TradeDetail";
import { TradeForm } from "./journal/TradeForm";
import { TradesTab } from "./journal/TradesTab";

// Trading journal built after TradeZella's feature set (dashboard, calendar, day view, trades, reports, playbooks,
// notebook; see shared/journalAnalytics.ts). Everything stays in this browser under chartai.journal.* and travels with ☁ Sync.

const STORAGE_KEY = "chartai.journal.v1";
const PLAYBOOKS_KEY = "chartai.journal.playbooks.v1";
const NOTES_KEY = "chartai.journal.notes.v1";

type Tab = "dashboard" | "days" | "trades" | "reports" | "playbooks" | "notebook";
const TABS: { id: Tab; label: string; tip: string }[] = [
  { id: "dashboard", label: "📊 Dashboard", tip: "Kennzahlen, Score, Kurve und Kalender auf einen Blick" },
  { id: "days", label: "📅 Tagebuch", tip: "Jeder Handelstag mit Ergebnis, Trades und Tagesnotiz" },
  { id: "trades", label: "📋 Trades", tip: "Alle Trades suchen, filtern und öffnen" },
  { id: "reports", label: "📈 Berichte", tip: "Ergebnis nach Wochentag, Uhrzeit, Symbol, Playbook, Fehler …" },
  { id: "playbooks", label: "📘 Playbooks", tip: "Deine Strategien mit Regeln und ihrer Auswertung" },
  { id: "notebook", label: "📝 Notizbuch", tip: "Trading-Plan, Rückblicke und alle Tagesnotizen" },
];

type Range = "all" | "week" | "month" | "30d" | "90d" | "year";
const RANGES: [Range, string][] = [
  ["all", "Gesamte Zeit"],
  ["week", "Diese Woche"],
  ["month", "Dieser Monat"],
  ["30d", "Letzte 30 Tage"],
  ["90d", "Letzte 90 Tage"],
  ["year", "Dieses Jahr"],
];

function rangeStart(r: Range): string | null {
  const d = new Date();
  if (r === "all") return null;
  if (r === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (r === "month") d.setDate(1);
  else if (r === "30d") d.setDate(d.getDate() - 29);
  else if (r === "90d") d.setDate(d.getDate() - 89);
  else d.setMonth(0, 1);
  return isoOf(d);
}

function read<T>(key: string, parse: (raw: unknown) => T, fallback: unknown): T {
  try {
    const raw = localStorage.getItem(key);
    return parse(raw === null ? fallback : (JSON.parse(raw) as unknown));
  } catch {
    return parse(fallback);
  }
}

const loadTrades = () => {
  try {
    return parseBackup(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown);
  } catch {
    return [];
  }
};

export function JournalView({ onClose, getEngine }: { onClose: () => void; getEngine: () => ChartEngine | null }) {
  const chartSymbol = useChartState((s) => s.symbol);
  const chartInterval = useChartState((s) => s.interval);
  const [trades, setTrades] = useState<JournalTrade[]>(loadTrades);
  const [playbooks, setPlaybooksState] = useState<Playbook[]>(() => read(PLAYBOOKS_KEY, parsePlaybooks, DEFAULT_PLAYBOOKS));
  const [notes, setNotesState] = useState<JournalNotes>(() => read(NOTES_KEY, parseNotes, {}));
  const [tab, setTab] = useState<Tab>("dashboard");
  const [range, setRange] = useState<Range>("all");
  const [symbol, setSymbol] = useState("");
  const [pbFilter, setPbFilter] = useState("");
  const [unit, setUnit] = useState<"usd" | "r">("usd");
  const [form, setForm] = useState<{ editing: JournalTrade | null } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [firstTime] = useState(() => trades.length === 0);
  const backupRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  const persist = (key: string, value: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      setError("Speichern im Browser fehlgeschlagen – bitte ein Backup exportieren");
    }
  };
  useEffect(() => {
    persist(STORAGE_KEY, trades);
    refreshJournaled();
  }, [trades]);
  useEffect(() => {
    persist(PLAYBOOKS_KEY, playbooks);
  }, [playbooks]);
  useEffect(() => {
    persist(NOTES_KEY, notes);
  }, [notes]);

  // Demo trades taken over from the demo account while this page is open.
  useEffect(() => {
    const reload = () => setTrades(loadTrades());
    window.addEventListener(JOURNAL_EVENT, reload);
    return () => window.removeEventListener(JOURNAL_EVENT, reload);
  }, []);

  // Ask the browser not to evict the journal when storage runs low.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An open picture closes first (Screenshots handles that).
      if (e.key !== "Escape" || document.querySelector(".jz-lightbox")) return;
      if (form) setForm(null);
      else if (detailId) setDetailId(null);
      else return;
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [form, detailId]);

  // Each tab starts at the top.
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [tab]);

  const openDay = useCallback((date: string) => {
    setDetailId(null);
    setFocusDay(date);
    setTab("days");
  }, []);

  const api: JournalApi = {
    trades,
    playbooks,
    notes,
    openTrade: setDetailId,
    openDay,
    editTrade: (t) => {
      setDetailId(null);
      setForm({ editing: t });
    },
    updateTrade: (t) => setTrades((list) => list.map((x) => (x.id === t.id ? t : x))),
    setNotes: setNotesState,
    setPlaybooks: setPlaybooksState,
    chartShot: () => {
      try {
        return getEngine()?.screenshot() ?? null;
      } catch {
        return null;
      }
    },
  };

  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol).filter(Boolean))].sort(), [trades]);
  const from = rangeStart(range);
  const shown = useMemo(
    () => trades.filter((t) => (!from || t.date >= from) && (!symbol || t.symbol === symbol) && (!pbFilter || (pbFilter === "-" ? !t.playbook : t.playbook === pbFilter))),
    [trades, from, symbol, pbFilter],
  );
  const filtered = shown.length !== trades.length;
  const ordered = useMemo(() => sortTrades(trades), [trades]);
  const detail = detailId ? trades.find((t) => t.id === detailId) : undefined;

  const saveTrade = (t: JournalTrade, isNew: boolean) => {
    setTrades((list) => (isNew ? [...list, t] : list.map((x) => (x.id === t.id ? t : x))));
    setNotice(isNew ? `Trade gespeichert: ${signed(tradePnl(t))} $` : "Trade geändert");
    setForm(null);
    setError(null);
  };

  const addImported = (list: JournalTrade[], skipped: number, what: string) => {
    // Same day, symbol, side and result counts as the same trade (a file imported twice).
    const sig = (t: JournalTrade) => `${t.date}|${t.symbol}|${t.side}|${tradePnl(t).toFixed(2)}|${t.time ?? ""}`;
    const known = new Set(trades.map((t) => t.id));
    const knownSig = new Set(trades.map(sig));
    const added = list.filter((t) => !known.has(t.id) && !knownSig.has(sig(t)));
    setTrades((l) => [...l, ...added]);
    setNotice(`${added.length} Trades aus ${what} übernommen${list.length > added.length ? `, ${list.length - added.length} waren schon da` : ""}${skipped ? `, ${skipped} Zeilen nicht lesbar` : ""}`);
    setError(null);
  };

  const restoreBackup = async (file: File) => {
    try {
      const json = JSON.parse(await file.text()) as { playbooks?: unknown; notes?: unknown };
      addImported(parseBackup(json), 0, "dem Backup");
      const pics = await restoreImages((json as { images?: unknown }).images);
      if (pics) setNotice((n) => `${n ?? ""} · ${pics} Screenshots`);
      if (Array.isArray(json.playbooks)) {
        const restored = parsePlaybooks(json.playbooks);
        setPlaybooksState((list) => [...list, ...restored.filter((p) => !list.some((x) => x.id === p.id))]);
      }
      if (json.notes) {
        const restored = parseNotes(json.notes);
        setNotesState((n) => ({ days: { ...restored.days, ...n.days }, notebook: [...n.notebook, ...restored.notebook.filter((x) => !n.notebook.some((y) => y.id === x.id))] }));
      }
    } catch (e) {
      setError(`Backup konnte nicht gelesen werden: ${(e as Error).message}`);
    }
  };

  const importCsv = async (file: File) => {
    try {
      const { trades: list, skipped } = parseTradesCsv(await file.text());
      addImported(list, skipped, file.name);
    } catch (e) {
      setError(`CSV konnte nicht gelesen werden: ${(e as Error).message}`);
    }
  };

  return (
    <div className="heatmap-view calc-view jr-view jz-view">
      <div className="heatmap-head">
        <strong>Trading-Journal</strong>
        <span className="heatmap-symbol">
          {trades.length} {trades.length === 1 ? "Trade" : "Trades"}
        </span>
        <div className="spacer" />
        <button className="jr-save" onClick={() => setForm({ editing: null })} data-tip="Neuen Trade eintragen">
          + Trade
        </button>
        <div className="jz-import">
          <button onClick={() => setImportOpen((o) => !o)} data-tip="Trades aus einer Datei übernehmen">
            ⤒ Import
          </button>
          {importOpen && (
            <div className="jz-menu" onMouseLeave={() => setImportOpen(false)}>
              <button
                onClick={() => {
                  setImportOpen(false);
                  csvRef.current?.click();
                }}
              >
                CSV deiner Börse / deines Brokers
                <em>Spalten wie Datum, Symbol, Side, Entry, Exit, Qty, P&L werden erkannt</em>
              </button>
              <button
                onClick={() => {
                  setImportOpen(false);
                  backupRef.current?.click();
                }}
              >
                Journal-Backup (.json)
                <em>bestehende Trades bleiben erhalten</em>
              </button>
            </div>
          )}
        </div>
        <button onClick={() => void saveFile(`journal-${today()}.csv`, `﻿${toCsv(trades)}`, "text/csv")} disabled={!trades.length} data-tip="Alle Trades als Tabelle (Excel, Numbers)">
          ⇩ CSV
        </button>
        <button
          onClick={async () => {
            const images = await imagesFor(trades.flatMap((t) => t.images ?? []));
            void saveFile(`journal-backup-${today()}.json`, JSON.stringify({ version: 2, trades, playbooks, notes, images }, null, 2), "application/json");
          }}
          data-tip={"Sicherung von Trades, Playbooks, Notizen und Screenshots als Datei\nauf dem iPad: „In Dateien sichern“"}
        >
          ⤓ Backup
        </button>
        <input ref={backupRef} type="file" accept="application/json,.json" hidden onChange={(e) => (e.target.files?.[0] && void restoreBackup(e.target.files[0]), (e.target.value = ""))} />
        <input ref={csvRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => (e.target.files?.[0] && void importCsv(e.target.files[0]), (e.target.value = ""))} />
        <button className="pill" onClick={onClose} data-tip="Zurück zum Chart">
          ✕ Chart
        </button>
      </div>

      <div className="jz-nav">
        <div className="jz-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => {
                setTab(t.id);
                if (t.id !== "days") setFocusDay(null);
              }}
              data-tip={t.tip}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab !== "notebook" && (
          <div className="jz-filters">
            <select className="jr-select" value={range} onChange={(e) => setRange(e.target.value as Range)} data-tip="Zeitraum für alle Auswertungen">
              {RANGES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            {symbols.length > 1 && (
              <select className="jr-select" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                <option value="">Alle Symbole</option>
                {symbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            {tab !== "playbooks" && (
              <select className="jr-select" value={pbFilter} onChange={(e) => setPbFilter(e.target.value)}>
                <option value="">Alle Playbooks</option>
                {playbooks.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="-">ohne Playbook</option>
              </select>
            )}
            <div className="jr-seg">
              <button className={unit === "usd" ? "active" : ""} onClick={() => setUnit("usd")}>
                $
              </button>
              <button className={unit === "r" ? "active" : ""} onClick={() => setUnit("r")} data-tip="In R: Ergebnis geteilt durch das Risiko (nur Trades mit Stop-Loss)">
                R
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="calc-body" ref={bodyRef}>
        {error && <div className="calc-warn">{error}</div>}
        {notice && <div className="jr-notice">{notice}</div>}
        {tab === "dashboard" && <Dashboard api={api} shown={shown} unit={unit} filtered={filtered} />}
        {tab === "days" && <DayView api={api} shown={shown} focus={focusDay} onFocus={setFocusDay} />}
        {tab === "trades" && <TradesTab api={api} shown={shown} />}
        {tab === "reports" && <Reports api={api} shown={shown} unit={unit} />}
        {tab === "playbooks" && <Playbooks api={api} shown={shown} />}
        {tab === "notebook" && <Notebook api={api} />}
      </div>

      {detail && (
        <TradeDetail
          trade={detail}
          api={api}
          ordered={ordered}
          onOpenChart={(s) => {
            void loadChart(s, chartInterval);
            onClose();
          }}
          onDelete={(id) => {
            for (const img of trades.find((t) => t.id === id)?.images ?? []) void deleteImage(img).catch(() => undefined);
            setTrades((list) => list.filter((t) => t.id !== id));
            setDetailId(null);
            setNotice("Trade gelöscht");
          }}
          onClose={() => setDetailId(null)}
        />
      )}
      {form && (
        <TradeForm
          editing={form.editing}
          chartSymbol={chartSymbol}
          last={ordered[ordered.length - 1]}
          trades={trades}
          playbooks={playbooks}
          firstTime={firstTime}
          chartShot={api.chartShot}
          onSave={saveTrade}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}
