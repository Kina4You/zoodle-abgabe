/**
 * Zoodle - Serveranwendung
 * ========================
 *
 * Diese Datei verdrahtet nur: Sie nimmt Nachrichten entgegen, fragt die
 * zuständigen Module und schickt Antworten zurück. Die Spielregeln stehen
 * in spiel.js, die Partieverwaltung in partien.js, die privaten Lobbys in
 * lobbys.js.
 *
 * Starten:
 *   npm start                 Port 3000
 *   npm start -- 8080         Port als Argument
 *   PORT=8080 npm start       Port als Umgebungsvariable
 */

import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { Server as SocketIoServer } from 'socket.io';

import { SUCH_TIERE, findeTier } from './tierdaten.js';
import { KATEGORIEN } from './spiel.js';
import { Partienverwaltung } from './partien.js';
import { Lobbyverwaltung, SPIELBARE_MODI } from './lobbys.js';
import { Zuguhren, STANDARD_ZUGZEIT, WAHLZEIT_SEKUNDEN } from './zugzeit.js';
import { echteAdresse } from './adresse.js';
import { bereinigeName } from './namen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OEFFENTLICH = path.join(__dirname, '..', 'public');

const STANDARD_PORT = 3000;

/** Wie viele Nachrichten ein Spieler pro Sekunde senden darf. */
const MAX_NACHRICHTEN_PRO_SEKUNDE = 10;

/** Ab wie vielen Nachrichten pro Sekunde die Verbindung getrennt wird. */
const KAPPUNGSGRENZE = 50;

// --------------------------------------------------------------------------
// Port bestimmen
// --------------------------------------------------------------------------

/**
 * Liest den Port aus Kommandozeile oder Umgebungsvariable.
 * Ungültige Angaben führen nicht zum Absturz, sondern zum Standardwert.
 */
function ermittlePort() {
  const angabe = process.argv[2] ?? process.env.PORT;
  if (angabe === undefined) return STANDARD_PORT;

  const port = Number(angabe);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(`[!] "${angabe}" ist kein gueltiger Port. Nutze ${STANDARD_PORT}.`);
    return STANDARD_PORT;
  }
  return port;
}

const PORT = ermittlePort();

// --------------------------------------------------------------------------
// HTTP-Server
// --------------------------------------------------------------------------

const app = express();
const httpServer = createServer(app);
const io = new SocketIoServer(httpServer, {
  // Unsere größte Client-Nachricht ist ein Tiername. 8 KB sind reichlich -
  // die Voreinstellung von 1 MB wäre eine unnötig große Angriffsfläche.
  maxHttpBufferSize: 8 * 1024,
});

// "X-Powered-By: Express" verriete jedem, welche Software hier läuft.
app.disable('x-powered-by');

/**
 * Sicherheits-Kopfzeilen für jede Antwort - ohne Zusatzpaket, es sind nur drei.
 *
 * Die Content-Security-Policy erlaubt nur Dateien vom eigenen Server: Selbst
 * wenn es jemand schaffte, HTML einzuschleusen, liefe kein fremdes Skript.
 * "data:" bei Bildern braucht die gemalte Szene (SVGs in szene.css),
 * "connect-src 'self'" deckt auch die WebSocket-Verbindung zum selben Host ab.
 */
const SICHERHEITS_KOPFZEILEN = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  // Dateien nur als das ausführen, was der Server angibt - nie "erraten".
  'X-Content-Type-Options': 'nosniff',
  // Beim Klick auf einen Link erfährt die andere Seite nicht, woher man kommt.
  'Referrer-Policy': 'no-referrer',
};
app.use((anfrage, antwort, weiter) => {
  antwort.set(SICHERHEITS_KOPFZEILEN);
  weiter();
});

// Schriften ändern sich nie - sie dürfen lange im Browser-Cache bleiben.
app.use(
  '/fonts',
  express.static(path.join(OEFFENTLICH, 'fonts'), {
    maxAge: '30d',
    immutable: true,
  }),
);

// Alle übrigen Dateien: der Browser fragt nach, bekommt aber "304 Not
// Modified" statt der Datei, solange sich nichts geändert hat.
app.use(express.static(OEFFENTLICH));

/**
 * Die Tierliste für die Vorschlagssuche.
 *
 * Bewusst ein normaler HTTP-Aufruf und keine Socket-Nachricht: So lädt der
 * Browser die Liste genau einmal und holt sie beim nächsten Spiel aus
 * seinem Cache, statt sie bei jeder Partie erneut zu übertragen.
 */
const TIERE_ALS_JSON = JSON.stringify(SUCH_TIERE);
app.get('/api/tiere', (anfrage, antwort) => {
  antwort.type('application/json').send(TIERE_ALS_JSON);
});

// Unbekannte Pfade: knappe Antwort, keine Verzeichnisstruktur verraten.
app.use((anfrage, antwort) => {
  antwort.status(404).type('text/plain').send('Nicht gefunden');
});

// Fehlerbehandlung. Ohne diese Funktion würde Express im Entwicklungsmodus
// einen kompletten Stacktrace samt Serverpfaden an den Browser ausliefern.
// Details gehören ins Serverlog, nicht zum Angreifer.
app.use((fehler, anfrage, antwort, _weiter) => {
  console.error(`[!] Fehler bei ${anfrage.method} ${anfrage.url}:`, fehler);
  antwort.status(500).type('text/plain').send('Interner Serverfehler');
});

// --------------------------------------------------------------------------
// Spielbetrieb
// --------------------------------------------------------------------------

