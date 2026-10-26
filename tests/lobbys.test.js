/**
 * Tests der Lobbyverwaltung.
 *
 * Wie die Partienverwaltung kennt sie kein Socket.io - die Tests arbeiten mit
 * einfachen Zeichenketten als Spielerkennungen. Für die Sperre nach fünf
 * Fehlversuchen bekommt die Verwaltung eine Attrappe als Uhr: So lässt sich
 * prüfen, was nach 30 Sekunden passiert, ohne 30 Sekunden zu warten.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Lobbyverwaltung,
  SPIELBARE_MODI,
  MAX_LOBBYS,
  MAX_FEHLVERSUCHE,
  SPERRDAUER,
  MAX_GLEICHZEITIGE_PRUEFUNGEN,
  MAX_LOBBYS_PRO_ADRESSE,
  LOBBY_LEBENSDAUER,
} from '../server/lobbys.js';

/** Eine Uhr, die nur weiterläuft, wenn der Test sie stellt. */
function testuhr(start = 1_000_000) {
  let jetzt = start;
  return {
    uhr: () => jetzt,
    vor: (ms) => {
      jetzt += ms;
    },
  };
}

/** Legt eine Lobby an und liefert sie - der Test schlägt fehl, wenn das nicht klappt. */
async function oeffne(v, id = 'lena', name = 'Lena', passwort = 'geheim') {
  const { lobby, fehler } = await v.erstelle(id, name, 'zufall', passwort);
  assert.equal(fehler, undefined, `Lobby von ${name} sollte entstehen`);
  return lobby;
}

// --------------------------------------------------------------------------
// Erstellen
// --------------------------------------------------------------------------

test('eine Lobby entsteht mit Modus, Ersteller und eigener Kennung', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);

  assert.equal(lobby.erstellerId, 'lena');
  assert.equal(lobby.erstellerName, 'Lena');
  assert.equal(lobby.modus, 'zufall');
  assert.match(lobby.id, /^[0-9a-f-]{36}$/, 'Kennung aus crypto.randomUUID');
  assert.equal(v.anzahlLobbys, 1);
});

test('das Passwort wird nie im Klartext gespeichert', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v, 'lena', 'Lena', 'meinPasswort');

  assert.ok(Buffer.isBuffer(lobby.passwortHash));
  assert.equal(lobby.passwortHash.length, 32);
  assert.equal(lobby.salz.length, 16);
  assert.ok(!JSON.stringify(lobby).includes('meinPasswort'));
  assert.ok(!Object.values(lobby).includes('meinPasswort'));
});

test('gleiche Passwoerter ergeben dank Salz verschiedene Hashes', async () => {
  const v = new Lobbyverwaltung();
  const a = await oeffne(v, 'a', 'A', 'gleich');
  const b = await oeffne(v, 'b', 'B', 'gleich');

  assert.notDeepEqual(a.salz, b.salz);
  assert.notDeepEqual(a.passwortHash, b.passwortHash);
});

test('das Passwort braucht 4 bis 32 Zeichen', async () => {
  const v = new Lobbyverwaltung();
  const versuch = async (passwort, id) => (await v.erstelle(id, 'X', 'zufall', passwort)).fehler;

  assert.equal(await versuch('abc', 'a'), 'passwort', '3 Zeichen sind zu wenig');
  assert.equal(await versuch('', 'b'), 'passwort');
  assert.equal(await versuch('x'.repeat(33), 'c'), 'passwort', '33 Zeichen sind zu viel');
  assert.equal(await versuch('abcd', 'd'), undefined, '4 Zeichen reichen');
  assert.equal(await versuch('x'.repeat(32), 'e'), undefined, '32 Zeichen gehen noch');
});

test('das Passwort darf beliebige Zeichen enthalten', async () => {
  const v = new Lobbyverwaltung();
  assert.equal((await v.erstelle('a', 'A', 'zufall', 'ä ß !?"<>')).fehler, undefined);
});

