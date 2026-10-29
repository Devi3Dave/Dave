# Eigener Proxy für gesperrte Börsen (Cloudflare Worker)

ChartAI läuft komplett im Browser. Einige Börsen erlauben den Abruf ihrer Kurse aus dem Browser nicht (CORS):
KuCoin, BitMEX, die Kraken-Perps (futures.kraken.com), die Binance-Optionen und teils die Marktlisten von Bitfinex und Bitstamp.
Ein kleiner Cloudflare Worker holt diese öffentlichen Kurse für dich ab und reicht sie an ChartAI weiter.

**Was der Proxy darf und was nicht**

- Nur Lesen (GET) von öffentlichen Kursdaten, nur bei den Börsen-Adressen in `worker.js` (`HOSTS`, `WS_HOSTS`)
- Nur Anfragen von deiner ChartAI-Seite `https://devi3dave.github.io` (`ALLOWED_ORIGINS`)
- Keine Logins, keine API-Schlüssel, keine Orders, kein Geld. Dort kommt nie ein Schlüssel hinein
- Höchstens 300 Anfragen pro Minute und Adresse, Antworten werden 10 Sekunden zwischengespeichert
- Journal, Einstellungen und Demo-Trades bleiben nur auf deinem Gerät, außer du schaltest den Sync ein (unten)

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

## Geräte synchronisieren (Mac ↔ iPad)

ChartAI kann deine Charts, Indikatoren, Zeichnungen, Layouts, Vorlagen, Alarme, Watchlisten, Journal, Demo-Konto und Einstellungen
zwischen deinen Geräten abgleichen. Danach geht alles von selbst: was du am Mac einzeichnest, ist auf dem iPad da, sobald du ChartAI dort öffnest,
und umgekehrt. Die API-Schlüssel für Claude und Twelve Data werden nie übertragen, sie bleiben auf dem jeweiligen Gerät.

Apple selbst gleicht die Daten einer Webseite nicht ab (iCloud synchronisiert nur Lesezeichen, Tabs und Passwörter), darum braucht es einen Speicher
dazwischen. Es gibt drei Wege, oben auf **☁** tippen:

### Weg A: über GitHub (einfach, empfohlen, ca. 3 Minuten)

Der Stand liegt in einem geheimen Gist in deinem GitHub-Konto. Den Proxy brauchst du dafür nicht.

1. **Am Mac:** in ChartAI auf **☁** tippen, „Über GitHub“ ist schon gewählt. **🔑 Schlüssel bei GitHub erstellen** antippen.
   GitHub öffnet die Seite „New personal access token“, Name `ChartAI-Sync` und der Haken bei **gist** sind schon gesetzt.
2. Bei **Expiration** „No expiration“ wählen (sonst hört der Sync nach 30 Tagen auf), ganz unten **Generate token** klicken und den Schlüssel
   (beginnt mit `ghp_`) kopieren. GitHub zeigt ihn nur einmal.
3. Zurück in ChartAI den Schlüssel einfügen → **3. Verbinden** → „Verbunden, noch leer“ → **Sync einschalten**. Oben steht jetzt **☁✓**.
4. **iPad verbinden:** am Mac im ☁-Fenster **🔗 Kopplungslink kopieren** und dir den Link aufs iPad schicken (AirDrop, Notizen oder Nachricht an dich
   selbst). Auf dem iPad antippen: ChartAI öffnet sich und lädt deinen Stand vom Mac („☁ Stand vom anderen Gerät übernommen“).
   Nutzt du ChartAI auf dem iPad als App vom Home-Bildschirm, hat diese App einen eigenen Speicher: dort selbst auf **☁** tippen, den Schlüssel einfügen
   (am Mac **Schlüssel kopieren**) → **3. Verbinden** → **Stand vom anderen Gerät laden**.

Der Schlüssel darf nur Gists lesen und schreiben, nicht an deine Repositories. Abschalten: auf GitHub unter Settings → Developer settings →
Personal access tokens den Schlüssel `ChartAI-Sync` löschen; den Gist „ChartAI-Sync“ findest du unter gist.github.com.

### Weg B: Datei (ohne Einrichtung, nicht automatisch)

Im ☁-Fenster unten am Mac **📤 Exportieren** und die Datei in iCloud Drive sichern oder per AirDrop schicken, am iPad **📥 Importieren** und die Datei
wählen. Das ersetzt Charts und Einstellungen auf dem iPad. Auch gut als Sicherung.

### Weg C: über den eigenen Cloudflare Worker

Derselbe Worker wie für den Proxy bekommt einen kleinen Speicher (Cloudflare KV) und einen geheimen Schlüssel. Nur wer diesen Schlüssel kennt, kann die Daten lesen
oder ändern. Die Daten liegen in deinem eigenen Cloudflare-Konto. Einmalig ca. 10 Minuten, ohne Kommandozeile
(Cloudflare benennt Menüs ab und zu leicht um; die Begriffe in **fett** stehen so oder ähnlich im Dashboard). Im ☁-Fenster „Über eigenen Cloudflare Worker“ wählen:

1. **Neuen Worker-Code bereitstellen:** wie oben in Schritt 4: in Cloudflare den Worker öffnen → **Edit code** → den ganzen Inhalt durch den aktuellen
   [`worker.js`](./worker.js) ersetzen → **Deploy**.
