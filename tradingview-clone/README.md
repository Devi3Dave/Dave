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

## Auf dem iPad (Web-App)

ChartAI läuft auch ohne Server als installierbare Web-App:
**https://devi3dave.github.io/Dave/chartai/**

1. Den Link in **Safari** auf dem iPad öffnen.
2. Teilen-Symbol → **„Zum Home-Bildschirm“** → Hinzufügen.
3. ChartAI vom Home-Bildschirm starten, im Claude-Panel auf **⚙** tippen und den API-Schlüssel
   eintragen (erstellen unter platform.claude.com → API Keys).

Der Schlüssel wird nur auf dem iPad gespeichert und direkt an `api.anthropic.com` gesendet.
Unterschiede zur Server-Version: Krypto-Kurse kommen live von Binance. Yahoo ist ohne Server nicht
abrufbar (blockiert Browser-Zugriffe); Gold, Silber, Öl und viele US-Aktien laden deshalb über die
TradFi-Perpetuals von Binance Futures (Kennzeichen „Perp“). DAX-Werte, Indizes ohne Perpetual,
Agrarrohstoffe und Forex zeigen auf dem iPad Demo-Daten.
Zeichnen per Touch: Werkzeug wählen und Punkte antippen.

Die Web-App wird bei jedem Push auf `master` per GitHub Actions gebaut (`npm run build:standalone`)
und zusammen mit der Fill & Sign-App auf GitHub Pages veröffentlicht.

## Funktionen

**Chart**
- Kerzen, Balken, Heikin Ashi, Linie, Fläche · Zeiteinheiten 1m – 1w, Monat (1Mo), Quartal (1Q),
  Jahr (1J) und „Alles“ (gesamte Historie in Wochenkerzen, komplett eingepasst)
- Kursdaten: Krypto über Binance (inkl. Live-Updates per WebSocket), Aktien/Indizes/Forex über Yahoo
  Finance (z. B. `AAPL`, `^GDAXI`, `EURUSD=X`), Binance-Futures-Perpetuals wie `XAUUSDT` (Gold),
  `CLUSDT` (Öl) oder `TSLAUSDT`. Ohne Internet werden Demo-Daten erzeugt.
- Asset-Auswahl in der Kopfzeile: Drop-down mit gängigen Assets nach Rubriken (Krypto, Aktien,
  Indizes & ETFs, Edelmetalle, Rohstoffe, Forex) und Favoriten; 🔍 öffnet die Suche über alle
  Binance-Märkte, ebenfalls nach Rubriken, mit ☆ zum Speichern von Favoriten. Jede Zeile zeigt die
  Datenquelle (Live, Perp, Yahoo oder Demo).
- Indikator-Panels mit verschiebbaren Trennern, Legende mit Werten unter dem Fadenkreuz,
  Einstellungen (Parameter/Farben), Ein-/Ausblenden
- Chart-Einstellungen (⚙ in der Kopfzeile): Preisskala Normal/Log/%/Index 100, Achse links/rechts,
  invertieren; aktueller Kurs als Achsen-Label und Linie, Countdown bis Kerzenschluss, Hoch/Tief des
  sichtbaren Bereichs, Kurs mit 24-h-Veränderung in der Kopfzeile; Zeitzone, Sekunden, Gitter, Fadenkreuz
- Schnellbuttons unten rechts im Chart: log, %, Auto-Skalierung, Ansicht zurücksetzen
- Hinweise beim Überfahren mit der Maus für alle Buttons (auf Touch-Geräten ausgeblendet)
- Mehrere Charts gleichzeitig (Layout-Button ▢ in der Kopfzeile): 1, 2 nebeneinander/übereinander,
  3 (einer groß) oder 2 × 2 – jeder mit eigenem Symbol, Zeiteinheit, Indikatoren und Zeichnungen.
  Der angetippte Chart ist aktiv (blauer Rahmen); Kopfzeile, Werkzeuge und Claude wirken auf ihn.
  Optional wird die Zeiteinheit in allen Charts synchron gewechselt
- Layout (Symbol, Indikatoren, Zeichnungen, Einstellungen) wird je Chart im Browser gespeichert
- Vorlagen (▤ Vorlagen): fertige Setups Scalping, Daytrading, Swing, Krypto-Zyklus und
  Smart Money, Mustererkennung; eigene Vorlagen aus dem aktiven Chart speichern (Indikatoren mit Parametern/Farben,
  optional Zeiteinheit, Symbol und Zeichnungen) und ganze Arbeitsbereiche (Layout mit allen Charts)
- Versionsnummer neben dem Logo; sie zeigt „Update“, sobald eine neuere Version online ist –
  Antippen lädt sie