test('ein Passwort, das kein Text ist, wird abgelehnt', async () => {
  const v = new Lobbyverwaltung();
  for (const [i, passwort] of [1234, null, undefined, ['abcd'], { a: 1 }].entries()) {
    assert.equal(
      (await v.erstelle(`s${i}`, 'X', 'zufall', passwort)).fehler,
      'passwort',
      String(passwort),
    );
  }
  assert.equal(v.anzahlLobbys, 0);
});

test('es gibt genau die Modi Zufallstier und Duell - beide spielbar', async () => {
  assert.deepEqual(SPIELBARE_MODI, ['zufall', 'duell']);
});

test('eine Lobby im Modus Duell laesst sich erstellen', async () => {
  const v = new Lobbyverwaltung();
  const { lobby, fehler } = await v.erstelle('a', 'A', 'duell', 'geheim');
  assert.equal(fehler, undefined);
  assert.equal(lobby.modus, 'duell');
  assert.equal(v.liste()[0].modus, 'duell');
});

test('unbekannte Modi werden abgelehnt', async () => {
  const v = new Lobbyverwaltung();
  for (const [i, modus] of [
    'schach',
    '',
    'ZUFALL',
    undefined,
    null,
    42,
    { modus: 'zufall' },
  ].entries()) {
    assert.equal((await v.erstelle(`s${i}`, 'X', modus, 'geheim')).fehler, 'modus', String(modus));
  }
  assert.equal(v.anzahlLobbys, 0);
});

test('jeder Spieler hat hoechstens eine Lobby', async () => {
  const v = new Lobbyverwaltung();
  await oeffne(v, 'lena');

  assert.equal((await v.erstelle('lena', 'Lena', 'zufall', 'nochmal')).fehler, 'schonOffen');
  assert.equal(v.anzahlLobbys, 1);
});

test('nach dem Schliessen darf man eine neue Lobby erstellen', async () => {
  const v = new Lobbyverwaltung();
  await oeffne(v, 'lena');
  v.schliesse('lena');

  assert.equal((await v.erstelle('lena', 'Lena', 'zufall', 'nochmal')).fehler, undefined);
});

test(`hoechstens ${MAX_LOBBYS} Lobbys insgesamt`, async () => {
  const v = new Lobbyverwaltung();
  for (let i = 0; i < MAX_LOBBYS; i++) await oeffne(v, `s${i}`, `S${i}`);

  assert.equal((await v.erstelle('einer-zu-viel', 'X', 'zufall', 'geheim')).fehler, 'voll');
  assert.equal(v.anzahlLobbys, MAX_LOBBYS);

  v.schliesse('s0');
  assert.equal(
    (await v.erstelle('einer-zu-viel', 'X', 'zufall', 'geheim')).fehler,
    undefined,
    'sobald eine schliesst, ist wieder Platz',
  );
});

// Wer 50 Tabs öffnet, soll nicht alle Lobbys belegen.

test(`hoechstens ${MAX_LOBBYS_PRO_ADRESSE} offene Lobbys von derselben Adresse`, async () => {
  const v = new Lobbyverwaltung();
  const von = (adresse) => ({ adresse });
  for (let i = 0; i < MAX_LOBBYS_PRO_ADRESSE; i++) {
    const { fehler } = await v.erstelle(
      `tab${i}`,
      `Tab${i}`,
      'zufall',
      'geheim',
      10,
      von('10.0.0.7'),
    );
    assert.equal(fehler, undefined, `Lobby ${i + 1} entsteht`);
  }

  const vierte = await v.erstelle('tab3', 'Tab3', 'zufall', 'geheim', 10, von('10.0.0.7'));
  assert.equal(vierte.fehler, 'zuVieleVonDir');

  const andere = await v.erstelle('nachbar', 'Nachbar', 'zufall', 'geheim', 10, von('10.0.0.8'));
  assert.equal(andere.fehler, undefined, 'eine andere Adresse ist nicht betroffen');

  // Eine besetzte Lobby zählt nicht mehr - dort läuft ja eine Partie.
  const [eineVon7] = v.liste().filter((l) => l.erstellerName.startsWith('Tab'));
  await v.trittBei(eineVon7.id, 'gast', 'geheim');
  const nachBeitritt = await v.erstelle('tab3', 'Tab3', 'zufall', 'geheim', 10, von('10.0.0.7'));
  assert.equal(nachBeitritt.fehler, undefined);
});