/**
 * Nur für die Integrationstests: Ist ZOODLE_TESTTIER gesetzt, ist dieses
 * Tier in jeder Partie das Geheimnis. So kennen die Tests die Lösung, ohne
 * dass der Server sie irgendwo ausgeben muss. "npm start" setzt die
 * Variable nie - wie ZUGZEIT_MS_PRO_SEKUNDE weiter unten.
 */
const testtier = findeTier(process.env.ZOODLE_TESTTIER);
if (process.env.ZOODLE_TESTTIER && !testtier) {
  console.error('[!] ZOODLE_TESTTIER nennt kein bekanntes Tier - es wird zufaellig gelost.');
}
const verwaltung = new Partienverwaltung(testtier ? { waehleGeheimnis: () => testtier } : {});
const lobbys = new Lobbyverwaltung();

/**
 * Die Zugzeit-Uhren. Normalerweise dauert eine Sekunde 1000 ms. Nur die
 * Integrationstests setzen ZUGZEIT_MS_PRO_SEKUNDE kleiner, damit sie nicht
 * zehn Sekunden auf einen Ablauf warten müssen - im Spiel hat die
 * Variable keine Wirkung, solange niemand sie setzt.
 */
const msProSekunde = Number(process.env.ZUGZEIT_MS_PRO_SEKUNDE);
const zuguhren = new Zuguhren({
  msProSekunde: Number.isFinite(msProSekunde) && msProSekunde > 0 ? msProSekunde : 1000,
});

/**
 * Der Socket.io-Raum aller Spieler, die gerade frei in der Lobby stehen.
 * Ändert sich die Liste der privaten Lobbys, bekommen genau diese Spieler
 * die neue Liste. Wer wartet oder spielt, ist nicht im Raum - so taucht auch
 * die eigene, wartende Lobby nie in der eigenen Liste auf.
 */
const RAUM_LOBBY = 'lobby';

/** Liefert den Socket zu einer Kennung, sofern noch verbunden. */
const socketVon = (id) => io.sockets.sockets.get(id);

const namenVon = (id) => socketVon(id)?.data.name ?? 'Unbekannt';

/**
 * Einfache Nachrichtenbremse gegen Bots und versehentliche Endlosschleifen.
 *
 * Zählt die Nachrichten je Sekunde und Verbindung. Wer die Grenze reißt,
 * wird ignoriert; wer sie massiv reißt, fliegt raus. Ohne das könnte ein
 * Skript den Server mit Anfragen überziehen - und am Spieltag hängen alle
 * Partien am selben Prozess.
 *
 * @returns {boolean} true, wenn die Nachricht verworfen werden soll
 */
function zuVieleNachrichten(socket) {
  const jetzt = Date.now();

  if (socket.data.fensterBeginn === undefined || jetzt - socket.data.fensterBeginn >= 1000) {
    socket.data.fensterBeginn = jetzt;
    socket.data.nachrichten = 0;
    socket.data.gewarnt = false;
  }
  socket.data.nachrichten += 1;

  if (socket.data.nachrichten > KAPPUNGSGRENZE) {
    console.warn(`[!] ${socket.id} sendet zu viele Nachrichten - Verbindung wird getrennt.`);
    socket.disconnect(true);
    return true;
  }

  const zuSchnell = socket.data.nachrichten > MAX_NACHRICHTEN_PRO_SEKUNDE;

  // Höchstens EINE Meldung je Sekunde. Würde jede verworfene Nachricht
  // beantwortet, verdoppelte die Antwort die Last, statt sie zu bremsen -
  // die Bremse wäre selbst der Verstärker. Ohne jede Rückmeldung wäre es
  // aber auch falsch: Ein ehrlicher Spieler, der schnell klickt, sähe
  // seinen Tipp kommentarlos verschwinden.
  if (zuSchnell && !socket.data.gewarnt) {
    socket.data.gewarnt = true;
    socket.emit('fehler', 'Etwas langsamer bitte - dein Tipp kam nicht an.');
  }

  return zuSchnell;
}

io.on('connection', (socket) => {
  console.log(`[+] Neue Verbindung: ${socket.id}`);

  // Die Bremse hängt VOR allen Handlern und sieht dadurch jedes eingehende
  // Ereignis - auch frei erfundene Namen, zu denen es gar keinen Handler gibt.
  // Steckte sie nur in einzelnen Handlern, könnte ein Angreifer sie umgehen,
  // indem er einfach "irgendwas" statt "raten" sendet.
  //
  // Wird "weiter" nicht aufgerufen, ist die Nachricht verworfen.
  socket.use((paket, weiter) => {
    if (zuVieleNachrichten(socket)) return;
    weiter();
  });

  socket.on('anmelden', (rohName) => behandleAnmeldung(socket, rohName));
  socket.on('raten', (rohName) => behandleRateversuch(socket, rohName));
  socket.on('tierWaehlen', (rohName) => behandleTierwahl(socket, rohName));
  // Bewusst OHNE Parameter: Was der Client mitschickt, wird nie gelesen.
  socket.on('tippt', () => behandleTippen(socket));
  socket.on('aufgeben', () => behandleAufgeben(socket));

  // Die Lobby: öffentliche Warteschlange und private Lobbys.
  socket.on('warteschlangeBetreten', (daten) => behandleWarteschlangeBetreten(socket, daten));
  socket.on('warteschlangeVerlassen', () => behandleWarteschlangeVerlassen(socket));
  socket.on('lobbyErstellen', (daten) => behandleLobbyErstellen(socket, daten));
  socket.on('lobbySchliessen', () => behandleLobbySchliessen(socket));
  socket.on('lobbyBeitreten', (daten) => behandleLobbyBeitreten(socket, daten));

  // Die beiden Wege aus der Endkarte heraus - ohne die Seite neu zu laden.
  socket.on('revanche', () => behandleRevanche(socket));
  socket.on('zurLobby', () => behandleZurLobby(socket));

  // "disconnect" läuft nicht durch socket.use - eine Trennung darf nie
  // an der Bremse hängen bleiben, sonst räumt der Server die Partie nicht ab.
  socket.on('disconnect', (grund) => behandleTrennung(socket, grund));
});

