/**
 * Integrationstests des Servers.
 *
 * Anders als die übrigen Tests prüfen diese hier nicht einzelne Funktionen,
 * sondern den ECHTEN Server: Er wird als eigener Prozess gestartet, und die
 * Tests verbinden sich als richtige Socket.io-Clients - genau so, wie es ein
 * Browser tut. Damit ist auch server.js abgedeckt, wo die sechs Regelprüfungen
 * gegen Cheating stehen.
 *
 * Der Port wird vom Betriebssystem vergeben, damit die Tests nie mit einem
 * schon laufenden Zoodle kollidieren.
 */

import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { io } from 'socket.io-client';

const WURZEL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Wie lange ein Test höchstens auf eine Serverantwort wartet. */
const ZEITLIMIT = 4000;

let serverProzess;
let serverLog = '';
let adresse;
let alleTiere;

// --------------------------------------------------------------------------
// Hilfsmittel
// --------------------------------------------------------------------------

/** Fragt das Betriebssystem nach einem freien Port. */
function freierPort() {
  return new Promise((erfuellen, ablehnen) => {
    const probe = createServer();
    probe.on('error', ablehnen);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => erfuellen(port));
    });
  });
}

/** Startet den Server und wartet, bis er wirklich lauscht. */
function starteServer(port) {
  return new Promise((erfuellen, ablehnen) => {
    const prozess = spawn('node', ['server/server.js', String(port)], {
      cwd: WURZEL,
      env: { ...process.env, ZOODLE_TESTTIER: TESTTIER },
    });

    const uhr = setTimeout(() => ablehnen(new Error('Server ist nicht gestartet.')), ZEITLIMIT);

    prozess.stdout.on('data', (brocken) => {
      serverLog += brocken.toString();
      // Diese Zeile gibt der Server aus, sobald er bereit ist.
      if (serverLog.includes('Zoodle laeuft')) {
        clearTimeout(uhr);
        erfuellen(prozess);
      }
    });
    prozess.stderr.on('data', (brocken) => {
      serverLog += brocken.toString();
    });
    prozess.on('error', ablehnen);
  });
}

/**
 * Das Tier, das in jeder Partie (Zufallstier) dieses Testservers gesucht wird.
 *
 * Der Server schickt die Lösung erst beim Spielende an die Clients. Ein
 * Test, der den Sieg prüfen will, muss sie also vorher kennen. Deshalb
 * startet er den Server mit ZOODLE_TESTTIER (siehe server.js) - genommen
 * wird einfach das erste Tier der Datenbank.
 */
const TESTTIER = JSON.parse(readFileSync(path.join(WURZEL, 'data', 'tiere.json'), 'utf8'))[0].name;
const gesuchtesTier = () => TESTTIER;

/** Alle in diesem Test geöffneten Verbindungen - werden danach geschlossen. */
let offeneClients = [];

/**
 * Verbindet einen neuen Client und wartet, bis die Verbindung steht.
 * @param {object} [kopfzeilen]  z. B. { 'x-forwarded-for': '...' } - so, wie
 *   Caddy sie auf dem DHBW-Server mitschickt
 */
function neuerClient(ziel = adresse, kopfzeilen = {}) {
  return new Promise((erfuellen, ablehnen) => {
    const client = io(ziel, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: kopfzeilen,
    });
    offeneClients.push(client);

    const uhr = setTimeout(() => ablehnen(new Error('Verbindung kam nicht zustande.')), ZEITLIMIT);
    client.on('connect', () => {
      clearTimeout(uhr);
      erfuellen(client);
    });
    client.on('connect_error', ablehnen);
  });
}

/** Wartet auf ein bestimmtes Ereignis - oder scheitert nach dem Zeitlimit. */
function warteAuf(client, ereignis, zeitlimit = ZEITLIMIT) {
  return new Promise((erfuellen, ablehnen) => {
    const uhr = setTimeout(
      () => ablehnen(new Error(`Ereignis "${ereignis}" kam nicht innerhalb von ${zeitlimit} ms.`)),
      zeitlimit,
    );
    client.once(ereignis, (daten) => {
      clearTimeout(uhr);
      erfuellen(daten);
    });
  });
}

/** Wartet eine feste Zeit - nötig, um zu prüfen, dass NICHTS passiert. */
const kurzWarten = (ms = 250) => new Promise((erfuellen) => setTimeout(erfuellen, ms));

/**
 * Meldet einen Client an und wartet, bis er in der Lobby steht.
 * @returns {Promise<{name: string}>} Was der Server mit "lobbyBetreten" schickt
 */
async function anmelden(client, name) {
  const inLobby = warteAuf(client, 'lobbyBetreten');
  client.emit('anmelden', name);
  return inLobby;
}

/** Stellt einen angemeldeten Client in die Warteschlange und wartet auf "warten". */
async function inWarteschlange(client) {
  const wartet = warteAuf(client, 'warten');
  client.emit('warteschlangeBetreten');
  await wartet;
}

/**
 * Wartet, bis eine Lobbyliste kommt, die die Bedingung erfüllt.
 * Nötig, weil der Server die Liste bei JEDER Änderung schickt - die
 * erste, die ankommt, ist nicht unbedingt die, auf die der Test wartet.
 */
function warteAufListe(client, bedingung) {
  return new Promise((erfuellen, ablehnen) => {
    const uhr = setTimeout(
      () => ablehnen(new Error('Die erwartete Lobbyliste kam nicht.')),
      ZEITLIMIT,
    );
    const pruefe = (liste) => {
      if (!bedingung(liste)) return;
      clearTimeout(uhr);
      client.off('lobbyListe', pruefe);
      erfuellen(liste);
    };
    client.on('lobbyListe', pruefe);
  });
}

/**
 * Meldet zwei Spieler an, schickt beide in die öffentliche Warteschlange
 * und liefert die fertige Partie zurück.
 * @returns {Promise<{amZug, wartend, anna, ben, modus}>}
 */
async function startePartie() {
  const anna = await neuerClient();
  const ben = await neuerClient();

  await anmelden(anna, 'Anna');
  await anmelden(ben, 'Ben');
  await inWarteschlange(anna);

  const startAnna = warteAuf(anna, 'spielStart');
  const startBen = warteAuf(ben, 'spielStart');
  ben.emit('warteschlangeBetreten');
  const [infoAnna] = await Promise.all([startAnna, startBen]);

  return {
    anna,
    ben,
    modus: infoAnna.modus,
    loesung: TESTTIER,
    amZug: infoAnna.duBistDran ? anna : ben,
    wartend: infoAnna.duBistDran ? ben : anna,
  };
}

/** Ein Tiername, der garantiert nicht die Lösung ist. */
function falschesTier(ausser = []) {
  const loesung = gesuchtesTier();
  return alleTiere.find((t) => t.name !== loesung && !ausser.includes(t.name)).name;
}

// --------------------------------------------------------------------------
// Auf- und Abbau
// --------------------------------------------------------------------------

before(async () => {
  const port = await freierPort();
  adresse = `http://localhost:${port}`;
  serverProzess = await starteServer(port);
  alleTiere = await (await fetch(`${adresse}/api/tiere`)).json();
});

// Nach jedem Test alle Verbindungen schliessen. Das ist wichtig: Der Server
// merkt sich global, wer auf einen Gegner wartet. Bliebe ein Client offen,
// würde er im nächsten Test fälschlich mit jemandem gepaart.
afterEach(async () => {
  for (const client of offeneClients) client.disconnect();
  offeneClients = [];
  await kurzWarten(150);
});

after(() => {
  serverProzess?.kill('SIGKILL');
});

// --------------------------------------------------------------------------
// Matchmaking
// --------------------------------------------------------------------------

test('nach der Anmeldung steht man in der Lobby und bekommt die Liste', async () => {
  const anna = await neuerClient();
  const liste = warteAuf(anna, 'lobbyListe');
  const { name } = await anmelden(anna, '  Anna  ');

  assert.equal(name, 'Anna', 'der Server meldet den bereinigten Namen zurueck');
  assert.ok(Array.isArray(await liste));
});

test('die Anmeldung allein startet noch keine Partie', async () => {
  const anna = await neuerClient();
  const ben = await neuerClient();
  let gestartet = false;
  for (const c of [anna, ben])
    c.on('spielStart', () => {
      gestartet = true;
    });

  await anmelden(anna, 'Anna');
  await anmelden(ben, 'Ben');
  await kurzWarten();

  assert.equal(gestartet, false, 'erst die Warteschlange oder eine Lobby fuehrt ins Spiel');
});

test('der erste Spieler in der Warteschlange wartet', async () => {
  const anna = await neuerClient();
  await anmelden(anna, 'Anna');
  await inWarteschlange(anna); // Wirft, wenn "warten" nicht kommt.
});

test('eine oeffentliche Partie spielt immer Zufallstier', async () => {
  const { modus } = await startePartie();
  assert.equal(modus, 'zufall');
});

test('der zweite Spieler startet die Partie fuer beide', async () => {
  const { amZug, wartend } = await startePartie();

  // Genau einer von beiden ist am Zug - niemals beide, niemals keiner.
  const infoAmZug = await new Promise((erfuellen) => {
    amZug.emit('raten', falschesTier());
    amZug.once('zug', erfuellen);
  });
  assert.equal(infoAmZug.duBistDran, false, 'nach dem eigenen Zug ist man nicht mehr dran');
  assert.ok(wartend);
});

