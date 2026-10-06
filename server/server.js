/**
 * Zoodle - Serveranwendung
 * ========================
 *
 * Diese Datei verdrahtet nur: Sie nimmt Nachrichten entgegen, fragt die
 * zustaendigen Module und schickt Antworten zurueck. Die Spielregeln stehen
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
import { Zuguhren, STANDARD_ZUGZEIT } from './zugzeit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OEFFENTLICH = path.join(__dirname, '..', 'public');

const STANDARD_PORT = 3000;
const MAX_NAMENSLAENGE = 20;

/** Wie viele Nachrichten ein Spieler pro Sekunde senden darf. */
const MAX_NACHRICHTEN_PRO_SEKUNDE = 10;

/** Ab wie vielen Nachrichten pro Sekunde die Verbindung getrennt wird. */
const KAPPUNGSGRENZE = 50;

// --------------------------------------------------------------------------
// Port bestimmen
// --------------------------------------------------------------------------

/**
 * Liest den Port aus Kommandozeile oder Umgebungsvariable.
 * Ungueltige Angaben fuehren nicht zum Absturz, sondern zum Standardwert.
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
  // Unsere groesste Client-Nachricht ist ein Tiername. 8 KB sind reichlich -
  // die Voreinstellung von 1 MB waere eine unnoetig grosse Angriffsflaeche.
  maxHttpBufferSize: 8 * 1024,
});

// Schriften aendern sich nie - sie duerfen lange im Browser-Cache bleiben.
app.use('/fonts', express.static(path.join(OEFFENTLICH, 'fonts'), {
  maxAge: '30d',
  immutable: true,
}));

// Alle uebrigen Dateien: der Browser fragt nach, bekommt aber "304 Not
// Modified" statt der Datei, solange sich nichts geaendert hat.
app.use(express.static(OEFFENTLICH));

/**
 * Die Tierliste fuer die Vorschlagssuche.
 *
 * Bewusst ein normaler HTTP-Aufruf und keine Socket-Nachricht: So laedt der
 * Browser die rund 20 KB genau einmal und holt sie beim naechsten Spiel aus
 * seinem Cache, statt sie bei jeder Partie erneut zu uebertragen.
 */
const TIERE_ALS_JSON = JSON.stringify(SUCH_TIERE);
app.get('/api/tiere', (anfrage, antwort) => {
  antwort.type('application/json').send(TIERE_ALS_JSON);
});

// Unbekannte Pfade: knappe Antwort, keine Verzeichnisstruktur verraten.
app.use((anfrage, antwort) => {
  antwort.status(404).type('text/plain').send('Nicht gefunden');
});

// Fehlerbehandlung. Ohne diese Funktion wuerde Express im Entwicklungsmodus
// einen kompletten Stacktrace samt Serverpfaden an den Browser ausliefern.
// Details gehoeren ins Serverlog, nicht zum Angreifer.
app.use((fehler, anfrage, antwort, _weiter) => {
  console.error(`[!] Fehler bei ${anfrage.method} ${anfrage.url}:`, fehler);
  antwort.status(500).type('text/plain').send('Interner Serverfehler');
});

// --------------------------------------------------------------------------
// Spielbetrieb
// --------------------------------------------------------------------------

const verwaltung = new Partienverwaltung();
const lobbys = new Lobbyverwaltung();

/**
 * Die Zugzeit-Uhren. Normalerweise dauert eine Sekunde 1000 ms. Nur die
 * Integrationstests setzen ZUGZEIT_MS_PRO_SEKUNDE kleiner, damit sie nicht
 * zehn Sekunden auf einen Ablauf warten muessen - im Spiel hat die
 * Variable keine Wirkung, solange niemand sie setzt.
 */
const msProSekunde = Number(process.env.ZUGZEIT_MS_PRO_SEKUNDE);
const zuguhren = new Zuguhren({
  msProSekunde: Number.isFinite(msProSekunde) && msProSekunde > 0 ? msProSekunde : 1000,
});