function behandleAnmeldung(socket, rohName) {
  // Der Server traut dem Client grundsätzlich nicht: jede Eingabe wird geprüft.
  // bereinigeName entfernt unsichtbare Zeichen und kürzt nach ganzen Zeichen.
  const name = bereinigeName(rohName);

  if (name.length === 0) {
    socket.emit('fehler', 'Bitte gib einen Namen ein.');
    return;
  }
  if (socket.data.name) {
    return; // Doppelte Anmeldung stillschweigend ignorieren.
  }

  socket.data.name = name;
  console.log(`[i] "${name}" hat sich angemeldet (${socket.id})`);

  betreteLobby(socket);
}

// --------------------------------------------------------------------------
// Lobby
// --------------------------------------------------------------------------

/**
 * Schickt einen Spieler in die Lobby: Er kommt in den Raum "lobby" und
 * bekommt sofort die aktuelle Liste der privaten Lobbys.
 *
 * Alle Wege zurück in die Lobby laufen hier durch - Anmeldung,
 * Warteschlange verlassen, eigene Lobby schliessen, "Zur Lobby".
 */
function betreteLobby(socket) {
  socket.join(RAUM_LOBBY);
  socket.emit('lobbyBetreten', { name: socket.data.name });
  socket.emit('lobbyListe', lobbys.liste());
}

/** Schickt die aktuelle Liste an alle, die gerade in der Lobby stehen. */
function verschickeLobbyListe() {
  io.to(RAUM_LOBBY).emit('lobbyListe', lobbys.liste());
}

/**
 * Was jeder Weg aus der Lobby heraus voraussetzt: Der Spieler ist angemeldet
 * und gerade frei - er spielt nicht, steht nicht in der Warteschlange und
 * wartet nicht in seiner eigenen Lobby. Niemand kann an zwei Orten zugleich
 * warten.
 *
 * Der Browser bietet in diesen Fällen gar keine Knöpfe an. Geprüft wird
 * trotzdem, denn ein manipulierter Client schickt, was er will.
 *
 * @returns {string | null} Der Fehlertext - oder null, wenn alles passt.
 */
function pruefeFrei(socket) {
  if (!socket.data.name) return 'Bitte melde dich zuerst an.';
  if (verwaltung.partieVon(socket.id)) return 'Deine Partie läuft noch.';
  if (verwaltung.wartet(socket.id)) return 'Du stehst schon in der Warteschlange.';
  if (lobbys.lobbyVon(socket.id)) return 'Du hast schon eine eigene Lobby.';
  return null;
}

/**
 * Öffentlich spielen: ab in die Warteschlange des gewählten Modus.
 * Jeder Modus hat seine eigene Warteschlange - wer Duell wählt, trifft nur
 * auf jemanden, der ebenfalls Duell gewählt hat.
 */
function behandleWarteschlangeBetreten(socket, rohDaten) {
  const fehler = pruefeFrei(socket);
  if (fehler) {
    socket.emit('fehler', fehler);
    return;
  }

  // Ohne Angabe gilt Zufallstier.
  const { modus = 'zufall' } = alsObjekt(rohDaten);
  if (!SPIELBARE_MODI.includes(modus)) {
    socket.emit('fehler', 'Diesen Modus gibt es nicht.');
    return;
  }

  ziehtWeiter(socket);
  socket.leave(RAUM_LOBBY);
  const spiel = verwaltung.suchePartie(socket.id, modus);

  if (spiel === null) {
    socket.emit('warten', { modus, zugzeit: STANDARD_ZUGZEIT });
    return;
  }

  verkuendeSpielStart(spiel);
}

/** Doch nicht öffentlich spielen: zurück in die Lobby. */
function behandleWarteschlangeVerlassen(socket) {
  if (!verwaltung.wartet(socket.id)) return; // war gar nicht drin

  verwaltung.verlasseWarteschlange(socket.id);
  betreteLobby(socket);
}

/**
 * Macht aus einer Nutzlast ein Objekt, ohne abzustürzen.
 * Der Client könnte statt { modus, passwort } auch null, eine Zahl oder
 * einen Text schicken - dann gelten alle Felder als fehlend.
 */
function alsObjekt(daten) {
  return typeof daten === 'object' && daten !== null ? daten : {};
}

/**
 * Die Adresse, nach der Sperren und Grenzen zählen - hinter Caddy die echte
 * des Spielers, nicht die des Proxys (siehe adresse.js).
 */
function adresseVon(socket) {
  return echteAdresse(socket.handshake.address, socket.handshake.headers['x-forwarded-for']);
}

/**
 * Fragt nach einem "await" nach: Ist der Spieler noch da und noch frei?
 * Während das Passwort gehasht wird, kann er sich getrennt haben oder (mit
 * einem manipulierten Client) schon woanders warten.
 */
function istNochFrei(socket) {
  return () => socket.connected && pruefeFrei(socket) === null;
}

