/**
 * Zoodle - Spiellogik
 *
 * WICHTIG: Diese Datei laeuft ausschliesslich auf dem Server. Das geheime Tier
 * verlaesst den Server erst, wenn die Partie vorbei ist. Ein Spieler kann sich
 * die Loesung also nicht aus dem Browser herausholen.
 */

/**
 * Verwandtschaftsgruppen. Liegen zwei Werte in derselben Gruppe, ist der Tipp
 * "nah dran" statt einfach falsch - das macht das Raten fair und lehrreich.
 */
const GRUPPEN = {
  klasse: [
    ['Säugetier', 'Vogel'],
    ['Reptil', 'Amphibie', 'Fisch'],
    ['Insekt', 'Weichtier', 'Krebstier', 'Spinnentier'],
  ],
  lebensraum: [
    ['Ozean', 'Süßwasser'],
    ['Savanne', 'Wüste', 'Grasland'],
    ['Wald', 'Regenwald'],
    ['Gebirge', 'Polargebiet', 'Siedlung'],
  ],
};

/** Werte, die als Bruecke zwischen zwei Extremen gelten. */
const BRUECKEN = {
  ernaehrung: 'Allesfresser',
  aktivitaet: 'dämmerungsaktiv',
};

/** Ab welchem Verhaeltnis eine Zahl als Treffer bzw. als nah dran zaehlt. */
const ZAHL_TREFFER = { min: 0.9, max: 1.1 };
const ZAHL_NAH     = { min: 0.4, max: 2.5 };

/**
 * Die Hinweisspalten des Spielfelds. Der Client baut seine Tabelle aus genau
 * dieser Liste - Spalten muessen also nur an einer Stelle geaendert werden.
 */
export const KATEGORIEN = Object.freeze([
  { schluessel: 'klasse',     titel: 'Klasse',     art: 'text' },
  { schluessel: 'lebensraum', titel: 'Lebensraum', art: 'text' },
  { schluessel: 'ernaehrung', titel: 'Ernährung',  art: 'text' },
  { schluessel: 'gewichtKg',  titel: 'Gewicht',    art: 'zahl' },
  { schluessel: 'groesseCm',  titel: 'Größe',      art: 'zahl' },
  { schluessel: 'alterJahre', titel: 'Alter',      art: 'zahl' },
  { schluessel: 'aktivitaet', titel: 'Aktiv',      art: 'text' },
]);

// --------------------------------------------------------------------------
// Formatierung
// --------------------------------------------------------------------------

/**
 * Schreibt eine Zahl deutsch: Komma statt Punkt, ohne ueberfluessige Nullen.
 *
 * Der Trick ist parseFloat: Es wirft angehaengte Nullen weg, die toFixed
 * gerade erst erzeugt hat. Aus "0.10" wird 0.1, aus "2.00" wird 2. Erst
 * danach wird der Punkt zum Komma.
 *
 *   deutscheZahl(2.5,   1) -> "2,5"
 *   deutscheZahl(25,    1) -> "25"
 *   deutscheZahl(0.01,  2) -> "0,01"
 */
function deutscheZahl(zahl, maxStellen) {
  return String(parseFloat(zahl.toFixed(maxStellen))).replace('.', ',');
}

export function formatiereGewicht(kg) {
  if (kg >= 1000)  return `${Math.round(kg / 1000)} t`;
  if (kg >= 1)     return `${deutscheZahl(kg, 1)} kg`;
  if (kg >= 0.001) return `${Math.round(kg * 1000)} g`;
  // Unter einem Gramm - Ameise, Marienkaefer und Verwandtschaft.
  return `${deutscheZahl(kg * 1000, 2)} g`;
}

export function formatiereGroesse(cm) {
  // Ab einem Meter in Metern, darunter in Zentimetern.
  return cm >= 100
    ? `${deutscheZahl(cm / 100, 1)} m`
    : `${deutscheZahl(cm, 1)} cm`;
}

const FORMAT = {
  gewichtKg: formatiereGewicht,
  groesseCm: formatiereGroesse,
  alterJahre: (jahre) => `${jahre} J`,
};

// --------------------------------------------------------------------------
// Bewertung eines Tipps
// --------------------------------------------------------------------------

/** Liegen zwei Werte in derselben Verwandtschaftsgruppe? */
function gleicheGruppe(feld, a, b) {
  return (GRUPPEN[feld] ?? []).some((gruppe) => gruppe.includes(a) && gruppe.includes(b));
}

/** Ist einer der beiden Werte der "Brueckenwert" dieses Feldes? */
function istBruecke(feld, a, b) {
  const bruecke = BRUECKEN[feld];
  return bruecke !== undefined && (a === bruecke || b === bruecke);
}

/**
 * Vergleicht ein geratenes Tier mit dem geheimen Tier.
 *
 * Jede Kategorie bekommt:
 *   bewertung: 'treffer' | 'nah' | 'daneben'
 *   richtung:  'hoeher' | 'niedriger' | null
 *              - zeigt bei Zahlen, wo das GESUCHTE Tier liegt.
 */