**Indikatoren (82)**
- Favoriten: im Indikator-Dialog mit ☆ markieren; sie stehen dort oben und im ★-Menü der Kopfzeile
- *Orderblöcke & Buy/Sell-Signale (MTF):* Smart-Money-Orderblöcke (letzte Gegenkerze vor einem
  Strukturbruch) auf dem Chart-Zeitrahmen und zwei wählbaren höheren Zeitrahmen (Standard 4h und 1d),
  als Zonen bis zur Invalidierung; Buy/Sell-Signal beim ersten Retest mit Reaktionskerze.
  Höhere Zeitrahmen werden aus abgeschlossenen Kerzen gebildet (kein Repainting)
- *Muster:* Kerzenmuster (Engulfing, Hammer, Hanging Man, Inverted Hammer, Shooting Star, Morning/Evening
  Star, Harami, Piercing Line, Dark Cloud Cover, Three White Soldiers/Black Crows, optional Doji) als Marker;
  Chartformationen (Doppeltop/-boden, Schulter-Kopf-Schulter auch invers, aktuelles Dreieck) mit
  Nackenlinie, Bestätigung und Kursziel
- *Krypto:* Liquidations-Heatmap (geschätzt), Bull Market Support Band (20W SMA / 21W EMA), Pi Cycle Top, Mayer Multiple,
  Cumulative Volume Delta (CVD), Volume Delta (mit Binance-Taker-Volumen)
- *Gleitende Durchschnitte:* SMA, EMA, WMA, HMA, VWMA, DEMA, TEMA, SMMA/RMA, KAMA, ALMA, LSMA,
  McGinley Dynamic, EMA Ribbon (8/13/21/34/55), MA Cross (Golden/Death Cross)
- *Trend:* Ichimoku, Supertrend, Parabolic SAR, Chandelier Exit, Williams Alligator, Williams Fractals,
  ZigZag, Lineare Regression (Kanal), Envelope, Pivot Points, ADX/DMI, Aroon, Vortex
- *Momentum:* RSI (mit MA), MACD, Stochastic, Stochastic RSI, WaveTrend (LazyBear),
  Squeeze Momentum (LazyBear), KDJ, CCI, Williams %R, ROC, Momentum, Awesome Oscillator, TRIX,
  Ultimate Oscillator, Fisher Transform, Connors RSI, Schaff Trend Cycle, PPO, KST, Coppock Curve, DPO
- *Volatilität:* Bollinger Bands, %B, Band Width, Keltner, Donchian, ATR, Historische Volatilität,
  Choppiness Index, Standardabweichung
- *Volumen:* Volumen, Volume Profile (Fixed Range, POC/VAH/VAL), VWAP, VWAP mit σ-Bändern,
  Anchored VWAP, OBV, MFI, CMF, A/D, Chaikin Oscillator, Elder Force Index, Klinger, Ease of Movement,
  Volume Oscillator, PVT, Relative Volume (RVOL)

**Orderbuch & Liquidationen** (Seitenleiste rechts, nur Binance-Krypto)
- *Orderbuch:* Live-Orderbuch von Binance Spot oder USDⓈ-M Futures (lokal synchronisiert aus
  Snapshot + Diff-Stream, automatischer Resync bei Lücken), Gruppierung, Tiefenbalken, Spread,
  Kauf-/Verkaufsverhältnis; Antippen einer Stufe zeichnet sie als Linie in den Chart
- *Liquidations-Heatmap (geschätzt):* Modell wie bei CoinGlass – je Kerze neue Positionen mit 10×/25×/50×/100×
  Hebel, Niveaus verschwinden, sobald der Kurs sie erreicht; dazu die stärksten Cluster über/unter dem Kurs
- *Heatmap-Ansicht im CoinGlass-Stil (🔥 Heatmap in der Kopfzeile):* Vollbild mit Kurslinie, Farblegende,
  Zeiträumen 12 h bis 1 Jahr, Kontrast/Schwelle und Tooltip mit geschätztem Liquidationsvolumen je Preis.
  Das Modell nutzt wie CoinGlass das Open Interest von Binance Futures (neue Positionen bei steigendem,
  anteilig geschlossene bei fallendem OI; ≈ letzte 30 Tage), davor kalibriertes Volumen
- *Live-Liquidationen:* echte Liquidationen von Binance Futures als Blasen im Chart und als Liste
  (Binance liefert höchstens eine pro Sekunde und Symbol)
- Claude kann beides über `get_orderbook` und `get_liquidations` auswerten