/**
 * Der Socket.io-Raum aller Spieler, die gerade frei in der Lobby stehen.
 * Aendert sich die Liste der privaten Lobbys, bekommen genau diese Spieler
 * die neue Liste. Wer wartet oder spielt, ist nicht im Raum - so taucht auch
 * die eigene, wartende Lobby nie in der eigenen Liste auf.
 */
const RAUM_LOBBY = 'lobby';

/** Liefert den Socket zu einer Kennung, sofern noch verbunden. */
const socketVon = (id) => io.sockets.sockets.get(id);

/** Liefert den Anzeigenamen zu einer Kennung. */
const namenVon = (id) => socketVon(id)?.data.name ?? 'Unbekannt';

/**
 * Einfache Nachrichtenbremse gegen Bots und versehentliche Endlosschleifen.
 *
 * Zaehlt die Nachrichten je Sekunde und Verbindung. Wer die Grenze reisst,
 * wird ignoriert; wer sie massiv reisst, fliegt raus. Ohne das koennte ein
 * Skript den Server mit Anfragen ueberziehen - und am Spieltag haengen alle
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

  // Hoechstens EINE Meldung je Sekunde. Wuerde jede verworfene Nachricht
  // beantwortet, verdoppelte die Antwort die Last, statt sie zu bremsen -
  // die Bremse waere selbst der Verstaerker. Ohne jede Rueckmeldung waere es
  // aber auch falsch: Ein ehrlicher Spieler, der schnell klickt, saehe
  // seinen Tipp kommentarlos verschwinden.
  if (zuSchnell && !socket.data.gewarnt) {
    socket.data.gewarnt = true;
    socket.emit('fehler', 'Etwas langsamer bitte - dein Tipp kam nicht an.');
  }

  return zuSchnell;
}

io.on('connection', (socket) => {
  console.log(`[+] Neue Verbindung: ${socket.id}`);

  // Die Bremse haengt VOR allen Handlern und sieht dadurch jedes eingehende
  // Ereignis - auch frei erfundene Namen, zu denen es gar keinen Handler gibt.
  // Wuerde sie wie frueher nur in den beiden Handlern stecken, koennte ein
  // Angreifer sie umgehen, indem er einfach "irgendwas" statt "raten" sendet.
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

  // Die Lobby: oeffentliche Warteschlange und private Lobbys.
  socket.on('warteschlangeBetreten', (daten) => behandleWarteschlangeBetreten(socket, daten));
  socket.on('warteschlangeVerlassen', () => behandleWarteschlangeVerlassen(socket));
  socket.on('lobbyErstellen', (daten) => behandleLobbyErstellen(socket, daten));
  socket.on('lobbySchliessen', () => behandleLobbySchliessen(socket));
  socket.on('lobbyBeitreten', (daten) => behandleLobbyBeitreten(socket, daten));

  // Die beiden Wege aus der Endkarte heraus - ohne die Seite neu zu laden.
  socket.on('revanche', () => behandleRevanche(socket));
  socket.on('zurLobby', () => behandleZurLobby(socket));

  // "disconnect" laeuft nicht durch socket.use - eine Trennung darf nie
  // an der Bremse haengen bleiben, sonst raeumt der Server die Partie nicht ab.
  socket.on('disconnect', (grund) => behandleTrennung(socket, grund));
});

/** Ein Spieler meldet sich mit seinem Namen an. */
function behandleAnmeldung(socket, rohName) {
  // Der Server traut dem Client grundsaetzlich nicht: jede Eingabe wird geprueft.
  const name = typeof rohName === 'string' ? rohName.trim().slice(0, MAX_NAMENSLAENGE) : '';

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
 * Alle Wege zurueck in die Lobby laufen hier durch - Anmeldung,
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
 * Der Browser bietet in diesen Faellen gar keine Knoepfe an. Geprueft wird
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
 * Oeffentlich spielen: ab in die Warteschlange des gewaehlten Modus.
 * Jeder Modus hat seine eigene Warteschlange - wer Duell waehlt, trifft nur
 * auf jemanden, der ebenfalls Duell gewaehlt hat.
 */
function behandleWarteschlangeBetreten(socket, rohDaten) {
  const fehler = pruefeFrei(socket);
  if (fehler) {
    socket.emit('fehler', fehler);
    return;
  }

  // Ohne Angabe gilt Zufallstier - so funktionieren auch aeltere Clients.
  const { modus = 'zufall' } = alsObjekt(rohDaten);
  if (!SPIELBARE_MODI.includes(modus)) {
    socket.emit('fehler', 'Diesen Modus gibt es nicht.');
    return;
  }

  socket.leave(RAUM_LOBBY);
  const spiel = verwaltung.suchePartie(socket.id, modus);

  if (spiel === null) {
    socket.emit('warten', { modus, zugzeit: STANDARD_ZUGZEIT });
    return;
  }

  verkuendeSpielStart(spiel);
}

/** Doch nicht oeffentlich spielen: zurueck in die Lobby. */
function behandleWarteschlangeVerlassen(socket) {
  if (!verwaltung.wartet(socket.id)) return; // war gar nicht drin

  verwaltung.verlasseWarteschlange(socket.id);
  betreteLobby(socket);
}

/**
 * Macht aus einer Nutzlast ein Objekt, ohne abzustuerzen.
 * Der Client koennte statt { modus, passwort } auch null, eine Zahl oder
 * einen Text schicken - dann gelten alle Felder als fehlend.
 */
function alsObjekt(daten) {
  return typeof daten === 'object' && daten !== null ? daten : {};
}

/** Eine private Lobby eroeffnen. */
function behandleLobbyErstellen(socket, rohDaten) {
  const fehler = pruefeFrei(socket);
  if (fehler) {
    socket.emit('fehler', fehler);
    return;
  }

  // Modus und Passwort prueft lobbys.js - der Browser prueft nur aus Komfort.
  // Ohne Angabe gilt die Standard-Zugzeit - so funktionieren auch aeltere Clients.
  const { modus, passwort, zugzeit = STANDARD_ZUGZEIT } = alsObjekt(rohDaten);
  const ergebnis = lobbys.erstelle(socket.id, socket.data.name, modus, passwort, zugzeit);

  if (ergebnis.fehler) {
    // grund: 'passwort', 'modus', 'zugzeit' oder 'voll' (50 Lobbys erreicht)
    socket.emit('erstellenAbgelehnt', { grund: ergebnis.fehler });
    return;
  }

  // Das Passwort steht bewusst NICHT im Log.
  console.log(`[i] "${socket.data.name}" hat eine Lobby eroeffnet (Modus ${ergebnis.lobby.modus})`);

  socket.leave(RAUM_LOBBY);
  socket.emit('lobbyErstellt', { modus: ergebnis.lobby.modus, zugzeit: ergebnis.lobby.zugzeit });
  verschickeLobbyListe();
}

/** Die eigene, noch wartende Lobby schliessen und zurueck in die Lobby. */
function behandleLobbySchliessen(socket) {
  const lobby = lobbys.lobbyVon(socket.id);
  // Eine besetzte Lobby gehoert zu einer laufenden Partie - die schliesst
  // man nicht per Knopf, sondern durch das Spielende.
  if (!lobby || lobby.besetzt) return;

  lobbys.schliesse(socket.id);
  betreteLobby(socket);
  verschickeLobbyListe();
}

/**
 * Einer privaten Lobby beitreten.
 *
 * Bewusst ohne "await", wie beim Raten: Die Pruefung samt Passwortvergleich
 * laeuft in einem Stueck durch. Treten zwei gleichzeitig mit dem richtigen
 * Passwort bei, wird der erste fertig bearbeitet, bevor der zweite drankommt
 * - und der findet die Lobby schon besetzt vor.
 */
function behandleLobbyBeitreten(socket, rohDaten) {
  const fehler = pruefeFrei(socket);
  if (fehler) {
    socket.emit('fehler', fehler);
    return;
  }

  const { lobbyId, passwort } = alsObjekt(rohDaten);
  const ergebnis = lobbys.trittBei(lobbyId, socket.id, passwort);

  if (ergebnis.fehler) {
    // grund: 'passwort', 'voll', 'weg' oder 'gesperrt'. ('eigene' kann hier
    // nicht vorkommen - wer eine eigene Lobby hat, ist nicht frei.)
    socket.emit('beitrittAbgelehnt', { grund: ergebnis.fehler });
    return;
  }

  const { lobby } = ergebnis;
  console.log(`[i] "${socket.data.name}" tritt der Lobby von "${lobby.erstellerName}" bei`);

  const spiel = verwaltung.starteLobbyPartie(lobby.erstellerId, socket.id, lobby.modus, lobby.zugzeit);
  verkuendeSpielStart(spiel);
  verschickeLobbyListe(); // die Lobby ist jetzt besetzt und verschwindet
}

/**
 * Gibt beiden Spielern den Startschuss - fuer oeffentliche Partien,
 * Lobby-Partien und Revanchen gleichermassen.
 */
function verkuendeSpielStart(spiel) {
  // Beim Zufallstier wird sofort geraten - die Uhr laeuft ab jetzt. Im Duell
  // erst nach der Wahl (siehe behandleTierwahl): Fuers Aussuchen gibt es
  // keine Frist.
  if (spiel.phase === 'raten') starteFrist(spiel);

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
      restzeitMs: zuguhren.restzeitMs(spiel),
    });
  }

  const [idA, idB] = spiel.spielerIds;
  console.log(spiel.modus === 'duell'
    ? `[*] Duell gestartet: "${namenVon(idA)}" gegen "${namenVon(idB)}" - beide waehlen ein Tier`
    : `[*] Partie gestartet: "${namenVon(idA)}" gegen "${namenVon(idB)}", Modus ${spiel.modus} ` +
      `(gesucht: ${spiel.geheimnis.name})`);
}