/**
 * Eine private Lobby eröffnen.
 *
 * Asynchron, weil lobbys.js das Passwort hasht, ohne den Server anzuhalten.
 * Was sich währenddessen ändern kann, prüft lobbys.js nach dem Hashen
 * noch einmal (siehe istNochFrei).
 */
async function behandleLobbyErstellen(socket, rohDaten) {
  const fehler = pruefeFrei(socket);
  if (fehler) {
    socket.emit('fehler', fehler);
    return;
  }

  // Modus und Passwort prüft lobbys.js - der Browser prüft nur aus Komfort.
  // Ohne Angabe gilt die Standard-Zugzeit.
  const { modus, passwort, zugzeit = STANDARD_ZUGZEIT } = alsObjekt(rohDaten);
  const ergebnis = await lobbys.erstelle(socket.id, socket.data.name, modus, passwort, zugzeit, {
    // Für die Obergrenze je Adresse - 50 Tabs belegen nicht alle Plätze.
    adresse: adresseVon(socket),
    istSpielerFrei: istNochFrei(socket),
  });

  // Inzwischen getrennt oder anderswo unterwegs: keine Antwort nötig.
  if (ergebnis.fehler === 'nichtFrei') return;
  if (ergebnis.fehler) {
    // grund: 'passwort', 'modus', 'zugzeit', 'voll' (50 Lobbys erreicht),
    // 'zuVieleVonDir' (3 offene Lobbys von dieser Adresse),
    // 'beschaeftigt' (zu viele Passwortprüfungen gleichzeitig) oder
    // 'schonOffen' (zwei Anfragen gleichzeitig, nur mit manipuliertem Client)
    socket.emit('erstellenAbgelehnt', { grund: ergebnis.fehler });
    return;
  }

  // Das Passwort steht bewusst NICHT im Log.
  console.log(`[i] "${socket.data.name}" hat eine Lobby eroeffnet (Modus ${ergebnis.lobby.modus})`);

  ziehtWeiter(socket);
  socket.leave(RAUM_LOBBY);
  socket.emit('lobbyErstellt', { modus: ergebnis.lobby.modus, zugzeit: ergebnis.lobby.zugzeit });
  verschickeLobbyListe();
}

/** Die eigene, noch wartende Lobby schliessen und zurück in die Lobby. */
function behandleLobbySchliessen(socket) {
  const lobby = lobbys.lobbyVon(socket.id);
  // Eine besetzte Lobby gehört zu einer laufenden Partie - die schließt
  // man nicht per Knopf, sondern durch das Spielende.
  if (!lobby || lobby.besetzt) return;

  lobbys.schliesse(socket.id);
  betreteLobby(socket);
  verschickeLobbyListe();
}

/**
 * Einer privaten Lobby beitreten.
 *
 * Anders als beim Raten MIT "await": Das Hashen des Passworts dauert, und
 * synchron würde es den ganzen Server anhalten. Den Wettlauf zweier
 * gleichzeitiger Beitritte fängt lobbys.js ab - nach dem Hashen wird dort
 * alles neu geprüft und erst dann, in einem Stück, besetzt. Der Zweite
 * findet die Lobby schon besetzt vor.
 */
async function behandleLobbyBeitreten(socket, rohDaten) {
  const fehler = pruefeFrei(socket);
  if (fehler) {
    socket.emit('fehler', fehler);
    return;
  }

  const { lobbyId, passwort } = alsObjekt(rohDaten);
  const ergebnis = await lobbys.trittBei(lobbyId, socket.id, passwort, {
    // Die Sperre nach Fehlversuchen zählt je Adresse - Neuladen hilft nicht.
    adresse: adresseVon(socket),
    istSpielerFrei: istNochFrei(socket),
  });

  // Inzwischen getrennt oder anderswo unterwegs: keine Antwort nötig.
  if (ergebnis.fehler === 'nichtFrei') return;
  if (ergebnis.fehler) {
    // grund: 'passwort', 'voll', 'weg', 'gesperrt' oder 'beschaeftigt'.
    // ('eigene' kann hier nicht vorkommen - wer eine eigene Lobby hat, ist
    // nicht frei.)
    socket.emit('beitrittAbgelehnt', { grund: ergebnis.fehler });
    return;
  }

  const { lobby } = ergebnis;
  console.log(`[i] "${socket.data.name}" tritt der Lobby von "${lobby.erstellerName}" bei`);

  ziehtWeiter(socket);
  const spiel = verwaltung.starteLobbyPartie(
    lobby.erstellerId,
    socket.id,
    lobby.modus,
    lobby.zugzeit,
  );
  verkuendeSpielStart(spiel);
  verschickeLobbyListe(); // die Lobby ist jetzt besetzt und verschwindet
}

/** So oft (in ms) sucht der Server nach Lobbys, denen niemand beitritt. */
const LOBBY_AUFRAEUMEN_ALLE_MS = 30_000;

/**
 * Schließt Lobbys, die seit 10 Minuten niemand betreten hat (siehe
 * LOBBY_LEBENSDAUER in lobbys.js). Der Ersteller landet wieder in der Lobby
 * und erfährt, warum; die Liste ändert sich für alle.
 */
function raeumeLobbysAuf() {
  const ersteller = lobbys.raeumeAbgelaufeneAuf();
  if (ersteller.length === 0) return;

  for (const id of ersteller) {
    const socket = socketVon(id);
    if (!socket) continue;
    betreteLobby(socket);
    socket.emit('lobbyAbgelaufen');
  }
  verschickeLobbyListe();
}
setInterval(raeumeLobbysAuf, LOBBY_AUFRAEUMEN_ALLE_MS);

