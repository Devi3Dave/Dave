import { useEffect, useState } from "react";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUPS,
  assignCombo,
  comboFromEvent,
  conflictFor,
  defaultCombos,
  formatCombo,
  getAction,
  isModified,
  removeCombo,
  reservedReason,
  resetAction,
  resolveBindings,
} from "../../shared/shortcuts";
import { IS_MAC, shortcutStore, suspendShortcuts, useShortcutOverrides } from "../shortcuts";

/** A key press waiting for "Übernehmen" because another action already uses it. */
interface Pending {
  id: string;
  combo: string;
  from: string;
}

/** Legend of all shortcuts (searchable), where each one can be changed, added, removed and reset (TradingView: ⌘/ / Ctrl + /). */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const overrides = useShortcutOverrides();
  const bindings = resolveBindings(overrides, IS_MAC);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Records the next key combination for one action; Esc cancels.
  useEffect(() => {
    if (!recording) return;
    const resume = suspendShortcuts();
    const onKey = (ev: KeyboardEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === "Escape" && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) return setRecording(null);
      const combo = comboFromEvent(ev, IS_MAC);
      if (!combo) return;
      setRecording(null);
      const reserved = reservedReason(combo, IS_MAC);
      if (reserved) return setError(`${reserved} und kann nicht belegt werden.`);
      setError(null);
      const from = conflictFor(combo, bindings, IS_MAC, recording);
      if (from) return setPending({ id: recording, combo, from });
      shortcutStore.set(assignCombo(overrides, recording, combo, IS_MAC));
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      resume();
    };
  }, [recording, overrides]);

  // Esc closes the list (while not recording).
  useEffect(() => {
    if (recording) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (pending) setPending(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, pending, onClose]);

  const q = query.trim().toLowerCase();
  const visible = SHORTCUT_ACTIONS.filter((a) => {
    if (!q) return true;
    const keys = bindings[a.id].map((c) => formatCombo(c, IS_MAC)).join(" ");
    return `${a.label} ${a.group} ${keys}`.toLowerCase().includes(q);
  });
  const modifiedCount = Object.keys(overrides).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Tastenkürzel</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <input
          className="search"
          placeholder="Suchen: Aktion oder Taste, z. B. „Fibonacci“ oder „⌥“"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={!("ontouchstart" in window)}
        />
        <div className="sc-hint">
          <span className="sc-tv">TV</span> = Standard wie in TradingView. Auf {IS_MAC ? "Mac und iPad stehen ⌘ und ⌥ für Strg und Alt" : "Mac und iPad gelten ⌘ statt Strg und ⌥ statt Alt"}.
          Tippe auf <b>+</b> und drücke die neue Tastenkombination; ✕ entfernt ein Kürzel.
        </div>
        {error && <div className="sc-error">{error}</div>}
        {pending && (
          <div className="sc-conflict">
            <span>
              <kbd>{formatCombo(pending.combo, IS_MAC)}</kbd> gehört schon zu „{getAction(pending.from)?.label}“. Dorthin verschieben?
            </span>
            <button
              className="primary"
              onClick={() => {
                shortcutStore.set(assignCombo(overrides, pending.id, pending.combo, IS_MAC));
                setPending(null);
              }}
            >
              Übernehmen
            </button>
            <button onClick={() => setPending(null)}>Abbrechen</button>
          </div>
        )}
        <div className="sc-list">
          {SHORTCUT_GROUPS.map((group) => {
            const rows = visible.filter((a) => a.group === group);
            if (!rows.length) return null;
            return (
              <section key={group}>
                <h3>{group}</h3>
                {rows.map((a) => {
                  const combos = bindings[a.id];
                  const changed = isModified(overrides, a.id);
                  const def = defaultCombos(a, IS_MAC).map((c) => formatCombo(c, IS_MAC)).join(", ") || "keins";
                  return (
                    <div className={`sc-row ${recording === a.id ? "recording" : ""}`} key={a.id}>
                      <span className="sc-label">
                        {a.label}
                        {a.tv && (
                          <span className="sc-tv" data-tip="Standard-Kürzel aus der TradingView-Dokumentation">
                            TV
                          </span>
                        )}
                      </span>
                      <span className="sc-keys">
                        {combos.map((c) => (
                          <span className="sc-chip" key={c}>
                            <kbd>{formatCombo(c, IS_MAC)}</kbd>
                            <button aria-label="Kürzel entfernen" data-tip="Kürzel entfernen" onClick={() => shortcutStore.set(removeCombo(overrides, a.id, c, IS_MAC))}>
                              ✕
                            </button>
                          </span>
                        ))}
                        {recording === a.id ? (
                          <button className="sc-add active" onClick={() => setRecording(null)}>
                            Tasten drücken … (Esc)
                          </button>
                        ) : (
                          <button
                            className="sc-add"
                            aria-label="Kürzel hinzufügen"
                            data-tip="Neue Tastenkombination aufnehmen"
                            onClick={() => {
                              setError(null);
                              setPending(null);
                              setRecording(a.id);
                            }}
                          >
                            +
                          </button>
                        )}
                        {changed && (
                          <button className="sc-reset" aria-label="Zurücksetzen" data-tip={`Zurücksetzen auf Standard: ${def}`} onClick={() => shortcutStore.set(resetAction(overrides, a.id))}>
                            ↺
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </section>
            );
          })}
          {(!q || "esc abbrechen cursor".includes(q)) && (
            <section>
              <h3>Fest</h3>
              <div className="sc-row">
                <span className="sc-label">Abbrechen: Zeichnen, Auswahl, Menüs und Dialoge</span>
                <span className="sc-keys">
                  <kbd>Esc</kbd>
                </span>
              </div>
            </section>
          )}
          {visible.length === 0 && <div className="menu-empty">Kein Kürzel gefunden.</div>}
        </div>
        <div className="dialog-actions">
          <button
            className="danger"
            disabled={modifiedCount === 0}
            onClick={() => {
              if (window.confirm("Alle Tastenkürzel auf die Standardwerte zurücksetzen?")) shortcutStore.set({});
            }}
          >
            Alle zurücksetzen{modifiedCount ? ` (${modifiedCount} geändert)` : ""}
          </button>
          <button className="primary" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