/**
 * Duell: Ein Spieler waehlt das Tier, das sein Gegner erraten muss.
 *
 * Die Wahl bleibt geheim: Der Waehlende bekommt sie bestaetigt, der Gegner
 * erfaehrt nur, DASS gewaehlt wurde - nicht was. Erst das Spielende
 * verraet es. Bewusst ohne "await", wie beim Raten.
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
  socket.emit('tierGewaehlt', { tierName: tier.name });
  socketVon(gegnerId)?.emit('gegnerHatGewaehlt');

  if (spiel.phase !== 'raten') return; // der Gegner waehlt noch

  starteFrist(spiel);
  for (const id of spiel.spielerIds) {
    socketVon(id)?.emit('duellStart', {
      duBistDran: spiel.amZug === id,
      restzeitMs: zuguhren.restzeitMs(spiel),
    });
  }
  console.log(`[*] Duell laeuft: "${namenVon(socket.id)}" sucht ${spiel.geheimnisVon(socket.id).name}, ` +
    `"${namenVon(gegnerId)}" sucht ${spiel.geheimnisVon(gegnerId).name}`);
}

/** Hoechstens so oft (in ms) wird "tippt" pro Verbindung weitergegeben. */
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
 * Fehlermeldung wert. Die Nachrichtenbremse zaehlt "tippt" ohnehin mit.
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
 * eroeffnet eine neue Lobby.
 */
