/**
 * Lobbyverwaltung - private Lobbys mit Passwort und Spielmodus.
 *
 * Wie partien.js kennt diese Klasse weder Socket.io noch HTTP, sondern nur
 * Spieler-Kennungen (Strings). Dadurch lässt sie sich ohne laufenden Server
 * testen - siehe tests/lobbys.test.js.
 *
 * Ablauf einer Lobby:
 *   erstellen  ->  offen (steht in der Liste)
 *              ->  besetzt (jemand ist mit dem richtigen Passwort beigetreten,
 *                  die Partie läuft; nicht mehr in der Liste)
 *              ->  geschlossen (Ersteller schließt, Partie vorbei, Trennung)
 */

import { randomUUID, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { STANDARD_ZUGZEIT, istGueltigeZugzeit } from './zugzeit.js';

/** Die Spielmodi, die man für eine Lobby oder die Warteschlange wählen darf. */
export const SPIELBARE_MODI = ['zufall', 'duell'];

export const MIN_PASSWORTLAENGE = 4;
export const MAX_PASSWORTLAENGE = 32;

/** Obergrenze für alle Lobbys zusammen - schützt den Speicher des Servers. */
export const MAX_LOBBYS = 50;

/**
 * Höchstens so viele offene Lobbys von derselben IP-Adresse. Sonst könnte
 * einer mit 50 Tabs alle Plätze belegen. Bewusst nicht 1: Am Spieltag
 * kommen viele Studierende über dasselbe Hochschulnetz.
 */
export const MAX_LOBBYS_PRO_ADRESSE = 3;

/**
 * So lange (in Millisekunden) bleibt eine Lobby offen, der niemand beitritt.
 * Danach schließt der Server sie, damit vergessene Lobbys keinen Platz
 * belegen.
 */
export const LOBBY_LEBENSDAUER = 10 * 60_000;

/** Nach so vielen falschen Passwörtern wird gesperrt ... */
export const MAX_FEHLVERSUCHE = 5;

/** ... und zwar so lange (in Millisekunden). */
export const SPERRDAUER = 30_000;

/**
 * So viele Passwörter darf der Server höchstens gleichzeitig hashen.
 * Jede Prüfung belegt einen Hilfsthread von Node, und davon gibt es nur
 * wenige (standardmäßig vier). Wer mehr schickt, bekommt "beschaeftigt"
 * statt einer Warteschlange, die immer länger wird.
 */
export const MAX_GLEICHZEITIGE_PRUEFUNGEN = 4;

/** Länge des Passwort-Hashes in Byte. */
const HASHLAENGE = 32;

/** scrypt als Promise - damit sich "await" darauf anwenden lässt. */
const scryptAsync = promisify(scrypt);

/** Ist das überhaupt ein zulässiges Passwort? Beliebige Zeichen, 4 bis 32. */
function istGueltigesPasswort(passwort) {
  return (
    typeof passwort === 'string' &&
    passwort.length >= MIN_PASSWORTLAENGE &&
    passwort.length <= MAX_PASSWORTLAENGE
  );
}

/**
 * Macht aus einem Passwort einen Hash.
 *
 * scrypt ist absichtlich langsam: Wer die gespeicherten Hashes erbeutet, kann
 * damit nicht in Sekunden Millionen Passwörter durchprobieren. Das Salz sorgt
 * dafür, dass zwei gleiche Passwörter trotzdem verschiedene Hashes ergeben.
 *
 * Bewusst die asynchrone Variante: scryptSync rechnet rund 35 ms im
 * Hauptthread, und in dieser Zeit steht der GANZE Server still - für alle
 * Spieler. scrypt rechnet in einem Hilfsthread, währenddessen bearbeitet
 * Node andere Nachrichten weiter.
 *
 * @returns {Promise<Buffer>}
 */
function hashe(passwort, salz) {
  return scryptAsync(passwort, salz, HASHLAENGE);
}

export class Lobbyverwaltung {
  /** Alle Lobbys:  lobbyId -> Lobby */
  #lobbys = new Map();

  /**
   * Falsche Passwörter, gezählt je IP-Adresse UND Lobby:
   * "lobbyId adresse" -> { anzahl, gesperrtBis }
   *
   * Bewusst die Adresse, nicht die Socket-Kennung: Eine neue Verbindung
   * bekommt eine neue Kennung - wer neu lädt, hätte sonst wieder fünf
   * Versuche. Die Einträge bleiben deshalb auch beim Trennen liegen und
   * verschwinden erst mit der Lobby. Die Adressen stehen nur hier im
   * Arbeitsspeicher und in keinem Log.
   */
  #fehlversuche = new Map();

  /** Liefert die aktuelle Zeit in Millisekunden - in Tests eine Attrappe. */
  #uhr;

  /** Wie viele Passwörter gerade gehasht werden (höchstens 4). */
  #laufendePruefungen = 0;

  /**
   * @param {object} [optionen]
   * @param {() => number} [optionen.uhr]  Zeitquelle, Standard Date.now.
   *   Tests reichen eine eigene Uhr herein, um 30 Sekunden Sperre zu prüfen,
   *   ohne 30 Sekunden zu warten.
   */
  constructor({ uhr = () => Date.now() } = {}) {
    this.#uhr = uhr;
  }

  /**
   * Hasht ein Passwort - aber nur, solange noch ein Platz frei ist.
   *
   * @returns {Promise<Buffer | null>} null, wenn schon zu viele laufen
   */
  async #hasheMitLimit(passwort, salz) {
    if (this.#laufendePruefungen >= MAX_GLEICHZEITIGE_PRUEFUNGEN) return null;

    this.#laufendePruefungen += 1;
    try {
      return await hashe(passwort, salz);
    } finally {
      // "finally": Der Platz wird auch dann wieder frei, wenn scrypt scheitert.
      this.#laufendePruefungen -= 1;
    }
  }

  /** Die Prüfungen vor dem Erstellen, die sich während des Hashens ändern können. */
  #pruefeErstellen(erstellerId, adresse) {
    if (this.lobbyVon(erstellerId)) return { fehler: 'schonOffen' };
    if (this.#lobbys.size >= MAX_LOBBYS) return { fehler: 'voll' };

    const vonDieserAdresse = [...this.#lobbys.values()].filter(
      (lobby) => !lobby.besetzt && lobby.adresse === adresse,
    );
    if (vonDieserAdresse.length >= MAX_LOBBYS_PRO_ADRESSE) return { fehler: 'zuVieleVonDir' };
    return null;
  }

  /**
   * Legt eine neue Lobby an.
   *
   * Asynchron, weil das Hashen Zeit braucht (siehe hashe). Währenddessen
   * läuft der Server weiter, und alles kann sich ändern: Derselbe Spieler
   * hat schon eine zweite Lobby eröffnet, die Obergrenze ist erreicht, oder
   * er hat sich getrennt. Deshalb wird NACH dem "await" alles noch einmal
   * geprüft - in einem Stück, ohne weiteres "await" dazwischen.
   *
   * @param {number} [zugzeit]  Sekunden pro Zug: 10, 20, 30, 60 oder 0 (ohne Limit)
   * @param {object} [optionen]
   * @param {string} [optionen.adresse]  IP-Adresse des Erstellers - für
   *   die Obergrenze je Adresse. Ohne Angabe (in einfachen Tests) zählt die
   *   Kennung.
   * @param {() => boolean} [optionen.istSpielerFrei]  Fragt nach dem Hashen
   *   beim Server nach, ob der Spieler noch verbunden und frei ist. Diese
   *   Klasse kennt keine Sockets - das weiß nur server.js.
   * @returns {Promise<{lobby: object}
   *         | {fehler: 'passwort' | 'modus' | 'zugzeit' | 'schonOffen' | 'voll'
   *                  | 'zuVieleVonDir' | 'beschaeftigt' | 'nichtFrei'}>}
   */
  async erstelle(
    erstellerId,
    erstellerName,
    modus,
    passwort,
    zugzeit = STANDARD_ZUGZEIT,
    { adresse = erstellerId, istSpielerFrei = () => true } = {},
  ) {
    if (!SPIELBARE_MODI.includes(modus)) return { fehler: 'modus' };
    if (!istGueltigeZugzeit(zugzeit)) return { fehler: 'zugzeit' };
    if (!istGueltigesPasswort(passwort)) return { fehler: 'passwort' };
    const vorher = this.#pruefeErstellen(erstellerId, adresse);
    if (vorher) return vorher;

    const salz = randomBytes(16);
    const passwortHash = await this.#hasheMitLimit(passwort, salz);
    if (!passwortHash) return { fehler: 'beschaeftigt' };

    // Ab hier kein "await" mehr: Prüfen und Eintragen laufen in einem Stück.
    const nachher = this.#pruefeErstellen(erstellerId, adresse);
    if (nachher) return nachher;
    if (!istSpielerFrei()) return { fehler: 'nichtFrei' };

    const lobby = {
      id: randomUUID(),
      erstellerId,
      erstellerName,
      modus,
      zugzeit,
      passwortHash,
      salz,
      // Bleibt auf dem Server - liste() gibt sie nicht heraus.
      adresse,
      erstelltAm: this.#uhr(),
      besetzt: false,
    };
    this.#lobbys.set(lobby.id, lobby);
    return { lobby };
  }

  /**
   * Die offenen Lobbys für die Anzeige - neueste zuerst.
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
   * Die Prüfungen vor dem Passwortvergleich - vor UND nach dem Hashen.
   *
   * Die Reihenfolge ist Absicht: Erst wenn feststeht, dass die Lobby
   * existiert, frei ist und der Spieler nicht gesperrt ist, wird das Passwort
   * überhaupt geprüft.
   *
   * @returns {{lobby: object, schluessel: string} | {fehler: string}}
   */
  #pruefeBeitritt(lobbyId, spielerId, adresse) {
    const lobby = this.#lobbys.get(lobbyId);
    if (!lobby) return { fehler: 'weg' };

    const schluessel = `${lobby.id} ${adresse}`;
    const versuche = this.#fehlversuche.get(schluessel);
    if (versuche && versuche.gesperrtBis > this.#uhr()) return { fehler: 'gesperrt' };

    if (lobby.besetzt) return { fehler: 'voll' };
    if (lobby.erstellerId === spielerId) return { fehler: 'eigene' };
    return { lobby, schluessel };
  }

  /**
   * Ein Spieler möchte einer Lobby beitreten.
   *
   * Asynchron, weil das Hashen Zeit braucht. Der gefährliche Moment ist das
   * "await": Währenddessen kann ein zweiter Spieler mit dem richtigen
   * Passwort schneller sein, der Ersteller kann die Lobby schliessen, oder
   * dieser Spieler trennt sich. Deshalb wird nach dem Hashen ALLES noch
   * einmal geprüft - und erst dann, ohne weiteres "await" dazwischen, die
   * Lobby als besetzt markiert. Wer zuerst dort ankommt, bekommt sie; der
   * Zweite findet sie schon besetzt vor.
   *
   * @param {object} [optionen]
   * @param {string} [optionen.adresse]  IP-Adresse für die Sperre nach
   *   Fehlversuchen. Ohne Angabe (in einfachen Tests) zählt die Kennung.
   * @param {() => boolean} [optionen.istSpielerFrei]  wie bei erstelle()
   * @returns {Promise<{lobby: object}
   *         | {fehler: 'weg' | 'gesperrt' | 'voll' | 'eigene' | 'passwort'
   *                  | 'beschaeftigt' | 'nichtFrei'}>}
   */
  async trittBei(
    lobbyId,
    spielerId,
    passwort,
    { adresse = spielerId, istSpielerFrei = () => true } = {},
  ) {
    const vorher = this.#pruefeBeitritt(lobbyId, spielerId, adresse);
    if (vorher.fehler) return vorher;

    // Unsinnige Eingaben gar nicht erst hashen - scrypt kostet Rechenzeit.
    if (!istGueltigesPasswort(passwort)) {
      this.#merkeFehlversuch(vorher.schluessel);
      return { fehler: 'passwort' };
    }

    const hash = await this.#hasheMitLimit(passwort, vorher.lobby.salz);
    if (!hash) return { fehler: 'beschaeftigt' };

    // Ab hier kein "await" mehr: Prüfen und Besetzen laufen in einem Stück.
    const nachher = this.#pruefeBeitritt(lobbyId, spielerId, adresse);
    if (nachher.fehler) return nachher;
    if (!istSpielerFrei()) return { fehler: 'nichtFrei' };

    // timingSafeEqual braucht für jeden Vergleich gleich lange - egal, an
    // welcher Stelle sich die Hashes unterscheiden. Ein normales "===" bricht
    // beim ersten Unterschied ab, und aus der Antwortzeit ließe sich dann
    // Stück für Stück ablesen, wie viel schon stimmt.
    if (!timingSafeEqual(hash, nachher.lobby.passwortHash)) {
      this.#merkeFehlversuch(nachher.schluessel);
      return { fehler: 'passwort' };
    }

    this.#fehlversuche.delete(nachher.schluessel);
    nachher.lobby.besetzt = true;
    return { lobby: nachher.lobby };
  }

  /** Zählt einen Fehlversuch - beim fünften beginnt die Sperre. */
  #merkeFehlversuch(schluessel) {
    const versuche = this.#fehlversuche.get(schluessel) ?? { anzahl: 0, gesperrtBis: 0 };
    versuche.anzahl += 1;

    if (versuche.anzahl >= MAX_FEHLVERSUCHE) {
      versuche.gesperrtBis = this.#uhr() + SPERRDAUER;
      // Nach Ablauf der Sperre gibt es wieder fünf neue Versuche.
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
   * Schließt die Lobby dieses Erstellers - egal ob offen oder besetzt.
   *
   * @returns {boolean} true, wenn sich die Liste dadurch ändert - also nur,
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
   * Schließt alle offenen Lobbys, denen seit LOBBY_LEBENSDAUER niemand
   * beigetreten ist. server.js ruft das regelmäßig auf und sagt den
   * Erstellern Bescheid. Besetzte Lobbys bleiben - dort läuft eine Partie.
   *
   * @returns {string[]} Die Kennungen der Ersteller, deren Lobby zu ist
   */
  raeumeAbgelaufeneAuf() {
    const grenze = this.#uhr() - LOBBY_LEBENSDAUER;
    const abgelaufen = [...this.#lobbys.values()].filter(
      (lobby) => !lobby.besetzt && lobby.erstelltAm <= grenze,
    );

    for (const lobby of abgelaufen) this.schliesse(lobby.erstellerId);
    return abgelaufen.map((lobby) => lobby.erstellerId);
  }

  /**
   * Ein Spieler hat die Verbindung verloren: seine Lobby verschwindet.
   *
   * Seine Fehlversuche bei fremden Lobbys bleiben bewusst stehen - sonst
   * hätte er nach dem Neuladen wieder fünf Versuche.
   *
   * @returns {boolean} true, wenn sich die Liste dadurch ändert
   */
  entferneSpieler(spielerId) {
    return this.schliesse(spielerId);
  }

  /** Nur für Diagnose und Tests: wie viele Lobbys gibt es (offen + besetzt)? */
  get anzahlLobbys() {
    return this.#lobbys.size;
  }

  /** Nur für Diagnose und Tests: wie viele Fehlversuch-Einträge liegen herum? */
  get anzahlFehlversuche() {
    return this.#fehlversuche.size;
  }
}
