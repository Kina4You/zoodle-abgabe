/**
 * Spielfeld - baut aus den Daten des Servers die Tipp-Tabelle und im Duell
 * die Bausteine der beiden Bretter (Felder, Spurkarten, Stufe, Endstand).
 *
 * Dieses Modul kennt weder Socket.io noch die Spielregeln. Es bekommt fertig
 * bewertete Hinweise und macht daraus HTML - Texte immer per textContent.
 */

import { EIGENSCHAFTEN, STUFENTEXT } from './fortschritt.js';

const tabellenKopf    = document.querySelector('#tabellen-kopf');
const tabellenKoerper = document.querySelector('#tabellen-koerper');
const leerzustand     = document.querySelector('#leerzustand');

/** Symbole ergaenzen die Farbe - Farbe allein reicht als Information nicht. */
const SYMBOLE = { treffer: '✓', nah: '~', daneben: '✕' };
const PFEILE  = { hoeher: '↑', niedriger: '↓' };
const KLARTEXT = { treffer: 'stimmt', nah: 'nah dran', daneben: 'falsch' };

/**
 * Die Bewertung eines Hinweises in Worten, z. B. "falsch, gesucht ist hoeher".
 * Steht fuer Screenreader in jeder Kachel und im Tooltip.
 * @param {{bewertung: string, richtung?: string}} hinweis
 */
export function bewertungInWorten({ bewertung, richtung }) {
  const richtungsText = richtung === 'hoeher'    ? ', gesucht ist höher'
                      : richtung === 'niedriger' ? ', gesucht ist niedriger'
                      : '';
  return KLARTEXT[bewertung] + richtungsText;
}

/**
 * Ein Hinweis als ganzer Satz zum Vorlesen, z. B.
 * "Gewicht 190 kg ist falsch, gesucht ist niedriger."
 * @param {{titel: string, anzeige: string, bewertung: string, richtung?: string}} hinweis
 */
export function hinweisAlsSatz({ titel, anzeige, bewertung, richtung }) {
  // "14 J" passt in die Kachel, vorgelesen klingt es nach einem Buchstaben.
  const wert = anzeige === '1 J' ? '1 Jahr' : anzeige.replace(/ J$/, ' Jahre');
  const verb = bewertung === 'treffer' ? '' : 'ist ';
  return `${titel} ${wert} ${verb}${bewertungInWorten({ bewertung, richtung })}.`;
}

/**
 * Baut die Kopfzeile aus den Kategorien, die der Server liefert.
 * @param {Array<{schluessel: string, titel: string}>} kategorien
 */
export function setzeKategorien(kategorien) {
  tabellenKopf.replaceChildren();

  for (const titel of ['Tier', ...kategorien.map((k) => k.titel)]) {
    const zelle = document.createElement('th');
    zelle.scope = 'col';
    zelle.textContent = titel;
    tabellenKopf.append(zelle);
  }
}

/**
 * Haengt einen Tipp oben an die Tabelle an.
 * @param {{tierName: string, raterName: string, vonMir: boolean, hinweise: Array}} tipp
 */
export function fuegeTippHinzu({ tierName, raterName, vonMir, hinweise }, { beschriftung } = {}) {
  const zeile = document.createElement('tr');

  // Im Duell steht unter dem Tiernamen "Tipp 4" statt des Spielernamens -
  // in "Dein Brett" stehen ohnehin nur die eigenen Tipps.
  zeile.append(baueNamensZelle(tierName, beschriftung ?? (vonMir ? 'Du' : raterName), vonMir));
  for (const hinweis of hinweise) {
    zeile.append(baueHinweisZelle(hinweis));
  }

  // Neuester Tipp nach oben - so muss niemand scrollen.
  tabellenKoerper.prepend(zeile);
  leerzustand.hidden = true;
}