2. **Speicher anlegen:** im Dashboard links **Storage & Databases** → **Workers KV** öffnen, dann **Create** (bzw. „Create instance“).
   Als Namen `chartai-sync` eintragen und **Create** klicken.
3. **Speicher mit dem Worker verbinden:** links **Compute (Workers)** → **Workers & Pages** → deinen Worker (z. B. `chartai-proxy`) anklicken →
   oben den Reiter **Bindings** → **Add binding** → **KV namespace** wählen.
   Bei **Variable name** genau `CHARTAI_SYNC` eintragen (Großbuchstaben, mit Unterstrich), bei **KV namespace** `chartai-sync` auswählen → **Add binding**.
4. **Schlüssel erzeugen:** am Mac in ChartAI oben auf **☁** tippen → **🎲 Schlüssel erzeugen** → **Schlüssel kopieren**.
   Das Fenster offen lassen.
5. **Schlüssel im Worker hinterlegen:** in Cloudflare beim Worker den Reiter **Settings** → **Variables and Secrets** → **Add**.
   **Type:** `Secret`, **Variable name:** genau `SYNC_KEY`, **Value:** den kopierten Schlüssel einfügen → **Deploy** (bzw. „Save and deploy“).
6. **Am Mac einschalten:** zurück in ChartAI. Die Worker-Adresse steht schon drin, wenn du den Proxy eingetragen hast, sonst eintragen.
   **Verbinden** tippen. Es erscheint „Worker bereit, noch leer“ → **Sync einschalten**. Oben steht jetzt **☁✓**.
7. **iPad verbinden:** am Mac im ☁-Fenster **🔗 Kopplungslink kopieren** und dir den Link aufs iPad schicken (AirDrop, Notizen oder Nachricht an dich
   selbst). Auf dem iPad antippen: ChartAI öffnet sich, übernimmt Adresse und Schlüssel und lädt deinen Stand vom Mac
   („☁ Stand vom anderen Gerät übernommen“).
   Nutzt du ChartAI auf dem iPad als App vom Home-Bildschirm, hat diese App einen eigenen Speicher: dort selbst auf **☁** tippen, Adresse und
   Schlüssel einfügen (am Mac **Schlüssel kopieren**, auf dem iPad einfügen) → **Verbinden** → **Stand vom anderen Gerät laden**.

**So arbeitet der Sync (Weg A und C)**

- Beim Öffnen von ChartAI holt es zuerst den neuesten Stand (höchstens ein paar Sekunden, ohne Netz startet es einfach mit dem eigenen Stand)
- Änderungen gehen wenige Sekunden später an den Worker, danach höchstens alle 45 Sekunden und sofort, wenn du ChartAI verlässt oder das iPad sperrst
- Kommt ein neuer Stand vom anderen Gerät, übernimmt ChartAI ihn, sobald du es wieder nach vorne holst oder etwa 10 Sekunden nichts tippst
  (die Seite lädt dafür kurz neu)
- Abgeglichen wird Eintrag für Eintrag (z. B. Chart 1, Alarme, Journal): wer zuletzt geändert hat, gewinnt. Eine Zeichnung am Mac und ein Alarm am iPad
  bleiben also beide erhalten. Ändern beide Geräte gleichzeitig denselben Chart, gilt die spätere Änderung
- Cloudflares Gratis-Tarif erlaubt 1000 Speichervorgänge und 100.000 Abrufe am Tag, GitHub 5000 Abrufe pro Stunde: das reicht bei normaler Nutzung locker
- **Ausschalten:** ☁ → **Sync ausschalten**. Alles bleibt auf dem Gerät. Die Daten löschst du bei GitHub (Gist „ChartAI-Sync“) bzw. in Cloudflare
  unter **Workers KV** → `chartai-sync` → Eintrag `chartai-sync-v1`

**Wenn ☁⚠ erscheint** (Tippen zeigt den Grund):

- „Sync-Schlüssel stimmt nicht“: in ChartAI und in Cloudflare (`SYNC_KEY`) steht nicht derselbe Schlüssel. Schritt 5 mit dem Schlüssel aus ChartAI wiederholen
- „im Worker fehlt noch der KV-Speicher“: Schritt 3, der Name muss genau `CHARTAI_SYNC` sein
- „im Worker fehlt noch das Secret SYNC_KEY“: Schritt 5
- „Worker ist noch die alte Version ohne Sync“: Schritt 1
- „GitHub-Schlüssel ungültig oder abgelaufen“: bei GitHub einen neuen Schlüssel erstellen (Weg A, Schritt 1–2), im ☁-Fenster **Sync ausschalten**
  und mit dem neuen Schlüssel wieder verbinden, auf beiden Geräten

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
- Sync: `GET /sync` liefert den gespeicherten Stand (`?rev=` mit aktuellem Stand: nur `{"same":true}`), `POST /sync` mit `{"items":{…}}` führt
  Eintrag für Eintrag zusammen (neuere Zeit `t` gewinnt). Beides nur mit `Authorization: Bearer <SYNC_KEY>` und von der ChartAI-Seite.
  Logik der App: `shared/sync.ts` und `src/sync.ts`
- Quelle: Cloudflare-Dokumentation zu Workers (fetch-Handler, WebSockets, `cf.cacheTtl`, Bindings, Secrets), developers.cloudflare.com/workers,
  und zu Workers KV (`get`, `put`, Limits), developers.cloudflare.com/kv
