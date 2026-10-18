import { useState } from "react";
import { activeChart, layoutCount, useWorkspace } from "../store";
import { BUILTIN_TEMPLATES, applyTemplate, deleteTemplate, describeTemplate, saveTemplate, saveWorkspace, snapshotOf, useSavedTemplates, type Template } from "../templates";
import { Menu } from "./Menu";

function TemplateItem({ t, close }: { t: Template; close: () => void }) {
  return (
    <div className="menu-row">
      <button
        className="menu-item template-item"
        onClick={() => {
          void applyTemplate(t, activeChart());
          close();
        }}
      >
        <span className="template-name">{t.name}</span>
        <span className="template-desc">{describeTemplate(t)}</span>
      </button>
      {!t.builtin && (
        <button
          className="template-delete"
          data-tip="Vorlage löschen"
          aria-label={`${t.name} löschen`}
          onClick={() => {
            if (window.confirm(`„${t.name}“ löschen?`)) deleteTemplate(t.id);
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function SaveDialog({ kind, onClose }: { kind: "chart" | "workspace"; onClose: () => void }) {
  const count = useWorkspace((w) => layoutCount(w.layout));
  const [name, setName] = useState("");
  const [withInterval, setWithInterval] = useState(true);
  const [withDrawings, setWithDrawings] = useState(false);
  const save = () => {
    const n = name.trim();
    if (!n) return;
    if (kind === "workspace") saveWorkspace(n);
    else saveTemplate({ name: n, kind: "chart", chart: snapshotOf(activeChart(), { symbol: false, interval: withInterval, drawings: withDrawings }) });
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{kind === "workspace" ? "Arbeitsbereich speichern" : "Vorlage speichern"}</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <form
          className="save-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input autoFocus className="search" placeholder={kind === "workspace" ? "z. B. Morgen-Check" : "z. B. Mein Scalping"} value={name} onChange={(e) => setName(e.target.value)} />
          {kind === "chart" ? (
            <>
              <label className="settings-toggle">
                <input type="checkbox" checked={withInterval} onChange={(e) => setWithInterval(e.target.checked)} /> Zeiteinheit mitspeichern
              </label>
              <label className="settings-toggle">
                <input type="checkbox" checked={withDrawings} onChange={(e) => setWithDrawings(e.target.checked)} /> Symbol und Zeichnungen mitspeichern
              </label>
              <p className="hint">Gespeichert werden Indikatoren mit Parametern und Farben sowie der Charttyp. Ohne Symbol lässt sich die Vorlage auf jeden Chart anwenden.</p>
            </>
          ) : (
            <p className="hint">Speichert das Layout ({count} {count === 1 ? "Chart" : "Charts"}) mit Symbol, Zeiteinheit, Indikatoren und Zeichnungen jedes Charts.</p>
          )}
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

/** Built-in and saved chart templates plus saved workspaces (layout with all charts). */
export function TemplatesMenu() {
  const saved = useSavedTemplates();
  const [dialog, setDialog] = useState<"chart" | "workspace" | null>(null);
  const chartTemplates = saved.filter((t) => t.kind === "chart");
  const workspaces = saved.filter((t) => t.kind === "workspace");
  return (
    <>
      <Menu label="▤ Vorlagen" ariaLabel="Vorlagen" tip={"Vorlagen und gespeicherte Layouts\nz. B. Scalping oder Swing mit eigenen Indikatoren"}>
        {(close) => (
          <>
            <div className="menu-title">Vorlagen (auf aktiven Chart)</div>
            {[...BUILTIN_TEMPLATES, ...chartTemplates].map((t) => (
              <TemplateItem key={t.id} t={t} close={close} />
            ))}
            <div className="menu-title">Arbeitsbereiche</div>
            {workspaces.length === 0 && <div className="menu-empty">Noch keine gespeichert.</div>}
            {workspaces.map((t) => (
              <TemplateItem key={t.id} t={t} close={close} />
            ))}
            <div className="menu-actions">
              <button
                className="menu-item"
                onClick={() => {
                  setDialog("chart");
                  close();
                }}
              >
                ＋ Aktuellen Chart als Vorlage speichern …
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setDialog("workspace");
                  close();
                }}
              >
                ＋ Arbeitsbereich speichern …
              </button>
            </div>
          </>
        )}
      </Menu>
      {dialog && <SaveDialog kind={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
