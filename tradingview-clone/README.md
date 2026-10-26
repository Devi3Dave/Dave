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

**iPad und Mac:** Die obere Leiste passt sich der Fensterbreite an. Auf schmaleren Bildschirmen
(iPad, MacBook) stehen die Zeiteinheiten in einem Menü und die Seiten-Buttons zeigen nur ihr Symbol
(Name als Hinweis beim Darüberfahren); im iPad-Hochformat bricht die Leiste in eine zweite Zeile um
statt seitlich aus dem Bild zu laufen. Pinch-Zoom vergrößert nur den Chart, nicht die ganze Seite
(in Safari auf dem Mac auch per Trackpad).

**Zeichnungen bearbeiten (wie in TradingView)**
Rechtsklick auf eine Linie (Mac) oder lange drücken (iPad) öffnet das Kontextmenü:
- Farbe (auch eigene), Linienstil, Linienstärke, Verlängern (Trendlinie), Beschriftung / Text
- Parallel verschieben und parallel kopieren: danach die neue Stelle antippen
- Klonen (⌘D), Kopieren (⌘C) und Einfügen (⌘V, auch in einen anderen Chart)
- Anordnen: Vordergrund, nach vorne, nach hinten, Hintergrund
- Sperren, Ausblenden (Rechtsklick auf leeren Chart blendet wieder ein), Rückgängig (⌘Z), Entfernen (⌫)
- Antippen wählt eine Zeichnung aus; ausgewählte Zeichnungen lassen sich mit Maus oder Finger ziehen,
  ihre Ankerpunkte einzeln verschieben. Mit der Maus lässt sich jede Zeichnung direkt ziehen.

Die Web-App wird bei jedem Push auf `master` per GitHub Actions gebaut (`npm run build:standalone`)
und zusammen mit der Fill & Sign-App auf GitHub Pages veröffentlicht.

## Funktionen

**Chart**
- Charttypen: Kerzen, hohle Kerzen, Balken, Heikin Ashi, Linie, Stufenlinie, Fläche, Baseline, Renko und
  Line Break. Hohle Kerzen: Farbe nach dem vorherigen Schluss, hohl wenn Schluss über Eröffnung (wie
  mplfinance `hollow_and_filled`). Baseline: grün über, rot unter dem Kurs von vor ~160 Kerzen.
  Renko (Steine nur bei Bewegung um eine Box, Umkehr erst nach zwei Boxen) und Line Break (Umkehr erst,
  wenn der Schluss die letzten 3 Linien durchbricht) nach Steve Nison, „Beyond Candlesticks“, bzw. der
  Referenz `stocktrends`; Boxgröße ATR 14 oder fest und Linienzahl in den Chart-Einstellungen.
  Indikatoren und Zeichnungen rechnen dort auf den Steinen/Linien, Claude und Alarme auf den Kerzen
- Zeiteinheiten wie bei TradingView Ultimate: Sekunden (1s, 5s, 15s, 30s – nur Binance-Spot-Krypto, live
  über den 1-s-Stream), Minuten bis 45m, Stunden bis 12h, 1D, 3D, Woche, Monat, Quartal, Jahr, und eigene
  Zeiteinheiten bis 7 Tage im Menü (z. B. 7m, 90s, 3h, 2D; werden gemerkt). Was die Datenquelle nicht direkt
  liefert, wird aus der größten passenden Kerze zusammengesetzt (z. B. 45m aus 15m, bei Binance bis zu
  5 Abrufe zurück); Zeiteinheiten, die keinen Tag glatt teilen, beginnen um 00:00 UTC neu.
- Zeiteinheiten 1m – 1w, Monat (1Mo), Quartal (1Q),
  Jahr (1J) und „Alles“ (gesamte Historie in Wochenkerzen, komplett eingepasst)
- Kursdaten: Krypto über Binance (inkl. Live-Updates per WebSocket), Aktien/Indizes/Forex über Yahoo
  Finance (z. B. `AAPL`, `^GDAXI`, `EURUSD=X`), Binance-Futures-Perpetuals wie `XAUUSDT` (Gold),
  `CLUSDT` (Öl) oder `TSLAUSDT`. Ohne Internet werden Demo-Daten erzeugt.