function beendePartie(spiel) {
  zuguhren.stoppe(spiel);
  verwaltung.beende(spiel);
  for (const id of spiel.spielerIds) lobbys.schliesse(id);
}

// --------------------------------------------------------------------------
// Zugzeit
// --------------------------------------------------------------------------

/** Startet die Frist fuer den Spieler, der jetzt am Zug ist (bei 0 nichts). */
function starteFrist(spiel) {
  zuguhren.starte(spiel, laufeFristAb);
}

/**
 * Die Zeit ist um: Der Zug geht ohne Tipp an den Gegner, und dessen Frist
 * beginnt. Beide erfahren es - mit der neuen Restzeit, damit ihre Anzeige
 * wieder bei voller Zeit anfaengt.
 */
function laufeFristAb(spiel) {
  // Zur Sicherheit: Eine beendete oder schon abgeraeumte Partie hat keine
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
  console.log(`[*] Zeit abgelaufen fuer "${namenVon(verpasstVon)}" - "${namenVon(spiel.amZug)}" ist dran`);
}

/**
 * Was beide Knoepfe der Endkarte voraussetzen: Der Spieler ist angemeldet,
 * und seine alte Partie ist wirklich vorbei.
 *
 * Der Browser sperrt die Knoepfe zwar selbst, aber darauf ist wie ueberall
 * kein Verlass - ein manipulierter Client koennte sie jederzeit wieder
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
 * Nimmt ein Revanche-Angebot zurueck und sagt dem Gegner Bescheid, falls der
 * schon zugestimmt hat und nun vergeblich wartet.
 *
 * Die Reihenfolge ist wichtig: erst fragen, dann loeschen. Nach dem Loeschen
 * weiss niemand mehr, wem die Absage ueberhaupt gilt.
 */