test('beide Spieler erfahren den Namen des Gegners', async () => {
  const anna = await neuerClient();
  const ben = await neuerClient();

  await anmelden(anna, 'Anna');
  await anmelden(ben, 'Ben');
  await inWarteschlange(anna);

  const startAnna = warteAuf(anna, 'spielStart');
  const startBen = warteAuf(ben, 'spielStart');
  ben.emit('warteschlangeBetreten');
  const [infoAnna, infoBen] = await Promise.all([startAnna, startBen]);

  assert.equal(infoAnna.gegnerName, 'Ben');
  assert.equal(infoBen.gegnerName, 'Anna');
  assert.ok(Array.isArray(infoAnna.kategorien), 'die Spalten des Spielfelds kommen mit');
});

test('jede HTTP-Antwort hat die Sicherheits-Kopfzeilen und verraet keine Software', async () => {
  for (const weg of ['/', '/api/tiere', '/css/basis.css', '/gibt-es-nicht']) {
    const antwort = await fetch(adresse + weg);
    const csp = antwort.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/, weg);
    assert.match(csp, /img-src 'self' data:/, `${weg}: ohne data: verschwaende die Szene`);
    assert.match(csp, /frame-ancestors 'none'/, weg);
    assert.equal(antwort.headers.get('x-content-type-options'), 'nosniff', weg);
    assert.equal(antwort.headers.get('referrer-policy'), 'no-referrer', weg);
    assert.equal(antwort.headers.get('x-powered-by'), null, weg);
  }
});

test('ein leerer Name wird abgelehnt', async () => {
  const client = await neuerClient();
  const fehler = warteAuf(client, 'fehler');
  client.emit('anmelden', '   ');

  assert.match(await fehler, /Namen/);
});

test('unsichtbare Zeichen im Namen kommen beim Gegner nicht an', async () => {
  const anna = await neuerClient();
  const ben = await neuerClient();
  assert.equal((await anmelden(anna, '\u202Eanna\u200B')).name, 'anna');
  await anmelden(ben, 'Ben');
  await inWarteschlange(anna);

  const start = warteAuf(ben, 'spielStart');
  ben.emit('warteschlangeBetreten');
  assert.equal((await start).gegnerName, 'anna');
});

test('ein Name nur aus unsichtbaren Zeichen wird abgelehnt', async () => {
  const client = await neuerClient();
  const fehler = warteAuf(client, 'fehler');
  client.emit('anmelden', '\u200B\u200B');
  assert.match(await fehler, /Namen/);
});

test('ein Emoji an der Laengengrenze bleibt ganz', async () => {
  const client = await neuerClient();
  const { name } = await anmelden(client, 'a'.repeat(19) + '😀');
  assert.equal(name, 'a'.repeat(19) + '😀');
});

// --------------------------------------------------------------------------
// Die Regelprüfungen gegen Cheating - Nummern wie in pruefeRateversuch()
// (server.js). Regel 2 (Duell-Wahl) und Regel 4 (Zeit abgelaufen) stehen
// weiter unten bei Duell und Zugzeit.
// --------------------------------------------------------------------------

test('Regel 1: wer in keiner Partie ist, darf nicht raten', async () => {
  const einzelgaenger = await neuerClient();
  await anmelden(einzelgaenger, 'Allein');
  await inWarteschlange(einzelgaenger);

  const fehler = warteAuf(einzelgaenger, 'fehler');
  einzelgaenger.emit('raten', 'Löwe');

  assert.match(await fehler, /keiner laufenden Partie/);
});

test('Regel 3: wer nicht am Zug ist, darf nicht raten', async () => {
  const { wartend } = await startePartie();

  const fehler = warteAuf(wartend, 'fehler');
  wartend.emit('raten', falschesTier());

  assert.match(await fehler, /nicht am Zug/);
});

test('Regel 3: auch die richtige Loesung zaehlt nicht, wenn man nicht am Zug ist', async () => {
  const { wartend, amZug } = await startePartie();

  // Der härteste Fall: Der Wartende kennt die Lösung und feuert sie ab.
  const fehler = warteAuf(wartend, 'fehler');
  let hatGewonnen = false;
  wartend.once('spielEnde', () => {
    hatGewonnen = true;
  });
  wartend.emit('raten', gesuchtesTier());

  assert.match(await fehler, /nicht am Zug/);
  await kurzWarten();
  assert.equal(hatGewonnen, false, 'ein Sieg ausser der Reihe darf nicht moeglich sein');
  assert.ok(amZug);
});

test('Regel 5: erfundene Tiere werden abgelehnt', async () => {
  const { amZug } = await startePartie();

  const fehler = warteAuf(amZug, 'fehler');
  amZug.emit('raten', 'Einhorn');

  assert.match(await fehler, /kenne ich nicht/);
});

test('Regel 6: dasselbe Tier laesst sich kein zweites Mal raten', async () => {
  const { amZug, wartend } = await startePartie();
  const tier = falschesTier();

  // Erster Tipp: geht durch, danach ist der Gegner am Zug.
  amZug.emit('raten', tier);
  await warteAuf(amZug, 'zug');

  // Der Gegner versucht dasselbe Tier noch einmal.
  const fehler = warteAuf(wartend, 'fehler');
  wartend.emit('raten', tier);

  assert.match(await fehler, /schon geraten/);
});

// --------------------------------------------------------------------------
// Spielablauf
// --------------------------------------------------------------------------

test('nach einem falschen Tipp ist der Gegner am Zug', async () => {
  const { amZug, wartend } = await startePartie();

  const zugAmZug = warteAuf(amZug, 'zug');
  const zugWartend = warteAuf(wartend, 'zug');
  amZug.emit('raten', falschesTier());

  const [beiMir, beimGegner] = await Promise.all([zugAmZug, zugWartend]);

  assert.equal(beiMir.duBistDran, false, 'der Rater ist nicht mehr dran');
  assert.equal(beimGegner.duBistDran, true, 'der Gegner ist jetzt dran');
});

test('beide Spieler sehen denselben Zug mit denselben Hinweisen', async () => {
  const { amZug, wartend } = await startePartie();
  const tier = falschesTier();

  const zugAmZug = warteAuf(amZug, 'zug');
  const zugWartend = warteAuf(wartend, 'zug');
  amZug.emit('raten', tier);
  const [beiMir, beimGegner] = await Promise.all([zugAmZug, zugWartend]);

  assert.equal(beiMir.tierName, tier);
  assert.equal(beimGegner.tierName, tier);
  assert.deepEqual(beiMir.hinweise, beimGegner.hinweise, 'die Bewertung ist fuer beide gleich');

  // "vonMir" unterscheidet die beiden Sichten - sonst nichts.
  assert.equal(beiMir.vonMir, true);
  assert.equal(beimGegner.vonMir, false);
});

test('das gesuchte Tier steht in keiner Nachricht, solange die Partie laeuft', async () => {
  const { amZug, wartend } = await startePartie();
  const loesung = gesuchtesTier();

  // Alles mitschneiden, was der Server während der Partie schickt.
  const mitschnitt = [];
  amZug.onAny((ereignis, daten) => mitschnitt.push({ ereignis, daten }));
  wartend.onAny((ereignis, daten) => mitschnitt.push({ ereignis, daten }));

  let dran = amZug,
    andere = wartend;
  const schonGeraten = [];
  for (let i = 0; i < 4; i++) {
    const tier = falschesTier(schonGeraten);
    schonGeraten.push(tier);
    const zug = warteAuf(dran, 'zug');
    dran.emit('raten', tier);
    await zug;
    [dran, andere] = [andere, dran];
  }

  assert.ok(mitschnitt.length > 0, 'es wurde ueberhaupt etwas mitgeschnitten');
  const durchsickert = mitschnitt.find((n) => JSON.stringify(n).includes(loesung));
  assert.equal(
    durchsickert,
    undefined,
    `Die Loesung "${loesung}" stand in der Nachricht "${durchsickert?.ereignis}".`,
  );
});

// Das Geheimnis darf auch nicht im Serverlog stehen, solange die Partie läuft.
test('das gesuchte Tier steht nicht im Serverlog, solange die Partie laeuft', async () => {
  const vorher = serverLog.length;
  const { amZug } = await startePartie();
  const zug = warteAuf(amZug, 'zug');
  amZug.emit('raten', falschesTier());
  await zug;
  await kurzWarten(100);

  assert.ok(!serverLog.slice(vorher).includes(TESTTIER), serverLog.slice(vorher));
});

test('ein richtiger Tipp beendet die Partie fuer beide', async () => {
  const { amZug, wartend } = await startePartie();
  const loesung = gesuchtesTier();

  const endeGewinner = warteAuf(amZug, 'spielEnde');
  const endeVerlierer = warteAuf(wartend, 'spielEnde');
  amZug.emit('raten', loesung);

  const [beimGewinner, beimVerlierer] = await Promise.all([endeGewinner, endeVerlierer]);

  assert.equal(beimGewinner.duHastGewonnen, true);
  assert.equal(beimVerlierer.duHastGewonnen, false);
  assert.equal(
    beimGewinner.gewinnerName,
    beimVerlierer.gewinnerName,
    'beide sehen denselben Sieger',
  );

  // Erst JETZT darf die Lösung mitkommen - und beide bekommen sie.
  assert.equal(beimGewinner.geheimnis.name, loesung);
  assert.equal(beimVerlierer.geheimnis.name, loesung);
  assert.equal(beimGewinner.anzahlTipps, 1);
});

test('nach dem Spielende wird kein weiterer Zug mehr angenommen', async () => {
  const { amZug, wartend } = await startePartie();

  const ende = warteAuf(amZug, 'spielEnde');
  amZug.emit('raten', gesuchtesTier());
  await ende;

  const fehler = warteAuf(wartend, 'fehler');
  wartend.emit('raten', falschesTier());

  assert.match(await fehler, /keiner laufenden Partie/);
});

// --------------------------------------------------------------------------
// Verbindungsabbruch in jeder Spielphase
// --------------------------------------------------------------------------

