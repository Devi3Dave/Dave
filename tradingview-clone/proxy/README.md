# Eigener Proxy für gesperrte Börsen (Cloudflare Worker)

ChartAI läuft komplett im Browser. Einige Börsen erlauben den Abruf ihrer Kurse aus dem Browser nicht (CORS):
KuCoin, BitMEX, die Kraken-Perps (futures.kraken.com), die Binance-Optionen und teils die Marktlisten von Bitfinex und Bitstamp.
Ein kleiner Cloudflare Worker holt diese öffentlichen Kurse für dich ab und reicht sie an ChartAI weiter.

**Was der Proxy darf und was nicht**

- Nur Lesen (GET) von öffentlichen Kursdaten, nur bei den Börsen-Adressen in `worker.js` (`HOSTS`, `WS_HOSTS`)
- Nur Anfragen von deiner ChartAI-Seite `https://devi3dave.github.io` (`ALLOWED_ORIGINS`)
- Keine Logins, keine API-Schlüssel, keine Orders, kein Geld. Dort kommt nie ein Schlüssel hinein
- Höchstens 300 Anfragen pro Minute und Adresse, Antworten werden 10 Sekunden zwischengespeichert
- Journal, Einstellungen und Demo-Trades bleiben wie bisher nur auf deinem Gerät

Der kostenlose Cloudflare-Tarif reicht (100.000 Anfragen am Tag).

## Einrichten (ca. 5 Minuten, ohne Kommandozeile)

1. **Konto anlegen:** auf [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) mit E-Mail und Passwort registrieren und die E-Mail bestätigen. Eine eigene Domain brauchst du nicht.
2. **Worker anlegen:** im Dashboard links **Compute (Workers)** → **Workers & Pages** öffnen, dann **Create** (bzw. „Erstellen“) → **Start with Hello World!** wählen.
3. **Namen vergeben:** als Namen z. B. `chartai-proxy` eintragen und **Deploy** klicken. Cloudflare zeigt danach die Adresse, etwa `https://chartai-proxy.deinname.workers.dev`.
4. **Code einfügen:** auf **Edit code** klicken. Links ist die Datei `worker.js` offen. Den ganzen Inhalt löschen und den Inhalt von [`worker.js`](./worker.js) einfügen
   (auf GitHub oben rechts beim Code auf **Copy raw file** tippen). Dann oben rechts **Deploy** klicken.
5. **Prüfen:** die Worker-Adresse im Browser öffnen, z. B. `https://chartai-proxy.deinname.workers.dev`. Es muss „✓ ChartAI-Proxy läuft“ erscheinen.
   Steht dort „Hello World!“, ist der Code aus Schritt 4 noch nicht bereitgestellt. „origin not allowed“ (403) bei anderen Adressen ist gewollt:
   Kurse gibt der Proxy nur an die ChartAI-Seite heraus.
6. **In ChartAI eintragen:** Asset-Auswahl öffnen → **🩺 Test** → oben bei „Eigener Proxy für gesperrte Börsen“ die Worker-Adresse eintragen → **Speichern**.
   ChartAI prüft den Proxy sofort („Proxy läuft und nimmt Anfragen dieser Seite an“). Danach erscheinen KuCoin und BitMEX wieder in der Börsenauswahl,
   bei Kraken lässt sich Perp wählen, und die Suche zeigt auch die Binance-Optionen.
7. **Testen:** im selben Fenster **Alle testen**. Was über den Proxy kommt, steht mit „über Proxy“ in der Zeile.

Die Adresse wird nur auf dem jeweiligen Gerät gespeichert: auf iPad und iPhone also je einmal eintragen.

## Häufige Fragen

- **„Proxy läuft, erlaubt aber diese Seite nicht“:** ChartAI läuft unter einer anderen Adresse als `https://devi3dave.github.io`. Im Worker oben bei
  `ALLOWED_ORIGINS` die Adresse ergänzen (ohne Schrägstrich am Ende) und erneut **Deploy** klicken.
- **„nicht erreichbar“:** Adresse vertippt oder Worker noch nicht bereitgestellt (Schritt 4 wiederholen).
- **Abschalten:** in ChartAI **Proxy entfernen**. Alles lädt dann wieder direkt, die gesperrten Börsen verschwinden aus der Auswahl. Den Worker kannst du in
  Cloudflare unter **Settings** → **Delete** löschen.
- **Updates:** ändert sich `worker.js` in einer neuen ChartAI-Version (steht dann in der Versionshistorie), Schritt 4 mit dem neuen Inhalt wiederholen.
- **Kosten:** keine im kostenlosen Tarif. Über 100.000 Anfragen am Tag antwortet der Worker bis Mitternacht (UTC) mit einem Fehler, es entstehen keine Kosten.

## Technik

- `GET https://<worker>/<host>/<pfad>?<query>` holt `https://<host>/<pfad>?<query>`, nur für die Hosts in `HOSTS`, Umleitungen werden nicht verfolgt
- WebSocket `wss://<worker>/ws.bitmex.com/realtime` wird zu `wss://ws.bitmex.com/realtime` durchgereicht (BitMEX lehnt den Browser auch dort ab)
- ChartAI schickt KuCoin, BitMEX, Kraken Futures und Binance-Optionen immer über den Proxy, Bitfinex und Bitstamp nur, wenn der direkte Abruf scheitert
  (`shared/proxy.ts`, dessen Hostlisten mit `worker.js` übereinstimmen müssen; ein Test prüft das)
- Quelle: Cloudflare-Dokumentation zu Workers (fetch-Handler, WebSockets, `cf.cacheTtl`), developers.cloudflare.com/workers
