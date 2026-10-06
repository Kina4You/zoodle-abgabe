/**
 * Tests der Zugzeit-Uhren.
 *
 * Statt echt zu warten, simulieren die Tests Zeitgeber und Uhr mit
 * mock.timers aus node:test: "tick(10000)" laesst zehn Sekunden vergehen -
 * in einem Augenblick. "setTime" verstellt nur die Uhr, ohne faellige
 * Zeitgeber auszufuehren; damit laesst sich der Moment nachstellen, in dem
 * die Frist schon um ist, Node den Ablauf aber noch nicht bearbeitet hat.
 */

import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { Zuguhren, ZUGZEITEN, STANDARD_ZUGZEIT, istGueltigeZugzeit } from '../server/zugzeit.js';

const START = 1_000_000;

beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START }));
afterEach(() => mock.timers.reset());

/** Eine Partie, wie die Uhren sie brauchen - nur das Feld "zugzeit". */
const partie = (zugzeit = 10) => ({ zugzeit });

test('erlaubt sind 10, 20, 30, 60 Sekunden und 0 (ohne Limit)', () => {
  assert.deepEqual(ZUGZEITEN, [10, 20, 30, 60, 0]);
  assert.equal(STANDARD_ZUGZEIT, 10);
  for (const wert of ZUGZEITEN) assert.equal(istGueltigeZugzeit(wert), true, String(wert));
  for (const wert of [5, 15, -10, '10', null, undefined, 10.5, Infinity]) {
    assert.equal(istGueltigeZugzeit(wert), false, String(wert));
  }
});

test('Ablauf: nach der Zugzeit wird die Ablauf-Funktion gerufen - genau einmal', () => {
  const uhren = new Zuguhren();
  const spiel = partie(10);
  const abgelaufen = [];
  uhren.starte(spiel, (s) => abgelaufen.push(s));

  mock.timers.tick(9999);
  assert.equal(abgelaufen.length, 0, 'eine Millisekunde vorher noch nicht');

  mock.timers.tick(1);
  assert.deepEqual(abgelaufen, [spiel]);

  mock.timers.tick(60_000);
  assert.equal(abgelaufen.length, 1, 'kein zweiter Ablauf ohne neuen Start');
  assert.equal(uhren.anzahlFristen, 0, 'die abgelaufene Frist ist weggeraeumt');
});

test('die Restzeit zaehlt herunter und wird nie negativ', () => {
  const uhren = new Zuguhren();
  const spiel = partie(30);
  uhren.starte(spiel, () => {});

  assert.equal(uhren.restzeitMs(spiel), 30_000);
  mock.timers.tick(12_500);
  assert.equal(uhren.restzeitMs(spiel), 17_500);

  mock.timers.setTime(START + 40_000); // Uhr ueber das Ende hinaus, Zeitgeber noch nicht dran
  assert.equal(uhren.restzeitMs(spiel), 0);
});

test('rechtzeitiger Tipp: vor dem Ende ist die Frist nicht abgelaufen', () => {
  const uhren = new Zuguhren();
  const spiel = partie(10);
  uhren.starte(spiel, () => {});

  mock.timers.tick(9_999);
  assert.equal(uhren.istAbgelaufen(spiel), false);
});

test('zu spaeter Tipp: Frist um, Ablauf aber noch nicht bearbeitet', () => {
  const uhren = new Zuguhren();
  const spiel = partie(10);
  let abgelaufen = false;
  uhren.starte(spiel, () => { abgelaufen = true; });

  mock.timers.setTime(START + 10_000);
  assert.equal(abgelaufen, false, 'der Zeitgeber ist noch nicht gelaufen ...');
  assert.equal(uhren.istAbgelaufen(spiel), true, '... trotzdem ist ein Tipp jetzt zu spaet');
});

test('ein Neustart ersetzt die alte Frist - wie nach jedem Zugwechsel', () => {
  const uhren = new Zuguhren();
  const spiel = partie(10);
  let ablaeufe = 0;
  uhren.starte(spiel, () => { ablaeufe += 1; });

  mock.timers.tick(8_000);
  uhren.starte(spiel, () => { ablaeufe += 1; }); // der Gegner ist jetzt dran
  mock.timers.tick(8_000);
  assert.equal(ablaeufe, 0, 'die alte Frist darf nicht mehr ablaufen');
  assert.equal(uhren.restzeitMs(spiel), 2_000);
  assert.equal(uhren.anzahlFristen, 1);
});

test('0 = ohne Zeitlimit: keine Uhr, keine Restzeit, kein Ablauf', () => {
  const uhren = new Zuguhren();
  const spiel = partie(0);
  let abgelaufen = false;
  uhren.starte(spiel, () => { abgelaufen = true; });

  assert.equal(uhren.anzahlFristen, 0);
  assert.equal(uhren.restzeitMs(spiel), null);
  assert.equal(uhren.istAbgelaufen(spiel), false);
  mock.timers.tick(10 * 60_000);
  assert.equal(abgelaufen, false);
});

test('Aufraeumen: eine gestoppte Frist laeuft nie ab (Spielende, Trennung)', () => {
  const uhren = new Zuguhren();
  const spiel = partie(10);
  let abgelaufen = false;
  uhren.starte(spiel, () => { abgelaufen = true; });

  uhren.stoppe(spiel);
  mock.timers.tick(20_000);
  assert.equal(abgelaufen, false);
  assert.equal(uhren.anzahlFristen, 0);
  assert.equal(uhren.restzeitMs(spiel), null);
  uhren.stoppe(spiel); // zweimal stoppen ist harmlos
});

test('mehrere Partien haben voneinander unabhaengige Uhren', () => {
  const uhren = new Zuguhren();
  const kurz = partie(10);
  const lang = partie(60);
  const abgelaufen = [];
  uhren.starte(kurz, (s) => abgelaufen.push(s));
  uhren.starte(lang, (s) => abgelaufen.push(s));

  mock.timers.tick(10_000);
  assert.deepEqual(abgelaufen, [kurz]);
  assert.equal(uhren.restzeitMs(lang), 50_000);
});

test('die Uhr laesst sich fuer Tests beschleunigen', () => {
  const uhren = new Zuguhren({ msProSekunde: 50 });
  const spiel = partie(10);
  let abgelaufen = false;
  uhren.starte(spiel, () => { abgelaufen = true; });

  assert.equal(uhren.restzeitMs(spiel), 500, '10 "Sekunden" dauern hier 500 ms');
  mock.timers.tick(500);
  assert.equal(abgelaufen, true);
});