**Zeichenwerkzeuge**
Trendlinie, Strahl, horizontale/vertikale Linie, Rechteck/Zone, Fibonacci-Retracement,
Fibonacci-Extension, Auto-Fibonacci (größter Swing im sichtbaren Bereich), paralleler Kanal,
Messwerkzeug (Δ Preis, Δ %, Kerzen, Δ Zeit), Pinsel (Freihand), Text, Long-/Short-Position,
Radierer, Magnet (rastet an OHLC ein). `Esc` bricht ab.

*Long-/Short-Position (▲/▼):* Einstieg, Stop-Loss und Take-Profit nacheinander antippen (der letzte Tipp
legt auch das Ende der Zeitspanne fest). Angezeigt werden Chance/Risiko, Abstand in % und Betrag,
Positionsgröße aus Kontogröße × Risiko-%, bei Hebel die geschätzte Liquidation, und ob Ziel oder Stop
erreicht wurde (Gewinn/Verlust). Antippen der Position öffnet ihre Einstellungen.

**Trading-Rechner (🧮 Rechner in der Kopfzeile)**
Vollbild-Seite mit editierbaren Rechnern; Startwerte sind die Beispiele aus der Strategie, Eingaben
werden im Browser gespeichert, „↺ Beispielwerte“ setzt sie zurück. Zu jedem Rechner gibt es eine
ausklappbare Erklärung in einfacher Sprache (was die Formel bedeutet, wie man sie anwendet, Beispiel),
„💡 Erklärungen“ klappt alle ein oder aus. Das Risiko pro Trade (1 R) gilt
für alle Rechner.
- *Positionsgröße:* Risiko ÷ |Einstieg − Stop| mit Stop-Abstand, Positionswert und Preisleiter
  (Stop, Einstieg, Ziel im gewählten R-Multiple)
- *Erwartungswert:* Trefferquote × Ø Gewinn − Verlustquote × Ø Verlust, in R und $, Break-even-Trefferquote,
  Kurve Erwartungswert vs. Trefferquote
- *Simulation:* 30 zufällige Trade-Serien als Equity-Kurven mit Drawdown, längster Verlustserie und
  Wahrscheinlichkeit langer Verlustserien
- *R-Multiple & Gewinn:* Gewinn und Zielpreis je R (Standard 1:4), Balkendiagramm 1R–15R
- *Fibonacci:* Retracement (23,6 / 38,2 / 50 / 61,8 / 78,6 %) und Trend-based Extension
  (1,618 / 2,618 / 3,618) aus den Punkten A, B, C mit Grafik
- *Hebel & Margin:* Positionswert ÷ Hebel, geschätzte Liquidation und Warnung, wenn sie vor dem Stop liegt

**Trading-Journal (📒 Journal in der Kopfzeile)**
Vollbild-Seite, um abgeschlossene Trades festzuhalten (Datum, Symbol, Long/Short, Einstieg, Stop,
Ausstieg, Menge, Gebühren, Setup, Notiz – oder nur das Ergebnis in $). Die Trades werden im Browser
gespeichert; „⤓ Backup“ sichert sie als Datei (iPad: „In Dateien sichern“), „⤒ Wiederherstellen“
liest sie wieder ein, „⇩ CSV“ exportiert sie für Excel/Numbers.
- Oben die Antwort: profitabel oder nicht, mit Gesamtergebnis in $ und R
- Equity-Kurve (kumuliertes Ergebnis je Trade, in $ oder R) mit Break-even-Linie und Höchststand
- Trefferquote, Profit-Faktor, Ø pro Trade, Ø Gewinn/Verlust, max. Drawdown, längste Verlustserie
- Balken je Trade und je Monat, Filter nach Symbol oder Setup, Trades bearbeiten und löschen
- Menge auf Knopfdruck aus dem 1 R des Rechners

**Demo-Trading mit Spielgeld (💰 Demo in der Kopfzeile oder Seitenleiste)**
Ein virtuelles Konto (Start 10.000 $, frei wählbar) zum Üben mit jedem Asset, das der Chart laden
kann: Krypto, Aktien, Indizes, Metalle, Rohstoffe, Forex. Gehandelt wird zum aktuellen Kurs des
aktiven Charts, wie bei einem Futures-Konto mit isolierter Margin; das Konto liegt nur im Browser.
- Kaufen/Long oder Verkaufen/Short, Größe als Einsatz in $, als Risiko in % (über den Stop) oder als Menge
- Hebel 1×–100×, Stop-Loss und Take-Profit (Schnellwahl 1/2/5 % bzw. Chance-Risiko 1:2 und 1:3)
- Vorschau: Positionswert, Margin, Gebühr, Verlust bei SL, Gewinn bei TP, Liquidationspreis
- Offene Positionen mit laufendem G/V, SL/TP nachträglich verschieben, schließen per Tipp
- SL, TP und Liquidation lösen automatisch aus (solange die App offen ist), mit Hinweis oben im Bild
- Einstieg, SL, TP und Liquidation als Linien im Chart; laufendes Ergebnis in der Kopfzeile
- SL- und TP-Linie im Chart mit Finger oder Maus ziehen, um sie während des Trades zu verschieben
  (das Label zeigt den Gewinn/Verlust beim Auslösen); fehlt SL oder TP, zieht man ihn aus der
  Einstiegslinie heraus (nach oben/unten je nach Seite). Gespeichert wird beim Loslassen.
