/**
 * Tests der Lobbyverwaltung.
 *
 * Wie die Partienverwaltung kennt sie kein Socket.io - die Tests arbeiten mit
 * einfachen Zeichenketten als Spielerkennungen. Fuer die Sperre nach fuenf
 * Fehlversuchen bekommt die Verwaltung eine Attrappe als Uhr: So laesst sich
 * pruefen, was nach 30 Sekunden passiert, ohne 30 Sekunden zu warten.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Lobbyverwaltung, MODI, SPIELBARE_MODI, MAX_LOBBYS, MAX_FEHLVERSUCHE, SPERRDAUER,
} from '../server/lobbys.js';

/** Eine Uhr, die nur weiterlaeuft, wenn der Test sie stellt. */
function testuhr(start = 1_000_000) {
  let jetzt = start;
  return {
    uhr: () => jetzt,
    vor: (ms) => { jetzt += ms; },
  };
}

/** Legt eine Lobby an und liefert sie - der Test schlaegt fehl, wenn das nicht klappt. */
function oeffne(v, id = 'lena', name = 'Lena', passwort = 'geheim') {
  const { lobby, fehler } = v.erstelle(id, name, 'zufall', passwort);
  assert.equal(fehler, undefined, `Lobby von ${name} sollte entstehen`);
  return lobby;
}

// --------------------------------------------------------------------------
// Erstellen
// --------------------------------------------------------------------------

test('eine Lobby entsteht mit Modus, Ersteller und eigener Kennung', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v);

  assert.equal(lobby.erstellerId, 'lena');
  assert.equal(lobby.erstellerName, 'Lena');
  assert.equal(lobby.modus, 'zufall');
  assert.match(lobby.id, /^[0-9a-f-]{36}$/, 'Kennung aus crypto.randomUUID');
  assert.equal(v.anzahlLobbys, 1);
});

test('das Passwort wird nie im Klartext gespeichert', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v, 'lena', 'Lena', 'meinPasswort');

  assert.ok(Buffer.isBuffer(lobby.passwortHash));
  assert.equal(lobby.passwortHash.length, 32);
  assert.equal(lobby.salz.length, 16);
  assert.ok(!JSON.stringify(lobby).includes('meinPasswort'));
  assert.ok(!Object.values(lobby).includes('meinPasswort'));
});

test('gleiche Passwoerter ergeben dank Salz verschiedene Hashes', () => {
  const v = new Lobbyverwaltung();
  const a = oeffne(v, 'a', 'A', 'gleich');
  const b = oeffne(v, 'b', 'B', 'gleich');

  assert.notDeepEqual(a.salz, b.salz);
  assert.notDeepEqual(a.passwortHash, b.passwortHash);
});

test('das Passwort braucht 4 bis 32 Zeichen', () => {
  const v = new Lobbyverwaltung();
  const versuch = (passwort, id) => v.erstelle(id, 'X', 'zufall', passwort).fehler;

  assert.equal(versuch('abc', 'a'), 'passwort', '3 Zeichen sind zu wenig');
  assert.equal(versuch('', 'b'), 'passwort');
  assert.equal(versuch('x'.repeat(33), 'c'), 'passwort', '33 Zeichen sind zu viel');
  assert.equal(versuch('abcd', 'd'), undefined, '4 Zeichen reichen');
  assert.equal(versuch('x'.repeat(32), 'e'), undefined, '32 Zeichen gehen noch');
});

test('das Passwort darf beliebige Zeichen enthalten', () => {
  const v = new Lobbyverwaltung();
  assert.equal(v.erstelle('a', 'A', 'zufall', 'ä ß !?"<>').fehler, undefined);
});

test('ein Passwort, das kein Text ist, wird abgelehnt', () => {
  const v = new Lobbyverwaltung();
  for (const [i, passwort] of [1234, null, undefined, ['abcd'], { a: 1 }].entries()) {
    assert.equal(v.erstelle(`s${i}`, 'X', 'zufall', passwort).fehler, 'passwort', String(passwort));
  }
  assert.equal(v.anzahlLobbys, 0);
});

