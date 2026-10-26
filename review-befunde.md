# Zoodle – Code-Review

**Datum:** 25.08.2026 · **Stand:** Commit `6ff2421` · **Umfang:** 2.540 Zeilen in 18 Dateien

Ausgangslage: `npm test` 33/33 grün, `npm run build` grün. Alle Befunde unten sind
am Code oder durch Messung belegt, nicht vermutet.

**Zusammenfassung:** Die Architektur trägt. Die Sicherheitsentscheidungen aus der
Projektdoku halten einem aktiven Angriff nachweislich stand – das geheime Tier
sickert nicht durch, die Zugreihenfolge lässt sich nicht aushebeln, der Server
stürzt nicht ab. Die Mängel liegen woanders: eine Datei ohne jeden Test, eine
Animation, die nie lief, und aufgelaufener toter Code.

| Schweregrad | Anzahl |
| ----------- | ------ |
| Kritisch    | 1      |
| Wichtig     | 8      |
| Kleinigkeit | 15     |

**Aufbau dieser Datei:** Teil 1 (bis „Vorgeschlagene Reihenfolge“) ist die eigene
Prüfung vom 25.08. – Zeilennummern und Zahlen darin beziehen sich auf den damaligen
Stand und werden bewusst nicht nachgeführt. Danach folgen die Antwort auf das Review
von Mudaser Ahmad und die Barrierefreiheits-Prüfung vom 06.10.

### Was aus den Befunden vom 25.08. geworden ist (nachgeprüft am 25.10.)

| Nr.           | Status heute                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| K1            | **erledigt** – `tests/server.test.js` startet den echten Server und testet ihn als Socket.io-Client                       |
| W1            | **erledigt** – die Verzögerung hängt jetzt an `td:nth-child`, die Kacheln decken nacheinander auf                         |
| W2            | **erledigt** – die Nachrichtenbremse hängt als `socket.use()` vor allen Ereignissen                                       |
| W3            | **erledigt** – `deutscheZahl()` formatiert überall mit Komma („0,6 cm“)                                                   |
| W4            | **erledigt** – wer gebremst wird, bekommt eine Meldung (höchstens einmal je Sekunde)                                      |
| W5            | **erledigt** – „Verbindung verloren“ erscheint in jeder Ansicht                                                           |
| W6            | **bewusst so gelassen** – keine Obergrenze für Verbindungen, begründet in der README unter „Bekannte Einschränkungen“     |
| W7            | **erledigt** – aufgeteilt in `pruefeRateversuch()`, `verteileZug()` und `behandleRateversuch()`                           |
| W8            | **erledigt** – die README beschreibt das `hidden`-Attribut                                                                |
| S1            | **bewusst so gelassen** – die Tonwertreihen in `tokens.css` sind absichtlich vollständig (Begründung steht dort)          |
| S2, S3, S4    | **erledigt** – doppelte `[hidden]`-Regeln, `TIER_NAMEN` und die toten `nth-child`-Regeln sind weg                         |
| S5, S6        | **erledigt** – kein Inline-Style, keine hartcodierte Farbe mehr in `index.html`                                           |
| S7            | **teilweise** – `spielfeld.css` nutzt Tokens; neu hinzugekommen ist `border-radius: 6px` bei `.spur__feld` in `duell.css` |
| S8            | **erledigt** – Schriftgrößen stehen als Tokens in `tokens.css`                                                            |
| S9            | **erledigt** – die `throw`-Zweige der Datenprüfung sind getestet                                                          |
| S10           | **teilweise** – die Zeile ist jetzt lesbar (`deutscheZahl()`), der Zweig unter 1 Gramm hat aber noch keinen eigenen Test  |
| S11           | **erledigt** – eigene Tests für die Grenzwerte 10 % sowie 0,4 und 2,5                                                     |
| S12, S13, S14 | **erledigt** – Architekturdiagramm, Testbeschreibung und Nachrichtenbremse in der README stimmen                          |
| S15           | **erledigt** – `fetch('/api/tiere')` mit führendem Schrägstrich                                                           |

---

## KRITISCH

### K1 · `server/server.js` (gesamte Datei) – null Testabdeckung

Der Coverage-Report listet die Datei **überhaupt nicht**, weil kein einziger Test sie
importiert:

```
file          | line % | branch % | funcs %
 partien.js   | 100.00 |  100.00  | 100.00
 spiel.js     |  99.46 |   96.08  | 100.00
 tierdaten.js |  92.31 |   81.25  | 100.00
 server.js    |    — nicht geladen —
```