- Asset-Auswahl in der Kopfzeile: Drop-down mit gängigen Assets nach Rubriken (Krypto, Aktien,
  Indizes & ETFs, Edelmetalle, Rohstoffe, Forex) und Favoriten; 🔍 öffnet die Suche über alle
  Binance-Märkte, ebenfalls nach Rubriken, mit ☆ zum Speichern von Favoriten. Jede Zeile zeigt die
  Datenquelle (Live, Perp, Yahoo oder Demo).
- Aktualitäts-Nachweis: Ampel in der Legende jedes Charts (Live/Aktuell, Prüfen, Veraltet, Demo).
  Antippen zeigt den Nachweis: Geräteuhr gegen Binance-Serverzeit (Abweichung ± Messgenauigkeit),
  letzte Kerze gegen die Kerze, die jetzt laufen müsste (mit Börsenzeiten, Wochenenden und Feiertagen
  der Börse des Basiswerts), Alter und Übertragungszeit des letzten Live-Ticks und eine REST-Gegenprobe
  der letzten Kerze beim Datenserver. „Nachweis kopieren“ gibt das Protokoll mit UTC-Zeitstempeln aus.
  Ein Kursabgleich mit der Börse selbst (Xetra, Nasdaq …) ist ohne Börsen-Feed nicht möglich; Perp-Preise
  und Demo-Daten werden entsprechend gekennzeichnet.
- Börsenkurse mit eigenem Schlüssel (Aktualitäts-Nachweis → „Börsenkurs einrichten“): Mit einem
  Twelve-Data-Schlüssel laden US-Aktien, Xetra-Aktien, Indizes und Forex Kerzen und Live-Kurse direkt
  aus dem Browser von Twelve Data (auch auf dem iPad ohne Server), Kennzeichen „Börse“, und der Nachweis
  zeigt „Börsenkurs“. Der Schlüssel bleibt im localStorage des Geräts. Ob ein Kurs in Echtzeit kommt,
  hängt vom Tarif ab; der Nachweis misst das Alter jedes Live-Kurses. Streamt der Tarif ein Symbol nicht,
  lädt der Chart während der Börsenzeit jede Minute neu. Ohne Schlüssel oder bei Fehlern bleibt alles wie bisher.
- Aktualisieren (⟳ neben der Suche): lädt alle Charts neu, verbindet den Live-Stream neu und gleicht die
  Uhr ab. Automatisch passiert das, wenn die Live-Verbindung abreißt (Neuverbinden nach 2 s, 4 s … bis 30 s),
  beim Zurückkehren zur App, wenn das Netz wieder da ist und wenn der Live-Stream 1 min stillsteht.
  Quellen ohne Live-Stream (Yahoo) werden jede Minute neu geladen.
- Indikator-Panels mit verschiebbaren Trennern, Legende mit Werten unter dem Fadenkreuz,
  Einstellungen (Parameter/Farben), Ein-/Ausblenden
- Chart-Einstellungen (⚙ in der Kopfzeile): Preisskala Normal/Log/%/Index 100, Achse links/rechts,
  invertieren; aktueller Kurs als Achsen-Label und Linie, Countdown bis Kerzenschluss, Hoch/Tief des
  sichtbaren Bereichs, Kurs mit 24-h-Veränderung in der Kopfzeile; Zeitzone, Sekunden, Gitter, Fadenkreuz
- Schnellbuttons unten rechts im Chart: log, %, Auto-Skalierung, Ansicht zurücksetzen
- Hinweise beim Überfahren mit der Maus für alle Buttons (auf Touch-Geräten ausgeblendet)
- Mehrere Charts gleichzeitig (Layout-Button in der Kopfzeile): 1, 2 nebeneinander/übereinander,
  3 (einer groß oder nebeneinander), 2 × 2, 3 × 2 und 4 × 2 (iPad hochkant: zwei Spalten) – jeder mit eigenem
  Symbol, Zeiteinheit, Indikatoren und Zeichnungen. Der angetippte Chart ist aktiv (blauer Rahmen); Kopfzeile,
  Werkzeuge und Claude wirken auf ihn. Wie bei TradingView lassen sich Symbol, Zeiteinheit, Fadenkreuz
  (Standard an) und Zeitbereich (Scrollen/Zoomen des aktiven Charts) über alle Charts synchronisieren