function baueNamensZelle(tierName, unterzeile, vonMir) {
  const zelle = document.createElement('td');

  const block = document.createElement('div');
  block.className = 'tipp';

  const name = document.createElement('span');
  name.className = 'tipp__name';
  name.textContent = tierName;

  const von = document.createElement('span');
  von.className = `tipp__von tipp__von--${vonMir ? 'ich' : 'gegner'}`;
  von.textContent = unterzeile;

  block.append(name, von);
  zelle.append(block);
  return zelle;
}

function baueHinweisZelle({ titel, anzeige, bewertung, richtung }) {
  const zelle = document.createElement('td');

  const kachel = document.createElement('div');
  kachel.className = `kachel kachel--${bewertung}`;

  // Bei Zahlen ("450 kg") verbindet ein geschuetztes Leerzeichen (\u00A0)
  // Zahl und Einheit - sonst stuende "kg" bei Platzmangel allein darunter.
  const text = document.createElement('span');
  text.textContent = /^\d/.test(anzeige) ? anzeige.replace(' ', '\u00A0') : anzeige;

  const zeichen = document.createElement('span');
  zeichen.className = 'kachel__zeichen';
  // Das Zeichen steht IMMER da, bei Zahlen zusaetzlich der Pfeil ("~ ↓").
  // Stuende dort nur der Pfeil, unterschieden sich "nah dran" und "falsch"
  // allein durch die Farbe - und genau die sehen nicht alle.
  zeichen.textContent = richtung ? `${SYMBOLE[bewertung]}\u00A0${PFEILE[richtung]}` : SYMBOLE[bewertung];
  zeichen.setAttribute('aria-hidden', 'true');

  // Klartext fuer Screenreader - unsichtbar, aber Teil des Kachelinhalts.
  // Ein aria-label direkt am <div> ginge nicht: Auf einem Element ohne eigene
  // Rolle ist es nicht erlaubt, und Screenreader ignorieren es dort oft.
  // Den Spaltentitel ("Gewicht") liest der Screenreader aus dem Tabellenkopf.
  const worte = bewertungInWorten({ bewertung, richtung });
  const vorlesen = document.createElement('span');
  vorlesen.className = 'nur-sr';
  vorlesen.textContent = ` – ${worte}`;

  kachel.append(text, zeichen, vorlesen);

  // Tooltip fuer die Maus: alles in einem Satz, samt Spaltentitel.
  kachel.title = `${titel}: ${anzeige} – ${worte}`;

  zelle.append(kachel);
  return zelle;
}

/** Leert die Tabelle - noetig, wenn eine neue Partie beginnt. */
export function leereTabelle() {
  tabellenKoerper.replaceChildren();
  leerzustand.hidden = false;
}

// --------------------------------------------------------------------------
// Duell: Bausteine der beiden Bretter
// --------------------------------------------------------------------------

/**
 * Die sieben Fortschritts-Felder (Kl Le Er ...). Geknackt erkennt man an
 * Fuellung UND Rahmen; der Screenreader liest "Klasse: geknackt".
 * @param {HTMLOListElement} liste
 * @param {Set<string>} geknacktMenge
 * @param {string} wem  "dir" oder der Name des Gegners
 */
export function zeichneFelder(liste, geknacktMenge, wem) {
  liste.setAttribute('aria-label', `Eigenschaften von ${wem}`);
  liste.replaceChildren(...EIGENSCHAFTEN.map(({ schluessel, kurz, name }) => {
    const ja = geknacktMenge.has(schluessel);
    const feld = document.createElement('li');
    feld.className = ja ? 'fund fund--ja' : 'fund';

    const sichtbar = document.createElement('span');
    sichtbar.setAttribute('aria-hidden', 'true');
    sichtbar.textContent = kurz;

    const vorlesen = document.createElement('span');
    vorlesen.className = 'nur-sr';
    vorlesen.textContent = `${name}: ${ja ? 'geknackt' : 'offen'}`;

    feld.append(sichtbar, vorlesen);
    return feld;
  }));
}