test('Abbruch im Wartebildschirm: der Naechste wartet neu, statt gegen einen Geist zu spielen', async () => {
  const anna = await neuerClient();
  await anmelden(anna, 'Anna');
  await inWarteschlange(anna);

  anna.disconnect();
  await kurzWarten();

  // Ben darf jetzt NICHT gegen die verschwundene Anna gepaart werden.
  const ben = await neuerClient();
  await anmelden(ben, 'Ben');
  await inWarteschlange(ben);
  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
});

test('Abbruch in laufender Partie: der Gegner erfaehrt es und bekommt die Loesung', async () => {
  const { amZug, wartend } = await startePartie();
  const loesung = gesuchtesTier();

  const nachricht = warteAuf(wartend, 'gegnerWeg');
  amZug.disconnect();

  const daten = await nachricht;
  assert.equal(
    daten.geheimnis.name,
    loesung,
    'die Partie ist vorbei, also darf die Loesung kommen',
  );
  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
});

test('Abbruch mitten im Zug: kein Absturz', async () => {
  const { amZug, wartend } = await startePartie();

  // Tipp abschicken und im selben Moment die Verbindung kappen.
  amZug.emit('raten', falschesTier());
  amZug.disconnect();
  await kurzWarten(400);

  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
  assert.ok(wartend);
});

test('Abbruch nach dem Sieg: kein Absturz', async () => {
  const { amZug, wartend } = await startePartie();

  const ende = warteAuf(amZug, 'spielEnde');
  amZug.emit('raten', gesuchtesTier());
  await ende;

  amZug.disconnect();
  wartend.disconnect();
  await kurzWarten(400);

  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
});

test('beide Spieler brechen gleichzeitig ab: kein Absturz', async () => {
  const { amZug, wartend } = await startePartie();

  amZug.disconnect();
  wartend.disconnect();
  await kurzWarten(400);

  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
});

// --------------------------------------------------------------------------
// Robustheit gegen kaputte Eingaben
// --------------------------------------------------------------------------

test('kaputte Nutzlasten bringen den Server nicht zum Absturz', async () => {
  const { amZug } = await startePartie();

  // Alles, was ein manipulierter Client statt eines Tiernamens schicken könnte.
  const boesartig = [null, 42, {}, [1, 2, 3], true, '', '   ', '<img src=x onerror=alert(1)>'];

  for (const nutzlast of boesartig) {
    amZug.emit('raten', nutzlast);
    await kurzWarten(120); // Unter der Grenze von 10 Nachrichten pro Sekunde bleiben.
  }

  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');

  // Und er spielt danach ganz normal weiter. Vorher eine Sekunde Pause:
  // Anmelden, Warteschlange und acht Nutzlasten sind schon zehn Nachrichten -
  // ein elfter Tipp in derselben Sekunde fiele zu Recht der Bremse zum Opfer.
  await kurzWarten(1000);
  const zug = warteAuf(amZug, 'zug');
  amZug.emit('raten', falschesTier());
  await zug;
});

test('eine sehr lange Eingabe wird abgelehnt, ohne den Server zu stoeren', async () => {
  const { amZug } = await startePartie();

  const fehler = warteAuf(amZug, 'fehler');
  amZug.emit('raten', 'A'.repeat(5000));

  assert.match(await fehler, /kenne ich nicht/);
  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
});

// --------------------------------------------------------------------------
// Nachrichtenbremse
// --------------------------------------------------------------------------

test('eine Flut von Rateversuchen wird gekappt', async () => {
  const client = await neuerClient();
  await anmelden(client, 'Fluter');

  for (let i = 0; i < 200; i++) client.emit('raten', 'Löwe');
  await kurzWarten(800);

  assert.equal(client.connected, false, 'die Verbindung wird getrennt');
  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
});

test('die Bremse greift auch bei frei erfundenen Ereignisnamen', async () => {
  const client = await neuerClient();
  await anmelden(client, 'Schleicher');

  // Die Bremse muss JEDES Ereignis zählen, nicht nur "anmelden" und
  // "raten" - sonst käme ein frei erfundener Name ungebremst durch.
  for (let i = 0; i < 200; i++) client.emit('voelligFrei', 'x'.repeat(100));
  await kurzWarten(800);

  assert.equal(client.connected, false, 'auch hier wird getrennt');
  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
});

test('wer gebremst wird, erfaehrt es - aber nur einmal je Sekunde', async () => {
  const client = await neuerClient();
  const meldungen = [];
  client.on('fehler', (text) => meldungen.push(text));

  await anmelden(client, 'Hektisch');

  // Deutlich mehr als die erlaubten 10 pro Sekunde, aber unter der
  // Kappungsgrenze von 50 - die Verbindung soll bestehen bleiben.
  for (let i = 0; i < 20; i++) client.emit('raten', 'Löwe');
  await kurzWarten(500);

  const bremsmeldungen = meldungen.filter((text) => text.includes('langsamer'));
  assert.equal(
    bremsmeldungen.length,
    1,
    'genau eine Bremsmeldung - sonst wuerde die Antwort die Flut verstaerken',
  );
  assert.equal(client.connected, true, 'unter der Kappungsgrenze bleibt die Verbindung bestehen');
});

test('normales Spielen loest die Bremse nicht aus', async () => {
  const { amZug, wartend } = await startePartie();

  // Ein Zugwechsel hin und zurück in ruhigem Tempo - das muss durchgehen.
  const namen = [];
  for (let i = 0; i < 2; i++) namen.push(falschesTier(namen));

  let dran = amZug,
    andere = wartend;
  for (const name of namen) {
    const zug = warteAuf(dran, 'zug');
    dran.emit('raten', name);
    await zug;
    [dran, andere] = [andere, dran];
  }

  assert.equal(amZug.connected, true);
  assert.equal(wartend.connected, true);
});

// --------------------------------------------------------------------------
// Gleichzeitige Züge
// --------------------------------------------------------------------------

test('mehrere Tipps im selben Augenblick ergeben genau EINEN gueltigen Zug', async () => {
  const { amZug, wartend } = await startePartie();

  const zuege = [];
  wartend.on('zug', (zug) => zuege.push(zug));
  const fehler = [];
  amZug.on('fehler', (text) => fehler.push(text));

  // Fünf Tipps ohne Pause dazwischen. Wäre die Zugverarbeitung
  // unterbrechbar, käme derselbe Spieler mehrfach hintereinander dran.
  const namen = [];
  for (let i = 0; i < 5; i++) namen.push(falschesTier(namen));
  for (const name of namen) amZug.emit('raten', name);

  await kurzWarten(600);

  assert.equal(zuege.length, 1, 'nur der erste Tipp darf zaehlen');
  assert.equal(fehler.length, 4, 'die uebrigen vier werden abgelehnt');
  for (const text of fehler) assert.match(text, /nicht am Zug/);
});

// --------------------------------------------------------------------------
// Revanche und "Zur Lobby"
// --------------------------------------------------------------------------

/** Spielt die laufende Partie zu Ende - der Spieler am Zug gewinnt. */
async function spieleZuEnde({ anna, ben, amZug }) {
  const endeAnna = warteAuf(anna, 'spielEnde');
  const endeBen = warteAuf(ben, 'spielEnde');
  amZug.emit('raten', gesuchtesTier());
  await Promise.all([endeAnna, endeBen]);
}

test('stimmen beide zu, spielen dieselben zwei Spieler erneut', async () => {
  const partie = await startePartie();
  const { anna, ben } = partie;
  const ersteLoesung = gesuchtesTier();

  await spieleZuEnde(partie);

  // Anna klickt zuerst: Sie wartet, Ben bekommt das Angebot angezeigt.
  const annaWartet = warteAuf(anna, 'revancheWartet');
  const benErfaehrtEs = warteAuf(ben, 'revancheAngeboten');
  anna.emit('revanche');
  await Promise.all([annaWartet, benErfaehrtEs]);

  // Ben klickt auch - jetzt geht es für beide von vorn los.
  const startAnna = warteAuf(anna, 'spielStart');
  const startBen = warteAuf(ben, 'spielStart');
  ben.emit('revanche');
  const [infoAnna, infoBen] = await Promise.all([startAnna, startBen]);

  assert.equal(infoAnna.gegnerName, 'Ben', 'die Namen bleiben erhalten');
  assert.equal(infoBen.gegnerName, 'Anna');
  assert.notEqual(infoAnna.duBistDran, infoBen.duBistDran, 'genau einer faengt an');

  // Die neue Partie ist wirklich neu: Das alte Tier lässt sich wieder raten
  // ("schon geraten" wäre ein Fehler statt eines Zuges).
  const dranJetzt = infoAnna.duBistDran ? anna : ben;
  const zug = warteAuf(dranJetzt, 'zug');
  dranJetzt.emit('raten', ersteLoesung);
  assert.equal((await zug).tierName, ersteLoesung, 'die alte Tippliste ist geleert');
});

test('stimmt nur einer zu, passiert nichts weiter', async () => {
  const partie = await startePartie();
  const { anna, ben } = partie;
  await spieleZuEnde(partie);

  const benErfaehrtEs = warteAuf(ben, 'revancheAngeboten');
  let neueRunde = false;
  anna.once('spielStart', () => {
    neueRunde = true;
  });
  anna.emit('revanche');
  await benErfaehrtEs;

  await kurzWarten(400);
  assert.equal(neueRunde, false, 'ohne Bens Zustimmung beginnt nichts');
  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
});

test('eine Revanche mitten in der Partie wird abgelehnt', async () => {
  const { amZug } = await startePartie();

  const fehler = warteAuf(amZug, 'fehler');
  amZug.emit('revanche');

  assert.match(await fehler, /läuft noch/);
});