/**
 * Gibt beiden Spielern den Startschuss - für öffentliche Partien,
 * Lobby-Partien und Revanchen gleichermaßen.
 */
function verkuendeSpielStart(spiel) {
  // Beim Zufallstier wird sofort geraten - die Zugzeit läuft ab jetzt. Im
  // Duell läuft zuerst die Wahlfrist, die Zugzeit erst nach der Wahl (siehe
  // behandleTierwahl). Ohne Zeitlimit gibt es auch keine Wahlfrist.
  if (spiel.phase === 'raten') {
    starteFrist(spiel);
  } else if (spiel.zugzeit) {
    zuguhren.starte(spiel, laufeWahlfristAb, WAHLZEIT_SEKUNDEN);
  }

  for (const id of spiel.spielerIds) {
    const empfaenger = socketVon(id);
    // Wer spielt, steht nicht mehr in der Lobby und braucht keine Liste.
    empfaenger?.leave(RAUM_LOBBY);
    empfaenger?.emit('spielStart', {
      gegnerName: namenVon(spiel.gegnerVon(id)),
      duBistDran: spiel.amZug === id,
      kategorien: KATEGORIEN,
      modus: spiel.modus,
      zugzeit: spiel.zugzeit,
      // Nur im Duell: die volle Wahlfrist - für die Breite des Zeitbalkens.
      wahlzeit: WAHLZEIT_SEKUNDEN,
      restzeitMs: zuguhren.restzeitMs(spiel),
    });
  }

  // Das gesuchte Tier steht bewusst NICHT im Log - es verlässt den Server
  // erst beim Spielende, auch nicht über die Konsole.
  const [idA, idB] = spiel.spielerIds;
  console.log(
    spiel.modus === 'duell'
      ? `[*] Duell gestartet: "${namenVon(idA)}" gegen "${namenVon(idB)}" - beide waehlen ein Tier`
      : `[*] Partie gestartet: "${namenVon(idA)}" gegen "${namenVon(idB)}", Modus ${spiel.modus}`,
  );
}

/**
 * Duell: Ein Spieler wählt das Tier, das sein Gegner erraten muss.
 *
 * Die Wahl bleibt geheim: Der Wählende bekommt sie bestätigt, der Gegner
 * erfährt nur, DASS gewählt wurde - nicht was. Erst das Spielende
 * verrät es. Bewusst ohne "await", wie beim Raten.
 */
function behandleTierwahl(socket, rohName) {
  const spiel = verwaltung.partieVon(socket.id);

  if (!spiel || spiel.beendet || spiel.modus !== 'duell' || spiel.phase !== 'wahl') {
    socket.emit('fehler', 'Gerade gibt es kein Tier zu wählen.');
    return;
  }
  if (spiel.hatGewaehlt(socket.id)) {
    socket.emit('fehler', 'Du hast schon gewählt.');
    return;
  }
  const tier = findeTier(rohName);
  if (!tier) {
    socket.emit('fehler', 'Dieses Tier kenne ich nicht. Nutze die Vorschlagsliste.');
    return;
  }

  spiel.waehleTier(socket.id, tier);
  const gegnerId = spiel.gegnerVon(socket.id);
  // Mit Restzeit: Ab jetzt zeigt die Uhr, wie lange der Gegner noch hat.
  socket.emit('tierGewaehlt', { tierName: tier.name, restzeitMs: zuguhren.restzeitMs(spiel) });
  socketVon(gegnerId)?.emit('gegnerHatGewaehlt');

  if (spiel.phase !== 'raten') return; // der Gegner wählt noch

  starteFrist(spiel);
  for (const id of spiel.spielerIds) {
    socketVon(id)?.emit('duellStart', {
      duBistDran: spiel.amZug === id,
      restzeitMs: zuguhren.restzeitMs(spiel),
    });
  }
  console.log(`[*] Duell laeuft: "${namenVon(socket.id)}" gegen "${namenVon(gegnerId)}"`);
}

/** Höchstens so oft (in ms) wird "tippt" pro Verbindung weitergegeben. */
const TIPPT_ABSTAND_MS = 1000;

/**
 * Duell: Der Spieler am Zug tippt gerade - sein Gegner soll "Lena tippt ..."
 * sehen.
 *
 * Weitergeleitet wird NUR das Signal, nie ein Buchstabe: Die Nachricht hat
 * keine Daten, und selbst wenn ein manipulierter Client welche mitschickt,
 * liest der Server sie nicht. Ohne Zug kein Signal - wer nicht dran ist,
 * kann den Gegner damit auch nicht verunsichern. Stimmt eine Bedingung
 * nicht, passiert einfach nichts: Es ist nur eine Anzeige, keine
 * Fehlermeldung wert. Die Nachrichtenbremse zählt "tippt" ohnehin mit.
 */
function behandleTippen(socket) {
  const spiel = verwaltung.partieVon(socket.id);
  if (!spiel || spiel.beendet || spiel.modus !== 'duell' || spiel.phase !== 'raten') return;
  if (!spiel.istAmZug(socket.id)) return;

  const jetzt = Date.now();
  if (jetzt - (socket.data.letztesTippen ?? 0) < TIPPT_ABSTAND_MS) return;
  socket.data.letztesTippen = jetzt;

  socketVon(spiel.gegnerVon(socket.id))?.emit('gegnerTippt');
}