- Chartdaten exportieren wie bei TradingView: Rechtsklick / langes Drücken in den leeren Chart → „Chartdaten als
  CSV“ (oder ⚙ Chart-Einstellungen). Die Tabelle enthält Zeit (UTC und Unix), OHLC, Volumen und jede sichtbare
  Indikatorlinie, so wie der Chart sie zeigt (Renko-Steine, im Replay bis zur aktuellen Kerze); Semikolon und
  Dezimalkomma für Excel/Numbers, auf dem iPad über „In Dateien sichern“
- Symbole vergleichen wie bei TradingView (⊕ neben der Suche): bis zu 5 weitere Kurse als Linien über dem Chart,
  die Preisachse zeigt dann Prozent ab der ersten sichtbaren Kerze; ✕ in der Legende entfernt einen Vergleich
- Spread-Charts: in der Suche zwei Symbole mit / - + * verbinden, z. B. `BTCUSDT/ETHUSDT` (Verhältnis),
  `BTCUSDT - ETHUSDT` oder `GC=F / SI=F`. Open, High, Low und Close werden Kerze für Kerze verrechnet; der Chart
  lädt alle 60 s neu (kein eigener Live-Stream)
- Volumenprofile wie bei TradingView (Indikatoren → Volumen): „Volume Profile (Visible Range)“ rechnet über die
  sichtbaren Kerzen und folgt Scrollen und Zoomen, „Session Volume Profile“ zeigt ein Profil je Tag, Woche oder Monat
  (UTC) ab der ersten Kerze der Sitzung, „Market Profile (TPO)“ zählt je Sitzung die 30-Minuten-Perioden pro Preis
  (Steidlmayer). Alle mit POC (orange) und Value Area (kräftiger)
- Watchlists (Seitenleiste „📋 Liste“): mehrere benannte Listen mit Kurs und 24-h-Veränderung (Krypto von Binance,
  sonst zum Vortagesschluss, alle 15 s neu); antippen öffnet den Chart, ☆ nimmt den aktiven Chart auf
- Krypto-Screener (📊 Screener in der Watchlist): alle Binance-USDT-Paare mit Kurs, 24 h, Volumen und Lage in der
  Tagesspanne, sortier- und filterbar (Volumen, Gewinner/Verlierer, Suche). „📈 Technik laden“ ergänzt für die ersten
  60 Paare 7 und 30 Tage, RSI(14) und den Abstand zu SMA 50/200, danach lässt sich auch nach überverkauft/überkauft
  und Trend filtern; ☆ legt ein Paar in die aktive Watchlist
- Layout (Symbol, Indikatoren, Zeichnungen, Einstellungen) wird je Chart im Browser gespeichert
- Vorlagen (▤ Vorlagen): fertige Setups Nur Chart (ohne Indikatoren), Scalping, Daytrading, Swing, Krypto-Zyklus und
  Smart Money, Mustererkennung; eigene Vorlagen aus dem aktiven Chart speichern (Indikatoren mit Parametern/Farben,
  optional Zeiteinheit, Symbol und Zeichnungen) und ganze Arbeitsbereiche (Layout mit allen Charts)
- Versionsnummer neben dem Logo; sie zeigt „Update“, sobald eine neuere Version online ist –
  Antippen lädt sie

**Indikatoren (83)**
- Favoriten: im Indikator-Dialog mit ☆ markieren; sie stehen dort oben und im ★-Menü der Kopfzeile
- *Orderblöcke & Buy/Sell-Signale (MTF):* Smart-Money-Orderblöcke (letzte Gegenkerze vor einem
  Strukturbruch) auf dem Chart-Zeitrahmen und zwei wählbaren höheren Zeitrahmen (Standard 4h und 1d),
  als Zonen bis zur Invalidierung; Buy/Sell-Signal beim ersten Retest mit Reaktionskerze.
  Höhere Zeitrahmen werden aus abgeschlossenen Kerzen gebildet (kein Repainting)
- *Fair Value Gaps (FVG):* Drei-Kerzen-Imbalancen (bullisch: Tief von Kerze 3 über Hoch von Kerze 1,
  Kerze 2 grün; bärisch spiegelbildlich) als Zonen, bis der Kurs zurückkommt (Mitigation bei Berührung,
  50 % oder vollständig gefüllt; Mindestgröße in %). Definition nach smart-money-concepts (`smc.fvg`)
  bzw. „Fair Value Gap [LuxAlgo]“
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

