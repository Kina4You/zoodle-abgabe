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
|---|---|
| Kritisch | 1 |
| Wichtig | 8 |
| Kleinigkeit | 15 |

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
.kachel:nth-child(1) { animation-delay: 0.00s; }
.kachel:nth-child(2) { animation-delay: 0.06s; }   /* matcht nie */
…
.kachel:nth-child(7) { animation-delay: 0.36s; }   /* matcht nie */
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

| Angriff | Ergebnis |
|---|---|
| `raten` × 120 | Verbindung getrennt – Bremse greift |
| `voelligFrei` × 3000 (je 500 Byte) | **nicht getrennt, nicht gebremst** |

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
  if (zuVieleNachrichten(socket)) return;   // stiller Abbruch
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

**Warum das ein Problem ist:** Die Nachrichtenbremse schützt eine *bestehende*
Verbindung. Gegen viele *neue* Verbindungen greift nichts. Jede kostet Speicher und
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

| # | Fundstelle | Befund |
|---|---|---|
| S1 | `public/css/tokens.css` | **17 definierte Tokens werden nirgends benutzt:** `--farbe-akzent-2`, `--neutral-300/400/500/800`, `--akzent-100/400/500/600`, `--akzent-2-100/400/500/600/800`, `--raum-8`, `--rund-md`, `--schatten-md` |
| S2 | `komponenten.css:138`, `spielfeld.css:11, 48, 92, 225` | 5 Regeln `…[hidden] { display: none; }` – die globale Regel in `basis.css:16` trägt `!important` und gewinnt ohnehin |
| S3 | `server/tierdaten.js:41–43` | `TIER_NAMEN` wird exportiert, aber von keiner Produktionsdatei benutzt – nur vom Test in `tierdaten.test.js:56`, der damit nur sich selbst prüft |
| S4 | `public/css/spielfeld.css:203–208` | 6 der 7 `nth-child`-Regeln aus W1 |

### Verletzungen der eigenen Konventionen

| # | Fundstelle | Befund |
|---|---|---|
| S5 | `public/index.html:128` | Inline-Style `style="width:100%;margin-top:var(--raum-2)"` – die einzige Stelle im Projekt |
| S6 | `public/index.html:25` | Hartcodiertes `stroke="#f5ead8"` im Logo-SVG; das ist `--farbe-grund` |
| S7 | `spielfeld.css:148, 180, 218` | `border-radius: 22px` (×2) und `32px` statt Tokens – die Regel lautet „Rundungen ausschließlich über Custom Properties" |
| S8 | `tokens.css` | Für Schriftgrößen gibt es gar keine Tokens; `46px`, `28px`, `26px`, `16px`, `15px`, `13px`, `12px`, `11px` stehen verstreut in vier Dateien |

### Tests

| # | Fundstelle | Befund |
|---|---|---|
| S9 | `server/tierdaten.js:24–25, 29–30, 35–36` | Alle drei `throw`-Zweige der Datenprüfung sind ungetestet – dass ein kaputter Datensatz den Start *verhindert*, ist nie belegt |
| S10 | `server/spiel.js:59` | Einzige unabgedeckte Zeile in `spiel.js`: der Zweig unter 1 Gramm. Zugleich die unleserlichste Zeile des Projekts – vier verkettete `replace` |
| S11 | `tests/spiel.test.js` | Kein Test für die Grenzwerte selbst: 0,9 / 1,1 (Treffer-Kante) und 0,4 / 2,5 (nah-Kante) werden nie geprüft, nur Werte klar innerhalb |

### Dokumentation

| # | Fundstelle | Befund |
|---|---|---|
| S12 | `README.md:138–141` | Im Architekturdiagramm fehlt die Kante `part --> daten`; `partien.js:10` importiert `zufallsTier` aus `tierdaten.js` |
| S13 | `README.md:321` | „33 Tests … **ohne zusätzliche Abhängigkeit**" – wird mit `socket.io-client` als devDependency falsch |
| S14 | `README.md:303` | „Höchstens 10 Nachrichten pro Sekunde und Verbindung" – gilt laut Messung nur für `anmelden` und `raten` (siehe W2) |

### Sonstiges

| # | Fundstelle | Befund |
|---|---|---|
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

| # | Angriff | Ergebnis |
|---|---|---|
| 1 | Raten, obwohl nicht am Zug | **Abgewehrt** – `"Du bist nicht am Zug."`, kein `zug` erzeugt |
| 1b | Die Lösung nennen, obwohl nicht am Zug | **Abgewehrt** – auch der richtige Tipp wird abgelehnt |
| 2 | Lösung aus Servernachrichten ableiten | **Kein Leck** – 6 Züge gespielt, alle Nachrichten an beide Clients durchsucht, `"Weißer Hai"` kam in keiner vor |
| 2b | Lösung in `/api/tiere` markiert? | **Nein** – der Eintrag ist von 158 anderen nicht zu unterscheiden |
| 3 | In fremde Partie einklinken | **Abgewehrt** – `"Du bist gerade in keiner laufenden Partie."`, 0 von 6 fremden Zügen mitgehört |
| 4 | 14 kaputte Payload-Arten (`null`, `{}`, `[1,2,3]`, Prototype Pollution, Steuerzeichen, RTL-Override, 7.000 Zeichen) | **Kein Absturz** |
| 4b | Nachricht über 8 KB | **Sauber getrennt** – `maxHttpBufferSize` greift |
| 4c | Nachrichtenflut mit freiem Ereignisnamen | **LÜCKE** → siehe W2 |
| 5 | 300 gleichzeitige Verbindungen | Server überlebt, aber **kein Limit vorhanden** → siehe W6 |
| 6 | Verbindungsabbruch im Wartebildschirm / in laufender Partie / nach einem Zug | **Kein Absturz** in allen drei Phasen |
| 7 | 8 Tipps desselben Spielers in derselben Millisekunde | **Abgewehrt** – genau 1 gewertet, 7 abgelehnt |

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
