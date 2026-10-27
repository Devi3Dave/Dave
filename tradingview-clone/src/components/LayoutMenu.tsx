import { useEffect, useState } from "react";
import { currentName, newLayout, openLayout, renameLayout, saveLayout, setAutosave, useLayoutState } from "../layouts";
import { shortcutLabel } from "../shortcuts";
import { deleteTemplate, describeTemplate, useSavedTemplates } from "../templates";
import { Menu } from "./Menu";

/** Asks for a layout name; used for the first save, "Speichern unter" and renaming. */
function NameDialog({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (name: string) => string | null; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <form
          className="save-form"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            const err = onSave(n);
            if (err) setError(err);
            else onClose();
          }}
        >
          <input autoFocus className="search" placeholder="z. B. BTC Daytrading" value={name} onChange={(e) => (setName(e.target.value), setError(null))} />
          {error && <p className="hint error">{error}</p>}
          <p className="hint">Gespeichert werden alle Charts des Layouts mit Symbol, Zeiteinheit, Charttyp, Indikatoren, Zeichnungen und Synchronisierung.</p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Abbrechen
            </button>
            <button type="submit" className="primary" disabled={!name.trim()}>
              Speichern
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type Dialog = { kind: "save" | "saveAs" | "rename" } | null;

/** TradingView's layout menu: the current layout's name, save (⌘S), save as, rename, new, autosave and the saved layouts. */
export function SavedLayoutMenu() {
  const { id, name, dirty, autosave } = useLayoutState();
  const layouts = useSavedTemplates().filter((t) => t.kind === "workspace");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [query, setQuery] = useState("");
  const keys = shortcutLabel("layout.save");
  // ⌘S on a layout without a name yet asks for one here.
  useEffect(() => {
    const open = () => setDialog({ kind: "save" });
    window.addEventListener(OPEN_SAVE_LAYOUT_EVENT, open);
    return () => window.removeEventListener(OPEN_SAVE_LAYOUT_EVENT, open);
  }, []);
  const shown = layouts.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <Menu
        className="layout-name"
        ariaLabel="Chart-Layout speichern und öffnen"
        tip={`Layout „${name}“${dirty ? " – ungespeicherte Änderungen" : autosave && id ? " – wird automatisch gespeichert" : ""}\nSpeichern${keys ? ` (${keys})` : ""}, öffnen, umbenennen`}
        label={
          <>
            <span className="pill-icon">💾</span>
            <span className="pill-label layout-name-text"> {name}</span>
            {dirty && <span className="layout-dirty" aria-label="ungespeichert">●</span>}
            <span className="caret">▾</span>
          </>
        }
      >
        {(close) => (
          <>
            <div className="menu-title">Layout „{name}“</div>
            <button
              className="menu-item"
              onClick={() => {
                if (!saveLayout()) setDialog({ kind: "save" });
                close();
              }}
            >
              💾 Speichern{keys ? <span className="menu-keys">{keys}</span> : null}
            </button>
            <button className="menu-item" onClick={() => (setDialog({ kind: "saveAs" }), close())}>
              ⧉ Kopie speichern unter …
            </button>
            <button className="menu-item" onClick={() => (setDialog({ kind: "rename" }), close())}>
              ✎ Umbenennen …
            </button>
            <button
              className="menu-item"
              onClick={() => {
                if (dirty && !window.confirm(`„${name}“ hat ungespeicherte Änderungen. Trotzdem ein neues Layout beginnen?`)) return;
                newLayout();
                close();
              }}
            >
              ＋ Neues Layout
            </button>
            <label className="menu-check" data-tip="Jede Änderung wird nach einem Moment in das Layout geschrieben">
              <input type="checkbox" checked={autosave} onChange={(e) => setAutosave(e.target.checked)} />
              Automatisch speichern
            </label>
            <div className="menu-title">Gespeicherte Layouts</div>
            {layouts.length > 5 && <input className="search layout-search" placeholder="Layout suchen" value={query} onChange={(e) => setQuery(e.target.value)} />}
            {shown.length === 0 && <div className="hint">{layouts.length ? "Kein Treffer" : "Noch keine gespeicherten Layouts"}</div>}
            {shown
              .slice()
              .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
              .map((t) => (
                <div className="menu-row" key={t.id}>
                  <button
                    className={`menu-item template-item ${t.id === id ? "active" : ""}`}
                    onClick={() => {
                      if (t.id !== id && dirty && !window.confirm(`„${name}“ hat ungespeicherte Änderungen. Trotzdem „${t.name}“ öffnen?`)) return;
                      void openLayout(t);
                      close();
                    }}
                  >
                    <span className="template-name">
                      {t.id === id ? "✓ " : ""}
                      {t.name}
                    </span>
                    <span className="template-desc">
                      {describeTemplate(t)}
                      {t.savedAt ? ` · ${new Date(t.savedAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
                    </span>
                  </button>
                  <button
                    className="template-delete"
                    data-tip="Layout löschen"
                    aria-label={`${t.name} löschen`}
                    onClick={() => {
                      if (window.confirm(`Layout „${t.name}“ löschen?`)) deleteTemplate(t.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
          </>
        )}
      </Menu>
      {dialog && (
        <NameDialog
          title={dialog.kind === "rename" ? "Layout umbenennen" : dialog.kind === "saveAs" ? "Kopie speichern unter" : "Layout speichern"}
          initial={dialog.kind === "rename" && id ? currentName() : dialog.kind === "saveAs" ? `${currentName()} (Kopie)` : ""}
          onSave={(n) => {
            if (dialog.kind === "rename") return renameLayout(n) ? null : "Diesen Namen hat schon ein anderes Layout.";
            if (dialog.kind === "saveAs" && layouts.some((t) => t.name.toLowerCase() === n.toLowerCase()) && !window.confirm(`„${n}“ gibt es schon. Überschreiben?`)) return "Bitte einen anderen Namen wählen.";
            saveLayout(n);
            return null;
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

export const OPEN_SAVE_LAYOUT_EVENT = "chartai:save-layout";
