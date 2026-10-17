# ChartAI – TradingView-Klon mit Claude

React-Chart-App im Stil von TradingView mit gängigen Indikatoren, Zeichenwerkzeugen und einer
Claude-Schnittstelle: Claude sieht den Chart (Kerzen, Indikatoren, Zeichnungen und einen Screenshot),
analysiert ihn und kann selbst Indikatoren hinzufügen sowie Linien, Zonen, Fibonacci-Retracements,
Texte und Marker einzeichnen.

![Aufbau](https://img.shields.io/badge/React-19-61dafb) ![Charts](https://img.shields.io/badge/lightweight--charts-5-2962ff) ![Claude](https://img.shields.io/badge/Claude-Opus%205.5-d97757)

## Schnellstart

```bash
cd tradingview-clone
npm install
cp .env.example .env        # ANTHROPIC_API_KEY eintragen
npm run dev                 # Web: http://localhost:5173, API: http://localhost:8787
```

Produktion: `npm run build && npm start` (Express liefert dann auch das Frontend auf Port 8787 aus).

## Funktionen

**Chart**
- Kerzen, Balken, Heikin Ashi, Linie, Fläche · Zeiteinheiten 1m – 1w
- Kursdaten: Krypto über Binance (inkl. Live-Updates per WebSocket), Aktien/Indizes/Forex über Yahoo
  Finance (z. B. `AAPL`, `^GDAXI`, `EURUSD=X`). Ohne Internet werden Demo-Daten erzeugt.
- Indikator-Panels mit verschiebbaren Trennern, Legende mit Werten unter dem Fadenkreuz,
  Einstellungen (Parameter/Farben), Ein-/Ausblenden
- Layout (Symbol, Indikatoren, Zeichnungen) wird im Browser gespeichert

**Indikatoren (32)**
SMA, EMA, WMA, HMA, VWMA, VWAP, Bollinger Bands, Keltner Channels, Donchian Channels, Envelope,
Ichimoku Cloud, Parabolic SAR, Supertrend, Pivot Points, Volumen, OBV, MFI, CMF, RSI, MACD,
Stochastic, Stochastic RSI, CCI, Williams %R, ROC, Momentum, Awesome Oscillator, TRIX, ADX/DMI,
ATR, Bollinger Band Width, Standardabweichung.

**Zeichenwerkzeuge**
Trendlinie, Strahl, horizontale/vertikale Linie, Rechteck/Zone, Fibonacci-Retracement, Text,
Radierer, Magnet (rastet an OHLC ein). `Esc` bricht ab.

**Claude**
- Chat-Panel mit Streaming, Schnell-Prompts, wählbarem Aufwand (Effort) und optionalem Screenshot
- Jede Nachricht enthält einen `<chart_state>` mit den letzten Kerzen, aktiven Indikatoren
  (inkl. aktueller Werte) und Zeichnungen
- Tools, die Claude nutzen kann:

| Tool | Wirkung |
|---|---|
| `get_chart_data` | OHLCV-Kerzen lesen |
| `get_indicator_values` | Indikator berechnen, ohne ihn einzuzeichnen |
| `add_indicator` / `remove_indicator` | Indikatoren hinzufügen/entfernen |
| `set_chart` | Symbol, Zeiteinheit oder Charttyp wechseln |
| `draw_trendline`, `draw_horizontal_line`, `draw_vertical_line`, `draw_zone`, `draw_fibonacci`, `add_text`, `add_markers` | Zeichnen |
| `remove_drawing`, `clear_drawings` | Zeichnungen entfernen |
| `take_screenshot` | Chart als Bild prüfen |

Von Claude erstellte Objekte sind mit ✦ markiert und lassen sich über „Zeichnungen ✕“ im Panel
gesammelt entfernen.

## Architektur

```
shared/   math.ts        Indikator-Mathematik (rein, getestet)
          indicators.ts  Registry: Parameter, Ausgaben, Farben, Panels
          tools.ts       Zod-Schemas der Claude-Tools (Quelle für API-Schema und Validierung)
server/   index.ts       Express: /api/chat (SSE-Proxy zur Claude API), /api/klines
          marketData.ts  Binance / Yahoo / Demo-Daten
          prompt.ts      Systemprompt inkl. Indikatorkatalog
src/      chart/         ChartEngine (lightweight-charts v5), Zeichen- und Band-Primitives
          claude/        Kontextaufbau, Tool-Ausführung im Browser, Agent-Loop (useClaudeChat)
          components/    TopBar, Werkzeugleiste, Chart, Indikator-Dialoge, Claude-Panel
```

Der API-Schlüssel bleibt auf dem Server. Der Server streamt Claudes Antwort per Server-Sent Events;
Tool-Aufrufe werden im Browser gegen den Chart ausgeführt und die Ergebnisse im nächsten Request
zurückgegeben (der Verlauf wird unverändert inklusive Thinking-Blöcken weitergereicht).

Modell-Standard ist `claude-opus-5-5` mit adaptivem Thinking, Prompt-Caching und serverseitigem
Refusal-Fallback (`fallbacks: "default"`). Ein anderes Modell lässt sich mit `CLAUDE_MODEL` in `.env`
setzen.

## Skripte

| Befehl | Zweck |
|---|---|
| `npm run dev` | Vite + API-Server mit Hot Reload |
| `npm run build` | Typecheck und Produktions-Build |
| `npm start` | Produktionsserver (nach `build`) |
| `npm test` | Vitest (Indikatoren, Tool-Schemas) |
| `npm run typecheck` | TypeScript-Prüfung |

> Hinweis: Die Analysen von Claude sind keine Anlageberatung.