test('die Adresse des Erstellers steht nicht in der Liste', async () => {
  const v = new Lobbyverwaltung();
  await v.erstelle('lena', 'Lena', 'zufall', 'geheim', 10, { adresse: '10.0.0.7' });
  assert.ok(!JSON.stringify(v.liste()).includes('10.0.0.7'));
});

test('eine Lobby ohne Gast schliesst nach 10 Minuten', async () => {
  const zeit = testuhr();
  const v = new Lobbyverwaltung({ uhr: zeit.uhr });
  await oeffne(v, 'lena', 'Lena');
  zeit.vor(60_000);
  await oeffne(v, 'ben', 'Ben');

  zeit.vor(LOBBY_LEBENSDAUER - 60_000 - 1);
  assert.deepEqual(v.raeumeAbgelaufeneAuf(), [], 'eine Millisekunde vorher noch nicht');

  zeit.vor(1);
  assert.deepEqual(v.raeumeAbgelaufeneAuf(), ['lena'], 'nur Lenas Lobby ist alt genug');
  assert.deepEqual(
    v.liste().map((l) => l.erstellerName),
    ['Ben'],
  );
});

test('eine besetzte Lobby wird nicht weggeraeumt - dort laeuft eine Partie', async () => {
  const zeit = testuhr();
  const v = new Lobbyverwaltung({ uhr: zeit.uhr });
  const lobby = await oeffne(v);
  await v.trittBei(lobby.id, 'jonas', 'geheim');

  zeit.vor(LOBBY_LEBENSDAUER * 2);
  assert.deepEqual(v.raeumeAbgelaufeneAuf(), []);
  assert.equal(v.anzahlLobbys, 1);
});

// --------------------------------------------------------------------------
// Liste
// --------------------------------------------------------------------------

test('die Liste enthaelt NUR Kennung, Name, Modus und Zugzeit', async () => {
  const v = new Lobbyverwaltung();
  await oeffne(v, 'lena', 'Lena', 'streng-geheim');

  const [eintrag] = v.liste();
  assert.deepEqual(Object.keys(eintrag).sort(), ['erstellerName', 'id', 'modus', 'zugzeit']);
  assert.ok(!JSON.stringify(v.liste()).includes('streng-geheim'));
  assert.ok(
    !JSON.stringify(v.liste()).includes('lena'),
    'auch die Socket-Kennung des Erstellers bleibt geheim',
  );
});

test('die neueste Lobby steht oben', async () => {
  const zeit = testuhr();
  const v = new Lobbyverwaltung({ uhr: zeit.uhr });
  await oeffne(v, 'a', 'Alt');
  zeit.vor(1000);
  await oeffne(v, 'b', 'Mittel');
  zeit.vor(1000);
  await oeffne(v, 'c', 'Neu');

  assert.deepEqual(
    v.liste().map((l) => l.erstellerName),
    ['Neu', 'Mittel', 'Alt'],
  );
});

test('bei gleicher Zeit steht die zuletzt angelegte Lobby oben', async () => {
  const v = new Lobbyverwaltung({ uhr: () => 5 });
  await oeffne(v, 'a', 'Erste');
  await oeffne(v, 'b', 'Zweite');

  assert.deepEqual(
    v.liste().map((l) => l.erstellerName),
    ['Zweite', 'Erste'],
  );
});

test('eine besetzte Lobby verschwindet aus der Liste', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);
  await v.trittBei(lobby.id, 'jonas', 'geheim');

  assert.deepEqual(v.liste(), []);
  assert.equal(v.anzahlLobbys, 1, 'sie besteht aber weiter, bis die Partie vorbei ist');
});

test('die Liste ist eine Kopie - Aenderungen daran schaden der Verwaltung nicht', async () => {
  const v = new Lobbyverwaltung();
  await oeffne(v);
  v.liste()[0].modus = 'gehackt';

  assert.equal(v.liste()[0].modus, 'zufall');
});

// --------------------------------------------------------------------------
// Beitreten
// --------------------------------------------------------------------------