test('verschwindet der Gegner, erfaehrt der Wartende es sofort', async () => {
  const partie = await startePartie();
  const { anna, ben } = partie;
  await spieleZuEnde(partie);

  const annaWartet = warteAuf(anna, 'revancheWartet');
  anna.emit('revanche');
  await annaWartet;

  const abgesagt = warteAuf(anna, 'revancheGeplatzt');
  ben.disconnect();

  assert.ok(await abgesagt, 'Anna wartet nicht ewig auf ein Duell mit einem Geist');
  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
});

test('wer zur Lobby geht, sagt dem Wartenden ab und steht wieder in der Lobby', async () => {
  const partie = await startePartie();
  const { anna, ben } = partie;
  await spieleZuEnde(partie);

  const annaWartet = warteAuf(anna, 'revancheWartet');
  anna.emit('revanche');
  await annaWartet;

  const abgesagt = warteAuf(anna, 'revancheGeplatzt');
  const benInLobby = warteAuf(ben, 'lobbyBetreten');
  ben.emit('zurLobby');

  await Promise.all([abgesagt, benInLobby]);

  // Annas Revanche geht jetzt ins Leere - sie bekommt eine klare Absage.
  const fehler = warteAuf(anna, 'fehler');
  anna.emit('revanche');
  assert.match(await fehler, /nicht mehr möglich/);
});

test('geht der Gegner, bevor ich Revanche anbiete, erfahre ich es trotzdem', async () => {
  const partie = await startePartie();
  const { anna, ben } = partie;
  await spieleZuEnde(partie);

  // Anna hat noch nicht geklickt - ihr Revanche-Knopf darf trotzdem nicht
  // aktiv bleiben, sonst wartet sie nach dem Klick auf niemanden.
  const abgesagt = warteAuf(anna, 'revancheGeplatzt');
  ben.emit('zurLobby');

  assert.match(await abgesagt, /Lobby/);
});

test('wer Revanche anbietet und dann geht, sagt dem Gegner ab', async () => {
  const partie = await startePartie();
  const { anna, ben } = partie;
  await spieleZuEnde(partie);

  const benErfaehrtEs = warteAuf(ben, 'revancheAngeboten');
  anna.emit('revanche');
  await benErfaehrtEs;

  // Ben sieht "dein Gegner ist bereit" - das muss verschwinden.
  const abgesagt = warteAuf(ben, 'revancheGeplatzt');
  anna.emit('zurLobby');

  assert.match(await abgesagt, /Lobby/);
});

test('mehrfaches Klicken auf Revanche startet nur eine Partie', async () => {
  const partie = await startePartie();
  const { anna, ben } = partie;
  await spieleZuEnde(partie);

  const starts = [];
  anna.on('spielStart', (daten) => starts.push(daten));

  ben.emit('revanche');
  // Fünf Klicks - langsam genug, um nicht in die Nachrichtenbremse zu laufen.
  for (let i = 0; i < 5; i++) {
    anna.emit('revanche');
    await kurzWarten(120);
  }
  await kurzWarten(300);

  assert.equal(starts.length, 1, 'genau eine neue Partie');
  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
});

// Ein manipulierter Client springt nach der Zusage direkt in die
// Warteschlange oder eine Lobby, ohne "Zur Lobby". Sagt der alte Gegner dann
// zu, darf keine zweite Partie mit ihm entstehen.
for (const [weg, ziehWeiter] of [
  ['Warteschlange', (client) => client.emit('warteschlangeBetreten')],
  [
    'eigene Lobby',
    (client) => client.emit('lobbyErstellen', { modus: 'zufall', passwort: 'geheim' }),
  ],
]) {
  test(`Revanche zugesagt, dann ${weg}: der alte Gegner startet keine zweite Partie`, async () => {
    const partie = await startePartie();
    const { anna, ben } = partie;
    await spieleZuEnde(partie);

    const annaWartet = warteAuf(anna, 'revancheWartet');
    anna.emit('revanche');
    await annaWartet;

    let annaInZweiPartien = false;
    anna.once('spielStart', () => {
      annaInZweiPartien = true;
    });
    ziehWeiter(anna);
    await kurzWarten(150);

    const fehler = warteAuf(ben, 'fehler');
    ben.emit('revanche');
    assert.match(await fehler, /nicht mehr möglich/, 'Ben bekommt eine verstaendliche Absage');

    await kurzWarten(200);
    assert.equal(annaInZweiPartien, false, 'Anna wird nicht in eine Revanche gezogen');
  });
}

test('Revanche: hat der Gegner schon zugesagt, erfaehrt er, dass man weiterzieht', async () => {
  const partie = await startePartie();
  const { anna, ben } = partie;
  await spieleZuEnde(partie);

  const benWartet = warteAuf(ben, 'revancheWartet');
  ben.emit('revanche');
  await benWartet;

  const abgesagt = warteAuf(ben, 'revancheGeplatzt');
  anna.emit('warteschlangeBetreten');
  assert.ok(await abgesagt, 'Ben wartet nicht ewig');
});

test('wer nie angemeldet war, kommt weder in die Lobby noch ins Spiel', async () => {
  const fremder = await neuerClient();

  for (const [ereignis, daten] of [
    ['revanche'],
    ['zurLobby'],
    ['warteschlangeBetreten'],
    ['lobbyErstellen', { modus: 'zufall', passwort: 'geheim' }],
    ['lobbyBeitreten', { lobbyId: 'x', passwort: 'geheim' }],
  ]) {
    const fehler = warteAuf(fremder, 'fehler');
    fremder.emit(ereignis, daten);
    assert.match(await fehler, /melde dich zuerst an/, ereignis);
  }
});

// --------------------------------------------------------------------------
// Lobby: Warteschlange und private Lobbys
// --------------------------------------------------------------------------

/** Meldet einen Client an und eröffnet für ihn eine private Lobby. */
async function eroeffneLobby(name, passwort = 'geheim') {
  const client = await neuerClient();
  await anmelden(client, name);
  const erstellt = warteAuf(client, 'lobbyErstellt');
  client.emit('lobbyErstellen', { modus: 'zufall', passwort });
  return { client, info: await erstellt };
}

/** Meldet einen Client an und wartet, bis die Lobby von "name" in seiner Liste steht. */
async function besucherMitBlickAuf(besucherName, erstellerName) {
  const client = await neuerClient();
  const liste = warteAufListe(client, (l) => l.some((e) => e.erstellerName === erstellerName));
  await anmelden(client, besucherName);
  const lobby = (await liste).find((e) => e.erstellerName === erstellerName);
  return { client, lobby };
}

test('wer die Warteschlange verlaesst, steht wieder in der Lobby und wird nicht gepaart', async () => {
  const anna = await neuerClient();
  await anmelden(anna, 'Anna');
  await inWarteschlange(anna);

  const zurueck = warteAuf(anna, 'lobbyBetreten');
  anna.emit('warteschlangeVerlassen');
  await zurueck;

  let annaSpielt = false;
  anna.on('spielStart', () => {
    annaSpielt = true;
  });
  const ben = await neuerClient();
  await anmelden(ben, 'Ben');
  await inWarteschlange(ben); // Ben wartet - statt gegen Anna zu spielen
  assert.equal(annaSpielt, false);
});

test('eine neue private Lobby erscheint sofort bei allen in der Lobby', async () => {
  const jonas = await neuerClient();
  await anmelden(jonas, 'Jonas');

  const neueListe = warteAufListe(jonas, (l) => l.length === 1);
  const { info } = await eroeffneLobby('Lena');
  assert.equal(info.modus, 'zufall');

  const [eintrag] = await neueListe;
  assert.equal(eintrag.erstellerName, 'Lena');
  assert.equal(eintrag.modus, 'zufall');
});

test('die Lobbyliste verraet weder Passwort noch Hash noch Socket-Kennung', async () => {
  const { client: lena } = await eroeffneLobby('Lena', 'streng-geheim');
  const jonas = await neuerClient();
  const liste = warteAufListe(jonas, (l) => l.length === 1);
  await anmelden(jonas, 'Jonas');

  const [eintrag] = await liste;
  assert.deepEqual(Object.keys(eintrag).sort(), ['erstellerName', 'id', 'modus', 'zugzeit']);
  const alsText = JSON.stringify(await liste);
  assert.ok(!alsText.includes('streng-geheim'));
  assert.ok(!alsText.includes(lena.id));
});

test('private Lobby: mit falschem Passwort kommt man nicht hinein', async () => {
  const { client: lena } = await eroeffneLobby('Lena', 'richtig');
  const { client: jonas, lobby } = await besucherMitBlickAuf('Jonas', 'Lena');

  let gestartet = false;
  for (const c of [lena, jonas])
    c.on('spielStart', () => {
      gestartet = true;
    });

  const abgelehnt = warteAuf(jonas, 'beitrittAbgelehnt');
  jonas.emit('lobbyBeitreten', { lobbyId: lobby.id, passwort: 'falsch' });

  assert.deepEqual(await abgelehnt, { grund: 'passwort' });
  await kurzWarten();
  assert.equal(gestartet, false);
});

test('private Lobby: mit richtigem Passwort startet die Partie fuer beide', async () => {
  const { client: lena } = await eroeffneLobby('Lena', 'richtig');
  const { client: jonas, lobby } = await besucherMitBlickAuf('Jonas', 'Lena');

  const startLena = warteAuf(lena, 'spielStart');
  const startJonas = warteAuf(jonas, 'spielStart');
  jonas.emit('lobbyBeitreten', { lobbyId: lobby.id, passwort: 'richtig' });
  const [infoLena, infoJonas] = await Promise.all([startLena, startJonas]);

  assert.equal(infoLena.gegnerName, 'Jonas');
  assert.equal(infoJonas.gegnerName, 'Lena');
  assert.equal(infoLena.modus, 'zufall');
  assert.equal(infoJonas.modus, 'zufall');
  assert.notEqual(infoLena.duBistDran, infoJonas.duBistDran, 'genau einer ist dran');
});

