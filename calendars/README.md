# Kalender-Quellen

Wie die Termine auf [bitcircus101.de/events](https://bitcircus101.de/events) entstehen —
und wie ein neuer Kalender dazukommt.

## Wie das Zusammenführen funktioniert

Wir hosten keine Termine, wir **abonnieren** sie. Jede Quelle ist ein öffentlicher
`.ics`-Link (das Format, das Nextcloud, Google Calendar, WordPress-Event-Plugins und
so ziemlich alles andere exportieren). Etwa stündlich läuft ein Job, der:

1. **jeden Kalender parallel abholt** — fällt einer aus, laufen die anderen weiter
   und die letzten bekannten Termine der toten Quelle bleiben stehen (`status: stale`);
2. **wiederkehrende Termine ausrechnet** — aus „jeden 1. Freitag" werden echte
   Einzeltermine mit Datum und Uhrzeit;
3. **Vergangenes und Internes wegwirft** — alles vor heute, plus alles, was
   „Blocker" oder „interne Veranstaltung" heißt;
4. **Dubletten zusammenführt** — derselbe Termin in zwei Kalendern erscheint einmal.
   Wir vergleichen über die `UID` aus dem ICS, ersatzweise über Titel + Zeitpunkt;
5. **Tags vergibt** — aus `#hashtags` in der Terminbeschreibung, aus den Kategorien
   des Kalenders, sonst automatisch aus Stichworten im Titel;
6. **alles chronologisch sortiert** und daraus die Events-Seite, den RSS-Feed
   (`/feed.xml`) und einen iCal-Feed zum Abonnieren (`/ical.ics`) schreibt — beide
   mit dem, was im bitcircus101 stattfindet (`relation` `own` + `home`, siehe
   unten; `rss` kann das je Quelle übersteuern);
7. **jedem Termin eine eigene Seite gibt** — `/e/<id>/` mit der vollen
   Beschreibung (Absätze und Links bleiben erhalten). Ist der Tag vorbei, bleibt
   davon aus Datenschutzgründen nur, ob der Termin stattgefunden hat: Titel,
   Beschreibung und Ort werden nicht gespeichert, die Seite sagt nur noch
   „stattgefunden“ oder „abgesagt“. Die `id` ist ein Hash der Kalender-`UID`
   (bei Serien plus Datum): ein verschobener Termin behält seinen Link. Seiten
   gibt es für Quellen mit `pages: true` (Standard: wie der Haupt-Feed); alle
   anderen verlinken weiter auf ihre eigene Seite.

Das Ergebnis landet auf dem `live`-Branch — nie im Quellcode. Wer einen Kalender
ändert, ändert damit direkt die Website; niemand muss etwas nachpflegen.

### Gefilterte Feeds („der Filter, den du siehst, ist der Feed, den du bekommst")

Zusätzlich zu den Haupt-Feeds schreibt der Job unter `/feeds/` für **jedes
Schlagwort** und **jede Quelle** ein eigenes abonnierbares ICS+RSS-Paar
(`/feeds/tag/<slug>.ics`, `/feeds/source/<id>.ics`, dazu `/feeds/all.*` mit
allem). Schlagwort-Feeds enthalten nur Termine im bitcircus101 — so wie die
Standardansicht auf `/termine`; die Termine befreundeter Spaces stehen in
ihrem Quell-Feed und in `/feeds/all.*`. Die `id` aus deiner Quelldatei ist
dabei der Dateiname deines Feeds.
Alle Feeds speisen sich aus demselben Fenster von maximal 40 kommenden
Terminen, das auch die Events-Seite zeigt — ein Tag-Feed kann nie mehr
enthalten als die Seite. Verschwindet ein Schlagwort, bleibt sein Feed noch
90 Tage als leerer (gültiger) Kalender stehen, damit Abonnenten keinen
Fehler sehen; danach wird die Datei entfernt. Welche Feeds es gerade gibt,
steht maschinenlesbar im `feeds`-Block von `events-data.json`.

### Was das für dich heißt, wenn du uns deinen Kalender gibst

- **Du behältst die Kontrolle.** Wir kopieren nichts ab, wir lesen deinen Link.
  Du änderst einen Termin in deinem Kalender → in der Regel binnen einer Stunde steht es
  bei uns richtig. Du löschst ihn → er verschwindet.
- **Wir brauchen nur den öffentlichen ICS-Link.** In Nextcloud: Kalender teilen →
  „Link teilen" → die Adresse mit `?export`. Kein Zugang, kein Passwort, keine
  Schreibrechte.
- **Nicht alles muss öffentlich werden.** Termine mit „intern" oder „Blocker" im Titel
  filtern wir raus. Wenn du feiner steuern willst, können wir auch nach Kategorien
  oder Stichworten filtern (`ics-filtered`, siehe unten) — oder wir nehmen nur einen
  einzelnen Termin statt des ganzen Kalenders (`ics-single`).
- **Deine Termine bleiben als deine erkennbar.** Jede Karte trägt den Namen deines
  Kalenders als Quelle und verlinkt dorthin zurück.

## Einen Kalender hinzufügen

### 1. Den Link ansehen, bevor irgendetwas geändert wird

```sh
node scripts/check-calendars.mjs --probe "https://beispiel.org/kalender.ics"
```

Holt den Link, rechnet ihn durch **dieselbe Pipeline wie der echte Sync** und zeigt
genau die Karten, die auf der Website erscheinen würden — inklusive Tags und
inklusive dem, was rausgefiltert wird. Schreibt keine Datei an. Am Ende druckt es
einen fertigen JSON-Schnipsel zum Kopieren.

### 2. Die Quelldatei anlegen

Eine JSON-Datei pro Quelle (der Probe-Lauf oben druckt sie fertig aus):

```json
{
  "id": "repair-cafe",
  "name": "Repair Café Bonn",
  "ics": "https://beispiel.org/kalender.ics",
  "url": "https://beispiel.org/termine",
  "relation": "friend"
}
```

### 3. Im Manifest eintragen

`config.json` steuert, **welche** Quellen laufen und **in welcher Reihenfolge**
(bei Dubletten gewinnt die frühere Quelle):

```json
{ "sources": ["bitcircus.json", "repair-cafe.json"] }
```

Eine Zeile hier rauszunehmen deaktiviert eine Quelle, ohne die Datei zu löschen.

### 4. Prüfen

```sh
pnpm run check:calendars
```

Meckert über Tippfehler, unbekannte Felder, doppelte `id`/`name` — und über Dateien,
die zwar existieren, aber niemand ins Manifest eingetragen hat. Genau dieser Schritt
ist der Grund, warum es das Skript gibt: **Datei anlegen und Manifest vergessen sah
vorher aus wie „funktioniert nicht", ohne eine einzige Fehlermeldung.** Dieselbe
Prüfung läuft in CI bei jedem Pull Request.

## Freund*innen verwalten

Das Feld `relation` in der Quelldatei sagt, was ein Kalender für uns ist — und
daran hängt alles Weitere, ohne eine zweite Stelle:

- **`friend`** (Standard, wenn das Feld fehlt): ein befreundeter Space oder ein
  Veranstaltungsort anderswo. Auf `/termine` bekommt die Quelle ein Kästchen
  unter „weitere kalender" und ist erst nach dem Anhaken zu sehen; sie hat ihren
  Feed unter `/feeds/source/<id>.*`, steht in `/feeds/all.*` und auf `/calendar/`
  — und bleibt aus `feed.xml`/`ical.ics`, den Schlagwort-Feeds, dem
  Startseiten-Teaser, `/status`, der Kiosk-Ansicht „nur im bitcircus101" und
  der Lite-Seite heraus.
- **`home`**: ein fremder Kalender, dessen Termine im bitcircus101 stattfinden
  (stim.toys „Look at my toys!"). Zählt überall als „bei uns": Standardansicht,
  Haupt-Feeds, eigene Seiten, Verlauf. Die Karte trägt „Kalender: <name>".
- **`own`**: unser eigener Kalender, genau einer (`check:calendars` besteht darauf).

Alltag:

- **Freund*in dazu:** `--probe` → Datei (der Schnipsel trägt schon
  `"relation": "friend"`) → Zeile in `config.json` → `pnpm run check:calendars`.
  Der nächste Sync-Lauf bringt Kästchen, Quell-Feed und Kalenderseite mit;
  Code wird nicht angefasst.
- **Pausieren:** die Zeile aus `config.json` nehmen, die Datei bleibt (nur eine
  Warnung am Gate). Der Quell-Feed verschwindet beim nächsten Sync.
- **Wird „bei uns":** `relation` auf `home` setzen.

Der Sync schreibt die `relation` jeder Quelle in `events-data.json` (`sources[]`
und `feeds.sources`); Seiten und Skripte lesen sie dort bzw. aus `calendars/`,
niemals aus dem Quellnamen.

## Felder

| Feld | Pflicht | Bedeutung |
|------|---------|-----------|
| `id` | ja | Kleinbuchstaben-Kebab-Case. Taucht in Log-Ausgaben auf. |
| `name` | ja | Anzeigename auf der Karte. **Muss eindeutig sein** — der Name ist intern der Schlüssel für Feed-Auswahl und Ausfall-Cache. |
| `ics` | ja | Der öffentliche ICS-Link. Den liest der Sync; bei der `own`-Quelle ist es auch die Abo-Adresse, die `/calendar/` und die Lite-Ansicht zeigen. |
| `url` | — | Menschenlesbare Seite des Kalenders; Fallback-Ziel für Karten ohne eigenen Link. |
| `site` | — | Website der Gruppe, wenn es nicht `url` ist. Die Herkunftszeile jedes fremden Termins („veranstaltet von …“, „externer Termin von …“) auf `/termine` und der Event-Seite verlinkt `site`, sonst `url`. |
| `type` | — | `ics-full` (Standard), `ics-single`, `ics-filtered`. |
| `relation` | — | `own` (unser Kalender, genau einer), `home` (findet im bitcircus101 statt) oder `friend` (Standard: zuschaltbar auf `/termine`). Siehe „Freund*innen verwalten". |
| `rss` | — | Override für den Haupt-Feed: `true`/`false` = diese Quelle geht in `/feed.xml` und `/ical.ics` oder nicht. Fehlt das Feld, gilt `true` für `own` und `home`. |
| `pages` | — | `true` = jeder Termin bekommt eine eigene Seite `/e/<id>/` und kommt ins Archiv. Fehlt das Feld, gilt: wie der Haupt-Feed. |
| `tags` | — | Hashtags, die jeder Termin dieser Quelle bekommt, z. B. `["#kult41"]`. |
| `cap` | — | Maximale Terminzahl aus dieser Quelle (Standard 30). |
| `eventUrl` | — | Fester Link für Termine, deren ICS kein `URL`-Feld mitbringt. |
| `filter` | — | Nur mit `type: "ics-filtered"`. Siehe unten. |

Schlüssel mit `_` am Anfang (`_note`, `_comment`) sind freie Kommentare. Jeder
**andere** unbekannte Schlüssel ist ein Fehler — sonst schluckt der Sync einen
Tippfehler wie `icsUrl` stillschweigend.

### Filter

```json
"type": "ics-filtered",
"filter": {
  "categoryAllow": ["Öffentlich"],
  "categoryDeny":  ["Privat"],
  "titleAllow":    ["Workshop"],
  "titleDeny":     ["intern", "Probe"]
}
```

Deny gewinnt: Trifft eine Deny-Regel, ist der Termin raus. Allow-Regeln grenzen
danach weiter ein. Fehlende Regel = keine Einschränkung.

## Laufende Quellen prüfen

```sh
node scripts/check-calendars.mjs --probe
```

Ohne URL geht der Probe **alle** eingetragenen Quellen durch: erreichbar? wie viele
Termine? Nützlich, wenn ein Kalender verdächtig leer aussieht.

## Bitte nicht zum Testen benutzen

`node scripts/sync-events.mjs` ist der CI-Job, kein Probierwerkzeug. Er überschreibt
`events-data.json`, beide Feeds **und schreibt den JSON-LD-Block in die versionierte
`events.html`** — ein lokaler Testlauf hinterlässt also Änderungen im Repo. Zum
Ausprobieren ist `--probe` da; das schreibt nichts.
