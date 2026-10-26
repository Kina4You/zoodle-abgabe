/**
 * Fortschritt im Duell - wie nah ist ein Spieler seinem Tier schon?
 *
 * Nur reine Funktionen, KEIN Zugriff auf das Dokument. Dadurch laufen sie
 * genauso im Browser wie in den Tests mit node:test (tests/fortschritt.test.js).
 *
 * Warum im Browser und nicht auf dem Server? Beide Browser bekommen die
 * Bewertungen aller Tipps ohnehin mit der Nachricht "zug". Der Fortschritt ist
 * nur eine andere DARSTELLUNG dieser Daten - es entsteht keine neue
 * Information, also auch nichts, womit sich schummeln ließe.
 */

/**
 * Die sieben Eigenschaften in der Reihenfolge der Tabelle - mit Kurzform für
 * die Felder ("Kl"), Namen ("Klasse") und dem Artikel für Sätze ("die Klasse").
 */
export const EIGENSCHAFTEN = Object.freeze([
  { schluessel: 'klasse', kurz: 'Kl', name: 'Klasse', imSatz: 'die Klasse' },
  { schluessel: 'lebensraum', kurz: 'Le', name: 'Lebensraum', imSatz: 'den Lebensraum' },
  { schluessel: 'ernaehrung', kurz: 'Er', name: 'Ernährung', imSatz: 'die Ernährung' },
  { schluessel: 'gewichtKg', kurz: 'Ge', name: 'Gewicht', imSatz: 'das Gewicht' },
  { schluessel: 'groesseCm', kurz: 'Gr', name: 'Größe', imSatz: 'die Größe' },
  { schluessel: 'alterJahre', kurz: 'Al', name: 'Alter', imSatz: 'das Alter' },
  { schluessel: 'aktivitaet', kurz: 'Ak', name: 'Aktivitätszeit', imSatz: 'die Aktivitätszeit' },
]);

/** So heißen die Gefahrenstufen in der Anzeige. */
export const STUFENTEXT = Object.freeze({
  kalt: 'kalt',
  warm: 'warm',
  heiss: 'heiß',
  gleich: 'kurz vorm Ziel!',
});

/**
 * Welche Eigenschaften hat ein Spieler schon geknackt? Eine Eigenschaft ist
 * geknackt, sobald sie in IRGENDEINEM seiner Tipps gestimmt hat.
 *
 * @param {Array<{hinweise: Array<{schluessel: string, bewertung: string}>}>} tipps
 * @returns {Set<string>} Die Schlüssel, z. B. Set { 'klasse', 'alterJahre' }
 */
export function geknackt(tipps) {
  const ergebnis = new Set();
  for (const tipp of tipps) {
    for (const hinweis of tipp.hinweise) {
      if (hinweis.bewertung === 'treffer') ergebnis.add(hinweis.schluessel);
    }
  }
  return ergebnis;
}

/**
 * Wie "heiss" ist ein Spieler?
 *   0-2 geknackt: kalt · 3-4: warm · 5-6: heiss · 7: gleich ("kurz vorm Ziel!")
 *
 * @param {number} anzahl  Wie viele der sieben Eigenschaften geknackt sind
 * @returns {'kalt' | 'warm' | 'heiss' | 'gleich'}
 */
export function gefahrenstufe(anzahl) {
  if (anzahl >= 7) return 'gleich';
  if (anzahl >= 5) return 'heiss';
  if (anzahl >= 3) return 'warm';
  return 'kalt';
}

/** "a" · "a und b" · "a, b und c" */
export function aufzaehlung(woerter) {
  if (woerter.length <= 1) return woerter.join('');
  return `${woerter.slice(0, -1).join(', ')} und ${woerter.at(-1)}`;
}

/** Die Namen der noch offenen Eigenschaften, z. B. ['Gewicht', 'Größe']. */
export function fehlende(geknacktMenge) {
  return EIGENSCHAFTEN.filter((eigenschaft) => !geknacktMenge.has(eigenschaft.schluessel)).map(
    (eigenschaft) => eigenschaft.name,
  );
}

/**
 * Der Satz, wenn der Gegner etwas Neues geknackt hat - oder null.
 *
 *   "Lena hat die Aktivitätszeit geknackt – jetzt 5 von 7!"
 *   "Lena hat die Klasse und die Ernährung geknackt – jetzt 4 von 7!"
 * Steigt dabei die Stufe auf heiss bzw. "kurz vorm Ziel", kommt ein Satz dazu:
 *   "… Lena ist jetzt heiß." / "… Lena ist kurz vorm Ziel!"
 *
 * @param {Set<string>} vorher  geknackt vor dem Tipp
 * @param {Set<string>} nachher geknackt nach dem Tipp
 * @param {string} name         Name des Gegners
 * @returns {string | null}
 */
export function meilenstein(vorher, nachher, name) {
  const neu = EIGENSCHAFTEN.filter((e) => nachher.has(e.schluessel) && !vorher.has(e.schluessel));
  if (neu.length === 0) return null;

  let satz = `${name} hat ${aufzaehlung(neu.map((e) => e.imSatz))} geknackt – jetzt ${nachher.size} von 7!`;

  const stufeVorher = gefahrenstufe(vorher.size);
  const stufeNachher = gefahrenstufe(nachher.size);
  if (stufeNachher !== stufeVorher) {
    if (stufeNachher === 'heiss') satz += ` ${name} ist jetzt heiß.`;
    if (stufeNachher === 'gleich') satz += ` ${name} ist kurz vorm Ziel!`;
  }
  return satz;
}
