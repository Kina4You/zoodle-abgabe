/**
 * Tests der Build-Prüfung auf Syntaxfehler.
 *
 * Wie bei tests/important.test.js wird das Prüfskript genau so gestartet,
 * wie "npm run build" es tut. Entscheidend ist der Exit-Code: 0 heißt, der
 * Build läuft weiter - alles andere heißt, der Build bricht ab.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'pruefe-syntax.js',
);

/** Führt das Prüfskript aus - ohne Ordner prüft es das echte Projekt. */
function pruefe(ordner) {
  const argumente = ordner ? [SKRIPT, ordner] : [SKRIPT];
  return spawnSync(process.execPath, argumente, { encoding: 'utf8' });
}

/**
 * Legt einen Wegwerf-Ordner mit den angegebenen Dateien an.
 *
 * Mit package.json und "type": "module" wie im echten Projekt: Ohne diese
 * Angabe rät Node, ob eine Datei ein ES-Modul ist - und meldet einen
 * Syntaxfehler in einer Datei mit "export" dann nicht.
 */
function ordnerMit(dateien) {
  const ordner = mkdtempSync(path.join(tmpdir(), 'zoodle-syntax-'));
  writeFileSync(path.join(ordner, 'package.json'), '{ "type": "module" }\n');
  for (const [name, inhalt] of Object.entries(dateien)) {
    mkdirSync(path.dirname(path.join(ordner, name)), { recursive: true });
    writeFileSync(path.join(ordner, name), inhalt);
  }
  return ordner;
}

test('das echte Projekt hat keine Syntaxfehler', () => {
  const ergebnis = pruefe();
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
});

test('ein Syntaxfehler in einer Datei laesst den Build scheitern - mit Dateiname', (t) => {
  const ordner = ordnerMit({
    'js/sauber.js': 'export const a = 1;\n',
    'js/kaputt.js': 'export function b( {\n',
  });
  t.after(() => rmSync(ordner, { recursive: true }));

  const ergebnis = pruefe(ordner);
  assert.equal(ergebnis.status, 1);
  assert.match(ergebnis.stderr, /kaputt\.js/);
  assert.doesNotMatch(ergebnis.stderr, /sauber\.js/);
});

test('auch .mjs-Dateien in Unterordnern werden gefunden', (t) => {
  const ordner = ordnerMit({ 'tief/unten/kaputt.mjs': 'const = 1;\n' });
  t.after(() => rmSync(ordner, { recursive: true }));

  assert.equal(pruefe(ordner).status, 1);
});

test('node_modules wird ausgelassen', (t) => {
  const ordner = ordnerMit({ 'node_modules/fremd/kaputt.js': 'const = 1;\n' });
  t.after(() => rmSync(ordner, { recursive: true }));

  assert.equal(pruefe(ordner).status, 0);
});
