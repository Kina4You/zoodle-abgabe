/**
 * Wird von "npm run build" aufgerufen.
 *
 * Vorgabe des Dozenten: In CSS darf nirgends "!important" stehen, sonst gibt
 * es keine Punkte. Diese Prüfung macht den Verstoß unmöglich - sobald die
 * Zeichenfolge irgendwo unter public/ auftaucht, bricht der Build ab.
 *
 * Geprüft werden nicht nur .css-Dateien, sondern auch HTML (style-Attribute)
 * und JavaScript: Auch dort ließe sich die Regel sonst durch die Hintertür
 * wieder einschleusen.
 *
 * Aufruf:  node scripts/pruefe-important.js            prüft public/
 *          node scripts/pruefe-important.js <ordner>   prüft <ordner>
 *                                                      (für die Tests)
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VERBOTEN = '!important';
const TEXTDATEIEN = ['.css', '.html', '.js'];

const ordner = process.argv[2] ?? path.join(__dirname, '..', 'public');

/** Sammelt alle Textdateien in einem Ordner und seinen Unterordnern. */
function sammleDateien(verzeichnis) {
  const dateien = [];
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      dateien.push(...sammleDateien(pfad));
    } else if (TEXTDATEIEN.includes(path.extname(eintrag.name))) {
      dateien.push(pfad);
    }
  }
  return dateien;
}

const fundstellen = [];
for (const datei of sammleDateien(ordner)) {
  const zeilen = readFileSync(datei, 'utf8').split('\n');
  zeilen.forEach((zeile, i) => {
    if (zeile.includes(VERBOTEN)) {
      fundstellen.push(`${path.relative(ordner, datei)}:${i + 1}`);
    }
  });
}

if (fundstellen.length > 0) {
  console.error(`"${VERBOTEN}" ist verboten, gefunden in:\n  ${fundstellen.join('\n  ')}`);
  process.exit(1);
}

console.log(`Build OK - kein "${VERBOTEN}" unter ${path.basename(ordner)}/.`);
