/**
 * Tests der Tierdaten.
 *
 * Diese Tests pruefen nicht nur den Code, sondern auch die DATEN. Ein
 * Tippfehler in tiere.json faellt hier auf - nicht erst im laufenden Spiel.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ALLE_TIERE, SUCH_TIERE, findeTier, zufallsTier, pruefeTiere } from '../server/tierdaten.js';

const PFLICHTFELDER = ['name', 'klasse', 'lebensraum', 'ernaehrung', 'gewichtKg', 'groesseCm', 'alterJahre', 'aktivitaet'];

/** Ein tadelloses Testtier, das einzelne Tests gezielt beschaedigen. */
function gutesTier(eigenschaften = {}) {
  return {
    name: 'Testtier',
    klasse: 'Säugetier',
    lebensraum: 'Wald',
    ernaehrung: 'Fleischfresser',
    gewichtKg: 100,
    groesseCm: 100,
    alterJahre: 10,
    aktivitaet: 'tagaktiv',
    ...eigenschaften,
  };
}

test('die Tierliste enthaelt genug Tiere fuer ein Spiel', () => {
  assert.ok(ALLE_TIERE.length >= 50, `nur ${ALLE_TIERE.length} Tiere`);
});

test('kein Tiername kommt doppelt vor', () => {
  const namen = ALLE_TIERE.map((tier) => tier.name);
  const doppelte = namen.filter((name, i) => namen.indexOf(name) !== i);
  assert.deepEqual(doppelte, [], `doppelt: ${doppelte.join(', ')}`);
});

test('jedes Tier hat alle Pflichtfelder', () => {
  for (const tier of ALLE_TIERE) {
    for (const feld of PFLICHTFELDER) {
      assert.ok(tier[feld] !== undefined && tier[feld] !== '', `"${tier.name}" fehlt "${feld}"`);
    }
  }
});

test('alle Zahlenwerte sind groesser als null', () => {
  // Wichtig: die Bewertung teilt durch diese Werte. Eine Null waere fatal.
  for (const tier of ALLE_TIERE) {
    for (const feld of ['gewichtKg', 'groesseCm', 'alterJahre']) {
      assert.ok(tier[feld] > 0, `"${tier.name}": ${feld} = ${tier[feld]}`);
    }
  }
});

test('die Ernaehrung nutzt nur die drei erlaubten Werte', () => {
  const erlaubt = new Set(['Fleischfresser', 'Pflanzenfresser', 'Allesfresser']);
  for (const tier of ALLE_TIERE) {
    assert.ok(erlaubt.has(tier.ernaehrung), `"${tier.name}": "${tier.ernaehrung}"`);
  }
});

test('die Aktivitaetszeit nutzt nur die drei erlaubten Werte', () => {
  const erlaubt = new Set(['tagaktiv', 'nachtaktiv', 'dämmerungsaktiv']);
  for (const tier of ALLE_TIERE) {
    assert.ok(erlaubt.has(tier.aktivitaet), `"${tier.name}": "${tier.aktivitaet}"`);
  }
});

test('die Suchliste ist alphabetisch sortiert', () => {
  // Wichtig fuer die Vorschlagsliste im Browser: Sie zeigt die Tiere in
  // genau dieser Reihenfolge an.
  const namen = SUCH_TIERE.map((tier) => tier.name);
  const sortiert = [...namen].sort((a, b) => a.localeCompare(b, 'de'));
  assert.deepEqual(namen, sortiert);
});

test('die Suchliste enthaelt keine Zahlenwerte', () => {
  // Was der Browser nicht braucht, wird auch nicht uebertragen.
  for (const eintrag of SUCH_TIERE) {
    assert.equal(eintrag.gewichtKg, undefined);
    assert.equal(eintrag.groesseCm, undefined);
    assert.equal(eintrag.alterJahre, undefined);
  }
});

test('findeTier ignoriert Gross-/Kleinschreibung und Leerzeichen', () => {
  const erstes = ALLE_TIERE[0].name;

  assert.equal(findeTier(erstes)?.name, erstes);
  assert.equal(findeTier(erstes.toUpperCase())?.name, erstes);
  assert.equal(findeTier(`   ${erstes.toLowerCase()}  `)?.name, erstes);
});

test('findeTier lehnt erfundene und ungueltige Eingaben ab', () => {
  assert.equal(findeTier('Einhorn'), undefined);
  assert.equal(findeTier(''), undefined);
  assert.equal(findeTier(null), undefined);
  assert.equal(findeTier(42), undefined);
  assert.equal(findeTier({ name: 'Löwe' }), undefined);
});

test('zufallsTier liefert immer ein Tier aus der Tierliste', () => {
  for (let i = 0; i < 50; i++) {
    assert.ok(ALLE_TIERE.includes(zufallsTier()));
  }
});

// --------------------------------------------------------------------------
// Die Datenpruefung selbst
//
// Diese Tests belegen, dass kaputte Daten den Serverstart WIRKLICH
// verhindern. Ohne sie waere nur getestet, dass die heutige Datei in Ordnung
// ist - nicht, dass die Pruefung ueberhaupt etwas taugt.
// --------------------------------------------------------------------------

test('die echten Tierdaten bestehen die Pruefung', () => {
  assert.doesNotThrow(() => pruefeTiere(ALLE_TIERE));
});

test('die Pruefung lehnt zu kurze oder gar keine Listen ab', () => {
  assert.throws(() => pruefeTiere([]), /zu wenige/);
  assert.throws(() => pruefeTiere([gutesTier()]), /zu wenige/, 'ein Tier allein ergibt kein Spiel');
  assert.throws(() => pruefeTiere(null), /zu wenige/);
  assert.throws(() => pruefeTiere('keine Liste'), /zu wenige/);
});

test('die Pruefung findet jedes fehlende Pflichtfeld', () => {
  for (const feld of PFLICHTFELDER) {
    const kaputt = gutesTier();
    delete kaputt[feld];
    assert.throws(
      () => pruefeTiere([gutesTier(), kaputt]),
      new RegExp(`fehlt das Feld "${feld}"`),
      `ein fehlendes "${feld}" muss auffallen`
    );
  }
});

test('die Pruefung lehnt leere Felder ab, nicht nur fehlende', () => {
  assert.throws(() => pruefeTiere([gutesTier(), gutesTier({ klasse: '' })]), /fehlt das Feld "klasse"/);
  assert.throws(() => pruefeTiere([gutesTier(), gutesTier({ name: null })]), /fehlt das Feld "name"/);
});

test('die Pruefung lehnt unbrauchbare Zahlenwerte ab', () => {
  // Eine Null waere fatal: Die Bewertung teilt durch diese Zahlen.
  for (const kaputterWert of [0, -5, '100', NaN, Infinity, null]) {
    assert.throws(
      () => pruefeTiere([gutesTier(), gutesTier({ gewichtKg: kaputterWert })]),
      /gewichtKg/,
      `${String(kaputterWert)} darf nicht durchgehen`
    );
  }
});