test('eine besetzte Lobby verschwindet aus der Liste der anderen', async () => {
  const { client: lena } = await eroeffneLobby('Lena', 'richtig');
  const { client: jonas, lobby } = await besucherMitBlickAuf('Jonas', 'Lena');
  const { client: aylin } = await besucherMitBlickAuf('Aylin', 'Lena');

  const leer = warteAufListe(aylin, (l) => l.length === 0);
  const start = warteAuf(lena, 'spielStart');
  jonas.emit('lobbyBeitreten', { lobbyId: lobby.id, passwort: 'richtig' });
  await Promise.all([leer, start]);
});

// Das Passwort wird asynchron gehasht - welche Prüfung zuerst fertig ist,
// steht nicht fest. Der Test verlangt deshalb nur: genau EINER kommt rein,
// der andere bekommt "voll".
test('treten zwei gleichzeitig mit richtigem Passwort bei, kommt genau einer rein', async () => {
  await eroeffneLobby('Lena', 'richtig');
  const { client: jonas, lobby } = await besucherMitBlickAuf('Jonas', 'Lena');
  const { client: aylin } = await besucherMitBlickAuf('Aylin', 'Lena');

  /** Was bei diesem Client zuerst ankommt: Spielstart oder Ablehnung. */
  const ausgang = (client) =>
    new Promise((erfuellen) => {
      client.once('spielStart', () => erfuellen('drin'));
      client.once('beitrittAbgelehnt', ({ grund }) => erfuellen(grund));
    });
  const beiJonas = ausgang(jonas);
  const beiAylin = ausgang(aylin);
  jonas.emit('lobbyBeitreten', { lobbyId: lobby.id, passwort: 'richtig' });
  aylin.emit('lobbyBeitreten', { lobbyId: lobby.id, passwort: 'richtig' });

  const ergebnisse = (await Promise.all([beiJonas, beiAylin])).sort();
  assert.deepEqual(ergebnisse, ['drin', 'voll']);
});

test('nach fuenf falschen Passwoertern sperrt der Server - auch das richtige', async () => {
  await eroeffneLobby('Lena', 'richtig');
  const { client: jonas, lobby } = await besucherMitBlickAuf('Jonas', 'Lena');

  const gruende = [];
  for (const passwort of ['f1', 'f2xx', 'f3xx', 'f4xx', 'f5xx', 'richtig']) {
    const antwort = warteAuf(jonas, 'beitrittAbgelehnt');
    jonas.emit('lobbyBeitreten', { lobbyId: lobby.id, passwort });
    gruende.push((await antwort).grund);
  }

  assert.deepEqual(gruende, [
    'passwort',
    'passwort',
    'passwort',
    'passwort',
    'passwort',
    'gesperrt',
  ]);
});

// Neu verbinden darf die Sperre nicht aufheben. Alle Test-Clients
// kommen von derselben Adresse (localhost) - genau wie ein neu geladener Tab.
test('die Sperre bleibt, auch wenn man die Verbindung trennt und neu verbindet', async () => {
  await eroeffneLobby('Lena', 'richtig');
  const { client: jonas, lobby } = await besucherMitBlickAuf('Jonas', 'Lena');

  for (const passwort of ['f1xx', 'f2xx', 'f3xx', 'f4xx', 'f5xx']) {
    const antwort = warteAuf(jonas, 'beitrittAbgelehnt');
    jonas.emit('lobbyBeitreten', { lobbyId: lobby.id, passwort });
    await antwort;
  }
  jonas.disconnect();

  const { client: jonasNeu } = await besucherMitBlickAuf('Jonas', 'Lena');
  const antwort = warteAuf(jonasNeu, 'beitrittAbgelehnt');
  jonasNeu.emit('lobbyBeitreten', { lobbyId: lobby.id, passwort: 'richtig' });
  assert.deepEqual(await antwort, { grund: 'gesperrt' });
});

// Alle Test-Clients kommen von localhost - wie 50 Tabs eines
// Angreifers. Die vierte offene Lobby von dort wird abgelehnt.
test('hoechstens drei offene Lobbys von derselben Adresse', async () => {
  for (const name of ['Tab1', 'Tab2', 'Tab3']) await eroeffneLobby(name);

  const vierter = await neuerClient();
  await anmelden(vierter, 'Tab4');
  const abgelehnt = warteAuf(vierter, 'erstellenAbgelehnt');
  vierter.emit('lobbyErstellen', { modus: 'zufall', passwort: 'geheim' });
  assert.deepEqual(await abgelehnt, { grund: 'zuVieleVonDir' });
});

// Hinter Caddy (HTTPS auf dem DHBW-Server) kommen alle Verbindungen von
// 127.0.0.1. Die echte Adresse steht in X-Forwarded-For - sonst teilte sich
// der ganze Kurs die Grenze von 3 Lobbys.
test('hinter dem Proxy zaehlt die weitergeleitete Adresse, nicht 127.0.0.1', async () => {
  async function lobbyVon(name, weitergeleitet) {
    const client = await neuerClient(adresse, { 'x-forwarded-for': weitergeleitet });
    await anmelden(client, name);
    const antwort = new Promise((erfuellen) => {
      client.once('lobbyErstellt', () => erfuellen('erstellt'));
      client.once('erstellenAbgelehnt', ({ grund }) => erfuellen(grund));
    });
    client.emit('lobbyErstellen', { modus: 'zufall', passwort: 'geheim' });
    return antwort;
  }

  for (const name of ['Lea', 'Max', 'Ida']) {
    assert.equal(await lobbyVon(name, '2001:db8::a'), 'erstellt');
  }
  assert.equal(
    await lobbyVon('Tom', '2001:db8::a'),
    'zuVieleVonDir',
    'vierte Lobby derselben Person',
  );
  assert.equal(
    await lobbyVon('Eva', '2001:db8::b'),
    'erstellt',
    'eine andere Person hinter demselben Proxy',
  );
});

test('einer Lobby, die es nicht gibt, kann man nicht beitreten', async () => {
  const jonas = await neuerClient();
  await anmelden(jonas, 'Jonas');

  const abgelehnt = warteAuf(jonas, 'beitrittAbgelehnt');
  jonas.emit('lobbyBeitreten', { lobbyId: 'gibt-es-nicht', passwort: 'geheim' });
  assert.deepEqual(await abgelehnt, { grund: 'weg' });
});

test('trennt sich der Ersteller, verschwindet seine Lobby bei allen', async () => {
  const { client: lena } = await eroeffneLobby('Lena');
  const { client: jonas } = await besucherMitBlickAuf('Jonas', 'Lena');

  const leer = warteAufListe(jonas, (l) => l.length === 0);
  lena.disconnect();
  await leer;
  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
});

test('wer seine Lobby schliesst, steht wieder in der Lobby - und sie ist weg', async () => {
  const { client: lena } = await eroeffneLobby('Lena');
  const { client: jonas } = await besucherMitBlickAuf('Jonas', 'Lena');

  const leerBeiJonas = warteAufListe(jonas, (l) => l.length === 0);
  const zurueck = warteAuf(lena, 'lobbyBetreten');
  lena.emit('lobbySchliessen');
  await Promise.all([zurueck, leerBeiJonas]);
});

test('die eigene wartende Lobby steht nicht in der eigenen Liste', async () => {
  const { client: lena } = await eroeffneLobby('Lena');
  const listenBeiLena = [];
  lena.on('lobbyListe', (l) => listenBeiLena.push(l));

  await eroeffneLobby('Ben'); // eine Änderung, die alle in der Lobby erfahren
  await kurzWarten();

  assert.equal(listenBeiLena.length, 0, 'wer in seiner Lobby wartet, ist nicht im Raum "lobby"');
});

test('ungueltige Lobbys werden abgelehnt: Passwort, Modus, Unsinn', async () => {
  const lena = await neuerClient();
  await anmelden(lena, 'Lena');

  for (const [daten, grund] of [
    [{ modus: 'zufall', passwort: 'abc' }, 'passwort'],
    [{ modus: 'zufall', passwort: 'x'.repeat(33) }, 'passwort'],
    [{ modus: 'schach', passwort: 'geheim' }, 'modus'],
    [null, 'modus'],
    ['Quatsch', 'modus'],
  ]) {
    const abgelehnt = warteAuf(lena, 'erstellenAbgelehnt');
    lena.emit('lobbyErstellen', daten);
    assert.deepEqual(await abgelehnt, { grund }, JSON.stringify(daten));
  }
});

test('niemand kann an zwei Orten zugleich warten', async () => {
  const anna = await neuerClient();
  await anmelden(anna, 'Anna');
  await inWarteschlange(anna);

  const fehler = warteAuf(anna, 'fehler');
  anna.emit('lobbyErstellen', { modus: 'zufall', passwort: 'geheim' });
  assert.match(await fehler, /Warteschlange/);

  const { client: lena } = await eroeffneLobby('Lena');
  const fehlerLena = warteAuf(lena, 'fehler');
  lena.emit('warteschlangeBetreten');
  assert.match(await fehlerLena, /eigene Lobby/);
});

test('kaputte Lobby-Nutzlasten bringen den Server nicht zum Absturz', async () => {
  const client = await neuerClient();
  await anmelden(client, 'Kaputt');

  for (const daten of [
    undefined,
    null,
    42,
    'text',
    [],
    { lobbyId: { x: 1 } },
    { passwort: ['a'] },
  ]) {
    client.emit('lobbyBeitreten', daten);
    client.emit('lobbyErstellen', daten);
    await kurzWarten(120);
  }
  assert.equal(serverProzess.exitCode, null, 'der Server laeuft weiter');
  assert.equal(client.connected, true);
});