test('es gibt genau die Modi Zufallstier und Duell - beide spielbar', () => {
  assert.deepEqual(MODI, ['zufall', 'duell']);
  assert.deepEqual(SPIELBARE_MODI, ['zufall', 'duell']);
});

test('eine Lobby im Modus Duell laesst sich erstellen', () => {
  const v = new Lobbyverwaltung();
  const { lobby, fehler } = v.erstelle('a', 'A', 'duell', 'geheim');
  assert.equal(fehler, undefined);
  assert.equal(lobby.modus, 'duell');
  assert.equal(v.liste()[0].modus, 'duell');
});

test('unbekannte Modi werden abgelehnt', () => {
  const v = new Lobbyverwaltung();
  for (const [i, modus] of ['schach', '', 'ZUFALL', undefined, null, 42, { modus: 'zufall' }].entries()) {
    assert.equal(v.erstelle(`s${i}`, 'X', modus, 'geheim').fehler, 'modus', String(modus));
  }
  assert.equal(v.anzahlLobbys, 0);
});

test('jeder Spieler hat hoechstens eine Lobby', () => {
  const v = new Lobbyverwaltung();
  oeffne(v, 'lena');

  assert.equal(v.erstelle('lena', 'Lena', 'zufall', 'nochmal').fehler, 'schonOffen');
  assert.equal(v.anzahlLobbys, 1);
});

test('nach dem Schliessen darf man eine neue Lobby erstellen', () => {
  const v = new Lobbyverwaltung();
  oeffne(v, 'lena');
  v.schliesse('lena');

  assert.equal(v.erstelle('lena', 'Lena', 'zufall', 'nochmal').fehler, undefined);
});

test(`hoechstens ${MAX_LOBBYS} Lobbys insgesamt`, () => {
  const v = new Lobbyverwaltung();
  for (let i = 0; i < MAX_LOBBYS; i++) oeffne(v, `s${i}`, `S${i}`);

  assert.equal(v.erstelle('einer-zu-viel', 'X', 'zufall', 'geheim').fehler, 'voll');
  assert.equal(v.anzahlLobbys, MAX_LOBBYS);

  v.schliesse('s0');
  assert.equal(v.erstelle('einer-zu-viel', 'X', 'zufall', 'geheim').fehler, undefined,
    'sobald eine schliesst, ist wieder Platz');
});

// --------------------------------------------------------------------------
// Liste
// --------------------------------------------------------------------------

test('die Liste enthaelt NUR Kennung, Name, Modus und Zugzeit', () => {
  const v = new Lobbyverwaltung();
  oeffne(v, 'lena', 'Lena', 'streng-geheim');

  const [eintrag] = v.liste();
  assert.deepEqual(Object.keys(eintrag).sort(), ['erstellerName', 'id', 'modus', 'zugzeit']);
  assert.ok(!JSON.stringify(v.liste()).includes('streng-geheim'));
  assert.ok(!JSON.stringify(v.liste()).includes('lena'), 'auch die Socket-Kennung des Erstellers bleibt geheim');
});

test('die neueste Lobby steht oben', () => {
  const zeit = testuhr();
  const v = new Lobbyverwaltung({ uhr: zeit.uhr });
  oeffne(v, 'a', 'Alt');
  zeit.vor(1000);
  oeffne(v, 'b', 'Mittel');
  zeit.vor(1000);
  oeffne(v, 'c', 'Neu');

  assert.deepEqual(v.liste().map((l) => l.erstellerName), ['Neu', 'Mittel', 'Alt']);
});

test('bei gleicher Zeit steht die zuletzt angelegte Lobby oben', () => {
  const v = new Lobbyverwaltung({ uhr: () => 5 });
  oeffne(v, 'a', 'Erste');
  oeffne(v, 'b', 'Zweite');

  assert.deepEqual(v.liste().map((l) => l.erstellerName), ['Zweite', 'Erste']);
});

test('eine besetzte Lobby verschwindet aus der Liste', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v);
  v.trittBei(lobby.id, 'jonas', 'geheim');

  assert.deepEqual(v.liste(), []);
  assert.equal(v.anzahlLobbys, 1, 'sie besteht aber weiter, bis die Partie vorbei ist');
});

