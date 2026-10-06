/**
 * Tests des Duell-Fortschritts (public/js/fortschritt.js).
 *
 * Das Modul greift nicht auf das Dokument zu - deshalb laeuft es hier ohne
 * Browser. Die Tipps sind so aufgebaut wie die Nachricht "zug" vom Server.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EIGENSCHAFTEN, STUFENTEXT, geknackt, gefahrenstufe, meilenstein, aufzaehlung, fehlende,
} from '../public/js/fortschritt.js';
import { KATEGORIEN } from '../server/spiel.js';

/** Ein Tipp, bei dem genau die genannten Eigenschaften stimmen. */
function tipp(...treffer) {
  return {
    hinweise: EIGENSCHAFTEN.map(({ schluessel }) => ({
      schluessel,
      bewertung: treffer.includes(schluessel) ? 'treffer' : 'daneben',
    })),
  };
}

const menge = (...schluessel) => new Set(schluessel);

test('die Eigenschaften passen genau zu den Kategorien des Servers', () => {
  assert.deepEqual(EIGENSCHAFTEN.map((e) => e.schluessel), KATEGORIEN.map((k) => k.schluessel));
});

// --------------------------------------------------------------------------
// geknackt
// --------------------------------------------------------------------------

test('geknackt: ohne Tipps ist nichts geknackt', () => {
  assert.equal(geknackt([]).size, 0);
});

test('geknackt: zaehlt, was in IRGENDEINEM Tipp stimmte', () => {
  const ergebnis = geknackt([tipp('klasse'), tipp('alterJahre', 'klasse'), tipp()]);
  assert.deepEqual([...ergebnis].sort(), ['alterJahre', 'klasse']);
});

test('geknackt: "nah dran" zaehlt nicht', () => {
  const nah = { hinweise: [{ schluessel: 'klasse', bewertung: 'nah' }] };
  assert.equal(geknackt([nah]).size, 0);
});

// --------------------------------------------------------------------------
// gefahrenstufe - alle Grenzen
// --------------------------------------------------------------------------

test('gefahrenstufe: 0 bis 2 ist kalt', () => {
  for (const n of [0, 1, 2]) assert.equal(gefahrenstufe(n), 'kalt', String(n));
});

test('gefahrenstufe: Grenze 2/3 - ab 3 warm', () => {
  assert.equal(gefahrenstufe(2), 'kalt');
  assert.equal(gefahrenstufe(3), 'warm');
  assert.equal(gefahrenstufe(4), 'warm');
});

test('gefahrenstufe: Grenze 4/5 - ab 5 heiss', () => {
  assert.equal(gefahrenstufe(4), 'warm');
  assert.equal(gefahrenstufe(5), 'heiss');
  assert.equal(gefahrenstufe(6), 'heiss');
});

test('gefahrenstufe: Grenze 6/7 - bei 7 kurz vorm Ziel', () => {
  assert.equal(gefahrenstufe(6), 'heiss');
  assert.equal(gefahrenstufe(7), 'gleich');
});

test('jede Stufe hat ein Wort fuer die Anzeige', () => {
  assert.deepEqual(STUFENTEXT, { kalt: 'kalt', warm: 'warm', heiss: 'heiß', gleich: 'kurz vorm Ziel!' });
});

// --------------------------------------------------------------------------
// meilenstein
// --------------------------------------------------------------------------

test('meilenstein: nichts Neues -> null', () => {
  assert.equal(meilenstein(menge('klasse'), menge('klasse'), 'Lena'), null);
  assert.equal(meilenstein(menge(), menge(), 'Lena'), null);
});

test('meilenstein: eine neue Eigenschaft, mit richtigem Artikel', () => {
  assert.equal(
    meilenstein(menge('klasse'), menge('klasse', 'lebensraum'), 'Lena'),
    'Lena hat den Lebensraum geknackt – jetzt 2 von 7!',
  );
});