test('nach einer Lobby-Partie gibt es die Lobby nicht mehr - Revanche geht trotzdem', async () => {
  const { client: lena } = await eroeffneLobby('Lena', 'richtig');
  const { client: jonas, lobby } = await besucherMitBlickAuf('Jonas', 'Lena');

  const startLena = warteAuf(lena, 'spielStart');
  jonas.emit('lobbyBeitreten', { lobbyId: lobby.id, passwort: 'richtig' });
  const infoLena = await startLena;

  const amZug = infoLena.duBistDran ? lena : jonas;
  await spieleZuEnde({ anna: lena, ben: jonas, amZug });

  // Die Lobby ist mit dem Spielende verschwunden: Lena darf sofort eine neue eröffnen.
  const revanche = warteAuf(lena, 'spielStart');
  jonas.emit('revanche');
  lena.emit('revanche');
  assert.equal((await revanche).modus, 'zufall', 'die Revanche spielt im selben Modus');
});

// --------------------------------------------------------------------------
// Modus Duell
// --------------------------------------------------------------------------

/** Startet eine Duell-Lobby zwischen Lena (Erstellerin) und Jonas. */
async function starteDuell() {
  const lena = await neuerClient();
  await anmelden(lena, 'Lena');
  const erstellt = warteAuf(lena, 'lobbyErstellt');
  lena.emit('lobbyErstellen', { modus: 'duell', passwort: 'geheim' });
  assert.equal((await erstellt).modus, 'duell');

  const { client: jonas, lobby } = await besucherMitBlickAuf('Jonas', 'Lena');
  assert.equal(lobby.modus, 'duell');

  const startLena = warteAuf(lena, 'spielStart');
  const startJonas = warteAuf(jonas, 'spielStart');
  jonas.emit('lobbyBeitreten', { lobbyId: lobby.id, passwort: 'geheim' });
  const [infoLena, infoJonas] = await Promise.all([startLena, startJonas]);
  assert.equal(infoLena.modus, 'duell');
  assert.equal(infoJonas.modus, 'duell');
  return { lena, jonas };
}

/** Beide wählen, liefert die Info aus "duellStart" für beide. */
async function waehleBeide(lena, jonas, fuerJonas, fuerLena) {
  const startLena = warteAuf(lena, 'duellStart');
  const startJonas = warteAuf(jonas, 'duellStart');
  lena.emit('tierWaehlen', fuerJonas);
  await warteAuf(lena, 'tierGewaehlt');
  jonas.emit('tierWaehlen', fuerLena);
  const [infoLena, infoJonas] = await Promise.all([startLena, startJonas]);
  return { infoLena, infoJonas };
}

test('Duell: eine Lobby im Modus Duell startet eine Duell-Partie', async () => {
  await starteDuell();
});

test('Duell: vor der Wahl darf niemand raten', async () => {
  const { lena } = await starteDuell();
  const fehler = warteAuf(lena, 'fehler');
  lena.emit('raten', alleTiere[0].name);
  assert.match(await fehler, /Wählt zuerst/);
});

test('Duell: erfundene Tiere und doppeltes Waehlen werden abgelehnt', async () => {
  const { lena } = await starteDuell();

  const erfunden = warteAuf(lena, 'fehler');
  lena.emit('tierWaehlen', 'Einhorn');
  assert.match(await erfunden, /kenne ich nicht/);

  lena.emit('tierWaehlen', alleTiere[0].name);
  await warteAuf(lena, 'tierGewaehlt');
  const doppelt = warteAuf(lena, 'fehler');
  lena.emit('tierWaehlen', alleTiere[1].name);
  assert.match(await doppelt, /schon gewählt/);
});

test('Duell: der Gegner erfaehrt nur, DASS gewaehlt wurde - nicht was', async () => {
  const { lena, jonas } = await starteDuell();
  const geheim = alleTiere[5].name;

  const nachrichtenJonas = [];
  jonas.onAny((ereignis, ...daten) => nachrichtenJonas.push([ereignis, daten]));

  const hinweis = warteAuf(jonas, 'gegnerHatGewaehlt');
  lena.emit('tierWaehlen', geheim);
  assert.equal(await hinweis, undefined, 'keine Nutzdaten');
  await kurzWarten();

  assert.ok(
    !JSON.stringify(nachrichtenJonas).includes(geheim),
    'Lenas Wahl bleibt bei Jonas geheim',
  );
});

test('Duell: jeder raet auf das Tier, das der andere fuer ihn gewaehlt hat', async () => {
  const { lena, jonas } = await starteDuell();
  const fuerJonas = alleTiere[3].name;
  const fuerLena = alleTiere[7].name;
  const { infoLena, infoJonas } = await waehleBeide(lena, jonas, fuerJonas, fuerLena);
  assert.notEqual(infoLena.duBistDran, infoJonas.duBistDran, 'genau einer faengt an');

  let [dran, andere] = infoLena.duBistDran ? [lena, jonas] : [jonas, lena];
  // Wer dran ist, rät zuerst das Tier des ANDEREN - das ist für ihn falsch.
  const tierDesAnderen = dran === lena ? fuerJonas : fuerLena;
  const ersterZug = warteAuf(dran, 'zug');
  dran.emit('raten', tierDesAnderen);
  assert.equal((await ersterZug).richtig, false, 'das Tier des Gegners ist nicht das eigene');
  [dran, andere] = [andere, dran];

  // Jetzt rät der andere sein eigenes Tier - und gewinnt.
  const eigenesTier = dran === lena ? fuerLena : fuerJonas;
  const endeDran = warteAuf(dran, 'spielEnde');
  const endeAndere = warteAuf(andere, 'spielEnde');
  dran.emit('raten', eigenesTier);
  const [beimGewinner, beimVerlierer] = await Promise.all([endeDran, endeAndere]);

  assert.equal(beimGewinner.duHastGewonnen, true);
  assert.equal(beimGewinner.geheimnis.name, eigenesTier);
  assert.equal(beimVerlierer.duHastGewonnen, false);
  assert.equal(
    beimVerlierer.geheimnis.name,
    andere === lena ? fuerLena : fuerJonas,
    'der Verlierer erfaehrt das Tier, das ER gesucht hat',
  );
});

test('Duell: ein Tier, das der Gegner geraten hat, darf man selbst noch raten', async () => {
  const { lena, jonas } = await starteDuell();
  const fuerJonas = alleTiere[3].name;
  const fuerLena = alleTiere[7].name;
  const { infoLena } = await waehleBeide(lena, jonas, fuerJonas, fuerLena);

  const [dran, andere] = infoLena.duBistDran ? [lena, jonas] : [jonas, lena];
  const tierDesAnderen = andere === lena ? fuerLena : fuerJonas;

  // Der Erste rät ausgerechnet das Tier, das der Zweite sucht.
  const zug = warteAuf(andere, 'zug');
  dran.emit('raten', tierDesAnderen);
  await zug;

  const ende = warteAuf(andere, 'spielEnde');
  andere.emit('raten', tierDesAnderen);
  assert.equal((await ende).duHastGewonnen, true);
});

test('Duell: verschwindet der Gegner waehrend der Wahl, kein Absturz', async () => {
  const { lena, jonas } = await starteDuell();
  const weg = warteAuf(lena, 'gegnerWeg');
  jonas.disconnect();
  const daten = await weg;
  assert.equal(daten.geheimnis, undefined, 'noch nichts gewaehlt - nichts zu verraten');
  assert.equal(serverProzess.exitCode, null);
});

test('Duell: eine Revanche beginnt wieder mit der Wahl', async () => {
  const { lena, jonas } = await starteDuell();
  const fuerJonas = alleTiere[3].name;
  const fuerLena = alleTiere[7].name;
  const { infoLena } = await waehleBeide(lena, jonas, fuerJonas, fuerLena);
  const dran = infoLena.duBistDran ? lena : jonas;
  const ende = warteAuf(dran, 'spielEnde');
  dran.emit('raten', dran === lena ? fuerLena : fuerJonas);
  await ende;

  const revanche = warteAuf(lena, 'spielStart');
  jonas.emit('revanche');
  lena.emit('revanche');
  assert.equal((await revanche).modus, 'duell');

  const fehler = warteAuf(lena, 'fehler');
  lena.emit('raten', alleTiere[0].name);
  assert.match(await fehler, /Wählt zuerst/, 'erst wieder waehlen');
});

// --------------------------------------------------------------------------
// Öffentliche Warteschlange mit Moduswahl
// --------------------------------------------------------------------------

test('Warteschlange: zwei Spieler mit Duell spielen ein Duell', async () => {
  const anna = await neuerClient();
  const ben = await neuerClient();
  await anmelden(anna, 'Anna');
  await anmelden(ben, 'Ben');

  const wartet = warteAuf(anna, 'warten');
  anna.emit('warteschlangeBetreten', { modus: 'duell' });
  assert.deepEqual(await wartet, { modus: 'duell', zugzeit: 10 });

  const startAnna = warteAuf(anna, 'spielStart');
  const startBen = warteAuf(ben, 'spielStart');
  ben.emit('warteschlangeBetreten', { modus: 'duell' });
  const [infoAnna, infoBen] = await Promise.all([startAnna, startBen]);
  assert.equal(infoAnna.modus, 'duell');
  assert.equal(infoBen.modus, 'duell');

  const fehler = warteAuf(anna, 'fehler');
  anna.emit('raten', alleTiere[0].name);
  assert.match(await fehler, /Wählt zuerst/, 'auch oeffentlich beginnt das Duell mit der Wahl');
});