/**
 * Eine Spurkarte fuer einen Tipp des Gegners: Tiername und die sieben
 * Bewertungen als Symbol - ohne Werte, damit das Brett kompakt bleibt.
 * Neuester Tipp links.
 * @param {HTMLOListElement} liste
 * @param {{tierName: string, hinweise: Array}} tipp
 * @param {number} nummer  Der wievielte Tipp des Gegners
 */
export function fuegeSpurHinzu(liste, { tierName, hinweise }, nummer) {
  const spur = document.createElement('li');
  spur.className = 'spur';

  const name = document.createElement('span');
  name.className = 'spur__name';
  name.textContent = tierName;
  const nummerText = document.createElement('span');
  nummerText.className = 'nur-sr';
  nummerText.textContent = ` (Tipp ${nummer}):`;
  name.append(nummerText);

  const felder = document.createElement('span');
  felder.className = 'spur__felder';
  for (const hinweis of hinweise) {
    const feld = document.createElement('span');
    feld.className = `spur__feld spur__feld--${hinweis.bewertung}`;

    const symbol = document.createElement('span');
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = SYMBOLE[hinweis.bewertung];

    const vorlesen = document.createElement('span');
    vorlesen.className = 'nur-sr';
    const eigenschaft = EIGENSCHAFTEN.find((e) => e.schluessel === hinweis.schluessel);
    vorlesen.textContent = `${eigenschaft?.name ?? hinweis.titel} ${KLARTEXT[hinweis.bewertung]}, `;

    feld.append(symbol, vorlesen);
    felder.append(feld);
  }

  spur.append(name, felder);
  liste.prepend(spur);
}

/**
 * Setzt eine Gefahrenstufen-Plakette: Wort + Thermometer + Farbe.
 * @param {HTMLElement} element  .stufe mit einem .stufe__text darin
 * @param {'kalt' | 'warm' | 'heiss' | 'gleich'} stufe
 */
export function setzeStufe(element, stufe) {
  element.className = `stufe stufe--${stufe}`;
  element.querySelector('.stufe__text').textContent = STUFENTEXT[stufe];
}

/**
 * Eine Seite des Endstands (Du / Gegner) aus der Vorlage.
 * @param {object} seite
 * @param {string} seite.wer      "Du" oder der Name des Gegners
 * @param {boolean} seite.sieger
 * @param {string} seite.verb     "suchtest" / "suchte"
 * @param {string} seite.tier     Das gesuchte Tier
 * @param {number} seite.tipps
 * @param {number} seite.geknackt Anzahl der geknackten Eigenschaften
 * @param {string} seite.stufe    Gefahrenstufe - steht beim Verlierer
 */
export function baueEndstandSeite({ wer, sieger, verb, tier, tipps, geknackt, stufe }) {
  const seite = document.querySelector('#vorlage-endstand-seite').content.firstElementChild.cloneNode(true);
  seite.classList.toggle('endstand__seite--sieger', sieger);
  seite.querySelector('.endstand__wer').textContent = wer;
  seite.querySelector('.endstand__verb').textContent = verb;
  seite.querySelector('.endstand__tier').textContent = tier;
  seite.querySelector('.endstand__tipps').textContent = String(tipps);
  seite.querySelector('.endstand__geknackt').textContent = `${geknackt} von 7`;

  // Der Sieger bekommt die Plakette "gewonnen", der andere seine Stufe.
  const kopf = seite.querySelector('.endstand__kopf');
  if (sieger) {
    const plakette = document.createElement('span');
    plakette.className = 'endstand__plakette';
    plakette.textContent = 'gewonnen';
    kopf.append(plakette);
  } else {
    const stufenPlakette = document.querySelector('#vorlage-stufe').content.firstElementChild.cloneNode(true);
    setzeStufe(stufenPlakette, stufe);
    kopf.append(stufenPlakette);
  }
  return seite;
}
