/**
 * Partienverwaltung - wer wartet, wer spielt gegen wen.
 *
 * Diese Klasse kennt weder Socket.io noch HTTP. Sie arbeitet nur mit
 * Spieler-Kennungen (Strings). Dadurch lässt sie sich ohne laufenden Server
 * testen - siehe tests/partien.test.js.
 */

import { Spiel } from './spiel.js';
import { zufallsTier } from './tierdaten.js';
import { STANDARD_ZUGZEIT } from './zugzeit.js';

export class Partienverwaltung {
  /**
   * Die öffentlichen Warteschlangen - eine je Spielmodus:
   *   modus -> Kennung des Spielers, der dort auf einen Gegner wartet.
   * Wer Duell spielen will, wird nur mit jemandem gepaart, der ebenfalls
   * Duell gewählt hat.
   */
  #wartende = new Map();

  /** Ordnet jeder Spielerkennung die Partie zu, in der sie steckt. */
  #partien = new Map();

  /**
   * Was nach einer beendeten Partie von ihr übrig bleibt - die Grundlage
   * der Revanche:  spielerId -> { gegnerId, zugestimmt, modus }
   *
   * Jeder Spieler hat seine EIGENE Notiz und wirft nur diese weg. Wer eine
   * Revanche will, schaut deshalb in die Notiz des Gegners: Zeigt sie noch
   * auf ihn zurück, wollen beide dasselbe Duell.
   *
   * Eine Notiz bleibt liegen, bis der Spieler sich neu orientiert oder die
   * Verbindung verliert. Wer die Endkarte einfach offen stehen lässt,
   * belegt also einen Eintrag - höchstens einen je offener Verbindung, und
   * damit unkritisch.
   */
  #revancheNotizen = new Map();

  /** Lost das Geheimnis einer Partie aus - in Tests ein festes Tier. */
  #waehleGeheimnis;

  /**
   * @param {object} [optionen]
   * @param {() => object} [optionen.waehleGeheimnis]  Standard: ein
   *   zufälliges Tier. Die Integrationstests reichen über server.js ein
   *   festes Tier herein (ZOODLE_TESTTIER), damit sie die Lösung kennen.
   */
  constructor({ waehleGeheimnis = zufallsTier } = {}) {
    this.#waehleGeheimnis = waehleGeheimnis;
  }