test('Warteschlange: Zufallstier und Duell werden nicht miteinander gepaart', async () => {
  const anna = await neuerClient();
  const ben = await neuerClient();
  await anmelden(anna, 'Anna');
  await anmelden(ben, 'Ben');
  let gestartet = false;
  for (const c of [anna, ben])
    c.on('spielStart', () => {
      gestartet = true;
    });

  const wartetAnna = warteAuf(anna, 'warten');
  anna.emit('warteschlangeBetreten', { modus: 'zufall' });
  assert.deepEqual(await wartetAnna, { modus: 'zufall', zugzeit: 10 });

  const wartetBen = warteAuf(ben, 'warten');
  ben.emit('warteschlangeBetreten', { modus: 'duell' });
  assert.deepEqual(await wartetBen, { modus: 'duell', zugzeit: 10 });

  await kurzWarten();
  assert.equal(gestartet, false, 'verschiedene Modi warten getrennt');
});

test('Warteschlange: ein unbekannter Modus wird abgelehnt', async () => {
  const anna = await neuerClient();
  await anmelden(anna, 'Anna');

  for (const modus of ['schach', 42, '']) {
    const fehler = warteAuf(anna, 'fehler');
    anna.emit('warteschlangeBetreten', { modus });
    assert.match(await fehler, /Modus/, String(modus));
  }
});

// --------------------------------------------------------------------------
// Zugzeit
// --------------------------------------------------------------------------
//
// Für die meisten Zugzeit-Tests läuft ein ZWEITER Server, dessen Uhr
// schneller geht: ZUGZEIT_MS_PRO_SEKUNDE=50 macht aus 10 Sekunden 0,5
// Sekunden. Der normale Testserver bleibt unverändert - sonst liefe in
// jedem anderen Test nach einer halben Sekunde die Zeit ab.

const MS_PRO_SEKUNDE_SCHNELL = 50;

/** Startet den schnellen Server einmal für alle Zugzeit-Tests. */
let schnellerServer;
async function schnelleAdresse() {
  if (schnellerServer) return schnellerServer.adresse;
  const port = await freierPort();
  const prozess = spawn('node', ['server/server.js', String(port)], {
    cwd: WURZEL,
    env: { ...process.env, ZUGZEIT_MS_PRO_SEKUNDE: String(MS_PRO_SEKUNDE_SCHNELL) },
  });
  await new Promise((erfuellen, ablehnen) => {
    const uhr = setTimeout(() => ablehnen(new Error('Schneller Server startet nicht.')), ZEITLIMIT);
    let log = '';
    prozess.stdout.on('data', (brocken) => {
      log += brocken.toString();
      if (log.includes('Zoodle laeuft')) {
        clearTimeout(uhr);
        erfuellen();
      }
    });
  });
  schnellerServer = { prozess, adresse: `http://localhost:${port}` };
  return schnellerServer.adresse;
}
after(() => schnellerServer?.prozess.kill('SIGKILL'));

/** Öffentliche Partie auf dem schnellen Server. */
async function schnellePartie() {
  const ziel = await schnelleAdresse();
  const anna = await neuerClient(ziel);
  const ben = await neuerClient(ziel);
  await anmelden(anna, 'Anna');
  await anmelden(ben, 'Ben');
  await inWarteschlange(anna);
  const startAnna = warteAuf(anna, 'spielStart');
  const startBen = warteAuf(ben, 'spielStart');
  ben.emit('warteschlangeBetreten');
  const [infoAnna] = await Promise.all([startAnna, startBen]);
  return {
    anna,
    ben,
    infoAnna,
    amZug: infoAnna.duBistDran ? anna : ben,
    wartend: infoAnna.duBistDran ? ben : anna,
  };
}

/** Private Lobby mit Zugzeit auf einem Server (Standard: dem schnellen). */
async function lobbyPartie({ zugzeit, modus = 'zufall', ziel }) {
  ziel ??= await schnelleAdresse();
  const lena = await neuerClient(ziel);
  await anmelden(lena, 'Lena');
  const erstellt = warteAuf(lena, 'lobbyErstellt');
  lena.emit('lobbyErstellen', { modus, passwort: 'geheim', zugzeit });
  const infoErstellt = await erstellt;

  const jonas = await neuerClient(ziel);
  const liste = warteAufListe(jonas, (l) => l.some((e) => e.erstellerName === 'Lena'));
  await anmelden(jonas, 'Jonas');
  const lobby = (await liste).find((e) => e.erstellerName === 'Lena');

  const startLena = warteAuf(lena, 'spielStart');
  const startJonas = warteAuf(jonas, 'spielStart');
  jonas.emit('lobbyBeitreten', { lobbyId: lobby.id, passwort: 'geheim' });
  const [infoLena] = await Promise.all([startLena, startJonas]);
  return { lena, jonas, infoLena, infoErstellt, lobby };
}

test('Zugzeit: oeffentlich gelten 10 Sekunden, spielStart nennt die Restzeit', async () => {
  const { modus } = await startePartie();
  assert.equal(modus, 'zufall');
  // startePartie liefert nur die Kurzform - hier die volle Nachricht:
  const anna = await neuerClient();
  const ben = await neuerClient();
  await anmelden(anna, 'A');
  await anmelden(ben, 'B');
  await inWarteschlange(anna);
  const start = warteAuf(anna, 'spielStart');
  ben.emit('warteschlangeBetreten');
  const info = await start;

  assert.equal(info.zugzeit, 10);
  assert.ok(info.restzeitMs > 9000 && info.restzeitMs <= 10000, `restzeitMs ${info.restzeitMs}`);
  assert.ok(!('ende' in info) && !('frist' in info), 'nur die Restzeit, keine Uhrzeit');
});

test('Zugzeit: laeuft die Zeit ab, ist der Gegner dran - beide erfahren es', async () => {
  const { amZug, wartend } = await schnellePartie();

  const [beimSaeumigen, beimGegner] = await Promise.all([
    warteAuf(amZug, 'zeitAbgelaufen'),
    warteAuf(wartend, 'zeitAbgelaufen'),
  ]);
  assert.equal(beimSaeumigen.duBistDran, false);
  assert.equal(beimGegner.duBistDran, true);
  assert.ok(beimGegner.restzeitMs > 0, 'die Frist des Gegners laeuft schon');

  // Wer seine Zeit verpasst hat, darf jetzt nicht mehr raten.
  const fehler = warteAuf(amZug, 'fehler');
  amZug.emit('raten', alleTiere[0].name);
  assert.match(await fehler, /nicht am Zug/);
});

test('Zugzeit: ein rechtzeitiger Tipp zaehlt und startet die Frist des Gegners', async () => {
  const { amZug, wartend } = await schnellePartie();
  const zug = warteAuf(wartend, 'zug');
  amZug.emit('raten', alleTiere[0].name);
  const daten = await zug;

  assert.equal(daten.duBistDran, true);
  assert.ok(
    daten.restzeitMs > 0 && daten.restzeitMs <= 10 * MS_PRO_SEKUNDE_SCHNELL,
    `restzeitMs ${daten.restzeitMs}`,
  );
});

test('Zugzeit: private Lobby mit 30 Sekunden - Liste, Partie und Revanche', async () => {
  const { lena, jonas, infoLena, infoErstellt, lobby } = await lobbyPartie({
    zugzeit: 30,
    ziel: adresse,
  });
  assert.equal(infoErstellt.zugzeit, 30);
  assert.equal(lobby.zugzeit, 30, 'die Liste nennt die Zugzeit');
  assert.equal(infoLena.zugzeit, 30);

  // Zu Ende spielen und Revanche: die Zugzeit bleibt.
  const loesung = gesuchtesTier();
  const dran = infoLena.duBistDran ? lena : jonas;
  const ende = warteAuf(dran, 'spielEnde');
  dran.emit('raten', loesung);
  await ende;
  const revanche = warteAuf(lena, 'spielStart');
  jonas.emit('revanche');
  lena.emit('revanche');
  assert.equal((await revanche).zugzeit, 30, 'die Revanche uebernimmt die Zugzeit');
});

test('Zugzeit: ohne Zeitlimit laeuft keine Uhr', async () => {
  const { lena, jonas, infoLena } = await lobbyPartie({ zugzeit: 0 });
  assert.equal(infoLena.zugzeit, 0);
  assert.equal(infoLena.restzeitMs, null);

  let abgelaufen = false;
  for (const c of [lena, jonas])
    c.on('zeitAbgelaufen', () => {
      abgelaufen = true;
    });
  await kurzWarten(15 * MS_PRO_SEKUNDE_SCHNELL); // länger als 10 "Sekunden"
  assert.equal(abgelaufen, false);
});

test('Zugzeit: ungueltige Werte werden abgelehnt', async () => {
  const lena = await neuerClient();
  await anmelden(lena, 'Lena');
  for (const zugzeit of [5, 15, -10, '10', null, 3600]) {
    const abgelehnt = warteAuf(lena, 'erstellenAbgelehnt');
    lena.emit('lobbyErstellen', { modus: 'zufall', passwort: 'geheim', zugzeit });
    assert.deepEqual(await abgelehnt, { grund: 'zugzeit' }, String(zugzeit));
  }
});

test('Zugzeit: im Duell laeuft waehrend der Wahl die Wahlfrist, nicht die Zugzeit', async () => {
  const { lena, jonas, infoLena } = await lobbyPartie({ zugzeit: 10, modus: 'duell' });
  assert.equal(infoLena.wahlzeit, 60);
  assert.ok(
    infoLena.restzeitMs > 10 * MS_PRO_SEKUNDE_SCHNELL,
    'die Wahlfrist ist laenger als ein Zug',
  );

  let abgelaufen = false;
  for (const c of [lena, jonas])
    c.on('zeitAbgelaufen', () => {
      abgelaufen = true;
    });
  await kurzWarten(15 * MS_PRO_SEKUNDE_SCHNELL);
  assert.equal(abgelaufen, false, 'waehrend der Wahl gibt es keinen Zugwechsel');

  const duellStart = warteAuf(lena, 'duellStart');
  lena.emit('tierWaehlen', alleTiere[0].name);
  await warteAuf(lena, 'tierGewaehlt');
  jonas.emit('tierWaehlen', alleTiere[1].name);
  assert.ok((await duellStart).restzeitMs > 0, 'nach der Wahl beginnt die Frist');
});

