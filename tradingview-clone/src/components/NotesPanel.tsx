import { useState } from "react";
import { filterNotes, noteTitle, type Note, type NoteScope } from "../../shared/notes";
import { createNote, editNote, removeNote, useNotes } from "../notes";
import { activeChart, charts, loadChart, useChart, useWorkspace } from "../store";

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** TradingView-style notes: write down ideas per symbol, find them again by search. */
export function NotesPanel() {
  const slot = useWorkspace((w) => w.active);
  const symbol = useChart(charts[slot], (s) => s.symbol);
  const notes = useNotes();
  const [scope, setScope] = useState<NoteScope>("symbol");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [general, setGeneral] = useState(false);
  const shown = filterNotes(notes, scope, symbol, query);

  const add = () => {
    if (createNote(draft, general ? null : symbol)) setDraft("");
  };

  return (
    <div className="notes-panel">
      <div className="segmented notes-scope" role="tablist">
        <button role="tab" aria-selected={scope === "symbol"} className={scope === "symbol" ? "active" : ""} onClick={() => setScope("symbol")} data-tip={`Notizen zu ${symbol} und allgemeine Notizen`}>
          {symbol}
        </button>
        <button role="tab" aria-selected={scope === "all"} className={scope === "all" ? "active" : ""} onClick={() => setScope("all")} data-tip="Notizen zu allen Symbolen">
          Alle ({notes.length})
        </button>
      </div>

      <div className="notes-new">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
          placeholder={`Neue Notiz${general ? "" : ` zu ${symbol}`} … (erste Zeile = Titel)`}
          aria-label="Neue Notiz"
          rows={3}
        />
        <div className="notes-new-bar">
          <label data-tip="Ohne Symbol: erscheint bei jedem Chart">
            <input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} /> Allgemein
          </label>
          <button className="primary" onClick={add} disabled={!draft.trim()} data-tip="Speichern (⌘/Strg + Enter)">
            Notiz speichern
          </button>
        </div>
      </div>

      <input className="notes-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Notizen durchsuchen" aria-label="Notizen durchsuchen" />

      <div className="notes-list">
        {shown.length === 0 && <div className="notes-empty">{query ? "Keine Notiz passt zur Suche." : "Noch keine Notizen. Ideen, Setups oder Termine hier festhalten."}</div>}
        {shown.map((n) => (
          <NoteCard key={n.id} note={n} current={symbol} />
        ))}
      </div>
    </div>
  );
}

function NoteCard({ note, current }: { note: Note; current: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const [open, setOpen] = useState(false);
  const body = note.text.split("\n").slice(1).join("\n").trim();
  const save = () => {
    editNote(note.id, { text });
    setEditing(false);
  };

  return (
    <div className={`note-card${note.pinned ? " pinned" : ""}`}>
      <div className="note-head">
        <button className="note-title" onClick={() => setOpen(!open)} aria-expanded={open}>
          {note.pinned && "📌 "}
          {noteTitle(note)}
        </button>
        <div className="note-actions">
          <button onClick={() => editNote(note.id, { pinned: !note.pinned })} data-tip={note.pinned ? "Lösen" : "Oben anheften"} aria-label={note.pinned ? "Lösen" : "Anheften"}>
            📌
          </button>
          <button
            onClick={() => {
              setText(note.text);
              setEditing(!editing);
              setOpen(true);
            }}
            data-tip="Bearbeiten"
            aria-label="Bearbeiten"
          >
            ✎
          </button>
          <button onClick={() => removeNote(note.id)} data-tip="Notiz löschen" aria-label="Notiz löschen">
            ✕
          </button>
        </div>
      </div>
      {editing ? (
        <div className="note-edit">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            rows={5}
            autoFocus
            aria-label="Notiz bearbeiten"
          />
          <div className="notes-new-bar">
            <button onClick={() => setEditing(false)}>Abbrechen</button>
            <button className="primary" onClick={save} disabled={!text.trim()}>
              Speichern
            </button>
          </div>
        </div>
      ) : (
        open && body && <div className="note-body">{body}</div>
      )}
      <div className="note-meta">
        {note.symbol === null ? (
          <span className="note-tag">Allgemein</span>
        ) : note.symbol === current ? (
          <span className="note-tag">{note.symbol}</span>
        ) : (
          <button className="note-tag link" onClick={() => void loadChart(note.symbol!, activeChart().get().interval)} data-tip={`${note.symbol} im Chart öffnen`}>
            {note.symbol} ↗
          </button>
        )}
        <span>{dateFmt.format(note.updatedAt)}</span>
      </div>
    </div>
  );
}
