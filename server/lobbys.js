/**
 * Lobbyverwaltung - private Lobbys mit Passwort und Spielmodus.
 *
 * Wie partien.js kennt diese Klasse weder Socket.io noch HTTP, sondern nur
 * Spieler-Kennungen (Strings). Dadurch laesst sie sich ohne laufenden Server
 * testen - siehe tests/lobbys.test.js.
 *
 * Ablauf einer Lobby:
 *   erstellen  ->  offen (steht in der Liste)
 *              ->  besetzt (jemand ist mit dem richtigen Passwort beigetreten,
 *                  die Partie laeuft; nicht mehr in der Liste)
 *              ->  geschlossen (Ersteller schliesst, Partie vorbei, Trennung)
 */

import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { STANDARD_ZUGZEIT, istGueltigeZugzeit } from './zugzeit.js';

/** Alle Spielmodi, die es gibt. */
export const MODI = ['zufall', 'duell'];

/**
 * Die Modi, die man fuer eine Lobby waehlen darf. Getrennt von MODI, damit
 * ein kuenftiger Modus erst angelegt und spaeter freigeschaltet werden kann.
 */
export const SPIELBARE_MODI = ['zufall', 'duell'];

export const MIN_PASSWORTLAENGE = 4;
export const MAX_PASSWORTLAENGE = 32;

/** Obergrenze fuer alle Lobbys zusammen - schuetzt den Speicher des Servers. */
export const MAX_LOBBYS = 50;

/** Nach so vielen falschen Passwoertern wird gesperrt ... */
export const MAX_FEHLVERSUCHE = 5;

/** ... und zwar so lange (in Millisekunden). */
export const SPERRDAUER = 30_000;

/** Laenge des Passwort-Hashes in Byte. */
const HASHLAENGE = 32;

/** Ist das ueberhaupt ein zulaessiges Passwort? Beliebige Zeichen, 4 bis 32. */
function istGueltigesPasswort(passwort) {
  return typeof passwort === 'string'
    && passwort.length >= MIN_PASSWORTLAENGE
    && passwort.length <= MAX_PASSWORTLAENGE;
}

/**
 * Macht aus einem Passwort einen Hash.
 *
 * scrypt ist absichtlich langsam: Wer die gespeicherten Hashes erbeutet, kann
 * damit nicht in Sekunden Millionen Passwoerter durchprobieren. Das Salz sorgt
 * dafuer, dass zwei gleiche Passwoerter trotzdem verschiedene Hashes ergeben.
 */
function hashe(passwort, salz) {
  return scryptSync(passwort, salz, HASHLAENGE);
}

export class Lobbyverwaltung {
  /** Alle Lobbys:  lobbyId -> Lobby */
  #lobbys = new Map();

  /**
   * Falsche Passwoerter, gezaehlt je Spieler UND Lobby:
   * "lobbyId spielerId" -> { anzahl, gesperrtBis }
   */
  #fehlversuche = new Map();

  /** Liefert die aktuelle Zeit in Millisekunden - in Tests eine Attrappe. */
  #uhr;

  /**
   * @param {object} [optionen]
   * @param {() => number} [optionen.uhr]  Zeitquelle, Standard Date.now.
   *   Tests reichen eine eigene Uhr herein, um 30 Sekunden Sperre zu pruefen,
   *   ohne 30 Sekunden zu warten.
   */
  constructor({ uhr = () => Date.now() } = {}) {
    this.#uhr = uhr;
  }

