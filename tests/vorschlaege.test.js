/**
 * Tests der Vorschlagsliste im Eingabefeld.
 *
 * Getestet wird nur sucheTiere() - die reine Suchfunktion ohne DOM-Zugriff.
 * Sie entscheidet, welches Tier Enter auswählt (immer der erste Eintrag),
 * und genau daran sind schon Tipps daneben gegangen: "Bär" traf Ameisenbär,
 * "Fuchs" traf Polarfuchs.
 *
 * Als Datenbasis dient die echte Tierliste - so fällt auch auf, wenn ein
 * neu aufgenommenes Tier eine Reihenfolge durcheinanderbringt.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SUCH_TIERE } from '../server/tierdaten.js';
import { sucheTiere, beschriftung, MAX_TREFFER } from '../public/js/vorschlaege.js';

/** Liefert nur die Namen der Vorschläge - das macht die Tests lesbar. */
function namen(eingabe) {
  return sucheTiere(SUCH_TIERE, eingabe).treffer.map((eintrag) => eintrag.tier.name);
}

/** An welcher Stelle der Vorschlagsliste steht dieses Tier? */
function platz(eingabe, name) {
  const stelle = namen(eingabe).indexOf(name);
  assert.notEqual(stelle, -1, `"${name}" fehlt in den Vorschlaegen zu "${eingabe}"`);
  return stelle;
}

test('ein exakt getippter Name steht ganz oben', () => {
  assert.equal(namen('Wolf')[0], 'Wolf');
  assert.equal(namen('Ameise')[0], 'Ameise');
});

test('der exakte Treffer schlaegt den laengeren Namen', () => {
  // "Ameise" darf nicht als "Ameisenbär" geraten werden.
  assert.ok(platz('Ameise', 'Ameise') < platz('Ameise', 'Ameisenbär'));
});

test('"Bär" schlaegt echte Baeren vor dem Ameisenbaeren vor', () => {
  // Kein Tier heißt nur "Bär". Entscheidend ist dann, wo im Namen der
  // Suchtext steckt: bei Eisbär und Braunbär früher als beim Ameisenbären.
  assert.ok(platz('Bär', 'Braunbär') < platz('Bär', 'Ameisenbär'));
  assert.ok(platz('Bär', 'Eisbär') < platz('Bär', 'Ameisenbär'));
});

test('"Fuchs" waehlt nicht den alphabetisch ersten Fuchs', () => {
  assert.equal(namen('Fuchs')[0], 'Rotfuchs');
});

test('ein Namensanfang steht vor einem Treffer mitten im Namen', () => {
  assert.ok(platz('Eis', 'Eisbär') < platz('Eis', 'Ameise'));
});

test('Umlaute und Gross-/Kleinschreibung sind egal', () => {
  assert.deepEqual(namen('BÄR'), namen('bar'));
});

test('die Kategoriesuche liefert alle Saeugetiere', () => {
  const saeugetiere = SUCH_TIERE.filter((tier) => tier.klasse === 'Säugetier');
  const gefunden = namen('Säugetier');

  assert.equal(saeugetiere.length, 81, 'die Tierliste hat sich geaendert');
  assert.equal(gefunden.length, saeugetiere.length);
  // Diese Tiere stehen weit hinten - eine zu kleine Grenze schnitte sie ab.
  for (const name of ['Schneeleopard', 'Tiger', 'Wolf', 'Zebra']) {
    assert.ok(gefunden.includes(name), `"${name}" fehlt`);
  }
});

test('die Obergrenze liegt ueber der gesamten Tierliste', () => {
  // Sonst könnte eine Kategoriesuche wieder Tiere verschlucken.
  assert.ok(MAX_TREFFER > SUCH_TIERE.length, `${MAX_TREFFER} <= ${SUCH_TIERE.length}`);
  assert.equal(sucheTiere(SUCH_TIERE, 'Säugetier').gesamt, 81);
});

test('Namenstreffer stehen vor Kategorietreffern', () => {
  // "Fisch" ist Name (Anglerfisch ...) UND Klasse - die Namen kommen zuerst.
  const { treffer } = sucheTiere(SUCH_TIERE, 'Fisch');
  const ersterKategorietreffer = treffer.findIndex((eintrag) => eintrag.grund !== '');
  const letzterNamenstreffer = treffer.findLastIndex((eintrag) => eintrag.grund === '');
  assert.ok(ersterKategorietreffer > letzterNamenstreffer);
});

test('eine leere Eingabe liefert keine Vorschlaege', () => {
  assert.deepEqual(sucheTiere(SUCH_TIERE, '   '), { treffer: [], gesamt: 0 });
});

test('ein unbekannter Suchtext liefert keine Vorschlaege', () => {
  assert.deepEqual(namen('Einhorn'), []);
});

// --------------------------------------------------------------------------
// Beschriftung der Vorschläge
// --------------------------------------------------------------------------

/** Liefert Name und Zusatztext, so wie sie nebeneinander in der Liste stehen. */
function zeilen(eingabe) {
  return sucheTiere(SUCH_TIERE, eingabe).treffer.map((eintrag) => [
    eintrag.tier.name,
    beschriftung(eintrag.tier, eintrag.grund),
  ]);
}

test('jeder Vorschlag nennt die Tierklasse', () => {
  // Auch bei einer Namenssuche - sonst sähe man nicht, ob Braunbär und
  // Ameisenbär überhaupt zur selben Klasse gehören.
  for (const [name, zusatz] of zeilen('Bär')) {
    assert.equal(zusatz, 'Säugetier', name);
  }
  assert.deepEqual(zeilen('Wolf'), [['Wolf', 'Säugetier']]);
});

test('kein einziger Vorschlag bleibt ohne Zusatztext', () => {
  for (const eingabe of ['a', 'e', 'Säugetier', 'Wald', 'tagaktiv']) {
    for (const [name, zusatz] of zeilen(eingabe)) {
      assert.ok(zusatz.length > 0, `"${name}" hat bei Eingabe "${eingabe}" keinen Zusatz`);
    }
  }
});

test('bei einer Kategoriesuche steht der Grund hinter der Klasse', () => {
  for (const [name, zusatz] of zeilen('Savanne')) {
    assert.match(zusatz, / · Savanne$/, name);
  }
});

test('die Klasse wird nicht doppelt genannt', () => {
  for (const [name, zusatz] of zeilen('Säugetier')) {
    assert.equal(zusatz, 'Säugetier', name);
  }
});

test('die Beschriftung kommt ohne Kategorietreffer aus', () => {
  const tier = { name: 'Testtier', klasse: 'Vogel' };

  assert.equal(beschriftung(tier, ''), 'Vogel');
  assert.equal(beschriftung(tier, 'Vogel'), 'Vogel', 'nicht doppelt');
  assert.equal(beschriftung(tier, 'Wald'), 'Vogel · Wald');
});
