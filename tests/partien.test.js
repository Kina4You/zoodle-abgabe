/**
 * Tests der Partienverwaltung.
 *
 * Die Verwaltung kennt kein Socket.io - deshalb lässt sie sich hier mit
 * einfachen Zeichenketten als Spielerkennungen testen, ohne Server.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Partienverwaltung } from '../server/partien.js';

test('der erste Spieler wartet, der zweite startet die Partie', () => {
  const v = new Partienverwaltung();

  assert.equal(v.suchePartie('anna'), null, 'Anna muss warten');
  assert.equal(v.wartetJemand, true);

  const spiel = v.suchePartie('ben');
  assert.ok(spiel, 'Ben startet die Partie');
  assert.deepEqual([...spiel.spielerIds].sort(), ['anna', 'ben']);
  assert.equal(v.wartetJemand, false);
  assert.equal(v.anzahlPartien, 1);
});

test('das Geheimnis laesst sich fuer Tests vorgeben (ZOODLE_TESTTIER)', () => {
  const festesTier = { name: 'Testtier' };
  const v = new Partienverwaltung({ waehleGeheimnis: () => festesTier });
  v.suchePartie('anna');
  assert.equal(v.suchePartie('ben').geheimnis, festesTier);
});

test('beide Spieler finden ihre gemeinsame Partie', () => {
  const v = new Partienverwaltung();
  v.suchePartie('anna');
  const spiel = v.suchePartie('ben');

  assert.equal(v.partieVon('anna'), spiel);
  assert.equal(v.partieVon('ben'), spiel);
  assert.equal(v.partieVon('unbekannt'), undefined);
});

test('jede Partie bekommt ein Geheimnis und einen Startspieler', () => {
  const v = new Partienverwaltung();
  v.suchePartie('anna');
  const spiel = v.suchePartie('ben');

  assert.ok(spiel.geheimnis?.name);
  assert.ok(spiel.spielerIds.includes(spiel.amZug));
});

test('derselbe Spieler zweimal startet keine Partie gegen sich selbst', () => {
  const v = new Partienverwaltung();

  assert.equal(v.suchePartie('anna'), null);
  assert.equal(v.suchePartie('anna'), null, 'Anna darf nicht gegen sich selbst spielen');
  assert.equal(v.anzahlPartien, 0);
});

test('vier Spieler ergeben zwei getrennte Partien', () => {
  const v = new Partienverwaltung();

  v.suchePartie('a');
  const erste = v.suchePartie('b');
  v.suchePartie('c');
  const zweite = v.suchePartie('d');

  assert.notEqual(erste, zweite);
  assert.equal(v.anzahlPartien, 2);
  assert.equal(v.partieVon('a'), erste);
  assert.equal(v.partieVon('d'), zweite);
});

test('geht der Wartende, ist die Warteschlange wieder leer', () => {
  const v = new Partienverwaltung();
  v.suchePartie('anna');

  assert.equal(v.entferne('anna'), undefined, 'es lief noch keine Partie');
  assert.equal(v.wartetJemand, false);

  // Ben muss jetzt seinerseits warten und darf nicht gegen die weg-
  // gegangene Anna gepaart werden.
  assert.equal(v.suchePartie('ben'), null);
});

test('ein Verbindungsabbruch beendet die Partie fuer beide', () => {
  const v = new Partienverwaltung();
  v.suchePartie('anna');
  const spiel = v.suchePartie('ben');

  const beendet = v.entferne('anna');

  assert.equal(beendet, spiel);
  assert.equal(spiel.beendet, true);
  assert.equal(v.partieVon('anna'), undefined);
  assert.equal(v.partieVon('ben'), undefined, 'auch der Gegner ist raus');
  assert.equal(v.anzahlPartien, 0);
});

test('nach dem Beenden raeumt die Verwaltung sauber auf', () => {
  const v = new Partienverwaltung();
  v.suchePartie('anna');
  const spiel = v.suchePartie('ben');

  v.beende(spiel);

  assert.equal(v.anzahlPartien, 0);
  assert.equal(v.partieVon('anna'), undefined);
});

// --------------------------------------------------------------------------
// Revanche
// --------------------------------------------------------------------------

/** Spielt eine Partie zwischen Anna und Ben und beendet sie regulär. */
function beendetePartie() {
  const v = new Partienverwaltung();
  v.suchePartie('anna');
  const spiel = v.suchePartie('ben');
  v.beende(spiel);
  return { v, spiel };
}

