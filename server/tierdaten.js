/**
 * Laedt die Tierliste und stellt Suchfunktionen bereit.
 *
 * Die Datei data/tiere.json wird beim Serverstart EINMAL gelesen und geprueft.
 * Ist sie fehlerhaft, soll der Server gar nicht erst starten - ein Fehler in den
 * Daten ist ein Programmierfehler und kein Zustand, mit dem man weiterspielen will.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATEI = path.join(__dirname, '..', 'data', 'tiere.json');

const PFLICHTFELDER = ['name', 'klasse', 'lebensraum', 'ernaehrung', 'gewichtKg', 'groesseCm', 'alterJahre', 'aktivitaet'];
const ZAHLENFELDER  = ['gewichtKg', 'groesseCm', 'alterJahre'];

/**
 * Prueft eine Tierliste auf Vollstaendigkeit und wirft beim ersten Fehler.
 *
 * Bewusst eine eigene, exportierte Funktion und kein Code, der einfach beim
 * Import mitlaeuft: So laesst sich mit einer erfundenen Liste testen, dass
 * kaputte Daten wirklich abgelehnt werden - ohne dass man dafuer die echte
 * tiere.json beschaedigen muesste.
 *
 * @param {unknown} liste
 * @throws {Error} beim ersten gefundenen Fehler
 */
export function pruefeTiere(liste) {
  if (!Array.isArray(liste) || liste.length < 2) {
    throw new Error('tiere.json enthaelt zu wenige Eintraege.');
  }

  for (const tier of liste) {
    for (const feld of PFLICHTFELDER) {
      if (tier[feld] === undefined || tier[feld] === null || tier[feld] === '') {
        throw new Error(`Tier "${tier.name ?? '?'}" fehlt das Feld "${feld}".`);
      }
    }
    for (const feld of ZAHLENFELDER) {
      // Nullwerte waeren fatal: die Bewertung teilt durch diese Zahlen.
      if (typeof tier[feld] !== 'number' || !Number.isFinite(tier[feld]) || tier[feld] <= 0) {
        throw new Error(`Tier "${tier.name}" hat keinen gueltigen Wert fuer "${feld}".`);
      }
    }
  }
}

/** @type {ReadonlyArray<object>} Alle Lebewesen der Tierliste. */
export const ALLE_TIERE = Object.freeze(JSON.parse(readFileSync(DATEI, 'utf8')));

// Beim Start einmal pruefen. Schlaegt das fehl, startet der Server gar nicht
// erst - ein Fehler in den Daten ist ein Programmierfehler und kein Zustand,
// mit dem man weiterspielen will.
pruefeTiere(ALLE_TIERE);

/**
 * Die Liste, aus der der Client seine Vorschlaege baut.
 *
 * Enthaelt bewusst nur Name und die vier Textkategorien - damit kann man
 * "Saeugetier" oder "Savanne" eintippen und bekommt alle passenden Tiere.
 * Die Zahlenwerte bleiben draussen, weil sie fuer die Suche nichts bringen.
 *
 * Diese Daten sind kein Geheimnis: Welche Tiere es gibt und wie sie leben, ist
 * oeffentliches Spielwissen. Geheim ist nur, WELCHES Tier gesucht wird - und
 * das verlaesst den Server erst am Spielende.
 */
export const SUCH_TIERE = Object.freeze(
  ALLE_TIERE
    .map(({ name, klasse, lebensraum, ernaehrung, aktivitaet }) =>
      Object.freeze({ name, klasse, lebensraum, ernaehrung, aktivitaet }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
);

/**
 * Sucht ein Tier anhand seines Namens. Gross-/Kleinschreibung und
 * ueberfluessige Leerzeichen werden ignoriert.
 * @param {unknown} name
 * @returns {object | undefined}
 */
export function findeTier(name) {
  if (typeof name !== 'string') return undefined;
  const gesucht = name.trim().toLowerCase();
  return ALLE_TIERE.find((tier) => tier.name.toLowerCase() === gesucht);
}

/** Liefert ein zufaelliges Tier - das wird das Geheimnis einer Partie. */
export function zufallsTier() {
  return ALLE_TIERE[Math.floor(Math.random() * ALLE_TIERE.length)];
}