Ungetestet sind damit namentlich: `behandleAnmeldung` (Z. 164), `behandleRateversuch`
(Z. 201), `behandleTrennung` (Z. 259), `zuVieleNachrichten` (Z. 130), `ermittlePort`
(Z. 47), `erreichbareAdressen` (Z. 286).

**Warum das ein Problem ist:** Genau in `behandleRateversuch` stehen die vier
Prüfungen, die das ganze Spiel gegen Cheating absichern. Fällt eine davon bei einer
späteren Änderung weg, meldet `npm test` weiterhin „33/33 grün". Die einzige Datei
mit Sicherheitsrelevanz ist die einzige ohne Regressionsschutz.

---

## WICHTIG

### W1 · `public/css/spielfeld.css:202–208` – die Staffel-Animation läuft nicht

```css
.kachel:nth-child(1) {
  animation-delay: 0s;
}
.kachel:nth-child(2) {
  animation-delay: 0.06s;
} /* matcht nie */
… .kachel:nth-child(7) {
  animation-delay: 0.36s;
} /* matcht nie */
```

`public/js/spielfeld.js:69–91` baut je Hinweis **ein eigenes `<td>` mit genau einer
`.kachel` darin**. Jede Kachel ist damit Einzelkind ihrer Zelle – `:nth-child(2)` bis
`(7)` können nie zutreffen. Alle sieben Kacheln bekommen `animation-delay: 0s`.

**Warum das ein Problem ist:** Der Kommentar darüber verspricht „decken nacheinander
auf – wie bei Wordle". Tatsächlich klappen alle gleichzeitig um. Sechs von sieben
Regeln sind toter Code, und „Animationen" ist ein eigenes Bewertungskriterium.

### W2 · `server/server.js:150–158` – die Nachrichtenbremse ist umgehbar

`zuVieleNachrichten` wird nur in den Handlern für `anmelden` und `raten` aufgerufen.
Jeder andere Ereignisname läuft ungezählt durch. **Gemessen:**

| Angriff                            | Ergebnis                            |
| ---------------------------------- | ----------------------------------- |
| `raten` × 120                      | Verbindung getrennt – Bremse greift |
| `voelligFrei` × 3000 (je 500 Byte) | **nicht getrennt, nicht gebremst**  |

**Warum das ein Problem ist:** Die README sagt in der Sicherheitstabelle (Z. 303)
„Höchstens 10 Nachrichten pro Sekunde und Verbindung". Das stimmt nur für zwei von
beliebig vielen Ereignisnamen. Socket.io parst jedes Paket, bevor es merkt, dass kein
Handler zuständig ist – die Arbeit fällt trotzdem an.

### W3 · `server/spiel.js:63` – Dezimalpunkt statt deutschem Komma

```js
return cm >= 100 ? `${(cm/100).toFixed(…).replace('.', ',')} m` : `${cm} cm`;
//                  Komma nur in diesem Zweig ────────┘         └── hier fehlt es
```

Betrifft drei Tiere in der echten Datenbank:

```
Ameise        0.6 cm      ← Punkt
Honigbiene    1.5 cm      ← Punkt
Marienkäfer   0.7 cm      ← Punkt
```