  /**
   * Legt eine neue Partie an und merkt sie sich für beide Spieler.
   *
   * Gemeinsamer Kern von suchePartie, starteLobbyPartie und
   * stimmeRevancheZu: Eine Partie entsteht auf genau eine Art, egal über
   * welchen Weg sie zustande kommt.
   */
  #starteSpiel(idA, idB, modus = 'zufall', zugzeit = STANDARD_ZUGZEIT) {
    // Im Duell wählen die Spieler ihre Tiere selbst - nichts auszulosen.
    const geheimnis = modus === 'duell' ? null : this.#waehleGeheimnis();
    const spiel = new Spiel(idA, idB, geheimnis, modus, zugzeit);
    this.#partien.set(idA, spiel);
    this.#partien.set(idB, spiel);
    return spiel;
  }

  /**
   * Meldet einen Spieler zur Partiesuche an - in der Warteschlange seines
   * Modus.
   *
   * @param {string} spielerId
   * @param {string} [modus]  'zufall' oder 'duell'
   * @returns {Spiel | null} Die gestartete Partie - oder null, wenn dieser
   *                         Spieler jetzt auf einen Gegner wartet.
   */
  suchePartie(spielerId, modus = 'zufall') {
    const wartenderId = this.#wartende.get(modus);

    // Niemand da (oder derselbe Spieler nochmal): dieser wartet ab jetzt.
    if (wartenderId === undefined || wartenderId === spielerId) {
      this.#wartende.set(modus, spielerId);
      return null;
    }

    this.#wartende.delete(modus);
    // Öffentlich gilt immer die Standard-Zugzeit - einstellen kann man sie
    // nur in einer privaten Lobby.
    return this.#starteSpiel(wartenderId, spielerId, modus, STANDARD_ZUGZEIT);
  }

  /**
   * Startet die Partie einer privaten Lobby: Die beiden Spieler stehen schon
   * fest, niemand muss in die Warteschlange.
   *
   * @param {string} erstellerId  Wer die Lobby eröffnet hat
   * @param {string} beitretenderId  Wer mit dem richtigen Passwort kam
   * @param {string} modus  Der Modus der Lobby
   * @param {number} zugzeit  Die Zugzeit der Lobby in Sekunden (0 = ohne Limit)
   * @returns {Spiel}
   */
  starteLobbyPartie(erstellerId, beitretenderId, modus, zugzeit) {
    return this.#starteSpiel(erstellerId, beitretenderId, modus, zugzeit);
  }

  /** Steht dieser Spieler gerade in einer der öffentlichen Warteschlangen? */
  wartet(spielerId) {
    return [...this.#wartende.values()].includes(spielerId);
  }

  /** Nimmt einen Spieler aus der Warteschlange - harmlos, wenn er nicht drin ist. */
  verlasseWarteschlange(spielerId) {
    for (const [modus, wartenderId] of this.#wartende) {
      if (wartenderId === spielerId) this.#wartende.delete(modus);
    }
  }

  /** @returns {Spiel | undefined} Die laufende Partie dieses Spielers. */
  partieVon(spielerId) {
    return this.#partien.get(spielerId);
  }

  /** Beendet eine Partie und räumt sie aus der Verwaltung. */
  beende(spiel) {
    spiel.beendet = true;

    const [idA, idB] = spiel.spielerIds;
    for (const id of spiel.spielerIds) {
      this.#partien.delete(id);
    }

    // Die Partie ist vorbei, die Paarung merken wir uns aber: Nur so können
    // die beiden gleich "Revanche" klicken, ohne sich neu zu suchen. Modus
    // und Zugzeit kommen mit - eine Revanche spielt man nach denselben Regeln.
    const { modus, zugzeit } = spiel;
    this.#revancheNotizen.set(idA, { gegnerId: idB, zugestimmt: false, modus, zugzeit });
    this.#revancheNotizen.set(idB, { gegnerId: idA, zugestimmt: false, modus, zugzeit });
  }

  /**
   * Ein Spieler möchte eine Revanche gegen seinen letzten Gegner.
   *
   * Mehrfaches Aufrufen ist ungefährlich: Die Zustimmung ist ein Schalter,
   * kein Zähler. Wer den Knopf fünfmal drückt, erzeugt keine fünf
   * Einträge und erst recht keine fünf Partien.
   *
   * @param {string} spielerId
   * @returns {{status: 'unmöglich'}
   *         | {status: 'wartet', gegnerId: string}
   *         | {status: 'gestartet', spiel: Spiel}}
   */
  stimmeRevancheZu(spielerId) {
    const notiz = this.#revancheNotizen.get(spielerId);
    if (!notiz) return { status: 'unmoeglich' };

    // Zeigt die Notiz des Gegners nicht zu mir zurück, ist er inzwischen
    // weitergezogen - etwa, weil er "Zur Lobby" geklickt und mit jemand
    // anderem gespielt hat. Dann gibt es nichts mehr zu revanchieren.
    const gegnerNotiz = this.#revancheNotizen.get(notiz.gegnerId);
    if (!gegnerNotiz || gegnerNotiz.gegnerId !== spielerId) {
      return { status: 'unmoeglich' };
    }

    notiz.zugestimmt = true;

    if (!gegnerNotiz.zugestimmt) {
      return { status: 'wartet', gegnerId: notiz.gegnerId };
    }

    // Beide wollen: Die Notizen haben ihren Zweck erfüllt.
    this.vergissRevanche(spielerId);
    this.vergissRevanche(notiz.gegnerId);
    return {
      status: 'gestartet',
      spiel: this.#starteSpiel(notiz.gegnerId, spielerId, notiz.modus, notiz.zugzeit),
    };
  }

  /**
   * Wer steht noch auf der Endkarte und könnte eine Revanche mit diesem
   * Spieler wollen?
   *
   * Bewusst egal, ob der Gegner schon zugestimmt hat: Auch wer noch nicht
   * geklickt hat, sieht einen Revanche-Knopf. Erfährt er nicht, dass ich
   * gegangen bin, klickt er später ins Leere und bleibt bei "Warte auf
   * deinen Gegner" hängen. Zeigt seine Notiz nicht mehr auf mich, ist er
   * selbst schon weitergezogen - dann gibt es niemandem abzusagen.
   *
   * Reine Abfrage ohne Nebenwirkung. Der Server braucht sie, BEVOR er eine
   * Notiz wegwirft: Danach weiß niemand mehr, wem die Absage gilt.
   *
   * @returns {string | undefined} Kennung des Gegners auf der Endkarte
   */
  wartetAufRevancheMit(spielerId) {
    const notiz = this.#revancheNotizen.get(spielerId);
    if (!notiz) return undefined;

    const gegnerNotiz = this.#revancheNotizen.get(notiz.gegnerId);
    return gegnerNotiz?.gegnerId === spielerId ? notiz.gegnerId : undefined;
  }

  /**
   * Wirft die Revanche-Notiz dieses Spielers weg.
   *
   * Bewusst nur die eigene: Dass ich weiterziehe, ändert nichts am Wunsch
   * meines Gegners. Seine Notiz zeigt dann ins Leere - stimmeRevancheZu
   * merkt das und sagt ihm ab, statt ihn ewig warten zu lassen.
   */
  vergissRevanche(spielerId) {
    this.#revancheNotizen.delete(spielerId);
  }

  /**
   * Ein Spieler hat die Verbindung verloren. Wartet er noch, wird die
   * Warteschlange geleert; spielt er, wird die Partie beendet.
   *
   * @returns {Spiel | undefined} Die beendete Partie, falls es eine gab.
   */
  entferne(spielerId) {
    this.verlasseWarteschlange(spielerId);

    const spiel = this.#partien.get(spielerId);
    if (spiel) this.beende(spiel);

    // Reihenfolge beachten: beende() hat gerade eine frische Revanche-Notiz
    // angelegt - für einen Spieler, der schon weg ist. Die muss sofort
    // wieder verschwinden, sonst wartet sein Gegner auf ein Duell mit
    // jemandem, der gar nicht mehr da ist.
    this.vergissRevanche(spielerId);

    return spiel;
  }

  /** Nur für Diagnose und Tests: wie viele Partien laufen gerade? */
  get anzahlPartien() {
    // Jede Partie steht unter zwei Kennungen in der Map.
    return this.#partien.size / 2;
  }

  /** Nur für Diagnose und Tests: wartet gerade jemand? */
  get wartetJemand() {
    return this.#wartende.size > 0;
  }

  /** Nur für Diagnose und Tests: wie viele Revanche-Notizen liegen herum? */
  get anzahlRevancheNotizen() {
    return this.#revancheNotizen.size;
  }
}