test('stimmen beide zu, beginnt eine neue Partie derselben zwei Spieler', () => {
  const { v, spiel } = beendetePartie();

  assert.deepEqual(v.stimmeRevancheZu('anna'), { status: 'wartet', gegnerId: 'ben' });

  const ergebnis = v.stimmeRevancheZu('ben');

  assert.equal(ergebnis.status, 'gestartet');
  assert.notEqual(ergebnis.spiel, spiel, 'die alte Partie wird nicht wiederbelebt');
  assert.deepEqual([...ergebnis.spiel.spielerIds].sort(), ['anna', 'ben']);
  assert.ok(ergebnis.spiel.geheimnis?.name, 'neues Tier ausgelost');
  assert.equal(ergebnis.spiel.versuche.length, 0, 'die Tipps der alten Partie sind weg');
  assert.equal(v.anzahlPartien, 1);
  assert.equal(v.partieVon('anna'), ergebnis.spiel);
});

test('stimmt nur einer zu, passiert nichts weiter', () => {
  const { v } = beendetePartie();

  assert.equal(v.stimmeRevancheZu('anna').status, 'wartet');

  assert.equal(v.anzahlPartien, 0, 'ohne Bens Zustimmung laeuft keine Partie');
  assert.equal(v.wartetJemand, false, 'und in der Warteschlange steht auch niemand');
});

test('mehrfaches Klicken erzeugt keinen zweiten Eintrag', () => {
  const { v } = beendetePartie();

  for (let i = 0; i < 5; i++) {
    assert.equal(v.stimmeRevancheZu('anna').status, 'wartet', `Klick ${i + 1}`);
  }

  assert.equal(v.anzahlPartien, 0);
  assert.equal(v.anzahlRevancheNotizen, 2, 'weiterhin genau eine Notiz je Spieler');
});

test('nach der Revanche sind die Notizen aufgebraucht', () => {
  const { v } = beendetePartie();
  v.stimmeRevancheZu('anna');
  v.stimmeRevancheZu('ben');

  assert.equal(v.anzahlRevancheNotizen, 0);
  // Ein zweiter Klick startet keine dritte Partie.
  assert.equal(v.stimmeRevancheZu('anna').status, 'unmoeglich');
  assert.equal(v.anzahlPartien, 1);
});

test('verschwindet der Gegner, ist die Revanche hinfaellig', () => {
  const { v } = beendetePartie();
  v.stimmeRevancheZu('anna');

  // Vor dem Aufräumen muss erkennbar sein, wer vergeblich wartet -
  // sonst weiß der Server nicht, wem er absagen soll.
  assert.equal(v.wartetAufRevancheMit('ben'), 'anna');

  v.entferne('ben');

  assert.equal(v.stimmeRevancheZu('anna').status, 'unmoeglich');
  assert.equal(v.anzahlPartien, 0);

  // Annas Notiz zeigt jetzt ins Leere. Das ist harmlos - sie verschwindet,
  // sobald Anna sich ihrerseits neu orientiert oder die Seite verlässt.
  assert.equal(v.anzahlRevancheNotizen, 1);
  v.vergissRevanche('anna');
  assert.equal(v.anzahlRevancheNotizen, 0);
});

test('wer einen neuen Gegner sucht, gibt sein Revanche-Angebot auf', () => {
  const { v } = beendetePartie();
  v.stimmeRevancheZu('anna');

  assert.equal(v.wartetAufRevancheMit('ben'), 'anna');
  v.vergissRevanche('ben');

  assert.equal(v.stimmeRevancheZu('anna').status, 'unmoeglich');
  // Und Anna schickt auch niemandem mehr eine Absage hinterher.
  assert.equal(v.wartetAufRevancheMit('anna'), undefined);
});

test('wer geht, sagt auch einem Gegner ab, der noch nicht zugestimmt hat', () => {
  const { v } = beendetePartie();

  // Niemand hat geklickt - trotzdem sieht Anna einen Revanche-Knopf und
  // muss erfahren, dass Ben weg ist.
  assert.equal(v.wartetAufRevancheMit('ben'), 'anna');

  // Auch umgekehrt: Anna hat angeboten und geht selbst. Ben sieht
  // "dein Gegner ist bereit" und muss die Absage bekommen.
  v.stimmeRevancheZu('anna');
  assert.equal(v.wartetAufRevancheMit('anna'), 'ben');
});

test('ohne vorherige Partie gibt es nichts zu revanchieren', () => {
  const v = new Partienverwaltung();

  assert.equal(v.stimmeRevancheZu('fremder').status, 'unmoeglich');
  assert.equal(v.wartetAufRevancheMit('fremder'), undefined);
  // Und das Vergessen einer Notiz, die es nie gab, geht auch nicht schief.
  v.vergissRevanche('fremder');
});

