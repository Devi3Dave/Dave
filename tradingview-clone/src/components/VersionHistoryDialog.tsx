import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CHANGELOG, formatReleaseDate, searchChangelog } from "../changelog";
import { APP_VERSION } from "../version";

/** All versions with date and changes, newest first, searchable. */
export function VersionHistoryDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const releases = searchChangelog(CHANGELOG, query);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Opened from the top bar, which scrolls sideways; Safari clips fixed dialogs inside such a container,
  // so the dialog is rendered at the page root.
  return createPortal(
    <div className="modal-backdrop version-backdrop" onClick={onClose}>
      <div className="modal version-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Versionshistorie</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <input
          className="search"
          placeholder="Suchen: Version oder Funktion, z. B. „Replay“ oder „0.30“"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={!("ontouchstart" in window)}
        />
        <div className="vh-list">
          {releases.map((r) => (
            <section key={r.version} className={`vh-release ${r.version === APP_VERSION ? "current" : ""}`}>
              <div className="vh-head">
                <span className="vh-version">v{r.version}</span>
                <span className="vh-title">{r.title}</span>
                {r.version === APP_VERSION && <span className="vh-badge">installiert</span>}
                <span className="vh-date">{formatReleaseDate(r.date)}</span>
              </div>
              <ul>
                {r.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          ))}
          {releases.length === 0 && <div className="menu-empty">Keine Version gefunden.</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
