import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChartEngine } from "../chart/ChartEngine";
import { useClaudeChat, type AssistantPart, type Effort } from "../claude/useClaudeChat";
import { MODELS, STANDALONE, claudeSettings, useClaudeSettings } from "../config";
import { clearDrawings } from "../store";

const TOOL_LABELS: Record<string, string> = {
  get_chart_data: "Kursdaten lesen",
  get_indicator_values: "Indikator berechnen",
  add_indicator: "Indikator hinzufügen",
  move_indicator: "Indikator verschieben",
  remove_indicator: "Indikator entfernen",
  set_chart: "Chart wechseln",
  draw_trendline: "Trendlinie zeichnen",
  draw_horizontal_line: "Linie zeichnen",
  draw_vertical_line: "Vertikale zeichnen",
  draw_zone: "Zone zeichnen",
  draw_fibonacci: "Fibonacci zeichnen",
  add_text: "Text setzen",
  add_markers: "Marker setzen",
  remove_drawing: "Zeichnung entfernen",
  clear_drawings: "Zeichnungen löschen",
  take_screenshot: "Screenshot prüfen",
  get_orderbook: "Orderbuch lesen",
  get_liquidations: "Liquidationen lesen",
};

const QUICK_PROMPTS = [
  "Analysiere den aktuellen Chart: Trend, Schlüsselniveaus und Indikatorlage.",
  "Zeichne die wichtigsten Unterstützungs- und Widerstandszonen ein.",
  "Finde und zeichne die relevanten Trendlinien.",
  "Zeichne ein Fibonacci-Retracement über den letzten großen Swing.",
  "Füge RSI und MACD hinzu und markiere Divergenzen im Chart.",
  "Erstelle ein Long- und ein Short-Szenario mit Einstieg, Stop und Zielen im Chart.",
  "Wo liegen die großen Liquidations-Cluster und Orderbuch-Wände? Zeichne sie ein.",
];

function Part({ part }: { part: AssistantPart }) {
  switch (part.type) {
    case "text":
      return (
        <div className="md">
          <Markdown remarkPlugins={[remarkGfm]}>{part.text}</Markdown>
        </div>
      );
    case "thinking":
      return part.text.trim() ? (
        <details className="thinking">
          <summary>Denkprozess</summary>
          <p>{part.text}</p>
        </details>
      ) : null;
    case "tool":
      return (
        <div className={`tool-chip ${part.status}`}>
          <span className="tool-icon">{part.status === "running" ? "⟳" : part.status === "done" ? "✓" : "!"}</span>
          {TOOL_LABELS[part.name] ?? part.name}
          {part.summary && <span className="tool-summary"> · {part.summary}</span>}
        </div>
      );
    case "notice":
      return <div className={`notice ${part.level}`}>{part.text}</div>;
  }
}