test('gegen einen Gegner, der laengst weitergezogen ist, gibt es keine Revanche', () => {
  const { v } = beendetePartie();

  // Ben sucht sich Clara, spielt mit ihr und beendet auch diese Partie.
  // Annas Notiz zeigt weiterhin auf Ben - seine aber nicht mehr auf Anna.
  v.vergissRevanche('ben');
  v.suchePartie('ben');
  const zweite = v.suchePartie('clara');
  v.beende(zweite);

  // Annas Notiz zeigt noch auf Ben - seine aber inzwischen auf Clara.
  assert.equal(v.stimmeRevancheZu('anna').status, 'unmoeglich');
});

// --------------------------------------------------------------------------
// Spielmodus und Lobby-Partien
// --------------------------------------------------------------------------

test('eine oeffentliche Partie hat den Modus Zufallstier', () => {
  const v = new Partienverwaltung();
  v.suchePartie('anna');
  assert.equal(v.suchePartie('ben').modus, 'zufall');
});

test('eine Lobby-Partie startet sofort mit beiden Spielern und ihrem Modus', () => {
  const v = new Partienverwaltung();
  const spiel = v.starteLobbyPartie('lena', 'jonas', 'zufall');

  assert.deepEqual(spiel.spielerIds, ['lena', 'jonas']);
  assert.equal(spiel.modus, 'zufall');
  assert.equal(v.partieVon('lena'), spiel);
  assert.equal(v.partieVon('jonas'), spiel);
  assert.equal(v.wartetJemand, false, 'die Warteschlange bleibt unberuehrt');
});

test('eine Revanche behaelt den Modus der Partie', () => {
  const v = new Partienverwaltung();
  const erste = v.starteLobbyPartie('lena', 'jonas', 'duell');
  v.beende(erste);

  v.stimmeRevancheZu('lena');
  const { spiel } = v.stimmeRevancheZu('jonas');
  assert.equal(spiel.modus, 'duell');
});

test('wer die Warteschlange verlaesst, wird mit niemandem mehr gepaart', () => {
  const v = new Partienverwaltung();
  v.suchePartie('anna');
  assert.equal(v.wartet('anna'), true);

  v.verlasseWarteschlange('anna');
  assert.equal(v.wartet('anna'), false);
  assert.equal(v.suchePartie('ben'), null, 'Ben wartet jetzt selbst, statt gegen Anna zu spielen');
});

test('die Warteschlange zu verlassen, ohne drin zu sein, ist harmlos', () => {
  const v = new Partienverwaltung();
  v.suchePartie('anna');
  v.verlasseWarteschlange('ben');
  assert.equal(v.wartet('anna'), true, 'Anna wartet weiter');
});

test('eine Duell-Partie lost kein Tier aus, sondern beginnt mit der Wahl', () => {
  const v = new Partienverwaltung();
  const spiel = v.starteLobbyPartie('lena', 'jonas', 'duell');

  assert.equal(spiel.geheimnis, null);
  assert.equal(spiel.phase, 'wahl');
});

test('jeder Modus hat seine eigene Warteschlange', () => {
  const v = new Partienverwaltung();

  assert.equal(v.suchePartie('anna', 'zufall'), null);
  assert.equal(v.suchePartie('ben', 'duell'), null, 'Ben will Duell - Anna wartet auf Zufallstier');
  assert.equal(v.anzahlPartien, 0);

  const duell = v.suchePartie('cleo', 'duell');
  assert.deepEqual(duell.spielerIds, ['ben', 'cleo']);
  assert.equal(duell.modus, 'duell');
  assert.equal(duell.phase, 'wahl');

  const zufall = v.suchePartie('dora', 'zufall');
  assert.deepEqual(zufall.spielerIds, ['anna', 'dora']);
  assert.equal(zufall.modus, 'zufall');
});

test('ohne Angabe wartet man auf Zufallstier', () => {
  const v = new Partienverwaltung();
  v.suchePartie('anna');
  assert.equal(v.suchePartie('ben', 'zufall').modus, 'zufall');
});

test('wer die Duell-Warteschlange verlaesst, ist aus allen Warteschlangen raus', () => {
  const v = new Partienverwaltung();
  v.suchePartie('ben', 'duell');
  assert.equal(v.wartet('ben'), true);

  v.verlasseWarteschlange('ben');
  assert.equal(v.wartet('ben'), false);
  assert.equal(v.wartetJemand, false);
});

test('trennt sich ein Wartender, wird seine Warteschlange frei', () => {
  const v = new Partienverwaltung();
  v.suchePartie('ben', 'duell');
  v.entferne('ben');
  assert.equal(
    v.suchePartie('cleo', 'duell'),
    null,
    'Cleo wartet - statt gegen einen Geist zu spielen',
  );
});