**Alarme (🔔 Alarme in der Kopfzeile, Alt + A)**
Wie die Alarme von TradingView: ChartAI meldet sich mit Hinweis, Ton und optional einer Systemmitteilung,
sobald eine Bedingung eintritt.
- Bedingungen: kreuzt, kreuzt nach oben, kreuzt nach unten, größer als, kleiner als, tritt in Kanal ein,
  verlässt Kanal. Kreuzen ist wie `ta.crossover` / `ta.crossunder` in Pine Script definiert (jetzt über
  dem Wert, eine Kerze vorher darunter oder gleich)
- Überwacht wird der Kurs oder jede Linie eines Indikators im Chart (z. B. „RSI 14 kreuzt nach oben 30“)
- Auslösen: nur einmal, einmal pro Kerze oder einmal pro Kerzenschluss (nur abgeschlossene Kerzen)
- Rechtsklick / langes Drücken auf horizontale Linie, Trendlinie oder Zone → „Alarm hinzufügen“; der Alarm
  folgt der Zeichnung, wenn sie verschoben wird. Trendlinien gelten verlängert in beide Richtungen
- Preis-Alarme erscheinen als gestrichelte orange Linie mit 🔔 an der Preisachse; Liste mit Pausieren,
  Löschen und Verlauf der ausgelösten Alarme
- Geprüft wird bei jedem Live-Kurs des Charts; Alarme auf Symbole, die kein Chart zeigt, alle 15 s.
  Nur bei geöffneter App (ohne eigenen Server kann bei geschlossener App nichts auslösen); Demo-Daten
  lösen keine Alarme aus
- Claude kann Alarme anlegen, auflisten und löschen (`create_alert`, `list_alerts`, `delete_alert`)

**Bar-Replay (⏪ Replay in der Kopfzeile)**
Wie das Bar Replay von TradingView: den Chart an einer Kerze in der Vergangenheit abschneiden und die
folgenden Kerzen nacheinander aufdecken, um Setups ohne Blick in die Zukunft zu üben.
- Startkerze im Chart antippen (eine Linie zeigt, wo geschnitten wird) oder 🎲 Zufällig wählen
- ⏭ nächste Kerze (Shift + →), ⏮ eine Kerze zurück (Shift + ←, ohne offene Replay-Position),
  ▶/⏸ abspielen mit 0,5–10 Kerzen pro Sekunde, ⏪ zurückspulen: eine frühere Kerze antippen
- Intrabar-Replay (Auswahl „Kerze“ in der Replay-Leiste → z. B. 1m): jede Kerze baut sich wie bei TradingView aus
  Kerzen einer kleineren Zeiteinheit Schritt für Schritt auf; SL/TP im Replay-Konto lösen dann je Teilkerze aus.
  Die kleinere Zeiteinheit wird ab dem Replay-Zeitpunkt in Blöcken von Binance nachgeladen; bei anderen Quellen
  gibt es sie nur für die jüngste Zeit, ältere Kerzen kommen dann ganz. Bei Demo-Daten nicht verfügbar
- Indikatoren, Zeichnungen und Claude sehen nur die bereits aufgedeckten Kerzen
- Zeiteinheit wechseln bleibt am selben Zeitpunkt (nur abgeschlossene Kerzen werden gezeigt)
- Trading im Replay: solange der Replay-Chart aktiv ist, handelt 💰 Demo auf einem eigenen Replay-Konto
  zu den abgespielten Kursen. SL und TP lösen innerhalb einer Kerze aus (Weg Open → Tief/Hoch → Close),
  das Ergebnis steht in der Replay-Leiste. Das echte Demo-Konto bleibt unberührt; Replay-Trades lassen
  sich einzeln ins Journal übernehmen (Setup „Replay“).
- ✕ beendet das Replay und zeigt wieder den Live-Chart

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
| `get_fair_value_gaps` | Offene Fair Value Gaps mit Ober-/Unterkante und Abstand zum Kurs |
| `get_patterns` | Kerzenmuster und Chartformationen erkennen |
| `draw_position` | Handelsidee als Long-/Short-Position mit Stop, Ziel und Positionsgröße |
| `remove_drawing`, `clear_drawings` | Zeichnungen entfernen |
| `get_orderbook` | Live-Orderbuch mit Wänden und Kauf-/Verkaufsverhältnis |
| `get_liquidations` | Geschätzte Liquidations-Cluster und Live-Liquidationen |
| `create_alert`, `list_alerts`, `delete_alert` | Alarme auf Kurs oder Indikator anlegen, auflisten, löschen |
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