/**
 * Beendet eine Partie - und mit ihr die private Lobby, aus der sie
 * entstanden ist. Wer danach weiterspielen will, nutzt die Revanche oder
 * eröffnet eine neue Lobby.
 */
function beendePartie(spiel) {
  zuguhren.stoppe(spiel);
  verwaltung.beende(spiel);
  for (const id of spiel.spielerIds) lobbys.schliesse(id);
}

// --------------------------------------------------------------------------
// Zugzeit
// --------------------------------------------------------------------------

/** Startet die Frist für den Spieler, der jetzt am Zug ist (bei 0 nichts). */
function starteFrist(spiel) {
  zuguhren.starte(spiel, laufeFristAb);
}

/**
 * Die Zeit ist um: Der Zug geht ohne Tipp an den Gegner, und dessen Frist
 * beginnt. Beide erfahren es - mit der neuen Restzeit, damit ihre Anzeige
 * wieder bei voller Zeit anfängt.
 */
function laufeFristAb(spiel) {
  // Zur Sicherheit: Eine beendete oder schon abgeräumte Partie hat keine
  // Frist mehr. (stoppe() verhindert das eigentlich schon.)
  if (spiel.beendet || verwaltung.partieVon(spiel.amZug) !== spiel) return;

  const verpasstVon = spiel.amZug;
  spiel.gibZugAb();
  starteFrist(spiel);

  for (const id of spiel.spielerIds) {
    socketVon(id)?.emit('zeitAbgelaufen', {
      duBistDran: spiel.amZug === id,
      restzeitMs: zuguhren.restzeitMs(spiel),
    });
  }
  console.log(
    `[*] Zeit abgelaufen fuer "${namenVon(verpasstVon)}" - "${namenVon(spiel.amZug)}" ist dran`,
  );
}

/**
 * Duell: Die Wahlfrist ist um, und mindestens einer hat noch nicht gewählt
 * (sonst liefe schon die Zugzeit). Die Partie endet wie bei einer Trennung:
 * Wer gewählt hat, gewinnt. Hat keiner gewählt, gibt es keinen Sieger.
 */
function laufeWahlfristAb(spiel) {
  if (spiel.beendet || spiel.phase !== 'wahl') return;

  const gewaehlt = spiel.spielerIds.filter((id) => spiel.hatGewaehlt(id));
  beendePartie(spiel);

  for (const id of spiel.spielerIds) {
    socketVon(id)?.emit('wahlAbgelaufen', {
      // null heißt: beide haben nicht gewählt - Abbruch ohne Sieger.
      duHastGewonnen: gewaehlt.length === 1 ? gewaehlt[0] === id : null,
    });
  }
  console.log(
    `[*] Wahlfrist abgelaufen: "${namenVon(spiel.spielerIds[0])}" gegen "${namenVon(spiel.spielerIds[1])}"`,
  );
}

/**
 * Ein Spieler verlässt seine Partie per Knopf. Für den Gegner ist das wie
 * eine Trennung, nur mit ehrlicherem Text.
 *
 * Gebraucht wird es vor allem in der Duell-Wahl: Ohne diesen Ausweg müsste
 * man warten, bis der Gegner wählt oder die Frist abläuft. Der Server
 * nimmt die Partie aus der Socket-Kennung - wer in keiner steckt, kann auch
 * keine fremde beenden.
 */
function behandleAufgeben(socket) {
  const spiel = verwaltung.partieVon(socket.id);
  if (!spiel || spiel.beendet) {
    socket.emit('fehler', 'Du bist gerade in keiner laufenden Partie.');
    return;
  }

  const gegnerId = spiel.gegnerVon(socket.id);
  beendePartie(spiel);
  // Wer geht, will keine Revanche - sonst bekäme der Gegner ein Angebot
  // von jemandem, der gerade gegangen ist.
  verwaltung.vergissRevanche(socket.id);

  socketVon(gegnerId)?.emit('gegnerWeg', {
    geheimnis: spiel.geheimnisVon(gegnerId),
    aufgegeben: true,
  });
  console.log(
    `[*] "${namenVon(socket.id)}" hat die Partie gegen "${namenVon(gegnerId)}" verlassen`,
  );
  betreteLobby(socket);
}

/**
 * Was beide Knöpfe der Endkarte voraussetzen: Der Spieler ist angemeldet,
 * und seine alte Partie ist wirklich vorbei.
 *
 * Der Browser sperrt die Knöpfe zwar selbst, aber darauf ist wie überall
 * kein Verlass - ein manipulierter Client könnte sie jederzeit wieder
 * aktivieren und mitten in einer laufenden Partie eine neue verlangen.
 *
 * @returns {string | null} Der Fehlertext - oder null, wenn alles passt.
 */
function pruefeNeustart(socket) {
  if (!socket.data.name) {
    return 'Bitte melde dich zuerst an.';
  }
  if (verwaltung.partieVon(socket.id)) {
    return 'Deine Partie läuft noch.';
  }
  return null;
}

/**
 * Nimmt ein Revanche-Angebot zurück und sagt dem Gegner Bescheid, falls der
 * noch auf der Endkarte steht - ob er schon zugestimmt hat oder nicht. Sonst
 * zeigt sein Revanche-Knopf weiter etwas an, das es nicht mehr gibt.
 *
 * Die Reihenfolge ist wichtig: erst fragen, dann löschen. Nach dem Löschen
 * weiß niemand mehr, wem die Absage überhaupt gilt.
 */
