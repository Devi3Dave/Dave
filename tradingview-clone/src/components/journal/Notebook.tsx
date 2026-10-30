import { useEffect, useMemo, useState } from "react";
import { NOTE_TEMPLATES, type NotebookNote } from "../../../shared/journalAnalytics";
import { fmtDate, longDate, newId, today, type JournalApi } from "./format";

const DAY_FOLDER = "Tagesnotizen";

function NoteEditor({ note, folders, onChange, onDelete }: { note: NotebookNote; folders: string[]; onChange: (n: NotebookNote) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [folder, setFolder] = useState(note.folder);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setTitle(note.title);
    setBody(note.body);
    setFolder(note.folder);
    setConfirm(false);
  }, [note.id, note.title, note.body, note.folder]);
  const save = () => {
    const f = folder.trim() || "Notizen";
    if (title !== note.title || body !== note.body || f !== note.folder) onChange({ ...note, title, body, folder: f, updated: Date.now() });
  };
  return (
    <div className="jz-note-edit">
      <div className="calc-input">
        <input className="jz-note-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={save} placeholder="Titel" />
      </div>
      <div className="jz-bar">
        <span className="jr-muted">Ordner</span>
        <input className="jr-select" value={folder} list="jz-folders" onChange={(e) => setFolder(e.target.value)} onBlur={save} />
        <datalist id="jz-folders">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <div className="spacer" />
        {confirm ? (
          <>
            <button className="jr-danger" onClick={onDelete}>
              Löschen
            </button>
            <button onClick={() => setConfirm(false)}>Nein</button>
          </>
        ) : (
          <button onClick={() => setConfirm(true)}>🗑</button>
        )}
      </div>
      <textarea className="jz-textarea jz-note-body" value={body} onChange={(e) => setBody(e.target.value)} onBlur={save} placeholder="Schreib hier …" />
    </div>
  );
}

/** Notebook: free notes in folders (trading plan, reviews …) from templates, plus all day notes. */
export function Notebook({ api }: { api: JournalApi }) {
  const [folder, setFolder] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const notes = api.notes.notebook;
  const folders = useMemo(() => [...new Set(notes.map((n) => n.folder))].sort(), [notes]);
  const dayNotes = useMemo(() => Object.entries(api.notes.days).sort((a, b) => (a[0] < b[0] ? 1 : -1)), [api.notes.days]);
  const needle = q.trim().toLowerCase();
  const list = notes
    .filter((n) => (!folder || n.folder === folder) && (!needle || `${n.title}\n${n.body}`.toLowerCase().includes(needle)))
    .sort((a, b) => b.updated - a.updated);
  const days = folder && folder !== DAY_FOLDER ? [] : dayNotes.filter(([d, text]) => !needle || `${d}\n${text}`.toLowerCase().includes(needle));
  const current = notes.find((n) => n.id === selected) ?? null;

  const create = (tpl?: (typeof NOTE_TEMPLATES)[number]) => {
    const n: NotebookNote = { id: newId(), title: tpl ? `${tpl.name} ${fmtDate(today())}` : "Neue Notiz", body: tpl?.body ?? "", folder: tpl?.folder ?? (folder && folder !== DAY_FOLDER ? folder : "Notizen"), updated: Date.now() };
    api.setNotes((x) => ({ ...x, notebook: [...x.notebook, n] }));
    setSelected(n.id);
  };

  return (
    <div className="jz-notebook">
      <aside className="calc-card jz-folders">
        <button className={!folder ? "active" : ""} onClick={() => setFolder("")}>
          Alle Notizen <em>{notes.length + dayNotes.length}</em>
        </button>
        <button className={folder === DAY_FOLDER ? "active" : ""} onClick={() => setFolder(DAY_FOLDER)}>
          📅 {DAY_FOLDER} <em>{dayNotes.length}</em>
        </button>
        {folders.map((f) => (
          <button key={f} className={folder === f ? "active" : ""} onClick={() => setFolder(f)}>
            📁 {f} <em>{notes.filter((n) => n.folder === f).length}</em>
          </button>
        ))}
        <div className="jz-tpl">
          <span className="jr-muted">Neu aus Vorlage</span>
          <button onClick={() => create()}>+ Leere Notiz</button>
          {NOTE_TEMPLATES.map((t) => (
            <button key={t.name} onClick={() => create(t)}>
              + {t.name}
            </button>
          ))}
        </div>
      </aside>
      <section className="calc-card jz-note-list">
        <input className="jr-select jz-search" type="search" placeholder="Notizen durchsuchen" value={q} onChange={(e) => setQ(e.target.value)} />
        {folder !== DAY_FOLDER &&
          list.map((n) => (
            <button key={n.id} className={`jz-note-item ${n.id === selected ? "active" : ""}`} onClick={() => setSelected(n.id)}>
              <strong>{n.title || "Ohne Titel"}</strong>
              <span>
                {n.folder} · {new Date(n.updated || Date.now()).toLocaleDateString("de-DE")}
              </span>
              <em>{n.body.slice(0, 90)}</em>
            </button>
          ))}
        {days.map(([d, text]) => (
          <button key={d} className="jz-note-item" onClick={() => api.openDay(d)}>
            <strong>📅 {longDate(d)}</strong>
            <span>Tagesnotiz · öffnet den Tag</span>
            <em>{text.slice(0, 90)}</em>
          </button>
        ))}
        {list.length === 0 && days.length === 0 && <div className="jr-empty">Keine Notizen. Leg links eine an, z. B. deinen Trading-Plan.</div>}
      </section>
      <section className="calc-card jz-note-main">
        {current ? (
          <NoteEditor
            note={current}
            folders={folders}
            onChange={(n) => api.setNotes((x) => ({ ...x, notebook: x.notebook.map((y) => (y.id === n.id ? n : y)) }))}
            onDelete={() => {
              api.setNotes((x) => ({ ...x, notebook: x.notebook.filter((y) => y.id !== current.id) }));
              setSelected(null);
            }}
          />
        ) : (
          <div className="jr-empty">Wähle eine Notiz oder leg eine neue an. Tagesnotizen schreibst du im Tagebuch direkt beim Tag.</div>
        )}
      </section>
    </div>
  );
}
