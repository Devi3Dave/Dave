/**
 * Chart notes like TradingView's Notes panel: free text that belongs to a symbol (or to no symbol,
 * "Allgemein"), newest first, pinned notes on top. Pure functions; the browser store is src/notes.ts.
 */

export interface Note {
  id: string;
  /** Symbol the note belongs to; null = general note. */
  symbol: string | null;
  text: string;
  pinned: boolean;
  /** ms since epoch */
  createdAt: number;
  updatedAt: number;
}

export type NoteScope = "symbol" | "all";

export const NOTE_MAX = 5000;

/** The first line, used as the title of a note. */
export function noteTitle(n: Pick<Note, "text">): string {
  const line = n.text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || "Leere Notiz";
}

export function addNote(notes: Note[], text: string, symbol: string | null, now: number, id: string): Note[] {
  const t = text.trim().slice(0, NOTE_MAX);
  if (!t) return notes;
  return [{ id, symbol, text: t, pinned: false, createdAt: now, updatedAt: now }, ...notes];
}

export function updateNote(notes: Note[], id: string, patch: Partial<Pick<Note, "text" | "pinned" | "symbol">>, now: number): Note[] {
  return notes.map((n) => {
    if (n.id !== id) return n;
    const text = patch.text === undefined ? n.text : patch.text.trim().slice(0, NOTE_MAX) || n.text;
    // Pinning alone does not count as an edit.
    const edited = (patch.text !== undefined && text !== n.text) || (patch.symbol !== undefined && patch.symbol !== n.symbol);
    return { ...n, ...patch, text, updatedAt: edited ? now : n.updatedAt };
  });
}

export function deleteNote(notes: Note[], id: string): Note[] {
  return notes.filter((n) => n.id !== id);
}

/** Notes for the panel: for one symbol (plus general notes) or all, matching every word of `query`, pinned first, then newest. */
export function filterNotes(notes: Note[], scope: NoteScope, symbol: string, query = ""): Note[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return notes
    .filter((n) => scope === "all" || n.symbol === null || n.symbol === symbol)
    .filter((n) => words.every((w) => n.text.toLowerCase().includes(w) || (n.symbol ?? "").toLowerCase().includes(w)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

export function parseNotes(v: unknown): Note[] {
  if (!Array.isArray(v)) return [];
  const out: Note[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const n = x as Record<string, unknown>;
    if (typeof n.id !== "string" || typeof n.text !== "string" || !n.text.trim()) continue;
    const createdAt = typeof n.createdAt === "number" ? n.createdAt : 0;
    out.push({
      id: n.id,
      symbol: typeof n.symbol === "string" && n.symbol ? n.symbol : null,
      text: n.text.slice(0, NOTE_MAX),
      pinned: n.pinned === true,
      createdAt,
      updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : createdAt,
    });
  }
  return out;
}