// Die Wahlfrist (60 "Sekunden", auf dem schnellen Server 3 s).
const WAHLFRIST_TESTLIMIT = 70 * MS_PRO_SEKUNDE_SCHNELL;

test('Wahlfrist: wer gewaehlt hat, gewinnt - wer nicht gewaehlt hat, verliert', async () => {
  const { lena, jonas } = await lobbyPartie({ zugzeit: 10, modus: 'duell' });

  lena.emit('tierWaehlen', alleTiere[0].name);
  const { restzeitMs } = await warteAuf(lena, 'tierGewaehlt');
  assert.ok(restzeitMs > 0, 'nach der eigenen Wahl zeigt die Uhr die Zeit des Gegners');

  const [beiLena, beiJonas] = await Promise.all([
    warteAuf(lena, 'wahlAbgelaufen', WAHLFRIST_TESTLIMIT),
    warteAuf(jonas, 'wahlAbgelaufen', WAHLFRIST_TESTLIMIT),
  ]);
  assert.equal(beiLena.duHastGewonnen, true);
  assert.equal(beiJonas.duHastGewonnen, false);

  // Die Partie ist wirklich vorbei: Wählen geht nicht mehr.
  const fehler = warteAuf(jonas, 'fehler');
  jonas.emit('tierWaehlen', alleTiere[1].name);
  assert.match(await fehler, /kein Tier zu wählen/);
});

test('Wahlfrist: hat keiner gewaehlt, gibt es keinen Sieger', async () => {
  const { lena, jonas } = await lobbyPartie({ zugzeit: 10, modus: 'duell' });
  const [beiLena, beiJonas] = await Promise.all([
    warteAuf(lena, 'wahlAbgelaufen', WAHLFRIST_TESTLIMIT),
    warteAuf(jonas, 'wahlAbgelaufen', WAHLFRIST_TESTLIMIT),
  ]);
  assert.equal(beiLena.duHastGewonnen, null);
  assert.equal(beiJonas.duHastGewonnen, null);
});

test('Wahlfrist: ohne Zeitlimit gibt es auch keine Wahlfrist', async () => {
  const { lena, jonas, infoLena } = await lobbyPartie({ zugzeit: 0, modus: 'duell' });
  assert.equal(infoLena.restzeitMs, null);

  let abgelaufen = false;
  for (const c of [lena, jonas])
    c.on('wahlAbgelaufen', () => {
      abgelaufen = true;
    });
  await kurzWarten(WAHLFRIST_TESTLIMIT);
  assert.equal(abgelaufen, false);
});

test('aufgeben: der Gegner erfaehrt es, wer geht, steht wieder in der Lobby', async () => {
  const { lena, jonas } = await lobbyPartie({ zugzeit: 10, modus: 'duell' });

  const weg = warteAuf(jonas, 'gegnerWeg');
  const inLobby = warteAuf(lena, 'lobbyBetreten');
  lena.emit('aufgeben');
  const [daten] = await Promise.all([weg, inLobby]);
  assert.equal(daten.aufgegeben, true, 'Jonas liest "verlassen", nicht "Verbindung verloren"');

  // Keine Wahlfrist mehr für die beendete Partie.
  let abgelaufen = false;
  jonas.on('wahlAbgelaufen', () => {
    abgelaufen = true;
  });
  await kurzWarten(WAHLFRIST_TESTLIMIT);
  assert.equal(abgelaufen, false);

  // Und keine Revanche mit jemandem, der gerade gegangen ist.
  const fehler = warteAuf(jonas, 'fehler');
  jonas.emit('revanche');
  assert.match(await fehler, /nicht mehr möglich/);
});

// In einer Lobby ohne Zeitlimit kann der Gegner ewig nicht
// raten. Aufgeben muss deshalb auch in der Ratephase gehen.
test('aufgeben: auch mitten im Raten ohne Zeitlimit', async () => {
  const { lena, jonas } = await lobbyPartie({ zugzeit: 0, ziel: adresse });
  const weg = warteAuf(lena, 'gegnerWeg');
  const inLobby = warteAuf(jonas, 'lobbyBetreten');
  jonas.emit('aufgeben');
  const [daten] = await Promise.all([weg, inLobby]);
  assert.equal(daten.aufgegeben, true);
  assert.equal(daten.geheimnis.name, gesuchtesTier(), 'wer bleibt, erfaehrt die Loesung');
});

test('aufgeben: wer in keiner Partie ist, kann auch keine beenden', async () => {
  const client = await neuerClient();
  await anmelden(client, 'Niemand');
  const fehler = warteAuf(client, 'fehler');
  client.emit('aufgeben');
  assert.match(await fehler, /keiner laufenden Partie/);
});

test('Zugzeit: trennt sich ein Spieler, laeuft keine Frist mehr ab', async () => {
  const { amZug, wartend } = await schnellePartie();
  let abgelaufen = false;
  wartend.on('zeitAbgelaufen', () => {
    abgelaufen = true;
  });

  const weg = warteAuf(wartend, 'gegnerWeg');
  amZug.disconnect();
  await weg;
  await kurzWarten(15 * MS_PRO_SEKUNDE_SCHNELL);
  assert.equal(abgelaufen, false, 'die Uhr der beendeten Partie ist weggeraeumt');
  assert.equal(schnellerServer.prozess.exitCode, null, 'der Server laeuft weiter');
});

// --------------------------------------------------------------------------
// Duell: "tippt" und anzahlTipps
// --------------------------------------------------------------------------

/** Duell bis zur Ratephase; liefert, wer dran ist. */
async function duellInRatephase() {
  const { lena, jonas } = await starteDuell();
  const { infoLena } = await waehleBeide(lena, jonas, alleTiere[3].name, alleTiere[7].name);
  return {
    lena,
    jonas,
    dran: infoLena.duBistDran ? lena : jonas,
    wartend: infoLena.duBistDran ? jonas : lena,
    zielVon: (c) => (c === lena ? alleTiere[7].name : alleTiere[3].name),
  };
}

/** Sammelt "gegnerTippt" mit allen mitgeschickten Daten. */
function sammleTippen(client) {
  const signale = [];
  client.on('gegnerTippt', (...daten) => signale.push(daten));
  return signale;
}

test('tippt: wird weitergeleitet, wenn der Sender im Duell am Zug ist - ohne Daten', async () => {
  const { dran, wartend } = await duellInRatephase();
  const signal = warteAuf(wartend, 'gegnerTippt');
  dran.emit('tippt', 'Löwe'); // ein manipulierter Client schickt Text mit
  assert.equal(await signal, undefined, 'der Text kommt nie beim Gegner an');
});

test('tippt: wird NICHT weitergeleitet, wenn der Sender nicht am Zug ist', async () => {
  const { dran, wartend } = await duellInRatephase();
  const beimDran = sammleTippen(dran);
  wartend.emit('tippt');
  await kurzWarten();
  assert.equal(beimDran.length, 0);
});

test('tippt: wird NICHT weitergeleitet in der Wahlphase', async () => {
  const { lena, jonas } = await starteDuell();
  const beiJonas = sammleTippen(jonas);
  const beiLena = sammleTippen(lena);
  lena.emit('tippt');
  jonas.emit('tippt');
  await kurzWarten();
  assert.equal(beiJonas.length + beiLena.length, 0);
});

test('tippt: wird NICHT weitergeleitet im Modus Zufallstier', async () => {
  const { amZug, wartend } = await startePartie();
  const signale = sammleTippen(wartend);
  amZug.emit('tippt');
  await kurzWarten();
  assert.equal(signale.length, 0);
});

test('tippt: hoechstens eine Weiterleitung pro Sekunde', async () => {
  const { dran, wartend } = await duellInRatephase();
  const signale = sammleTippen(wartend);
  for (let i = 0; i < 5; i++) {
    dran.emit('tippt');
    await kurzWarten(100); // langsam genug für die Nachrichtenbremse
  }
  assert.equal(signale.length, 1, '5 Signale in einer halben Sekunde -> 1 Weiterleitung');

  await kurzWarten(700);
  dran.emit('tippt');
  await kurzWarten(150);
  assert.equal(signale.length, 2, 'nach einer Sekunde wieder eins');
});

test('anzahlTipps: im Duell zaehlen nur die Tipps des Gewinners', async () => {
  const { dran, wartend, zielVon } = await duellInRatephase();

  // dran: falsch (1) · wartend: falsch (1) · dran: richtig (2)
  let zug = warteAuf(wartend, 'zug');
  dran.emit(
    'raten',
    alleTiere[20].name === zielVon(dran) ? alleTiere[21].name : alleTiere[20].name,
  );
  await zug;
  zug = warteAuf(dran, 'zug');
  wartend.emit(
    'raten',
    alleTiere[22].name === zielVon(wartend) ? alleTiere[23].name : alleTiere[22].name,
  );
  await zug;

  const ende = warteAuf(dran, 'spielEnde');
  const endeVerlierer = warteAuf(wartend, 'spielEnde');
  dran.emit('raten', zielVon(dran));
  assert.equal((await ende).anzahlTipps, 2, 'der Gewinner brauchte 2 Tipps - nicht 3');
  assert.equal(
    (await endeVerlierer).anzahlTipps,
    2,
    'auch der Verlierer bekommt die Zahl des Gewinners',
  );
});
