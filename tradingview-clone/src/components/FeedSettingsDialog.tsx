import { useState } from "react";
import { createPortal } from "react-dom";
import { feedSettings, useFeedSettings, useFeedStatus } from "../market/exchangeFeed";
import { symbolFor } from "../assetStore";
import { charts } from "../store";

/** Own Twelve Data key for exchange prices of stocks, indices and forex. */
export function FeedSettingsDialog({ onClose }: { onClose: () => void }) {
  const current = useFeedSettings();
  const status = useFeedStatus();
  const [apiKey, setApiKey] = useState(current.apiKey);
  const save = (key: string) => {
    feedSettings.set({ apiKey: key });
    // Running charts reload from the new source (stocks switch between exchange symbol and Binance perpetual).
    for (const c of charts) if (c.get().source) void c.load(symbolFor(c.get().symbol), c.get().interval);
    onClose();
  };
  // Opened from the chart legend, so it is rendered at the page root (the legend clips and does not wrap text).
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Börsenkurse (Twelve Data)</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <label className="field">
          API-Schlüssel
          <input
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Twelve-Data-Schlüssel"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value.trim())}
          />
        </label>
        <p className="hint">
          Mit Schlüssel laden US-Aktien, Xetra-Aktien, Indizes und Forex ihre Kurse von Twelve Data und der Aktualitäts-Nachweis zeigt „Börsenkurs“. Krypto bleibt bei
          Binance. Ohne Schlüssel bleibt alles wie bisher. Welche Börsen in Echtzeit kommen, hängt von deinem Tarif ab: der Nachweis misst das Alter jedes Kurses.
        </p>
        <p className="hint">
          Der Schlüssel wird nur auf diesem Gerät gespeichert und nur an api.twelvedata.com und ws.twelvedata.com gesendet. Er gibt nur Kursdaten frei, kein Geld
          und keine Orders. Einen Schlüssel bekommst du unter twelvedata.com → Dashboard → API Keys.
        </p>
        {status.error && <div className="fresh-error">Letzter Fehler: {status.error}</div>}
        {status.refused.length > 0 && (
          <p className="hint">Kein Live-Stream im Tarif für {status.refused.join(", ")}: diese Charts laden während der Börsenzeit jede Minute neu.</p>
        )}
        <div className="modal-actions">
          {current.apiKey && <button onClick={() => save("")}>Schlüssel löschen</button>}
          <button className="send" onClick={() => save(apiKey)}>
            Speichern
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
