/**
 * Tests der Startbefehle in package.json.
 *
 * Folie 6 nennt "npm run <port>". npm sucht dabei ein Skript, das genau so
 * heißt wie die Zahl - Platzhalter kennt npm nicht. Deshalb stehen die
 * üblichen Ports als eigene Skripte in package.json. Diese Tests stellen
 * sicher, dass jedes davon auch wirklich auf SEINEM Port startet und keiner
 * beim Kopieren vergessen wurde.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { scripts } = JSON.parse(readFileSync(path.join(WURZEL, 'package.json'), 'utf8'));

/** Alle Skripte, deren Name eine Zahl ist - also "npm run 3333" und Co. */
const portSkripte = Object.entries(scripts).filter(([name]) => /^\d+$/.test(name));

test('die Ports 3000, 3333 und 8080 lassen sich mit "npm run <port>" starten', () => {
  assert.deepEqual(portSkripte.map(([name]) => name).sort(), ['3000', '3333', '8080']);
});

test('jedes Port-Skript startet den Server auf genau seinem Port', () => {
  for (const [name, befehl] of portSkripte) {
    assert.equal(befehl, `node server/server.js ${name}`, `"npm run ${name}"`);
  }
});

test('"npm start" bleibt fuer jeden anderen Port erhalten', () => {
  assert.equal(scripts.start, 'node server/server.js');
});