function loeseRevancheAuf(socket, grund) {
  const wartenderId = verwaltung.wartetAufRevancheMit(socket.id);
  verwaltung.vergissRevanche(socket.id);
  socketVon(wartenderId)?.emit('revancheGeplatzt', grund);
}

/** Ein Spieler moechte noch einmal gegen denselben Gegner antreten. */
function behandleRevanche(socket) {
  const fehler = pruefeNeustart(socket);
  if (fehler) {
    socket.emit('fehler', fehler);
    return;
  }

  const ergebnis = verwaltung.stimmeRevancheZu(socket.id);

  if (ergebnis.status === 'unmoeglich') {
    socket.emit('fehler', 'Eine Revanche ist nicht mehr möglich. Such dir in der Lobby einen neuen Gegner.');
    return;
  }

  if (ergebnis.status === 'wartet') {
    socket.emit('revancheWartet');
    socketVon(ergebnis.gegnerId)?.emit('revancheAngeboten');
    return;
  }

  // Beide haben zugestimmt: neue Partie, neues Geheimnis, gleiche Gegner.
  console.log(`[*] Revanche zwischen "${namenVon(ergebnis.spiel.spielerIds[0])}" und ` +
    `"${namenVon(ergebnis.spiel.spielerIds[1])}"`);
  verkuendeSpielStart(ergebnis.spiel);
}

/** Ein Spieler geht von der Endkarte zurueck in die Lobby. */
function behandleZurLobby(socket) {
  const fehler = pruefeNeustart(socket);
  if (fehler) {
    socket.emit('fehler', fehler);
    return;
  }

  // Wer in die Lobby geht, steht fuer eine Revanche nicht mehr bereit.
  loeseRevancheAuf(socket, 'Gegner ist in der Lobby');

  // Nur zur Sicherheit: In der Lobby wartet man nirgends. Ein manipulierter
  // Client koennte "zurLobby" schicken, waehrend er noch woanders wartet.
  verwaltung.verlasseWarteschlange(socket.id);
  if (lobbys.schliesse(socket.id)) verschickeLobbyListe();

  betreteLobby(socket);
}

