# Ausfüllen & Signieren – Fill & Sign für das iPad

Eine React-Web-App (installierbar als PWA), die den Funktionsumfang von Adobe Fill & Sign
nachbildet: Formulare als PDF oder Foto öffnen, ausfüllen, unterschreiben und als PDF teilen.
Läuft komplett lokal im Browser – keine Server, kein Konto, keine Daten verlassen das Gerät.

## Funktionen

- **Formulare öffnen**: PDF oder Bild aus „Dateien“/„Fotos“, Papierformular direkt mit der Kamera
  fotografieren (wird automatisch in ein A4-PDF umgewandelt), Drag & Drop aus anderen Apps (Split View).
- **Ausfüllen**: Auf die Seite tippen → Textfeld, Tastatur erscheint. Werkzeuge für Kreuz, Häkchen,
  Punkt, Rahmen und Linie (Werkzeug bleibt aktiv – ideal zum Abhaken vieler Kästchen).
- **Unterschrift & Initialen** mit Apple Pencil (druckempfindlich) oder Finger zeichnen, auf dem
  Gerät speichern und mit einem Tipp einfügen.
- **Eigene Angaben (Autofill)**: Name, Adresse, E-Mail usw. einmal hinterlegen und per Tipp einsetzen.
- **Datum** mit einem Tipp einfügen.
- Elemente verschieben, mit dem blauen Griff skalieren, Schriftgröße ändern, löschen.
- Tintenfarben Schwarz / Blau / Rot, Rückgängig/Wiederholen (auch ⌘Z mit Tastatur).
- Pinch-to-Zoom; große Dokumente werden seitenweise gerendert (speicherschonend auf dem iPad).
- **Teilen**: erzeugt ein „flaches“ PDF (pdf-lib) und öffnet das iOS-Teilen-Menü (Mail, In Dateien sichern, AirDrop …).
- Dokumentbibliothek mit Vorschaubildern, automatisches Speichern (IndexedDB), Umbenennen/Löschen.
- Offline-fähig (Service Worker), Dark Mode, Safe-Area-Unterstützung.

## Entwicklung

```bash
npm install
npm run dev       # Dev-Server, im WLAN erreichbar (--host)
npm run build     # Produktions-Build nach dist/
npm run preview   # Build lokal ausliefern
```

## Auf dem iPad nutzen

1. `npm run build` und den Ordner `dist/` über HTTPS hosten (z. B. GitHub Pages, Netlify, Vercel –
   die App nutzt relative Pfade und funktioniert auch in einem Unterordner).
2. Seite in Safari öffnen → Teilen → **„Zum Home-Bildschirm“**.
3. Die App startet danach im Vollbild wie eine native App und funktioniert offline.

Zum schnellen Testen im lokalen Netz: `npm run dev` und auf dem iPad `http://<IP-des-Rechners>:5173`
öffnen (Kamera und Teilen-Menü funktionieren zuverlässig erst über HTTPS).

## Aufbau

| Datei | Zweck |
| --- | --- |
| `src/components/Home.tsx` | Dokumentbibliothek, Import, Kamera |
| `src/components/Editor.tsx` | Werkzeugleiste, Platzieren/Verschieben, Undo, Zoom, Export |
| `src/components/PageView.tsx` | Rendert eine PDF-Seite (pdf.js) plus Anmerkungsebene |
| `src/components/AnnotationItem.tsx` | Text, Formen und Unterschriften auf der Seite |
| `src/components/SignaturePad.tsx` | Unterschriftenfeld mit Pencil-Druckstärke |
| `src/components/ProfileSheet.tsx` | Eigene Angaben (Autofill) |
| `src/exportPdf.ts` | Schreibt alle Anmerkungen in das PDF (inkl. gedrehter Seiten) |
| `src/importFile.ts` | Bilder/Fotos → PDF |
| `src/db.ts`, `src/settings.ts` | IndexedDB bzw. localStorage |

App-Icons neu erzeugen: `node scripts/make-icons.mjs`.

Hinweis: Eigenständiger Nachbau, nicht mit Adobe verbunden; es werden keine Adobe-Marken oder -Assets verwendet.