test('mit dem richtigen Passwort tritt man bei', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);

  const ergebnis = await v.trittBei(lobby.id, 'jonas', 'geheim');
  assert.equal(ergebnis.fehler, undefined);
  assert.equal(ergebnis.lobby, lobby);
  assert.equal(lobby.besetzt, true);
});

test('mit falschem Passwort nicht', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);

  assert.equal((await v.trittBei(lobby.id, 'jonas', 'falsch')).fehler, 'passwort');
  assert.equal(
    (await v.trittBei(lobby.id, 'jonas', 'GEHEIM')).fehler,
    'passwort',
    'Gross-/Kleinschreibung zaehlt',
  );
  assert.equal(lobby.besetzt, false);
});

test('unsinnige Passwoerter beim Beitreten gelten als falsch', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);

  for (const passwort of [undefined, 1234, 'x'.repeat(5000)]) {
    assert.equal(
      (await v.trittBei(lobby.id, `s${String(passwort).length}`, passwort)).fehler,
      'passwort',
    );
  }
});

test('treten zwei mit richtigem Passwort bei, gewinnt der erste', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);

  assert.equal((await v.trittBei(lobby.id, 'jonas', 'geheim')).fehler, undefined);
  assert.equal((await v.trittBei(lobby.id, 'aylin', 'geheim')).fehler, 'voll');
});

// Das Hashen ist asynchron. Diese Tests starten mehrere Aufrufe,
// OHNE auf den ersten zu warten - so entsteht genau der Wettlauf, den
// lobbys.js nach dem "await" abfangen muss.

test('treten zwei GLEICHZEITIG mit richtigem Passwort bei, kommt genau einer rein', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);

  const ergebnisse = await Promise.all([
    v.trittBei(lobby.id, 'jonas', 'geheim'),
    v.trittBei(lobby.id, 'aylin', 'geheim'),
  ]);
  const fehler = ergebnisse.map((e) => e.fehler).sort();
  assert.deepEqual(fehler, ['voll', undefined].sort(), 'einer drin, der andere bekommt "voll"');
});

test('wer gleichzeitig zwei Lobbys eroeffnet, bekommt nur eine', async () => {
  const v = new Lobbyverwaltung();
  const ergebnisse = await Promise.all([
    v.erstelle('lena', 'Lena', 'zufall', 'geheim'),
    v.erstelle('lena', 'Lena', 'zufall', 'geheim'),
  ]);
  assert.deepEqual(ergebnisse.map((e) => e.fehler).sort(), ['schonOffen', undefined].sort());
  assert.equal(v.anzahlLobbys, 1);
});

test('wird die Lobby waehrend der Passwortpruefung geschlossen, ist sie weg', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);

  const beitritt = v.trittBei(lobby.id, 'jonas', 'geheim');
  v.schliesse('lena'); // passiert, während scrypt noch rechnet
  assert.equal((await beitritt).fehler, 'weg');
});

test('ist der Spieler nach der Pruefung nicht mehr frei, bleibt die Lobby offen', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);

  const ergebnis = await v.trittBei(lobby.id, 'jonas', 'geheim', { istSpielerFrei: () => false });
  assert.equal(ergebnis.fehler, 'nichtFrei');
  assert.equal(lobby.besetzt, false, 'ein Getrennter darf die Lobby nicht blockieren');

  const erstellt = await v.erstelle('ben', 'Ben', 'zufall', 'geheim', 10, {
    istSpielerFrei: () => false,
  });
  assert.equal(erstellt.fehler, 'nichtFrei');
  assert.equal(v.anzahlLobbys, 1, 'keine Lobby fuer jemanden, der schon weg ist');
});

test(`hoechstens ${MAX_GLEICHZEITIGE_PRUEFUNGEN} Passwortpruefungen gleichzeitig`, async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);

  const versuche = [];
  for (let i = 0; i <= MAX_GLEICHZEITIGE_PRUEFUNGEN; i++) {
    versuche.push(v.trittBei(lobby.id, `s${i}`, 'falsch'));
  }
  const fehler = (await Promise.all(versuche)).map((e) => e.fehler);

  assert.equal(fehler.filter((f) => f === 'passwort').length, MAX_GLEICHZEITIGE_PRUEFUNGEN);
  assert.equal(fehler.at(-1), 'beschaeftigt', 'der fuenfte bekommt keinen Platz');
  assert.equal(
    v.anzahlFehlversuche,
    MAX_GLEICHZEITIGE_PRUEFUNGEN,
    '"beschaeftigt" ist kein Fehlversuch',
  );

  // Danach sind die Plätze wieder frei.
  assert.equal((await v.trittBei(lobby.id, 'jonas', 'geheim')).fehler, undefined);
});