test('die Liste ist eine Kopie - Aenderungen daran schaden der Verwaltung nicht', () => {
  const v = new Lobbyverwaltung();
  oeffne(v);
  v.liste()[0].modus = 'gehackt';

  assert.equal(v.liste()[0].modus, 'zufall');
});

// --------------------------------------------------------------------------
// Beitreten
// --------------------------------------------------------------------------

test('mit dem richtigen Passwort tritt man bei', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v);

  const ergebnis = v.trittBei(lobby.id, 'jonas', 'geheim');
  assert.equal(ergebnis.fehler, undefined);
  assert.equal(ergebnis.lobby, lobby);
  assert.equal(lobby.besetzt, true);
});

test('mit falschem Passwort nicht', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v);

  assert.equal(v.trittBei(lobby.id, 'jonas', 'falsch').fehler, 'passwort');
  assert.equal(v.trittBei(lobby.id, 'jonas', 'GEHEIM').fehler, 'passwort', 'Gross-/Kleinschreibung zaehlt');
  assert.equal(lobby.besetzt, false);
});

test('unsinnige Passwoerter beim Beitreten gelten als falsch', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v);

  for (const passwort of [undefined, 1234, 'x'.repeat(5000)]) {
    assert.equal(v.trittBei(lobby.id, `s${String(passwort).length}`, passwort).fehler, 'passwort');
  }
});

test('treten zwei mit richtigem Passwort bei, gewinnt der erste', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v);

  assert.equal(v.trittBei(lobby.id, 'jonas', 'geheim').fehler, undefined);
  assert.equal(v.trittBei(lobby.id, 'aylin', 'geheim').fehler, 'voll');
});

test('eine unbekannte oder geschlossene Lobby ist weg', () => {
  const v = new Lobbyverwaltung();
  assert.equal(v.trittBei('gibt-es-nicht', 'jonas', 'geheim').fehler, 'weg');
  assert.equal(v.trittBei(undefined, 'jonas', 'geheim').fehler, 'weg');
  assert.equal(v.trittBei({ id: 1 }, 'jonas', 'geheim').fehler, 'weg');

  const lobby = oeffne(v);
  v.schliesse('lena');
  assert.equal(v.trittBei(lobby.id, 'jonas', 'geheim').fehler, 'weg');
});

test('der eigenen Lobby kann man nicht beitreten', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v);

  assert.equal(v.trittBei(lobby.id, 'lena', 'geheim').fehler, 'eigene');
  assert.equal(lobby.besetzt, false);
});

// --------------------------------------------------------------------------
// Sperre nach Fehlversuchen
// --------------------------------------------------------------------------

test(`nach ${MAX_FEHLVERSUCHE} Fehlversuchen ist man gesperrt - auch mit richtigem Passwort`, () => {
  const v = new Lobbyverwaltung({ uhr: testuhr().uhr });
  const lobby = oeffne(v);

  for (let i = 1; i <= MAX_FEHLVERSUCHE; i++) {
    assert.equal(v.trittBei(lobby.id, 'jonas', 'falsch').fehler, 'passwort', `Versuch ${i}`);
  }
  assert.equal(v.trittBei(lobby.id, 'jonas', 'falsch').fehler, 'gesperrt');
  assert.equal(v.trittBei(lobby.id, 'jonas', 'geheim').fehler, 'gesperrt',
    'sonst waere die Sperre wertlos');
  assert.equal(lobby.besetzt, false);
});

test('vier Fehlversuche sperren noch nicht', () => {
  const v = new Lobbyverwaltung({ uhr: testuhr().uhr });
  const lobby = oeffne(v);

  for (let i = 1; i < MAX_FEHLVERSUCHE; i++) v.trittBei(lobby.id, 'jonas', 'falsch');
  assert.equal(v.trittBei(lobby.id, 'jonas', 'geheim').fehler, undefined);
});