export function ClaudePanel({ getEngine }: { getEngine: () => ChartEngine | null }) {
  const { items, busy, send, stop, reset } = useClaudeChat(getEngine);
  const [input, setInput] = useState("");
  const [effort, setEffort] = useState<Effort>("high");
  const [screenshot, setScreenshot] = useState(true);
  const [serverModel, setServerModel] = useState<string | null>(null);
  const [serverKey, setServerKey] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const settings = useClaudeSettings();
  const model = STANDALONE ? settings.model : serverModel;
  const apiKey = STANDALONE ? Boolean(settings.apiKey) : serverKey;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (STANDALONE) return;
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        setServerModel(h.model);
        setServerKey(h.apiKey);
      })
      .catch(() => setServerModel(null));
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items]);

  const submit = (text = input) => {
    if (!text.trim() || busy) return;
    void send(text, { effort, screenshot });
    setInput("");
  };

  return (
    <aside className="claude-panel">
      <div className="claude-head">
        <div>
          <strong>✦ Claude</strong>
          {model && <span className="model">{model}</span>}
        </div>
        <div className="claude-head-actions">
          <button data-tip="Alle von Claude erstellten Zeichnungen und Marker entfernen" onClick={() => clearDrawings("claude")}>
            Zeichnungen ✕
          </button>
          <button data-tip="Neues Gespräch beginnen (spart Kosten bei langen Verläufen)" onClick={reset}>
            Neu
          </button>
          {STANDALONE && (
            <button data-tip={"Claude-Einstellungen\nAPI-Schlüssel und Modell"} aria-label="Claude-Einstellungen" onClick={() => setShowSettings(true)}>
              ⚙
            </button>
          )}
        </div>
      </div>

      <div className="claude-messages" ref={listRef}>
        {!apiKey &&
          (STANDALONE ? (
            <div className="notice error">
              Noch kein API-Schlüssel hinterlegt.{" "}
              <button className="link" onClick={() => setShowSettings(true)}>
                Jetzt eintragen
              </button>
            </div>
          ) : (
            <div className="notice error">
              Kein <code>ANTHROPIC_API_KEY</code> gesetzt. Lege <code>tradingview-clone/.env</code> an (siehe <code>.env.example</code>) und starte den Server neu – oder melde dich mit <code>ant auth login</code> an.
            </div>
          ))}
        {items.length === 0 && (
          <div className="claude-empty">
            <p>Frag Claude nach einer Analyse oder lass Indikatoren und Linien einzeichnen. Claude sieht Kursdaten, Indikatoren, Zeichnungen und einen Screenshot des Charts.</p>
            <div className="quick">
              {QUICK_PROMPTS.map((q) => (
                <button key={q} onClick={() => submit(q)} disabled={busy}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((item, i) =>
          item.role === "user" ? (
            <div key={i} className="msg user">
              {item.text}
            </div>
          ) : (
            <div key={i} className="msg assistant">
              {item.parts.map((p, k) => (
                <Part key={k} part={p} />
              ))}
              {item.streaming && <span className="cursor-blink">▍</span>}
            </div>
          ),
        )}
      </div>

      <div className="claude-input">
        <textarea
          value={input}
          placeholder="z. B. „Zeichne mir die Bollinger Bänder und erkläre den Squeeze“"
          rows={3}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="claude-input-row">
          <label data-tip={"Denktiefe von Claude\nHöher = gründlicher, aber langsamer und teurer"}>
            Aufwand
            <select value={effort} onChange={(e) => setEffort(e.target.value as Effort)}>
              <option value="low">niedrig</option>
              <option value="medium">mittel</option>
              <option value="high">hoch</option>
              <option value="xhigh">sehr hoch</option>
              <option value="max">maximal</option>
            </select>
          </label>
          <label data-tip={"Screenshot des Charts mitsenden\nClaude sieht dann auch die Grafik (etwas höhere Kosten)"}>
            <input type="checkbox" checked={screenshot} onChange={(e) => setScreenshot(e.target.checked)} /> Screenshot
          </label>
          {busy ? (
            <button className="send stop" onClick={stop} data-tip="Antwort abbrechen">
              Stopp
            </button>
          ) : (
            <button className="send" onClick={() => submit()} disabled={!input.trim()} data-tip="Nachricht senden (Enter)">
              Senden
            </button>
          )}
        </div>
      </div>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </aside>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const current = useClaudeSettings();
  const [apiKey, setApiKey] = useState(current.apiKey);
  const [model, setModel] = useState(current.model);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Claude-Einstellungen</h2>
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
            placeholder="sk-ant-…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value.trim())}
          />
        </label>
        <label className="field">
          Modell
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          Der Schlüssel wird nur auf diesem Gerät gespeichert und direkt an api.anthropic.com gesendet. Einen Schlüssel erstellst du unter platform.claude.com → API Keys.
        </p>
        <div className="modal-actions">
          {current.apiKey && (
            <button
              onClick={() => {
                claudeSettings.set({ apiKey: "" });
                onClose();
              }}
            >
              Schlüssel löschen
            </button>
          )}
          <button
            className="send"
            onClick={() => {
              claudeSettings.set({ apiKey, model });
              onClose();
            }}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