test('eine unbekannte oder geschlossene Lobby ist weg', async () => {
  const v = new Lobbyverwaltung();
  assert.equal((await v.trittBei('gibt-es-nicht', 'jonas', 'geheim')).fehler, 'weg');
  assert.equal((await v.trittBei(undefined, 'jonas', 'geheim')).fehler, 'weg');
  assert.equal((await v.trittBei({ id: 1 }, 'jonas', 'geheim')).fehler, 'weg');

  const lobby = await oeffne(v);
  v.schliesse('lena');
  assert.equal((await v.trittBei(lobby.id, 'jonas', 'geheim')).fehler, 'weg');
});

test('der eigenen Lobby kann man nicht beitreten', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);

  assert.equal((await v.trittBei(lobby.id, 'lena', 'geheim')).fehler, 'eigene');
  assert.equal(lobby.besetzt, false);
});

// --------------------------------------------------------------------------
// Sperre nach Fehlversuchen
// --------------------------------------------------------------------------

test(`nach ${MAX_FEHLVERSUCHE} Fehlversuchen ist man gesperrt - auch mit richtigem Passwort`, async () => {
  const v = new Lobbyverwaltung({ uhr: testuhr().uhr });
  const lobby = await oeffne(v);

  for (let i = 1; i <= MAX_FEHLVERSUCHE; i++) {
    assert.equal(
      (await v.trittBei(lobby.id, 'jonas', 'falsch')).fehler,
      'passwort',
      `Versuch ${i}`,
    );
  }
  assert.equal((await v.trittBei(lobby.id, 'jonas', 'falsch')).fehler, 'gesperrt');
  assert.equal(
    (await v.trittBei(lobby.id, 'jonas', 'geheim')).fehler,
    'gesperrt',
    'sonst waere die Sperre wertlos',
  );
  assert.equal(lobby.besetzt, false);
});

test('vier Fehlversuche sperren noch nicht', async () => {
  const v = new Lobbyverwaltung({ uhr: testuhr().uhr });
  const lobby = await oeffne(v);

  for (let i = 1; i < MAX_FEHLVERSUCHE; i++) await v.trittBei(lobby.id, 'jonas', 'falsch');
  assert.equal((await v.trittBei(lobby.id, 'jonas', 'geheim')).fehler, undefined);
});

test('die Sperre dauert 30 Sekunden', async () => {
  const zeit = testuhr();
  const v = new Lobbyverwaltung({ uhr: zeit.uhr });
  const lobby = await oeffne(v);
  for (let i = 0; i < MAX_FEHLVERSUCHE; i++) await v.trittBei(lobby.id, 'jonas', 'falsch');

  zeit.vor(SPERRDAUER - 1);
  assert.equal(
    (await v.trittBei(lobby.id, 'jonas', 'geheim')).fehler,
    'gesperrt',
    'eine Millisekunde vorher',
  );

  zeit.vor(1);
  assert.equal(
    (await v.trittBei(lobby.id, 'jonas', 'geheim')).fehler,
    undefined,
    'danach wieder frei',
  );
});

test('nach der Sperre gibt es wieder fuenf neue Versuche', async () => {
  const zeit = testuhr();
  const v = new Lobbyverwaltung({ uhr: zeit.uhr });
  const lobby = await oeffne(v);
  for (let i = 0; i < MAX_FEHLVERSUCHE; i++) await v.trittBei(lobby.id, 'jonas', 'falsch');
  zeit.vor(SPERRDAUER);

  for (let i = 1; i < MAX_FEHLVERSUCHE; i++) {
    assert.equal(
      (await v.trittBei(lobby.id, 'jonas', 'falsch')).fehler,
      'passwort',
      `neuer Versuch ${i}`,
    );
  }
});