  /**
   * Legt eine neue Lobby an.
   *
   * @param {number} [zugzeit]  Sekunden pro Zug: 10, 20, 30, 60 oder 0 (ohne Limit)
   * @returns {{lobby: object}
   *         | {fehler: 'passwort' | 'modus' | 'zugzeit' | 'schonOffen' | 'voll'}}
   */
  erstelle(erstellerId, erstellerName, modus, passwort, zugzeit = STANDARD_ZUGZEIT) {
    if (!SPIELBARE_MODI.includes(modus)) return { fehler: 'modus' };
    if (!istGueltigeZugzeit(zugzeit)) return { fehler: 'zugzeit' };
    if (!istGueltigesPasswort(passwort)) return { fehler: 'passwort' };
    if (this.lobbyVon(erstellerId)) return { fehler: 'schonOffen' };
    if (this.#lobbys.size >= MAX_LOBBYS) return { fehler: 'voll' };

    const salz = randomBytes(16);
    const lobby = {
      id: randomUUID(),
      erstellerId,
      erstellerName,
      modus,
      zugzeit,
      passwortHash: hashe(passwort, salz),
      salz,
      erstelltAm: this.#uhr(),
      besetzt: false,
    };
    this.#lobbys.set(lobby.id, lobby);
    return { lobby };
  }

  /**
   * Die offenen Lobbys fuer die Anzeige - neueste zuerst.
   *
   * Bewusst eine NEUE, schmale Form: Hash und Salz verlassen den Server nie,
   * auch nicht die Kennung des Erstellers.
   *
   * @returns {Array<{id: string, erstellerName: string, modus: string, zugzeit: number}>}
   */
  liste() {
    return [...this.#lobbys.values()]
      .filter((lobby) => !lobby.besetzt)
      .reverse() // bei gleicher Zeit: zuletzt angelegt zuerst
      .sort((a, b) => b.erstelltAm - a.erstelltAm)
      .map(({ id, erstellerName, modus, zugzeit }) => ({ id, erstellerName, modus, zugzeit }));
  }

  /**
   * Ein Spieler moechte einer Lobby beitreten.
   *
   * Die Reihenfolge der Pruefungen ist Absicht: Erst wenn feststeht, dass die
   * Lobby existiert, frei ist und der Spieler nicht gesperrt ist, wird das
   * Passwort ueberhaupt geprueft.
   *
   * @returns {{lobby: object}
   *         | {fehler: 'weg' | 'gesperrt' | 'voll' | 'eigene' | 'passwort'}}
   */
  trittBei(lobbyId, spielerId, passwort) {
    const lobby = this.#lobbys.get(lobbyId);
    if (!lobby) return { fehler: 'weg' };

    const schluessel = `${lobby.id} ${spielerId}`;
    const versuche = this.#fehlversuche.get(schluessel);
    if (versuche && versuche.gesperrtBis > this.#uhr()) return { fehler: 'gesperrt' };

    if (lobby.besetzt) return { fehler: 'voll' };
    if (lobby.erstellerId === spielerId) return { fehler: 'eigene' };

    if (!this.#passwortStimmt(lobby, passwort)) {
      this.#merkeFehlversuch(schluessel);
      return { fehler: 'passwort' };
    }

    this.#fehlversuche.delete(schluessel);
    lobby.besetzt = true;
    return { lobby };
  }

  /**
   * Vergleicht das Passwort mit dem gespeicherten Hash.
   *
   * timingSafeEqual braucht fuer jeden Vergleich gleich lange - egal, an
   * welcher Stelle sich die Hashes unterscheiden. Ein normales "===" bricht
   * beim ersten Unterschied ab, und aus der Antwortzeit liesse sich dann
   * Stueck fuer Stueck ablesen, wie viel schon stimmt.
   */
  #passwortStimmt(lobby, passwort) {
    // Unsinnige Eingaben gar nicht erst hashen - scrypt kostet Rechenzeit.
    if (!istGueltigesPasswort(passwort)) return false;
    return timingSafeEqual(hashe(passwort, lobby.salz), lobby.passwortHash);
  }

  /** Zaehlt einen Fehlversuch - beim fuenften beginnt die Sperre. */
  #merkeFehlversuch(schluessel) {
    const versuche = this.#fehlversuche.get(schluessel) ?? { anzahl: 0, gesperrtBis: 0 };
    versuche.anzahl += 1;

    if (versuche.anzahl >= MAX_FEHLVERSUCHE) {
      versuche.gesperrtBis = this.#uhr() + SPERRDAUER;
      // Nach Ablauf der Sperre gibt es wieder fuenf neue Versuche.
      versuche.anzahl = 0;
    }
    this.#fehlversuche.set(schluessel, versuche);
  }

  /** @returns {object | undefined} Die Lobby, die dieser Spieler erstellt hat. */
  lobbyVon(erstellerId) {
    for (const lobby of this.#lobbys.values()) {
      if (lobby.erstellerId === erstellerId) return lobby;
    }
    return undefined;
  }

  /**
   * Schliesst die Lobby dieses Erstellers - egal ob offen oder besetzt.
   *
   * @returns {boolean} true, wenn sich die Liste dadurch aendert - also nur,
   *                    wenn die Lobby noch offen in der Liste stand.
   */
  schliesse(erstellerId) {
    const lobby = this.lobbyVon(erstellerId);
    if (!lobby) return false;

    this.#lobbys.delete(lobby.id);
    for (const schluessel of this.#fehlversuche.keys()) {
      if (schluessel.startsWith(`${lobby.id} `)) this.#fehlversuche.delete(schluessel);
    }
    return !lobby.besetzt;
  }

  /**
   * Ein Spieler hat die Verbindung verloren: seine Lobby verschwindet, und
   * seine Fehlversuche bei fremden Lobbys werden vergessen.
   *
   * @returns {boolean} true, wenn sich die Liste dadurch aendert
   */
  entferneSpieler(spielerId) {
    for (const schluessel of this.#fehlversuche.keys()) {
      if (schluessel.endsWith(` ${spielerId}`)) this.#fehlversuche.delete(schluessel);
    }
    return this.schliesse(spielerId);
  }

  /** Nur fuer Diagnose und Tests: wie viele Lobbys gibt es (offen + besetzt)? */
  get anzahlLobbys() {
    return this.#lobbys.size;
  }

  /** Nur fuer Diagnose und Tests: wie viele Fehlversuch-Eintraege liegen herum? */
  get anzahlFehlversuche() {
    return this.#fehlversuche.size;
  }
}
