/** One released version of ChartAI. */
export interface Release {
  version: string;
  /** Release day, YYYY-MM-DD. */
  date: string;
  title: string;
  changes: string[];
}

/**
 * Version history shown in the app (version badge → Versionshistorie), newest first.
 * Every version bump adds an entry on top; a test checks the first one matches package.json.
 * Written from the commit messages of each version.
 */
export const CHANGELOG: Release[] = [
  {
    version: "0.52.0",
    date: "2026-10-28",
    title: "FVG im Stil von Nephew_Sam_",
    changes: [
      "Neuer Indikator „FVG (Nephew_Sam_)“ unter Muster, zusätzlich zum bisherigen FVG",
      "Nachbau nach der öffentlichen Beschreibung des TradingView-Indikators, da dessen Code nicht öffentlich ist (Quelle: Annäherung)",
      "Einfache Drei-Kerzen-Lücke ohne Zusatzfilter, Chart-Zeitrahmen plus bis zu drei höhere Zeitrahmen",
      "Gefüllt per Docht oder Schlusskurs an der fernen Kante; gefüllte Lücken löschen oder grau stehen lassen",
      "Feste Länge in Kerzen, „Auf Kerzenschluss warten“ für höhere Zeitrahmen, Labels ein- und ausblendbar, Alarm bei neuer Lücke",
    ],
  },
  {
    version: "0.51.2",
    date: "2026-10-27",
    title: "Fadenkreuz-Sync mit dem Finger",
    changes: [
      "Fadenkreuz-Sync folgt jetzt dem Chart, in dem du zuletzt mit Finger oder Maus warst, statt dem „Hover“-Zustand",
      "Auf dem iPad blieb dieser am zuletzt angetippten Chart hängen: Bewegungen im anderen Chart kamen nicht an, und bei Live-Kursen sprang das Fadenkreuz zwischen beiden Zeitpunkten hin und her",
      "Nach dem Loslassen des Fingers bleibt das Fadenkreuz in allen Charts stehen, wie im berührten Chart",
    ],
  },
  {
    version: "0.51.1",
    date: "2026-10-27",
    title: "Versionshistorie passt aufs iPad",
    changes: [
      "Das Fenster der Versionshistorie wird nicht mehr abgeschnitten und liegt sauber über allen anderen Inhalten (auch über Hinweisen und Werkzeug-Menüs)",
      "Titel und Suche bleiben stehen, nur die Liste der Versionen scrollt",
      "Auf dem iPad und in kleinen Fenstern nutzt das Fenster die sichtbare Höhe und hält Abstand zu Home-Leiste und Rand",
    ],
  },
  {
    version: "0.51.0",
    date: "2026-10-27",
    title: "Krypto-Rankings wie CoinMarketCap",
    changes: [
      "Neue Vollbild-Seite 🏆 Rankings: alle Coins nach Marktkapitalisierung mit Rang, Kurs, 1 h, 24 h, 7 T, 30 T, Marktkapitalisierung, Volumen, Volumen/Marktkap., Umlauf und 7-Tage-Verlauf",
      "Oben der Gesamtmarkt: Marktkapitalisierung mit 24-h-Veränderung, Volumen, BTC- und ETH-Dominanz, Anzahl Coins",
      "Gewinner und Verlierer (ohne Stablecoins und Kleinst-Volumen), Suche, Sortieren per Spaltenkopf, Watchlist-Stern, USD oder EUR, Top 250 bis 1000",
      "Klick auf den Namen zeigt Umlauf, Maximalmenge, FDV, 24-h-Hoch/-Tief und Allzeithoch, Klick aufs Kürzel öffnet das Binance-USDT-Paar im Chart",
      "Quelle: CoinGecko API ohne Schlüssel (optional eigener Demo-Schlüssel), bei Ausfall CoinPaprika; CoinMarketCap selbst erlaubt keine Abfragen aus dem Browser",
      "Ohne erreichbare Quelle zeigt die Seite deutlich markierte Beispieldaten",
      "Fehlerzeile im Krypto-Screener steht wieder ganz lesbar über der Tabelle",
    ],
  },
  {
    version: "0.50.3",
    date: "2026-10-27",
    title: "Vollbild bleibt bei Esc",
    changes: [
      "Esc beendet in Safari auf dem Mac kein Vollbild-Fenster mehr, sondern bricht nur noch in ChartAI ab (Zeichnen, Auswahl, Menüs, Dialoge)",
      "Vollbild verlassen geht weiter über ⌃⌘F oder den grünen Fensterknopf",
    ],
  },
  {
    version: "0.50.2",
    date: "2026-10-27",
    title: "Fadenkreuz-Sync bei mehreren Charts",
    changes: [
      "Liegt der Zeitpunkt in einem anderen Chart außerhalb des sichtbaren Bereichs, verschwindet dort das Fadenkreuz, statt am Rand zu kleben und eine falsche Zeit anzuzeigen",
      "Zeigt der Cursor in den leeren Bereich rechts von der letzten Kerze, bleibt das Fadenkreuz in den anderen Charts nicht mehr auf deren letzter Kerze stehen",
    ],
  },
  {
    version: "0.50.1",
    date: "2026-10-27",
    title: "Ruhiges Fadenkreuz in Nachbarcharts",
    changes: [
      "Fadenkreuz-Sync: In den anderen Charts erscheint nur noch die senkrechte Zeitlinie, wie bei TradingView",
      "Die waagrechte Linie und das Preisschild sprangen dort bisher bei jeder Kerze auf deren Schlusskurs und zappelten",
      "Sobald der Zeiger in einen Chart kommt, hat er dort wieder das volle Fadenkreuz",
    ],
  },
  {
    version: "0.50.0",
    date: "2026-10-27",
    title: "Risiko-Rechner",
    changes: [
      "Neuer Risiko-Rechner im Rechner: Trading-Budget und Risiko in % eintragen, ergibt den möglichen Verlust pro Trade",
      "Betrag lässt sich mit einem Tipp als 1 R für alle anderen Rechner übernehmen",
      "Tabelle 0,5–10 % mit Verlust pro Trade und Verlusten in Folge bis −50 %, Grafik Kontostand nach Verlustserien",
    ],
  },
  {
    version: "0.49.1",
    date: "2026-10-27",
    title: "Rechner: Fib-Extension nachvollziehbarer",
    changes: ["Fibonacci-Extension zeigt zusätzlich die Spalte „Faktor × Spanne“ (1,618 / 2,618 / 3,618 × Impulsspanne) neben dem Kursziel ab C"],
  },
  {
    version: "0.49.0",
    date: "2026-10-27",
    title: "Notizen",
    changes: [
      "Notizen-Panel in der Seitenleiste: Ideen und Setups pro Symbol oder allgemein festhalten",
      "Anheften, bearbeiten, löschen und durchsuchen; Tipp auf ein anderes Symbol öffnet es im Chart",
      "Claude kann Notizen speichern und lesen (add_note, list_notes)",
    ],
  },
  {
    version: "0.48.0",
    date: "2026-10-27",
    title: "Strategietester und Limit-/Stop-Orders",
    changes: [
      "Strategietester in der Seitenleiste: MA-Kreuzung, RSI, MACD, Bollinger, Supertrend und Kanal-Ausbruch",
      "Bericht mit Nettogewinn, Profitfaktor, max. Drawdown, Equity-Kurve, Trade-Liste und Pfeilen im Chart",
      "Claude kann Strategien selbst testen (backtest_strategy)",
      "Demo-Konto: Limit- und Stop-Orders mit verschiebbarer Linie im Chart, Liste wartender Orders",
      "Positionen zu 25 % oder 50 % teilweise schließen",
    ],
  },
  {
    version: "0.47.0",
    date: "2026-10-27",
    title: "Versionen und Historie in der App",
    changes: [
      "Tipp auf die Versionsnummer öffnet ein Menü: aktuelle Version, Build, nach Updates suchen",
      "Versionshistorie mit Datum und Änderungen jeder Version, durchsuchbar",
    ],
  },
  {
    version: "0.46.0",
    date: "2026-10-27",
    title: "Benannte Chart-Layouts",
    changes: [
      "Layout speichern (⌘/Strg+S), als Kopie speichern, umbenennen, neu anlegen und wechseln",
      "Automatisches Speichern nach 1,5 s, sonst Punkt für ungespeicherte Änderungen",
      "Jedes Layout merkt sich alle Charts mit Symbol, Zeiteinheit, Charttyp, Indikatoren und Zeichnungen",
    ],
  },
  {
    version: "0.45.0",
    date: "2026-10-27",
    title: "Tick- und Bereichs-Charts, Objektbaum, Gehe zu",
    changes: [
      "Zeiteinheiten-Menü mit den Gruppen Ticks, Sekunden, Minuten, Stunden, Tage und Bereiche wie in TradingView",
      "1/10/100/1000 Ticks und 1/10/100/1000 Bereiche aus Binance-Trades, eigene wie 50T oder 25R",
      "Objektbaum und Datenfenster in der Seitenleiste: alle Indikatoren und Zeichnungen, Werte unter dem Fadenkreuz",
      "Gehe zu Datum (Alt+G oder Kalender-Knopf unter dem Chart)",
    ],
  },
  {
    version: "0.44.0",
    date: "2026-10-27",
    title: "37 weitere Zeichenwerkzeuge",
    changes: [
      "Pitchforks, Regressionstrend, Fibonacci-Kanal und -Zeitzonen, Gann-Box und -Fächer",
      "Harmonische und Chartmuster (XABCD, Cypher, ABCD, Kopf-Schulter, Dreieck), Elliott-Wellen",
      "Preis- und Datumsbereich, Anchored VWAP, Formen, Notizen, Preislabel und Emojis",
      "Werkzeugleiste gruppiert wie in TradingView, mit verschiebbarer Favoritenleiste",
    ],
  },
  {
    version: "0.43.0",
    date: "2026-10-27",
    title: "Alle 21 Charttypen aus dem TradingView-Menü",
    changes: [
      "Neu: Volumenkerzen, Linie mit Markierungen, HLC-Fläche, Säulen, Hoch-Tief, Volumen-Footprint, TPO, Session-Volumenprofil, Kagi, Point & Figure und Range",
      "Deutsche Namen und Gruppen wie in TradingView",
      "Kagi nach Nison, Point & Figure nach du Plessis/Dorsey, Range-Bars nach Nicolellis; Größen per ATR oder fest in den Chart-Einstellungen",
    ],
  },
  {
    version: "0.42.0",
    date: "2026-10-27",
    title: "Quelle hinter jedem Indikator",
    changes: [
      "Jeder Indikator zeigt in der Liste und in seinen Einstellungen, woher seine Formel stammt",
      "Kennzeichen: TA-Lib geprüft, Original-Formel, Börsendaten, Annäherung oder Schätzung",
      "Die Suche findet Indikatoren auch über ihre Quelle",
    ],
  },
  {
    version: "0.41.1",
    date: "2026-10-27",
    title: "Tastenkürzel-Liste nutzt die ganze Bildschirmhöhe",
    changes: ["Liste füllt die sichtbare Höhe, auf breiten Bildschirmen zweispaltig", "Gruppen-Knöpfe springen zum jeweiligen Abschnitt"],
  },
  {
    version: "0.41.0",
    date: "2026-10-27",
    title: "TradingView-Tastenkürzel",
    changes: [
      "Die gängigen Kürzel aus der TradingView-Dokumentation, mit Mac-Varianten",
      "Liste (⌘/ oder ⌨) durchsuchbar; Kürzel hinzufügen, verschieben, entfernen und zurücksetzen",
      "Wiederholen (Redo) für Zeichnungen",
    ],
  },
  {
    version: "0.40.0",
    date: "2026-10-26",
    title: "Krypto von Coinbase, Kraken, Bybit, OKX, Bitstamp und Bitfinex",
    changes: [
      "Symbole wie COINBASE:BTCUSD oder KRAKEN:ETHEUR mit Kerzen und Live-Trades der jeweiligen Börse, ohne Schlüssel",
      "Börsen-Auswahl für Krypto in der Asset-Auswahl",
      "Spreads auch über verschiedene Börsen",
    ],
  },
  {
    version: "0.39.1",
    date: "2026-10-26",
    title: "Dialoge und Menüs passen auf den Bildschirm",
    changes: ["Safaris Scrollbalken verdeckt die Favoriten-Sterne nicht mehr", "Alle Dialoge und Menüs bleiben in der sichtbaren Höhe und scrollen"],
  },
  {
    version: "0.39.0",
    date: "2026-10-26",
    title: "Percoco-Workflow",
    changes: [
      "FVG eines höheren Zeitrahmens im kleineren Chart (z. B. 15m-FVGs im 1m-Chart)",
      "Eingebauter Arbeitsbereich „Percoco 15m + 1m“",
      "Long/Short-Werkzeug mit festem Risikobetrag statt Prozent",
      "Alarme auf neuen CHoCH/BOS und neue FVG",
      "Journal-Checkliste: 15m-FVG-Reaktion, CHoCH 1m, FVG 1m",
    ],
  },
  {
    version: "0.38.1",
    date: "2026-10-26",
    title: "Chart-Einstellungen passen auf den Bildschirm",
    changes: ["Titel und Knöpfe bleiben stehen, nur der Inhalt scrollt", "Auf breiten Bildschirmen zweispaltig"],
  },
  {
    version: "0.38.0",
    date: "2026-10-26",
    title: "Footprint-Chart",
    changes: ["Kauf- und Verkaufsvolumen je Preisstufe in jeder Kerze"],
  },
  {
    version: "0.37.0",
    date: "2026-10-26",
    title: "Indikator auf Indikator",
    changes: ["Indikatoren wie gleitende Durchschnitte, Bollinger, RSI oder MACD lassen sich auf die Linie eines anderen Indikators anwenden"],
  },
  {
    version: "0.36.0",
    date: "2026-10-26",
    title: "Watchlists und Krypto-Screener",
    changes: [
      "Mehrere Watchlists in der Seitenleiste mit Kurs und 24-h-Änderung",
      "Vollbild-Screener über alle Binance-USDT-Paare, sortier- und filterbar, mit RSI und Abstand zu SMA 50/200",
    ],
  },
  {
    version: "0.35.0",
    date: "2026-10-26",
    title: "Intrabar-Replay",
    changes: ["Das Replay baut jede Kerze aus einem kleineren Zeitrahmen Stück für Stück auf (z. B. 1m im 1h-Chart)"],
  },
  {
    version: "0.34.0",
    date: "2026-10-26",
    title: "Volumenprofile und TPO",
    changes: ["Volumenprofil für den sichtbaren Bereich", "Session-Volumenprofil je Tag, Woche oder Monat", "Market Profile (TPO), alle mit POC und Value Area"],
  },
  {
    version: "0.33.0",
    date: "2026-10-26",
    title: "Symbole vergleichen und Spread-Charts",
    changes: ["Bis zu fünf weitere Symbole als Linie über dem Chart, Preisachse in Prozent", "Spread-Charts wie BTCUSDT/ETHUSDT oder BTCUSDT - ETHUSDT"],
  },
  {
    version: "0.32.0",
    date: "2026-10-26",
    title: "Chartdaten als CSV exportieren",
    changes: ["Zeit, OHLC, Volumen und jede sichtbare Indikatorlinie, aus dem Kontextmenü oder den Chart-Einstellungen"],
  },
  {
    version: "0.31.0",
    date: "2026-10-26",
    title: "Bis zu acht Charts pro Layout",
    changes: ["Neue Layouts: drei nebeneinander, 3 × 2 und 4 × 2", "Synchron: Symbol, Zeiteinheit, Fadenkreuz und Zeitbereich"],
  },
  {
    version: "0.30.0",
    date: "2026-10-26",
    title: "Sekunden-Charts und eigene Zeiteinheiten",
    changes: ["1s, 5s, 15s und 30s für Binance-Krypto", "Neu: 3m, 45m, 2h, 3h, 6h, 8h, 12h und 3D", "Eigene Zeiteinheiten bis eine Woche (z. B. 7m, 90s, 2D)"],
  },
  {
    version: "0.29.0",
    date: "2026-10-26",
    title: "Hohle Kerzen, Stufenlinie, Basislinie, Renko und Line Break",
    changes: ["Renko und Line Break nach Steve Nison", "Indikatoren und Zeichnungen arbeiten auf den Bricks"],
  },
  {
    version: "0.28.0",
    date: "2026-10-26",
    title: "Alarme und Börsenkurse",
    changes: ["Alarme auf Preis, Indikatoren, Linien und Zonen, mit Ton und Hinweis", "Aktien, Indizes und Forex über einen eigenen Twelve-Data-Schlüssel"],
  },
  {
    version: "0.27.0",
    date: "2026-10-26",
    title: "Aktualisieren-Knopf und automatische Wiederverbindung",
    changes: ["Live-Daten verbinden sich nach Abbruch, Ruhezustand oder Netzwechsel neu", "Aktualisieren-Knopf in der Kopfleiste und im Aktualitäts-Nachweis"],
  },
  {
    version: "0.26.0",
    date: "2026-10-26",
    title: "Craig-Percoco-Setup komplett",
    changes: ["Sessions Tokio/London/New York und Linie bei 9:30 New York", "RSI mit Wolken und Divergenzen", "FVG mit optionaler 50-%-Linie, Fib-Extension mit Level 3,618"],
  },
  {
    version: "0.25.0",
    date: "2026-10-26",
    title: "Marktstruktur (CHoCH / BOS)",
    changes: ["Indikator nach smart-money-concepts, gegen dessen Referenzwerte geprüft"],
  },
  {
    version: "0.24.0",
    date: "2026-10-26",
    title: "Vorlage „Craig Percoco“",
    changes: ["15m-FVG und RSI 14, nur öffentlich belegte Elemente"],
  },
  {
    version: "0.23.0",
    date: "2026-10-26",
    title: "Indikatoren gegen TA-Lib und Originalquellen geprüft",
    changes: ["Korrekturen an Parabolic SAR, Hull MA, McGinley Dynamic und Fisher Transform", "Referenztest mit 33 Reihen aus TA-Lib"],
  },
  {
    version: "0.22.1",
    date: "2026-10-26",
    title: "Asset-Auswahl: Sterne frei",
    changes: ["Hinweise verdecken die Favoriten-Sterne nicht mehr"],
  },
  {
    version: "0.22.0",
    date: "2026-10-26",
    title: "Fair Value Gaps",
    changes: ["Neuer Indikator Fair Value Gaps (FVG)", "Chandelier Exit und Klinger an die Originaldefinition angepasst"],
  },
  {
    version: "0.21.0",
    date: "2026-10-26",
    title: "Aktualitäts-Nachweis für Chartdaten und Uhr",
    changes: ["Statuslicht in jeder Chart-Legende", "Nachweis: Geräteuhr gegen Serverzeit, letzte Kerze, Alter des letzten Live-Ticks"],
  },
  {
    version: "0.20.0",
    date: "2026-10-26",
    title: "Kontextmenü für Zeichnungen",
    changes: ["Farbe, Linienstil, Kopieren, Einfügen, Sperren, Ausblenden, Löschen", "Zeichnungen mit Maus oder Finger verschieben"],
  },
  {
    version: "0.19.0",
    date: "2026-10-26",
    title: "Kopfleiste passt auf iPad und Mac",
    changes: ["Zeiteinheiten als Auswahl und nur Symbole auf schmalen Bildschirmen", "Pinch-Zoom nur noch im Chart"],
  },
  {
    version: "0.18.2",
    date: "2026-10-25",
    title: "Vorlage „Nur Chart“",
    changes: ["Entfernt alle Indikatoren aus dem aktiven Chart"],
  },
  {
    version: "0.18.1",
    date: "2026-10-25",
    title: "Replay zurückspulen",
    changes: ["Zurückspulen zu einer früheren Kerze und Schritt zurück (⏮, Shift+←)"],
  },
  {
    version: "0.18.0",
    date: "2026-10-25",
    title: "Bar-Replay",
    changes: ["Chart ab einer Startkerze Kerze für Kerze abspielen", "Eigenes Replay-Konto zum Üben"],
  },
  {
    version: "0.17.0",
    date: "2026-10-25",
    title: "Stop-Loss und Take-Profit im Chart ziehen",
    changes: ["SL- und TP-Linien offener Demo-Positionen mit Finger oder Maus verschieben"],
  },
  {
    version: "0.16.0",
    date: "2026-10-25",
    title: "Demo-Trading mit Spielgeld",
    changes: ["Long/Short mit Hebel, Stop-Loss und Take-Profit", "Offene Positionen, Historie und Hinweise bei erreichten Levels"],
  },
  {
    version: "0.15.0",
    date: "2026-10-25",
    title: "Asset-Auswahl",
    changes: ["Krypto, Aktien, Indizes, Edelmetalle, Rohstoffe und Forex nach Rubriken", "Suche über alle Binance-Märkte, mit Favoriten"],
  },
  {
    version: "0.14.0",
    date: "2026-10-25",
    title: "Wochenenden und Börsenfeiertage",
    changes: ["Feiertagskalender für jede Börse, geschlossene Tage ohne Session im Chart"],
  },
  {
    version: "0.13.0",
    date: "2026-10-25",
    title: "Monat, Quartal, Jahr und gesamte Historie",
    changes: ["Neue Zeiteinheiten 1M, 3M, 1J und „alles“"],
  },
  {
    version: "0.12.0",
    date: "2026-10-25",
    title: "Börsenzeiten",
    changes: ["Seite 🕐 Börsen mit 16 großen Börsen in deiner Zeitzone", "Ausgewählte Börsen als Sessions im Chart"],
  },
  {
    version: "0.11.0",
    date: "2026-10-25",
    title: "Trading-Journal",
    changes: ["Seite 📒 Journal: Trades eintragen, Equity-Kurve, Trefferquote, Profit-Faktor, Drawdown"],
  },
  {
    version: "0.10.1",
    date: "2026-10-24",
    title: "Erklärungen im Rechner",
    changes: ["„So funktioniert's“ mit Beispiel zu jedem Rechner"],
  },
  {
    version: "0.10.0",
    date: "2026-10-24",
    title: "Trading-Rechner",
    changes: ["Seite 🧮 Rechner: Positionsgröße, Erwartungswert, Trade-Serien, R-Multiple, Fibonacci, Hebel"],
  },
  {
    version: "0.9.0",
    date: "2026-10-18",
    title: "Orderblöcke über mehrere Zeiteinheiten",
    changes: ["Bullishe und bearishe Orderblöcke mit Kauf- und Verkaufssignalen", "Vorlage Smart Money"],
  },
  {
    version: "0.8.0",
    date: "2026-10-18",
    title: "Vorlagen, neue Zeichenwerkzeuge, Mustererkennung",
    changes: ["Vorlagen und gespeicherte Arbeitsbereiche", "Fibonacci-Extension, Auto-Fibonacci, Parallelkanal, Messen, Pinsel", "Kerzenmuster und Chartformationen"],
  },
  {
    version: "0.7.0",
    date: "2026-10-18",
    title: "Versionsanzeige, Favoriten, mehrere Charts, Positions-Tool",
    changes: ["Versionsnummer neben dem Logo mit Update-Hinweis", "Favorisierte Indikatoren", "Bis zu vier Charts gleichzeitig", "Long/Short-Positions-Tool"],
  },
  {
    version: "0.1.0",
    date: "2026-10-17",
    title: "Erste Version",
    changes: [
      "Chart-App im TradingView-Stil mit Claude-Chat, der Indikatoren hinzufügt und zeichnet",
      "Als Web-App auf dem iPad installierbar",
      "Bis 18.10.: 46 Krypto-Indikatoren, Chart-Einstellungen, Countdown, Orderbuch, Liquidationen und Liquidations-Heatmap",
    ],
  },
];

/** Releases whose version, title or changes contain the query (case-insensitive). */
export function searchChangelog(releases: Release[], query: string): Release[] {
  const q = query.trim().toLowerCase();
  if (!q) return releases;
  return releases.filter((r) => `${r.version} ${r.title} ${r.changes.join(" ")}`.toLowerCase().includes(q));
}

/** "2026-10-27" → "27.10.2026". */
export function formatReleaseDate(date: string): string {
  const [y, m, d] = date.split("-");
  return y && m && d ? `${d}.${m}.${y}` : date;
}