**Warum das ein Problem ist:** Überall sonst wird deutsch formatiert („2,5 m",
„1,5 kg"). Auf demselben Spielfeld stehen dann „2,5 m" und „0.6 cm" nebeneinander.

### W4 · `server/server.js:151` und `:156` – verworfene Tipps ohne Rückmeldung

```js
socket.on('raten', (rohName) => {
  if (zuVieleNachrichten(socket)) return; // stiller Abbruch
  behandleRateversuch(socket, rohName);
});
```

Wer die weiche Grenze von 10 Nachrichten pro Sekunde reißt, bekommt **keine**
`fehler`-Nachricht – der Tipp verschwindet kommentarlos.

**Warum das ein Problem ist:** Das trifft ehrliche Spieler. Wer in der
Vorschlagsliste schnell klickt oder Enter gedrückt hält, sieht, wie sein Tipp
wirkungslos verpufft, ohne zu erfahren warum. Am Spieltag sieht das wie ein Hänger aus.

### W5 · `public/js/client.js:219–221` – „Verbindung verloren" bleibt unsichtbar

```js
socket.on('disconnect', () => {
  zeigeEnde('Verbindung verloren', '…', false);
});
```

`zeigeEnde` macht `endeKarte` (`#ende`) sichtbar. Die Karte liegt aber in
`index.html:81` **innerhalb von `<main id="spielbereich" hidden>`**. Solange der
Spieler im Start- oder Wartebildschirm ist, ist der Elternknoten `hidden` – die
Meldung erscheint nicht.

**Warum das ein Problem ist:** Genau der Wartebildschirm ist der Zustand, in dem man
am längsten verharrt. Stirbt der Server währenddessen, sieht der Spieler unverändert
„Warte auf Gegner …" und wartet auf etwas, das nie kommt.

### W6 · `server/server.js` – keine Obergrenze für Verbindungen

**Gemessen:** 300 gleichzeitige Verbindungen wurden alle angenommen, alle 300
konnten sich anmelden (→ 150 Partien). Der Server lebte weiter und antwortete auf
HTTP – aber es gibt weder ein Limit pro IP noch insgesamt.

**Warum das ein Problem ist:** Die Nachrichtenbremse schützt eine _bestehende_
Verbindung. Gegen viele _neue_ Verbindungen greift nichts. Jede kostet Speicher und
einen Eintrag in `io.sockets.sockets`.

### W7 · `server/server.js:201–256` – `behandleRateversuch` ist 56 Zeilen lang

Die Funktion prüft die Regeln, führt den Zug aus, verschickt an beide Spieler zwei
verschiedene Ereignisse, protokolliert und räumt die Partie ab.

**Warum das ein Problem ist:** Deine Vorgabe lautet „verständlicher Code schlägt
cleveren Code", und ein Bewertungskriterium fragt wörtlich nach Verständlichkeit.
Die Datei behauptet in ihrem Kopfkommentar (Z. 5–7) „verdrahtet nur" – diese Funktion
tut vier Dinge auf einmal.

### W8 · `README.md:224–226` – beschreibt einen Mechanismus, den es nicht gibt

> „Alle vier Ansichten liegen gleichzeitig im HTML und werden über eine
> **CSS-Klasse** ein- und ausgeblendet."

Der Code nutzt durchgängig das **`hidden`-Attribut** (`client.js:69–72, 81–82,
88–89, 135, 176`), keine CSS-Klasse. Passend dazu gibt es die globale Regel
`[hidden] { display: none !important; }` in `basis.css:16`.

**Warum das ein Problem ist:** Wenn du am 07.10. gefragt wirst, wie das Umschalten
funktioniert, widerspricht deine eigene README deiner Antwort.

---

## KLEINIGKEITEN

### Toter Code

| #   | Fundstelle                                             | Befund                                                                                                                                                                                                    |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `public/css/tokens.css`                                | **17 definierte Tokens werden nirgends benutzt:** `--farbe-akzent-2`, `--neutral-300/400/500/800`, `--akzent-100/400/500/600`, `--akzent-2-100/400/500/600/800`, `--raum-8`, `--rund-md`, `--schatten-md` |
| S2  | `komponenten.css:138`, `spielfeld.css:11, 48, 92, 225` | 5 Regeln `…[hidden] { display: none; }` – die globale Regel in `basis.css:16` trägt `!important` und gewinnt ohnehin                                                                                      |
| S3  | `server/tierdaten.js:41–43`                            | `TIER_NAMEN` wird exportiert, aber von keiner Produktionsdatei benutzt – nur vom Test in `tierdaten.test.js:56`, der damit nur sich selbst prüft                                                          |
| S4  | `public/css/spielfeld.css:203–208`                     | 6 der 7 `nth-child`-Regeln aus W1                                                                                                                                                                         |

### Verletzungen der eigenen Konventionen

| #   | Fundstelle                    | Befund                                                                                                                                      |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| S5  | `public/index.html:128`       | Inline-Style `style="width:100%;margin-top:var(--raum-2)"` – die einzige Stelle im Projekt                                                  |
| S6  | `public/index.html:25`        | Hartcodiertes `stroke="#f5ead8"` im Logo-SVG; das ist `--farbe-grund`                                                                       |
| S7  | `spielfeld.css:148, 180, 218` | `border-radius: 22px` (×2) und `32px` statt Tokens – die Regel lautet „Rundungen ausschließlich über Custom Properties"                     |
| S8  | `tokens.css`                  | Für Schriftgrößen gibt es gar keine Tokens; `46px`, `28px`, `26px`, `16px`, `15px`, `13px`, `12px`, `11px` stehen verstreut in vier Dateien |

### Tests

| #   | Fundstelle                                | Befund                                                                                                                                        |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| S9  | `server/tierdaten.js:24–25, 29–30, 35–36` | Alle drei `throw`-Zweige der Datenprüfung sind ungetestet – dass ein kaputter Datensatz den Start _verhindert_, ist nie belegt                |
| S10 | `server/spiel.js:59`                      | Einzige unabgedeckte Zeile in `spiel.js`: der Zweig unter 1 Gramm. Zugleich die unleserlichste Zeile des Projekts – vier verkettete `replace` |
| S11 | `tests/spiel.test.js`                     | Kein Test für die Grenzwerte selbst: 0,9 / 1,1 (Treffer-Kante) und 0,4 / 2,5 (nah-Kante) werden nie geprüft, nur Werte klar innerhalb         |

### Dokumentation

| #   | Fundstelle          | Befund                                                                                                               |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| S12 | `README.md:138–141` | Im Architekturdiagramm fehlt die Kante `part --> daten`; `partien.js:10` importiert `zufallsTier` aus `tierdaten.js` |
| S13 | `README.md:321`     | „33 Tests … **ohne zusätzliche Abhängigkeit**" – wird mit `socket.io-client` als devDependency falsch                |
| S14 | `README.md:303`     | „Höchstens 10 Nachrichten pro Sekunde und Verbindung" – gilt laut Messung nur für `anmelden` und `raten` (siehe W2)  |

### Sonstiges

| #   | Fundstelle                | Befund                                                                                                 |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| S15 | `public/js/client.js:229` | `fetch('api/tiere')` ohne führenden Schrägstrich – funktioniert nur, solange die Seite unter `/` liegt |

---

## Was geprüft wurde und in Ordnung ist

Damit nicht der Eindruck entsteht, es sei nur nach Fehlern gesucht worden:

- **Kein `innerHTML`, `outerHTML`, `eval` oder `document.write`** – im gesamten
  Projekt nachweislich nicht vorhanden. Der XSS-Schutz ist konsequent umgesetzt.
- **`partien.js` kennt Socket.io nicht** – die behauptete Entkopplung stimmt, die
  Datei importiert nur `spiel.js` und `tierdaten.js`. Deshalb 100 % Abdeckung ohne
  laufenden Server.
- **`spiel.js` importiert gar nichts** – die Spielregeln hängen an keiner Infrastruktur.
- **Semantisches HTML** – `<table>` mit `<caption>` und `<th scope="col">`,
  `<header>/<main>/<footer>`, `role="alert"`, `.nur-sr`-Klasse für Screenreader.
- **Zahlengrenzen der Bewertung** stimmen mit der README überein (10 % Treffer,
  Verhältnis 0,4–2,5 für „nah dran"), ebenso die `GRUPPEN`-Listen und die Angabe
  „Säugetier → alle 87" (nachgezählt: exakt 87).
- **Die Ablaufdiagramme stimmen.** Das Sequenzdiagramm bildet den echten Code ab,
  inklusive der Feinheit, dass bei einem Treffer erst `zug` und dann `spielEnde` an
  **beide** Spieler geht.

---

## Aktiver Sicherheitstest

Durchgeführt mit einem Wegwerf-Skript, das sich als roher Socket.io-Client gegen
einen echt gestarteten Server verbindet und den Browser komplett umgeht. Das Skript
las das gesuchte Tier aus dem **Serverlog** mit und konnte damit jede an die Clients
gesendete Nachricht darauf durchsuchen. Nach dem Test gelöscht.

| #   | Angriff                                                                                                             | Ergebnis                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Raten, obwohl nicht am Zug                                                                                          | **Abgewehrt** – `"Du bist nicht am Zug."`, kein `zug` erzeugt                                                   |
| 1b  | Die Lösung nennen, obwohl nicht am Zug                                                                              | **Abgewehrt** – auch der richtige Tipp wird abgelehnt                                                           |
| 2   | Lösung aus Servernachrichten ableiten                                                                               | **Kein Leck** – 6 Züge gespielt, alle Nachrichten an beide Clients durchsucht, `"Weißer Hai"` kam in keiner vor |
| 2b  | Lösung in `/api/tiere` markiert?                                                                                    | **Nein** – der Eintrag ist von 158 anderen nicht zu unterscheiden                                               |
| 3   | In fremde Partie einklinken                                                                                         | **Abgewehrt** – `"Du bist gerade in keiner laufenden Partie."`, 0 von 6 fremden Zügen mitgehört                 |
| 4   | 14 kaputte Payload-Arten (`null`, `{}`, `[1,2,3]`, Prototype Pollution, Steuerzeichen, RTL-Override, 7.000 Zeichen) | **Kein Absturz**                                                                                                |
| 4b  | Nachricht über 8 KB                                                                                                 | **Sauber getrennt** – `maxHttpBufferSize` greift                                                                |
| 4c  | Nachrichtenflut mit freiem Ereignisnamen                                                                            | **LÜCKE** → siehe W2                                                                                            |
| 5   | 300 gleichzeitige Verbindungen                                                                                      | Server überlebt, aber **kein Limit vorhanden** → siehe W6                                                       |
| 6   | Verbindungsabbruch im Wartebildschirm / in laufender Partie / nach einem Zug                                        | **Kein Absturz** in allen drei Phasen                                                                           |
| 7   | 8 Tipps desselben Spielers in derselben Millisekunde                                                                | **Abgewehrt** – genau 1 gewertet, 7 abgelehnt                                                                   |

**Ergebnis: 9 von 11 Prüfungen bestanden.** Die beiden Lücken sind W2 und W6 –
beides Verfügbarkeitsthemen. Kein einziger Angriff konnte die Lösung vorzeitig
erfahren, einen Zug erschleichen oder eine fremde Partie beeinflussen.

Zu Punkt 7 im Detail, weil es die interessanteste Bestätigung ist: Ein erster
Testversuch ließ **beide** Spieler gleichzeitig feuern und meldete zwei gültige
Züge – das war ein Fehlalarm im Testskript. Der zweite Zug war legitim, weil der
erste den Zug bereits weitergereicht hatte. Der echte Angriff ist, denselben Spieler
achtmal feuern zu lassen. Genau ein Tipp wurde gewertet. Die Entscheidung,
`behandleRateversuch` synchron zu halten, trägt also messbar.

---

## Vorgeschlagene Reihenfolge

1. **K1** – Integrationstests für `server.js` (schließt zugleich die Belegpflicht
   für den Anti-Cheat-Nachweis am 07.10.)
2. **W1** – Staffel-Animation reparieren
3. **W3** – Komma statt Punkt in `formatiereGroesse`
4. **W2** – Nachrichtenbremse auf `socket.use()` umstellen
5. **S1–S5** – toten Code entfernen

---

## Antwort auf das Review von Mudaser Ahmad

Mudaser Ahmad hat Zoodle reviewt und 17 Punkte gemeldet – als PDF, nicht als
GitHub-Issues. Diese Tabelle ist deshalb der Nachweis, was aus jedem Punkt geworden
ist. Die Nummern sind seine Nummern aus der PDF. Jeder Commit beginnt mit
„Review #n“, nach jedem liefen `npm test` und `npm run build` grün.

| Nr. | Titel (aus der PDF)                                                 | Was geändert wurde                                                                                                                                                                                                                           | Commit       |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | Revanche-Zusage + Warteschlange: ein Spieler steckt in zwei Partien | `ziehtWeiter()` löst eine offene Revanche-Zusage auf, bevor jemand in Warteschlange, eigene oder fremde Lobby geht. 3 Regressionstests.                                                                                                      | `0ca291f`    |
| 2   | Duell-Wahlphase ohne Frist und ohne Ausweg                          | Wahlfrist 60 s (`WAHLZEIT_SEKUNDEN`) über die vorhandene Zuguhr: Wer gewählt hat, gewinnt; keiner gewählt → Abbruch. In einer Lobby ohne Zeitlimit keine Frist. Neues Ereignis `aufgeben` mit Knopf „Partie verlassen“. 6 Tests.             | `a47cf10`    |
| 3   | README klont das falsche Repo                                       | **Erledigt.** Abgabe-Repo ist das öffentliche `Kina4You/zoodle-abgabe` mit dem aktuellen Stand; README-Schnellstart, Zugangsabschnitt und Server-Anleitung klonen genau dieses Repo. (Entwickelt wird in `Kina4You/zoodle`, das privat ist.) | Abgabe-Check |
| 4   | Veraltete Zahlen in der README                                      | Zahlen entfernt („über hundert Tiere“, „`npm test` zeigt die Anzahl“), damit sie nicht wieder veralten.                                                                                                                                      | `38354b2`    |
| 5   | Build prüft nur 6 handgelistete Serverdateien                       | `scripts/pruefe-syntax.js` sammelt alle `.js`/`.mjs` in `server/`, `public/js/`, `scripts/`, `tests/` selbst ein. 4 Tests.                                                                                                                   | `908f129`    |
| 6   | Kein Linter                                                         | **Nachgeholt beim Abgabe-Check.** ESLint 9 mit den empfohlenen Regeln (`npm run lint`, `eslint.config.js`), bewusst nicht Teil von `npm run build`.                                                                                          | `4b4824f`    |
| 7   | `npm audit`: 3 Lücken                                               | `npm audit fix` ohne `--force` (nur Unterversionen: body-parser, engine.io, proxy-addr, qs). Danach 0 Lücken.                                                                                                                                | `4664a39`    |
| 8   | px und rem gemischt, doppelte Text-Tokens                           | Abstände `--raum-*` exakt in rem; `--text-xs/-sm/-md` (alle 0.875rem) → `--text-sm`. Linien, Rundungen, Klickflächen, Breakpoints bleiben begründet in px. 11 Screenshots bei 1024 × 768 vorher/nachher pixelgleich.                         | `4cc0818`    |
| 9   | Veralteter Kommentar zur Layer-Reihenfolge                          | Kopien in `lobby.css` und `duell.css` verweisen jetzt auf `schriften.css`.                                                                                                                                                                   | `4910c88`    |
| 10  | `scryptSync` blockiert den ganzen Server                            | Asynchrones `scrypt`, nach dem `await` alles neu prüfen, höchstens 4 Prüfungen gleichzeitig (`beschaeftigt`). Gemessen: ein Unbeteiligter wartete unter Last bis 1.885 ms, jetzt höchstens 10 ms. 6 Tests.                                   | `8a0fcea`    |
| 11  | Passwort-Sperre lässt sich durch Neuverbinden umgehen               | Fehlversuche je Lobby **und IP-Adresse**, bleiben beim Trennen stehen. README nennt die Grenze ehrlich. 3 Tests.                                                                                                                             | `c996189`    |
| 12  | Tests lesen das geheime Tier aus dem Konsolenlog                    | `ZOODLE_TESTTIER` gibt in Tests das Tier vor; das Log nennt kein Geheimnis mehr. Falscher Zeilenverweis entfernt. 2 Tests.                                                                                                                   | `ded0923`    |
| 13  | „Vier“ Regelprüfungen, im Code sind es sechs                        | README listet die sechs Prüfungen nummeriert auf; Kommentar und Testnamen nutzen dieselben Nummern.                                                                                                                                          | `7b9ca2b`    |
| 14  | `client.js` ist zu groß                                             | **Bewusst nicht umgesetzt.** Drei Tage vor der Abgabe ist das Risiko eines kaputten Duells größer als der Nutzen einer kleineren Datei.                                                                                                      | –            |
| 15  | 50 Verbindungen belegen alle privaten Lobbys                        | Höchstens 3 offene Lobbys je IP-Adresse; Lobbys ohne Gast schließen nach 10 Minuten (`LOBBY_LEBENSDAUER`). 5 Tests.                                                                                                                          | `291bb9f`    |
| 16  | Endlos-Animationen widersprechen der 5-Sekunden-Regel               | Überall feste Anzahl statt `infinite`, Rechnung im Kommentar (4,2 s / 4,0 s / 4,3 s / 3 s). Im Browser geprüft: nach 5,5 s läuft nichts mehr.                                                                                                | `c79ebef`    |
| 17  | `<br>` für Layout im Leertext der Lobbyliste                        | Zwei `<p>` statt Zeilenumbruch, Screenshot pixelgleich.                                                                                                                                                                                      | `ec58a69`    |

Offene Frage aus dem Review (kein Issue): Die Vorgabe verbindet Spieler direkt nach
der Anmeldung. Die README erklärt jetzt unter „Abweichung von der Vorgabe“, dass
„Schnell spielen“ genau diesen Ablauf erfüllt und die privaten Lobbys ein Zusatz sind
(`9fb95ca`).

---

## Barrierefreiheits-Prüfung (WCAG 2.2 AA, eigene Prüfung vom 06.10.)

| Nr. | Befund                                               | Status                                                                                  | Commit    |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- | --------- |
| B1  | Fehlermeldungen auf der Szene kaum lesbar (1,65 : 1) | erledigt, nachgemessen 8,14 : 1                                                         | `3624db0` |
| B2  | Fokus fällt nach dem eigenen Tipp auf `<body>`       | erledigt, im Browser mit Tastatur nachgeprüft                                           | `3de5a47` |
| B3  | Fokusrahmen 2,88 : 1                                 | erledigt, nachgemessen 5,35 : 1                                                         | `7cf00f8` |
| B4  | Feldrand 1,37 : 1                                    | erledigt, nachgemessen 3,37 : 1                                                         | `7cf00f8` |
| B5  | „wartest“ in der Spielermarke zu blass               | erledigt, nachgemessen 5,36 : 1                                                         | `14d4ee0` |
| B6  | nur Platzhalter statt sichtbarer Beschriftung        | erledigt, Platzhalter 6,02 : 1                                                          | `ce98d45` |
| B7  | Öffentlich immer 10 s Zugzeit (2.2.1)                | erledigt: Ausnahme „wesentlich“, Alternative „ohne Zeitlimit“ in Spielregeln und README | `53d47c4` |
| B8  | Revanche-Knopf pulsiert endlos (2.2.2)               | erledigt zusammen mit Review #16                                                        | `c79ebef` |
| B9  | Passwort-Knopf doppelt beschriftet (4.1.2)           | erledigt: feste Beschriftung „Passwort anzeigen“ + `aria-pressed`                       | `7897112` |
| B10 | „10 s“ sichtbar, „10 Sekunden“ vorgelesen (2.5.3)    | erledigt: sichtbar und vorgelesen „10 Sek.“                                             | `5cfdd9a` |
| B11 | Fokus springt ungefragt ins Eingabefeld              | erledigt, im Browser mit Tastatur nachgeprüft                                           | `3de5a47` |
| B12 | Spielername ohne `autocomplete` (1.3.5)              | erledigt: `autocomplete="nickname"`                                                     | `747af38` |
| B13 | Namensfehler ohne `aria-invalid` (3.3.1)             | erledigt: gemeinsame Hilfsfunktion `setzeFeldfehler()`                                  | `e7a0e14` |
| B14 | `<p>` als Kind der Vorschlagsliste (1.3.1, 4.1.2)    | erledigt: Hinweis außerhalb der Listbox, per `aria-describedby`                         | `315d242` |

Zusätzlich: Die Kontraste der Duell-Bretter und des Endstands sind nachgemessen
(alle Texte ≥ 5,17 : 1, alle nötigen Rahmen ≥ 3,30 : 1). Im Kontrastmodus
(`forced-colors`) waren zwei Legenden-Proben und der Logo-Kreis unsichtbar – behoben
in `156a678`.

---

## Selbstprüfung nach eigenem Review

Im Code Review eines anderen Projekts (Mancala) haben wir 23 Schwachstellen gefunden.
Wer anderen diese Fehler vorhält, darf sie selbst nicht haben. Jeder Punkt wurde in
Zoodle **zur Laufzeit** geprüft – mit Socket.io-Skripten, `curl`, Brave (Chromium) und
Tests –, nicht nur durch Lesen des Codes.

| Punkt                                                                          | Ergebnis                                                                                                          | Commit                                                |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| A1 Unsichtbare Zeichen im Namen (U+202E, Null-Breite, Zalgo)                   | **betraf Zoodle** – `server/namen.js` entfernt Steuer- und Formatzeichen, begrenzt Akzente                        | `6cbfced`                                             |
| A2 Gegner nennt sich „Du"                                                      | betrifft Zoodle, **bewusst so gelassen**: Die eigene Marke heißt immer „Du", Zug und Sieg bleiben eindeutig       | –                                                     |
| A3 Phase ohne Frist oder Ausweg                                                | **betraf Zoodle** (Lobby ohne Zeitlimit, Ratephase) – „Partie verlassen" in jeder laufenden Partie, im Seitenkopf | `a448e75`, `528ba08`                                  |
| A4 Aufräumen ohne Nachricht                                                    | nicht betroffen – jede Aufräumstelle meldet sich                                                                  | –                                                     |
| A5 Ereignis mit Doppelbedeutung                                                | nicht betroffen – kein Ereignis beendet eine laufende Partie aus Versehen                                         | –                                                     |
| A6 Keine Sicherheits-Kopfzeilen                                                | **betraf Zoodle** – CSP, `nosniff`, `Referrer-Policy`, kein `X-Powered-By`; ohne Zusatzpaket                      | `f8d1ab5`                                             |
| A7 Grenzen nur pro Verbindung                                                  | teilweise – alles begrenzt bis auf die Zahl der Verbindungen (README: Bekannte Einschränkungen)                   | –                                                     |
| B1 `.slice` zerschneidet Emoji                                                 | **betraf Zoodle** – Kürzen nach ganzen Zeichen (`Intl.Segmenter`)                                                 | `6cbfced`                                             |
| B2 Sieger trotz Abbruch                                                        | Daten stimmten; nur die Abbruch-Karte hatte Niederlage-Farbe → jetzt neutral                                      | `624fbe5`                                             |
| B3 Kommentare passen nicht zum Code                                            | Kommentare abgeglichen, Geschichte und Review-Nummern entfernt, echte Umlaute                                     | `a4cfb0e`, `d16008c`, `83619d1`, `2e632c7`, `1f6ea25` |
| B4 Toter Code                                                                  | teilweise – doppelte Modusliste und ein unnötiger Export entfernt; Ereignisse Server↔Client passen 1:1            | `81249d6`                                             |
| B5 Unklare Namen                                                               | nicht betroffen                                                                                                   | –                                                     |
| B6 Verweise auf Dokumente außerhalb des Repos                                  | betraf Kommentare – entfernt (siehe B3)                                                                           | wie B3                                                |
| B7 Seite verlassen ohne Rückfrage                                              | **betraf Zoodle** – `beforeunload` nur während einer Partie                                                       | `ca26887`                                             |
| C1–C4 Screenreader-Namen, Ansagen, Dialognamen, Umschrift in sichtbaren Texten | nicht betroffen                                                                                                   | –                                                     |
| D1/D2 Kleine Bildschirme                                                       | 1024 × 768 einwandfrei (Pflicht); auf dem Handy scrollt das Spielfeld waagerecht – bewusst nicht angefasst        | –                                                     |
| D3 Lange Namen                                                                 | **teilweise** – Name und „Zeit von …" enden mit „…", die Leiste bleibt bei 20 Zeichen einzeilig                   | `57b589e`                                             |
| E1 Build prüft kaum etwas                                                      | erledigt durch Review #5 (`908f129`)                                                                              | –                                                     |
| E2 Regressionstests                                                            | jede Korrektur mit Test, der ohne die Korrektur scheitert (Gegenprobe)                                            | –                                                     |

Doku-Abgleich mit dem Code: `19c6877`.

### Farbkontrast-Messung (25.10.)

Gemessen im Browser bei 1024 × 768 in 22 Spielzuständen: pro Zustand ein
Bildschirmfoto ohne Text, gegen das jede Schriftfarbe gerechnet wurde – so zählt
auch die Szene hinter dem Papier mit. Dazu alle Fokusrahmen und die Simulation von
Rot-, Grün- und Blauschwäche.

| Stelle                                                          | vorher                       | nachher  | Commit    |
| --------------------------------------------------------------- | ---------------------------- | -------- | --------- |
| ✓ ~ ✕ in den Kacheln (`opacity: 0.85`)                          | **4,04 : 1** (durchgefallen) | 5,90 : 1 | `dbdcef9` |
| Schrift auf dem Hauptknopf                                      | 4,55 : 1 (knapp)             | 5,52 : 1 | `8d5af76` |
| Spaltenköpfe über dem dunklen Wald (Papier zu 4 % durchsichtig) | 4,49 : 1 (knapp)             | 4,88 : 1 | `203f57b` |
| Rahmen der gewählten Option (Modus, Zugzeit)                    | 2,88 : 1 (knapp)             | 3,72 : 1 | `f9111d2` |

In Ordnung waren: alle übrigen Texte (≥ 5,1 : 1), alle 19 Fokusrahmen (≥ 5,4 : 1),
Rahmen der Eingabefelder (≥ 3,5 : 1). Bei Farbsehschwäche bleiben die drei Kachelarten
an der Helligkeit unterscheidbar. Bewusst unverändert: ausgegraute Elemente (inaktiv,
von WCAG ausgenommen; „Gegner ist weg“ steht zusätzlich im Text der Endkarte).
Regressionstest: `tests/kontrast.test.js`.

### Neue Palette (26.10.)

Die Farben waren barrierefrei, wirkten aber gedeckt. Neue Palette in derselben
Stimmung: Smaragd für „stimmt", Honig für „nah dran" (eine neue Reihe `--sonne`),
Koralle für Knöpfe. Zuvor als Vorschau mit zwei Varianten verglichen. Ein reines
Sonnengelb wurde verworfen: Es war fast so hell wie „falsch" und bei Grünschwäche
kaum davon zu unterscheiden.

| Paar                                       | vorher   | nachher                                |
| ------------------------------------------ | -------- | -------------------------------------- |
| Schrift auf den Kacheln (schlechteste)     | 5,90 : 1 | 5,70 : 1                               |
| Hauptknopf                                 | 5,53 : 1 | 6,64 : 1                               |
| „stimmt" gegen „falsch" (Helligkeit)       | 4,35 : 1 | 4,21 : 1                               |
| „nah dran" gegen „falsch" bei Grünschwäche | 1,30 : 1 | 1,29 : 1                               |
| „Du" unter dem Tipp                        | 5,10 : 1 | 7,06 : 1 (Stufe 800, Commit `1cbc7d6`) |

Der Kontrasttest prüft jetzt zusätzlich Spielermarken, Duell-Stufen, Plakette,
Meldung, die Namen unter den Tipps und die Rahmen von Feld, Fokus und Treffer.
Pixelmessung im Browser danach: kein aktiver Text unter dem Soll.
