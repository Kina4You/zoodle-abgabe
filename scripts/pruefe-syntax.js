/**
 * Wird von "npm run build" aufgerufen.
 *
 * Prüft die Syntax ALLER JavaScript-Dateien des Projekts mit "node --check".
 * Das Skript sammelt die Dateien selbst ein: Eine neue Datei ist automatisch
 * dabei, statt dass ein Tippfehler darin erst im Browser auffällt.
 *
 * "node --check" führt nichts aus, es liest die Datei nur ein. Deshalb geht
 * das auch für die Browserdateien: Ein "document" braucht es dafür nicht.
 *
 * Aufruf:  node scripts/pruefe-syntax.js             prüft das Projekt
 *          node scripts/pruefe-syntax.js <ordner>    prüft nur <ordner>
 *                                                    (für die Tests)
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const ORDNER = process.argv[2]
  ? [process.argv[2]]
  : ['server', 'public/js', 'scripts', 'tests'].map((ordner) => path.join(WURZEL, ordner));

const ENDUNGEN = ['.js', '.mjs'];

/** Sammelt alle JavaScript-Dateien in einem Ordner und seinen Unterordnern. */
function sammleDateien(verzeichnis) {
  const dateien = [];
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    if (eintrag.name === 'node_modules') continue;
    const pfad = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      dateien.push(...sammleDateien(pfad));
    } else if (ENDUNGEN.includes(path.extname(eintrag.name))) {
      dateien.push(pfad);
    }
  }
  return dateien;
}

const dateien = ORDNER.flatMap(sammleDateien);
const fehlerhaft = [];

for (const datei of dateien) {
  // process.execPath ist genau das Node, das gerade läuft - kein anderes
  // aus dem Suchpfad.
  const ergebnis = spawnSync(process.execPath, ['--check', datei], { encoding: 'utf8' });
  if (ergebnis.status !== 0) {
    fehlerhaft.push(`${path.relative(WURZEL, datei)}\n${ergebnis.stderr.trim()}`);
  }
}

if (fehlerhaft.length > 0) {
  console.error(`Syntaxfehler in ${fehlerhaft.length} Datei(en):\n\n${fehlerhaft.join('\n\n')}`);
  process.exit(1);
}

console.log(`Build OK - ${dateien.length} JavaScript-Dateien ohne Syntaxfehler.`);
