import type { JournalTrade } from "../../../shared/journal";
import type { JournalNotes, Playbook } from "../../../shared/journalAnalytics";

export const UP = "#26a69a";
export const DOWN = "#ef5350";
export const GOLD = "#f5c518";
export const GREY = "#787b86";

const nf = (d: number) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
export const num = (v: number, d = 2) => (Number.isFinite(v) ? nf(d).format(v) : v === Infinity ? "∞" : "–");
export const signed = (v: number, d = 2) => `${v > 0 ? "+" : ""}${num(v, d)}`;
export const pct = (v: number, d = 1) => `${num(v * 100, d)} %`;
export const money = (v: number, d = 2) => `${signed(v, d)} $`;
export const tone = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : undefined);
export const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : iso);
export const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
export const longDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
};
export const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => isoOf(new Date());

export const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** What every journal tab gets from the page. */
export interface JournalApi {
  trades: JournalTrade[];
  playbooks: Playbook[];
  notes: JournalNotes;
  openTrade: (id: string) => void;
  openDay: (date: string) => void;
  editTrade: (t: JournalTrade | null) => void;
  updateTrade: (t: JournalTrade) => void;
  setNotes: (fn: (n: JournalNotes) => JournalNotes) => void;
  setPlaybooks: (fn: (p: Playbook[]) => Playbook[]) => void;
  /** JPEG data URL of the chart behind the journal, or null without one. */
  chartShot: () => string | null;
}