function loeseRevancheAuf(socket, grund) {
  const wartenderId = verwaltung.wartetAufRevancheMit(socket.id);
  verwaltung.vergissRevanche(socket.id);
  socketVon(wartenderId)?.emit('revancheGeplatzt', grund);
}

/**
 * Der Spieler zieht weiter - in die Warteschlange, in die eigene oder in
 * eine fremde Lobby. Eine Revanche-Zusage von der Endkarte gilt dann nicht
 * mehr. Sonst könnte der alte Gegner noch zusagen und eine zweite Partie
 * mit jemandem starten, der längst woanders wartet oder spielt.
 *
 * Der Browser führt zwar immer erst über "Zur Lobby", das die Revanche
 * schon auflöst. Ein manipulierter Client springt aber direkt weiter.
 */
function ziehtWeiter(socket) {
  loeseRevancheAuf(socket, 'Gegner spielt schon weiter');
}

/** Ein Spieler möchte noch einmal gegen denselben Gegner antreten. */
function behandleRevanche(socket) {
  const fehler = pruefeNeustart(socket);
  if (fehler) {
    socket.emit('fehler', fehler);
    return;
  }

  const ergebnis = verwaltung.stimmeRevancheZu(socket.id);

  if (ergebnis.status === 'unmoeglich') {
    socket.emit(
      'fehler',
      'Eine Revanche ist nicht mehr möglich. Such dir in der Lobby einen neuen Gegner.',
    );
    return;
  }

  if (ergebnis.status === 'wartet') {
    socket.emit('revancheWartet');
    socketVon(ergebnis.gegnerId)?.emit('revancheAngeboten');
    return;
  }

  // Beide haben zugestimmt: neue Partie, neues Geheimnis, gleiche Gegner.
  console.log(
    `[*] Revanche zwischen "${namenVon(ergebnis.spiel.spielerIds[0])}" und ` +
      `"${namenVon(ergebnis.spiel.spielerIds[1])}"`,
  );
  verkuendeSpielStart(ergebnis.spiel);
}

/** Ein Spieler geht von der Endkarte zurück in die Lobby. */
function behandleZurLobby(socket) {
  const fehler = pruefeNeustart(socket);
  if (fehler) {
    socket.emit('fehler', fehler);
    return;
  }

  // Wer in die Lobby geht, steht für eine Revanche nicht mehr bereit.
  loeseRevancheAuf(socket, 'Gegner ist in der Lobby');

  // Nur zur Sicherheit: In der Lobby wartet man nirgends. Ein manipulierter
  // Client könnte "zurLobby" schicken, während er noch woanders wartet.
  verwaltung.verlasseWarteschlange(socket.id);
  if (lobbys.schliesse(socket.id)) verschickeLobbyListe();

  betreteLobby(socket);
}

/**
 * Die Spielregeln eines Rateversuchs. Liefert entweder das geratene Tier -
 * oder den Grund, warum der Zug nicht erlaubt ist. Geprüft wird, in dieser
 * Reihenfolge:
 *   1. Läuft eine Partie?
 *   2. Ist die Duell-Wahl vorbei?
 *   3. Ist der Spieler am Zug?
 *   4. Ist seine Zeit noch nicht abgelaufen?
 *   5. Gibt es das Tier?
 *   6. Wurde es noch nicht geraten?
 *
 * Das sind die eigentlichen Regeln des Spiels. Der Browser sperrt das
 * Eingabefeld zwar auch, aber darauf ist kein Verlass: Ein manipulierter
 * Client könnte es einfach wieder aktivieren. Deshalb stehen sie hier
 * gebündelt an einer Stelle - wer wissen will, wogegen Zoodle absichert,
 * muss nur diese Funktion lesen.
 *
 * @returns {{tier: object} | {fehler: string}}
 */
function pruefeRateversuch(spiel, spielerId, rohName) {
  if (!spiel || spiel.beendet) {
    return { fehler: 'Du bist gerade in keiner laufenden Partie.' };
  }
  if (spiel.phase === 'wahl') {
    return { fehler: 'Wählt zuerst eure Tiere.' };
  }
  if (!spiel.istAmZug(spielerId)) {
    return { fehler: 'Du bist nicht am Zug.' };
  }
  // Die Frist ist um, aber Node hat den Ablauf noch nicht bearbeitet - der
  // Tipp kam trotzdem zu spät.
  if (zuguhren.istAbgelaufen(spiel)) {
    return { fehler: 'Deine Zeit ist abgelaufen.' };
  }

  const tier = findeTier(rohName);
  if (!tier) {
    return { fehler: 'Dieses Tier kenne ich nicht. Nutze die Vorschlagsliste.' };
  }
  if (spiel.schonGeraten(tier.name, spielerId)) {
    return { fehler: `${tier.name} wurde schon geraten.` };
  }

  return { tier };
}

/**
 * Schickt einen ausgeführten Zug an beide Spieler.
 *
 * Beide sehen denselben Tipp mit denselben Hinweisen - das ist der Kern des
 * Duells. Unterschiedlich ist nur, was für wen gilt: "vonMir", "duBistDran"
 * und "duHastGewonnen".
 */