test('die Sperre gilt nur fuer diese Adresse und diese Lobby', async () => {
  const v = new Lobbyverwaltung({ uhr: testuhr().uhr });
  const lena = await oeffne(v, 'lena', 'Lena', 'geheim');
  const ben = await oeffne(v, 'ben', 'Ben', 'geheim');
  for (let i = 0; i < MAX_FEHLVERSUCHE; i++) await v.trittBei(lena.id, 'jonas', 'falsch');

  assert.equal(
    (await v.trittBei(ben.id, 'jonas', 'geheim')).fehler,
    undefined,
    'andere Lobby: frei',
  );
  assert.equal(
    (await v.trittBei(lena.id, 'aylin', 'geheim')).fehler,
    undefined,
    'anderer Spieler: frei',
  );
});

test('ein richtiges Passwort setzt die Fehlversuche zurueck', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);
  await v.trittBei(lobby.id, 'jonas', 'falsch');
  await v.trittBei(lobby.id, 'jonas', 'geheim');

  assert.equal(v.anzahlFehlversuche, 0);
});

// --------------------------------------------------------------------------
// Schließen und Trennung
// --------------------------------------------------------------------------

test('Schliessen entfernt die Lobby und meldet, ob sich die Liste aendert', async () => {
  const v = new Lobbyverwaltung();
  await oeffne(v);

  assert.equal(v.schliesse('lena'), true);
  assert.equal(v.anzahlLobbys, 0);
  assert.equal(v.schliesse('lena'), false, 'zweimal schliessen ist harmlos');
  assert.equal(v.schliesse('niemand'), false);
});

test('eine besetzte Lobby zu schliessen aendert die Liste nicht', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);
  await v.trittBei(lobby.id, 'jonas', 'geheim');

  assert.equal(v.schliesse('lena'), false, 'sie stand ja nicht mehr in der Liste');
  assert.equal(v.anzahlLobbys, 0);
});

test('Schliessen raeumt auch die Fehlversuche dieser Lobby ab', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);
  await v.trittBei(lobby.id, 'jonas', 'falsch');
  await v.trittBei(lobby.id, 'aylin', 'falsch');

  v.schliesse('lena');
  assert.equal(v.anzahlFehlversuche, 0);
});

test('trennt sich der Ersteller, verschwindet seine Lobby', async () => {
  const v = new Lobbyverwaltung();
  await oeffne(v);

  assert.equal(v.entferneSpieler('lena'), true);
  assert.deepEqual(v.liste(), []);
  assert.equal(v.entferneSpieler('jonas'), false, 'wer keine Lobby hat, aendert nichts');
});

// Die Sperre zählt je Adresse, nicht je Verbindung - sonst gäbe Neuladen
// fünf neue Versuche.

test('trennt sich ein Beitrittswilliger, bleiben seine Fehlversuche stehen', async () => {
  const v = new Lobbyverwaltung();
  const lobby = await oeffne(v);
  await v.trittBei(lobby.id, 'jonas', 'falsch', { adresse: '10.0.0.7' });

  v.entferneSpieler('jonas');
  assert.equal(v.anzahlFehlversuche, 1);
  assert.equal(v.anzahlLobbys, 1, 'Lenas Lobby bleibt davon unberuehrt');
});

test('gesperrt bleibt gesperrt - auch mit neuer Verbindung von derselben Adresse', async () => {
  const v = new Lobbyverwaltung({ uhr: testuhr().uhr });
  const lobby = await oeffne(v);
  for (let i = 0; i < MAX_FEHLVERSUCHE; i++) {
    await v.trittBei(lobby.id, 'socket-1', 'falsch', { adresse: '10.0.0.7' });
  }
  v.entferneSpieler('socket-1'); // Tab neu geladen

  const neu = await v.trittBei(lobby.id, 'socket-2', 'geheim', { adresse: '10.0.0.7' });
  assert.equal(neu.fehler, 'gesperrt');

  const andere = await v.trittBei(lobby.id, 'socket-3', 'geheim', { adresse: '10.0.0.8' });
  assert.equal(andere.fehler, undefined, 'eine andere Adresse ist nicht betroffen');
});