- Historie mit Trefferquote und Gebühren; Trades einzeln, alle oder automatisch ins Journal (Setup „Demo“)
- Gebühr pro Seite einstellbar (0 / 0,02 / 0,05 / 0,1 %), Konto jederzeit neu starten

**Börsenzeiten (🕐 Börsen in der Kopfzeile)**
Öffnungs- und Schließzeiten von 16 großen Börsen (NYSE, Nasdaq, TSX, LSE, Xetra, Börse Frankfurt,
Euronext, SIX, Tokio, Hongkong, Shanghai, Shenzhen, KRX, SGX, NSE, ASX) in der automatisch erkannten
Zeitzone des Geräts.
- Status live: offen, Mittagspause oder geschlossen, mit Countdown bis zur nächsten Änderung
- Zeiten vor Ort und auf deiner Uhr, Mittagspausen der asiatischen Börsen, 24-h-Leiste je Börse
- Sommer-/Winterzeit auf beiden Seiten; Hinweis, wenn sich die Zeit auf deiner Uhr demnächst
  verschiebt (z. B. NYSE 14:30 statt 15:30 in der Woche zwischen EU- und US-Umstellung)
- Angehakte Börsen erscheinen in allen Charts (Zeiteinheiten bis 4 h) als farbige Bereiche mit
  Linien bei Eröffnung und Schluss
- Wochenenden und Feiertage des jeweiligen Börsenlandes: an geschlossenen Tagen kein Bereich im
  Chart, Status „Feiertag“ und Hinweis auf den nächsten Feiertag. Berechnet für jedes Jahr (Ostern,
  „n-ter Wochentag“, chinesischer/koreanischer Mondkalender, islamischer Kalender, Ersatztage am
  Wochenende); nur die Hindu-Feste (NSE, Deepavali in Singapur) stehen in einer Tabelle (2025–2027).
  China ist näherungsweise, kurzfristige Sonderschließungen und verkürzte Tage fehlen

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
| `draw_fib_extension`, `draw_auto_fibonacci`, `draw_parallel_channel` | Fib-Extension, Auto-Fib, Kanal |
| `get_order_blocks` | Aktive Orderblöcke (mehrere Zeitrahmen) und letzte Buy/Sell-Signale |
| `get_patterns` | Kerzenmuster und Chartformationen erkennen |
| `draw_position` | Handelsidee als Long-/Short-Position mit Stop, Ziel und Positionsgröße |
| `remove_drawing`, `clear_drawings` | Zeichnungen entfernen |
| `get_orderbook` | Live-Orderbuch mit Wänden und Kauf-/Verkaufsverhältnis |
| `get_liquidations` | Geschätzte Liquidations-Cluster und Live-Liquidationen |
| `take_screenshot` | Chart als Bild prüfen |

Von Claude erstellte Objekte sind mit ✦ markiert und lassen sich über „Zeichnungen ✕“ im Panel
gesammelt entfernen.

## Architektur

```
shared/   math.ts        Indikator-Mathematik (rein, getestet)
          indicators.ts  Registry: Parameter, Ausgaben, Farben, Panels
          tools.ts       Zod-Schemas der Claude-Tools (Quelle für API-Schema und Validierung)
          claudeTurn.ts  Ein gestreamter Claude-Turn (Server und Standalone-Build)
          marketData.ts  Binance / Yahoo / Demo-Daten
          demoTrading.ts Demo-Konto: Positionen, Margin, SL/TP, Liquidation (rein, getestet)
          prompt.ts      Systemprompt inkl. Indikatorkatalog
server/   index.ts       Express: /api/chat (SSE-Proxy zur Claude API), /api/klines
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
| `npm run build:standalone` | Build ohne Server (iPad/GitHub Pages) |
| `npm run icons` | App-Icons in `public/` neu erzeugen |
| `npm start` | Produktionsserver (nach `build`) |
| `npm test` | Vitest (Indikatoren, Tool-Schemas) |
| `npm run typecheck` | TypeScript-Prüfung |

> Hinweis: Die Analysen von Claude sind keine Anlageberatung.