test('die Sperre dauert 30 Sekunden', () => {
  const zeit = testuhr();
  const v = new Lobbyverwaltung({ uhr: zeit.uhr });
  const lobby = oeffne(v);
  for (let i = 0; i < MAX_FEHLVERSUCHE; i++) v.trittBei(lobby.id, 'jonas', 'falsch');

  zeit.vor(SPERRDAUER - 1);
  assert.equal(v.trittBei(lobby.id, 'jonas', 'geheim').fehler, 'gesperrt', 'eine Millisekunde vorher');

  zeit.vor(1);
  assert.equal(v.trittBei(lobby.id, 'jonas', 'geheim').fehler, undefined, 'danach wieder frei');
});

test('nach der Sperre gibt es wieder fuenf neue Versuche', () => {
  const zeit = testuhr();
  const v = new Lobbyverwaltung({ uhr: zeit.uhr });
  const lobby = oeffne(v);
  for (let i = 0; i < MAX_FEHLVERSUCHE; i++) v.trittBei(lobby.id, 'jonas', 'falsch');
  zeit.vor(SPERRDAUER);

  for (let i = 1; i < MAX_FEHLVERSUCHE; i++) {
    assert.equal(v.trittBei(lobby.id, 'jonas', 'falsch').fehler, 'passwort', `neuer Versuch ${i}`);
  }
});

test('die Sperre gilt nur fuer diesen Spieler und diese Lobby', () => {
  const v = new Lobbyverwaltung({ uhr: testuhr().uhr });
  const lena = oeffne(v, 'lena', 'Lena', 'geheim');
  const ben = oeffne(v, 'ben', 'Ben', 'geheim');
  for (let i = 0; i < MAX_FEHLVERSUCHE; i++) v.trittBei(lena.id, 'jonas', 'falsch');

  assert.equal(v.trittBei(ben.id, 'jonas', 'geheim').fehler, undefined, 'andere Lobby: frei');
  assert.equal(v.trittBei(lena.id, 'aylin', 'geheim').fehler, undefined, 'anderer Spieler: frei');
});

test('ein richtiges Passwort setzt die Fehlversuche zurueck', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v);
  v.trittBei(lobby.id, 'jonas', 'falsch');
  v.trittBei(lobby.id, 'jonas', 'geheim');

  assert.equal(v.anzahlFehlversuche, 0);
});

// --------------------------------------------------------------------------
// Schliessen und Trennung
// --------------------------------------------------------------------------

test('Schliessen entfernt die Lobby und meldet, ob sich die Liste aendert', () => {
  const v = new Lobbyverwaltung();
  oeffne(v);

  assert.equal(v.schliesse('lena'), true);
  assert.equal(v.anzahlLobbys, 0);
  assert.equal(v.schliesse('lena'), false, 'zweimal schliessen ist harmlos');
  assert.equal(v.schliesse('niemand'), false);
});

test('eine besetzte Lobby zu schliessen aendert die Liste nicht', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v);
  v.trittBei(lobby.id, 'jonas', 'geheim');

  assert.equal(v.schliesse('lena'), false, 'sie stand ja nicht mehr in der Liste');
  assert.equal(v.anzahlLobbys, 0);
});

test('Schliessen raeumt auch die Fehlversuche dieser Lobby ab', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v);
  v.trittBei(lobby.id, 'jonas', 'falsch');
  v.trittBei(lobby.id, 'aylin', 'falsch');

  v.schliesse('lena');
  assert.equal(v.anzahlFehlversuche, 0);
});

test('trennt sich der Ersteller, verschwindet seine Lobby', () => {
  const v = new Lobbyverwaltung();
  oeffne(v);

  assert.equal(v.entferneSpieler('lena'), true);
  assert.deepEqual(v.liste(), []);
  assert.equal(v.entferneSpieler('jonas'), false, 'wer keine Lobby hat, aendert nichts');
});

test('trennt sich ein Beitrittswilliger, vergisst der Server seine Fehlversuche', () => {
  const v = new Lobbyverwaltung();
  const lobby = oeffne(v);
  v.trittBei(lobby.id, 'jonas', 'falsch');

  v.entferneSpieler('jonas');
  assert.equal(v.anzahlFehlversuche, 0);
  assert.equal(v.anzahlLobbys, 1, 'Lenas Lobby bleibt davon unberuehrt');
});