/**
 * Die vier Spielregeln. Liefert entweder das geratene Tier - oder den Grund,
 * warum der Zug nicht erlaubt ist.
 *
 * Das sind die eigentlichen Regeln des Spiels. Der Browser sperrt das
 * Eingabefeld zwar auch, aber darauf ist kein Verlass: Ein manipulierter
 * Client koennte es einfach wieder aktivieren. Deshalb stehen sie hier
 * gebuendelt an einer Stelle - wer wissen will, wogegen Zoodle absichert,
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
  // Tipp kam trotzdem zu spaet.
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
 * Schickt einen ausgefuehrten Zug an beide Spieler.
 *
 * Beide sehen denselben Tipp mit denselben Hinweisen - das ist der Kern des
 * Duells. Unterschiedlich ist nur, was fuer wen gilt: "vonMir", "duBistDran"
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
        // Das Tier, das DIESER Empfaenger gesucht hat - im Duell hat jeder
        // sein eigenes, beim Zufallstier ist es fuer beide dasselbe.
        geheimnis: spiel.geheimnisVon(id),
        // Beim Zufallstier raten beide zusammen auf ein Tier - es zaehlen
        // alle Tipps. Im Duell sucht jeder sein eigenes Tier, dort zaehlen
        // nur die Tipps des Gewinners.
        anzahlTipps: spiel.modus === 'duell'
          ? spiel.versuche.filter((v) => v.spielerId === raterId).length
          : spiel.versuche.length,
      });
    }
  }
}

/**
 * Ein Spieler rät ein Tier.
 *
 * Bewusst ohne "await": Die Verarbeitung eines Zuges laeuft in einem Stueck
 * durch. Node arbeitet Nachrichten nacheinander ab, und solange hier nichts
 * unterbricht, koennen zwei gleichzeitige Tipps sich nicht verschraenken.
 * Genau das schuetzt die Zugreihenfolge.
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
  // Vor dem Verteilen: Die Nachricht "zug" nennt schon die Frist des Naechsten.
  if (versuch.richtig) {
    zuguhren.stoppe(spiel);
  } else {
    starteFrist(spiel);
  }
  verteileZug(spiel, versuch, socket.id, raterName);

  if (versuch.richtig) {
    console.log(`[*] "${raterName}" hat "${spiel.geheimnisVon(socket.id).name}" erraten. Partie beendet.`);
    beendePartie(spiel);
  }
}

/** Ein Spieler hat die Verbindung verloren. */
function behandleTrennung(socket, grund) {
  console.log(`[-] Verbindung getrennt: ${socket.id} (${grund})`);

  // Muss VOR entferne() geschehen: Das raeumt die Revanche-Notizen ab, und
  // danach ist nicht mehr feststellbar, wer hier auf ein Duell wartet.
  const wartenderId = verwaltung.wartetAufRevancheMit(socket.id);

  const spiel = verwaltung.entferne(socket.id);
  if (spiel) zuguhren.stoppe(spiel); // keine Frist fuer eine Partie ohne Spieler

  socketVon(wartenderId)?.emit('revancheGeplatzt', 'Gegner ist weg');

  // Eine offene Lobby des Getrennten verschwindet aus der Liste.
  if (lobbys.entferneSpieler(socket.id)) verschickeLobbyListe();

  if (!spiel) return;

  // Kam die Partie aus einer Lobby des GEGNERS, ist auch die jetzt erledigt.
  const gegnerId = spiel.gegnerVon(socket.id);
  lobbys.schliesse(gegnerId);

  // Laut Aufgabenstellung wird die Partie bei einem Abbruch einfach beendet.
  // Der Gegner erfaehrt das Tier, das ER gesucht hat - im Duell nur, wenn es
  // schon gewaehlt war.
  socketVon(gegnerId)?.emit('gegnerWeg', { geheimnis: spiel.geheimnisVon(gegnerId) });
}

// --------------------------------------------------------------------------
// Robustheit: Der Server darf laut Aufgabenstellung niemals abstuerzen.
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
      // IPv6-Adressen gehoeren in eckige Klammern.
      adressen.push(family === 'IPv6'
        ? `http://[${address}]:${port}`
        : `http://${address}:${port}`);
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