export function vergleiche(tipp, geheimnis) {
  return KATEGORIEN.map(({ schluessel, titel, art }) => {
    const wertTipp = tipp[schluessel];
    const wertZiel = geheimnis[schluessel];

    if (art === 'text') {
      let bewertung = 'daneben';
      if (wertTipp === wertZiel) {
        bewertung = 'treffer';
      } else if (gleicheGruppe(schluessel, wertTipp, wertZiel) || istBruecke(schluessel, wertTipp, wertZiel)) {
        bewertung = 'nah';
      }
      return { schluessel, titel, anzeige: String(wertTipp), bewertung, richtung: null };
    }

    // art === 'zahl'
    const verhaeltnis = wertTipp / wertZiel;
    let bewertung = 'daneben';
    if (verhaeltnis >= ZAHL_TREFFER.min && verhaeltnis <= ZAHL_TREFFER.max) {
      bewertung = 'treffer';
    } else if (verhaeltnis >= ZAHL_NAH.min && verhaeltnis <= ZAHL_NAH.max) {
      bewertung = 'nah';
    }

    return {
      schluessel,
      titel,
      anzeige: FORMAT[schluessel](wertTipp),
      bewertung,
      // Kein Pfeil bei einem Treffer: eine gruene Kachel mit Pfeil waere
      // widerspruechlich. Der Pfeil zeigt, wo das GESUCHTE Tier liegt.
      richtung: bewertung === 'treffer' ? null : (wertTipp < wertZiel ? 'hoeher' : 'niedriger'),
    };
  });
}

// --------------------------------------------------------------------------
// Eine laufende Partie
// --------------------------------------------------------------------------

export class Spiel {
  /**
   * @param {string} idA        Socket-Id des ersten Spielers
   * @param {string} idB        Socket-Id des zweiten Spielers
   * @param {object | null} geheimnis  Das gesuchte Tier (Zufallstier).
   *   Im Duell null - dort waehlen die Spieler die Tiere selbst.
   * @param {string} [modus]    'zufall' oder 'duell' (siehe server/lobbys.js)
   * @param {number} [zugzeit]  Sekunden pro Zug, 0 = ohne Zeitlimit. Die Uhr
   *   selbst laeuft in server/zugzeit.js - hier steht nur die Einstellung.
   *
   * Die beiden Modi:
   *   zufall  Der Server lost EIN Tier aus, beide raten darauf.
   *   duell   Jeder waehlt ein Tier fuer den anderen ("Wahl"-Phase), danach
   *           raet jeder auf SEIN Tier. Wer zuerst richtig liegt, gewinnt.
   */
  constructor(idA, idB, geheimnis, modus = 'zufall', zugzeit = 0) {
    this.spielerIds = [idA, idB];
    this.geheimnis = geheimnis;
    this.modus = modus;
    this.zugzeit = zugzeit;
    this.versuche = [];
    this.beendet = false;
    // Wer anfaengt, wird ausgelost - sonst haette immer derselbe einen Vorteil.
    this.amZug = Math.random() < 0.5 ? idA : idB;

    // Nur im Duell: welches Tier muss welcher Spieler erraten?
    //   spielerId -> Tier, das sein GEGNER fuer ihn gewaehlt hat
    this.ziele = new Map();
    // 'wahl': beide waehlen noch ein Tier fuer den anderen; 'raten': es laeuft.
    this.phase = modus === 'duell' ? 'wahl' : 'raten';
  }

  gegnerVon(id) {
    return this.spielerIds.find((andere) => andere !== id);
  }

  /**
   * Das Tier, das dieser Spieler erraten muss. Beim Zufallstier ist es fuer
   * beide dasselbe, im Duell hat es der Gegner ausgesucht.
   * @returns {object | undefined}
   */
  geheimnisVon(spielerId) {
    return this.modus === 'duell' ? this.ziele.get(spielerId) : this.geheimnis;
  }

  istAmZug(id) {
    return !this.beendet && this.phase === 'raten' && this.amZug === id;
  }

  /**
   * Die Zugzeit ist abgelaufen: Der Zug geht ohne Tipp an den Gegner. Es
   * entsteht kein Versuch - wer nichts geraten hat, bekommt auch keine
   * Hinweise.
   */
  gibZugAb() {
    this.amZug = this.gegnerVon(this.amZug);
  }

  /** Duell: Hat dieser Spieler schon ein Tier fuer seinen Gegner gewaehlt? */
  hatGewaehlt(waehlerId) {
    return this.ziele.has(this.gegnerVon(waehlerId));
  }

  /**
   * Duell: Ein Spieler waehlt das Tier, das sein Gegner erraten muss.
   * Haben beide gewaehlt, beginnt das Raten. Der Aufrufer prueft vorher,
   * dass gerade gewaehlt wird und dieser Spieler noch nicht gewaehlt hat.
   */
  waehleTier(waehlerId, tier) {
    this.ziele.set(this.gegnerVon(waehlerId), tier);
    if (this.ziele.size === 2) this.phase = 'raten';
  }

  /**
   * Wurde dieses Tier schon geraten?
   *
   * Beim Zufallstier zaehlen die Tipps BEIDER Spieler - sie suchen ja
   * dasselbe Tier. Im Duell zaehlen nur die eigenen: Was der Gegner geraten
   * hat, kann genau das Tier sein, das ich suche.
   */
  schonGeraten(tierName, spielerId) {
    return this.versuche.some((versuch) => versuch.tierName === tierName
      && (this.modus !== 'duell' || versuch.spielerId === spielerId));
  }

  /**
   * Fuehrt einen Rateversuch aus. Der Aufrufer muss vorher geprueft haben,
   * dass der Spieler am Zug ist und das Tier noch nicht geraten wurde.
   */
  rate(spielerId, tier) {
    const ziel = this.geheimnisVon(spielerId);
    const richtig = tier.name === ziel.name;

    const versuch = {
      spielerId,
      tierName: tier.name,
      hinweise: vergleiche(tier, ziel),
      richtig,
    };
    this.versuche.push(versuch);

    if (richtig) {
      this.beendet = true;
    } else {
      this.amZug = this.gegnerVon(spielerId);
    }

    return versuch;
  }
}