function verteileZug(spiel, versuch, raterId, raterName) {
  for (const id of spiel.spielerIds) {
    const empfaenger = socketVon(id);
    if (!empfaenger) continue;

    empfaenger.emit('zug', {
      raterName,
      vonMir: id === raterId,
      tierName: versuch.tierName,
      hinweise: versuch.hinweise,
      richtig: versuch.richtig,
      duBistDran: !versuch.richtig && spiel.amZug === id,
      // Die Frist des Spielers, der jetzt dran ist (null bei Sieg oder ohne Limit).
      restzeitMs: zuguhren.restzeitMs(spiel),
    });

    if (versuch.richtig) {
      empfaenger.emit('spielEnde', {
        gewinnerName: raterName,
        duHastGewonnen: id === raterId,
        // Das Tier, das DIESER Empfänger gesucht hat - im Duell hat jeder
        // sein eigenes, beim Zufallstier ist es für beide dasselbe.
        geheimnis: spiel.geheimnisVon(id),
        // Beim Zufallstier raten beide zusammen auf ein Tier - es zählen
        // alle Tipps. Im Duell sucht jeder sein eigenes Tier, dort zählen
        // nur die Tipps des Gewinners.
        anzahlTipps:
          spiel.modus === 'duell'
            ? spiel.versuche.filter((v) => v.spielerId === raterId).length
            : spiel.versuche.length,
      });
    }
  }
}

/**
 * Ein Spieler rät ein Tier.
 *
 * Bewusst ohne "await": Die Verarbeitung eines Zuges läuft in einem Stück
 * durch. Node arbeitet Nachrichten nacheinander ab, und solange hier nichts
 * unterbricht, können zwei gleichzeitige Tipps sich nicht verschränken.
 * Genau das schützt die Zugreihenfolge.
 */
function behandleRateversuch(socket, rohName) {
  const spiel = verwaltung.partieVon(socket.id);

  const { tier, fehler } = pruefeRateversuch(spiel, socket.id, rohName);
  if (fehler) {
    socket.emit('fehler', fehler);
    return;
  }

  const raterName = socket.data.name;
  const versuch = spiel.rate(socket.id, tier);
  // Vor dem Verteilen: Die Nachricht "zug" nennt schon die Frist des Nächsten.
  if (versuch.richtig) {
    zuguhren.stoppe(spiel);
  } else {
    starteFrist(spiel);
  }
  verteileZug(spiel, versuch, socket.id, raterName);

  if (versuch.richtig) {
    console.log(
      `[*] "${raterName}" hat "${spiel.geheimnisVon(socket.id).name}" erraten. Partie beendet.`,
    );
    beendePartie(spiel);
  }
}

/** Ein Spieler hat die Verbindung verloren. */
function behandleTrennung(socket, grund) {
  console.log(`[-] Verbindung getrennt: ${socket.id} (${grund})`);

  // Muss VOR entferne() geschehen: Das räumt die Revanche-Notizen ab, und
  // danach ist nicht mehr feststellbar, wer hier auf ein Duell wartet.
  const wartenderId = verwaltung.wartetAufRevancheMit(socket.id);

  const spiel = verwaltung.entferne(socket.id);
  if (spiel) zuguhren.stoppe(spiel); // keine Frist für eine Partie ohne Spieler

  socketVon(wartenderId)?.emit('revancheGeplatzt', 'Gegner ist weg');

  // Eine offene Lobby des Getrennten verschwindet aus der Liste.
  if (lobbys.entferneSpieler(socket.id)) verschickeLobbyListe();

  if (!spiel) return;

  // Kam die Partie aus einer Lobby des GEGNERS, ist auch die jetzt erledigt.
  const gegnerId = spiel.gegnerVon(socket.id);
  lobbys.schliesse(gegnerId);

  // Laut Aufgabenstellung wird die Partie bei einem Abbruch einfach beendet.
  // Der Gegner erfährt das Tier, das ER gesucht hat - im Duell nur, wenn es
  // schon gewählt war.
  socketVon(gegnerId)?.emit('gegnerWeg', { geheimnis: spiel.geheimnisVon(gegnerId) });
}

// --------------------------------------------------------------------------
// Robustheit: Der Server darf laut Aufgabenstellung niemals abstürzen.
// --------------------------------------------------------------------------

process.on('uncaughtException', (fehler) => {
  console.error('[!] Unerwarteter Fehler - Server laeuft weiter:', fehler);
});

process.on('unhandledRejection', (grund) => {
  console.error('[!] Unbehandelte Promise-Ablehnung - Server laeuft weiter:', grund);
});

// --------------------------------------------------------------------------
// Start
// --------------------------------------------------------------------------

/** Sammelt alle Adressen, unter denen dieser Rechner erreichbar ist. */
function erreichbareAdressen(port) {
  const adressen = [`http://localhost:${port}`];

  for (const schnittstellen of Object.values(networkInterfaces())) {
    for (const { address, family, internal } of schnittstellen ?? []) {
      if (internal) continue;
      // IPv6-Adressen gehören in eckige Klammern.
      adressen.push(
        family === 'IPv6' ? `http://[${address}]:${port}` : `http://${address}:${port}`,
      );
    }
  }
  return adressen;
}

httpServer.on('error', (fehler) => {
  if (fehler.code === 'EADDRINUSE') {
    console.error(`[!] Port ${PORT} ist bereits belegt. Starte mit einem anderen Port, z. B.:`);
    console.error(`    npm start -- ${PORT + 1}`);
    process.exit(1);
  }
  console.error('[!] Der Server konnte nicht starten:', fehler);
  process.exit(1);
});

// Ohne Adressangabe lauscht Node auf allen Schnittstellen - IPv6 und IPv4.
httpServer.listen(PORT, () => {
  console.log(`\n  Zoodle laeuft (${SUCH_TIERE.length} Tiere geladen)\n`);
  for (const adresse of erreichbareAdressen(PORT)) {
    console.log(`    ${adresse}`);
  }
  console.log('\n  Beenden mit Strg+C\n');
});
