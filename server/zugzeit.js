/**
 * Zugzeit - wie lange ein Spieler für seinen Tipp Zeit hat.
 *
 * Die Uhr läuft AUSSCHLIESSLICH hier auf dem Server. Der Browser bekommt
 * nur die Restzeit mitgeteilt und zeigt sie an - er entscheidet nichts.
 * Würde der Browser die Zeit messen, könnte ein Spieler sie einfach
 * anhalten (Entwicklerwerkzeuge, verstellte Uhr) und so beliebig lange
 * nachdenken.
 *
 * Wie partien.js und lobbys.js kennt dieses Modul kein Socket.io. Es merkt
 * sich nur, welche Partie gerade eine laufende Frist hat, und ruft beim
 * Ablauf eine Funktion auf, die server.js übergibt. Dadurch lässt es sich
 * mit den simulierten Uhren von node:test prüfen - siehe tests/zugzeit.test.js.
 */

/** Die erlaubten Zugzeiten in Sekunden. 0 heißt: ohne Zeitlimit. */
export const ZUGZEITEN = [10, 20, 30, 60, 0];

/** Die Zugzeit der öffentlichen Warteschlange und die Vorauswahl im Dialog. */
export const STANDARD_ZUGZEIT = 10;

/**
 * Duell: So lange haben beide Zeit, ein Tier für den anderen zu wählen.
 * Ohne Frist könnte einer nie wählen und den anderen ewig warten lassen.
 * Ausnahme: In einer Lobby "ohne Zeitlimit" gilt auch hier keine Frist.
 */
export const WAHLZEIT_SEKUNDEN = 60;

/** Ist das eine der erlaubten Zugzeiten? Alles andere lehnt der Server ab. */
export function istGueltigeZugzeit(wert) {
  return ZUGZEITEN.includes(wert);
}

export class Zuguhren {
  /** Laufende Fristen:  Partie -> { zeitgeber, ende } */
  #fristen = new Map();

  /** Wie viele Millisekunden eine "Sekunde" Zugzeit dauert. */
  #msProSekunde;

  /**
   * @param {object} [optionen]
   * @param {number} [optionen.msProSekunde]  Standard 1000. Die
   *   Integrationstests lassen die Uhr schneller laufen, damit sie nicht zehn
   *   Sekunden auf einen Ablauf warten müssen.
   */
  constructor({ msProSekunde = 1000 } = {}) {
    this.#msProSekunde = msProSekunde;
  }

  /**
   * Startet die Frist für den Spieler, der jetzt am Zug ist. Eine noch
   * laufende Frist derselben Partie wird dabei ersetzt.
   *
   * @param {object} spiel  Die Partie (braucht das Feld "zugzeit" in Sekunden)
   * @param {(spiel: object) => void} beiAblauf  Wird gerufen, wenn die Zeit um ist
   * @param {number} [sekunden]  Standard ist die Zugzeit der Partie. Die
   *   Duell-Wahl nutzt dieselbe Uhr mit WAHLZEIT_SEKUNDEN.
   */
  starte(spiel, beiAblauf, sekunden = spiel.zugzeit) {
    this.stoppe(spiel);
    if (!sekunden) return; // 0 = ohne Zeitlimit: keine Uhr

    const dauer = sekunden * this.#msProSekunde;
    const zeitgeber = setTimeout(() => {
      this.#fristen.delete(spiel);
      beiAblauf(spiel);
    }, dauer);

    this.#fristen.set(spiel, { zeitgeber, ende: Date.now() + dauer });
  }

  /** Hält die Frist dieser Partie an - harmlos, wenn keine läuft. */
  stoppe(spiel) {
    const frist = this.#fristen.get(spiel);
    if (!frist) return;
    clearTimeout(frist.zeitgeber);
    this.#fristen.delete(spiel);
  }

  /**
   * Wie viel Zeit bleibt dem Spieler am Zug noch?
   *
   * Verschickt wird bewusst nur diese RESTZEIT, nie eine Uhrzeit: Die Uhren
   * von Server und Browser gehen nie genau gleich. Eine Restzeit bleibt auch
   * dann richtig, wenn der Rechner des Spielers falsch eingestellt ist.
   *
   * @returns {number | null} Millisekunden - oder null, wenn keine Frist läuft
   */
  restzeitMs(spiel) {
    const frist = this.#fristen.get(spiel);
    return frist ? Math.max(0, frist.ende - Date.now()) : null;
  }

  /**
   * Ist die Frist schon um, auch wenn der Ablauf noch nicht bearbeitet wurde?
   *
   * Zwischen dem Fristende und dem Moment, in dem Node den Zeitgeber
   * ausführt, kann noch ein Tipp eintreffen. Der kam zu spät und wird
   * abgelehnt.
   */
  istAbgelaufen(spiel) {
    const frist = this.#fristen.get(spiel);
    return frist ? Date.now() >= frist.ende : false;
  }

  /** Nur für Diagnose und Tests: wie viele Fristen laufen gerade? */
  get anzahlFristen() {
    return this.#fristen.size;
  }
}