test('meilenstein: alle sieben Artikel stimmen', () => {
  const erwartet = {
    klasse: 'die Klasse', lebensraum: 'den Lebensraum', ernaehrung: 'die Ernährung',
    gewichtKg: 'das Gewicht', groesseCm: 'die Größe', alterJahre: 'das Alter',
    aktivitaet: 'die Aktivitätszeit',
  };
  for (const [schluessel, imSatz] of Object.entries(erwartet)) {
    assert.match(meilenstein(menge(), menge(schluessel), 'Lena'), new RegExp(`^Lena hat ${imSatz} geknackt`), schluessel);
  }
});

test('meilenstein: zwei neue auf einmal - mit "und"', () => {
  assert.equal(
    meilenstein(menge(), menge('klasse', 'ernaehrung'), 'Lena'),
    'Lena hat die Klasse und die Ernährung geknackt – jetzt 2 von 7!',
  );
});

test('meilenstein: drei neue auf einmal - mit Komma und "und", in Tabellenreihenfolge', () => {
  assert.equal(
    meilenstein(menge(), menge('aktivitaet', 'klasse', 'gewichtKg'), 'Lena'),
    'Lena hat die Klasse, das Gewicht und die Aktivitätszeit geknackt – jetzt 3 von 7!',
  );
});

test('meilenstein: steigt die Stufe auf heiss, kommt ein Satz dazu', () => {
  const vorher = menge('klasse', 'lebensraum', 'ernaehrung', 'alterJahre');
  const nachher = menge('klasse', 'lebensraum', 'ernaehrung', 'alterJahre', 'aktivitaet');
  assert.equal(
    meilenstein(vorher, nachher, 'Lena'),
    'Lena hat die Aktivitätszeit geknackt – jetzt 5 von 7! Lena ist jetzt heiß.',
  );
});

test('meilenstein: bei 7 von 7 "kurz vorm Ziel"', () => {
  const alle = menge(...EIGENSCHAFTEN.map((e) => e.schluessel));
  const vorher = new Set(alle);
  vorher.delete('groesseCm');
  assert.equal(
    meilenstein(vorher, alle, 'Lena'),
    'Lena hat die Größe geknackt – jetzt 7 von 7! Lena ist kurz vorm Ziel!',
  );
});

test('meilenstein: von warm direkt auf "kurz vorm Ziel" - nur der hoechste Satz', () => {
  const vorher = menge('klasse', 'lebensraum', 'ernaehrung');
  const alle = menge(...EIGENSCHAFTEN.map((e) => e.schluessel));
  assert.match(meilenstein(vorher, alle, 'Lena'), /jetzt 7 von 7! Lena ist kurz vorm Ziel!$/);
});

test('meilenstein: innerhalb derselben Stufe kein Zusatzsatz', () => {
  // 5 -> 6 bleibt heiss
  const vorher = menge('klasse', 'lebensraum', 'ernaehrung', 'alterJahre', 'aktivitaet');
  const nachher = new Set([...vorher, 'gewichtKg']);
  assert.equal(meilenstein(vorher, nachher, 'Lena'), 'Lena hat das Gewicht geknackt – jetzt 6 von 7!');
});

test('meilenstein: auf warm gibt es keinen Zusatzsatz', () => {
  assert.equal(
    meilenstein(menge('klasse', 'lebensraum'), menge('klasse', 'lebensraum', 'ernaehrung'), 'Lena'),
    'Lena hat die Ernährung geknackt – jetzt 3 von 7!',
  );
});

// --------------------------------------------------------------------------
// Hilfen fuer das Fazit
// --------------------------------------------------------------------------

test('aufzaehlung: ein, zwei und drei Woerter', () => {
  assert.equal(aufzaehlung([]), '');
  assert.equal(aufzaehlung(['Gewicht']), 'Gewicht');
  assert.equal(aufzaehlung(['Gewicht', 'Größe']), 'Gewicht und Größe');
  assert.equal(aufzaehlung(['Klasse', 'Gewicht', 'Größe']), 'Klasse, Gewicht und Größe');
});

test('fehlende: die noch offenen Eigenschaften in Tabellenreihenfolge', () => {
  const fuenf = menge('klasse', 'lebensraum', 'ernaehrung', 'alterJahre', 'aktivitaet');
  assert.deepEqual(fehlende(fuenf), ['Gewicht', 'Größe']);
  assert.equal(fehlende(menge(...EIGENSCHAFTEN.map((e) => e.schluessel))).length, 0);
});
