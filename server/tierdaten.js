/**
 * Lädt die Tierliste und stellt Suchfunktionen bereit.
 *
 * Die Datei data/tiere.json wird beim Serverstart EINMAL gelesen und geprüft.
 * Ist sie fehlerhaft, soll der Server gar nicht erst starten - ein Fehler in den
 * Daten ist ein Programmierfehler und kein Zustand, mit dem man weiterspielen will.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATEI = path.join(__dirname, '..', 'data', 'tiere.json');

const PFLICHTFELDER = [
  'name',
  'klasse',
  'lebensraum',
  'ernaehrung',
  'gewichtKg',
  'groesseCm',
  'alterJahre',
  'aktivitaet',
];
const ZAHLENFELDER = ['gewichtKg', 'groesseCm', 'alterJahre'];

/**
 * Prüft eine Tierliste auf Vollständigkeit und wirft beim ersten Fehler.
 *
 * Bewusst eine eigene, exportierte Funktion und kein Code, der einfach beim
 * Import mitläuft: So lässt sich mit einer erfundenen Liste testen, dass
 * kaputte Daten wirklich abgelehnt werden - ohne dass man dafür die echte
 * tiere.json beschädigen müsste.
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
      // Nullwerte wären fatal: die Bewertung teilt durch diese Zahlen.
      if (typeof tier[feld] !== 'number' || !Number.isFinite(tier[feld]) || tier[feld] <= 0) {
        throw new Error(`Tier "${tier.name}" hat keinen gueltigen Wert fuer "${feld}".`);
      }
    }
  }
}

/** @type {ReadonlyArray<object>} Alle Lebewesen der Tierliste. */
export const ALLE_TIERE = Object.freeze(JSON.parse(readFileSync(DATEI, 'utf8')));

// Beim Start einmal prüfen. Schlägt das fehl, startet der Server gar nicht
// erst - ein Fehler in den Daten ist ein Programmierfehler und kein Zustand,
// mit dem man weiterspielen will.
pruefeTiere(ALLE_TIERE);

/**
 * Die Liste, aus der der Client seine Vorschläge baut.
 *
 * Enthält bewusst nur Name und die vier Textkategorien - damit kann man
 * "Säugetier" oder "Savanne" eintippen und bekommt alle passenden Tiere.
 * Die Zahlenwerte bleiben draußen, weil sie für die Suche nichts bringen.
 *
 * Diese Daten sind kein Geheimnis: Welche Tiere es gibt und wie sie leben, ist
 * öffentliches Spielwissen. Geheim ist nur, WELCHES Tier gesucht wird - und
 * das verlässt den Server erst am Spielende.
 */
export const SUCH_TIERE = Object.freeze(
  ALLE_TIERE.map(({ name, klasse, lebensraum, ernaehrung, aktivitaet }) =>
    Object.freeze({ name, klasse, lebensraum, ernaehrung, aktivitaet }),
  ).sort((a, b) => a.name.localeCompare(b.name, 'de')),
);

/**
 * Sucht ein Tier anhand seines Namens. Groß-/Kleinschreibung und
 * überflüssige Leerzeichen werden ignoriert.
 * @param {unknown} name
 * @returns {object | undefined}
 */
export function findeTier(name) {
  if (typeof name !== 'string') return undefined;
  const gesucht = name.trim().toLowerCase();
  return ALLE_TIERE.find((tier) => tier.name.toLowerCase() === gesucht);
}

/** Liefert ein zufälliges Tier - das wird das Geheimnis einer Partie. */
export function zufallsTier() {
  return ALLE_TIERE[Math.floor(Math.random() * ALLE_TIERE.length)];
}
