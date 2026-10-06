/**
 * Tests der Build-Pruefung gegen "!important".
 *
 * Die Tests starten das Pruefskript genau so, wie "npm run build" es tut, und
 * schauen auf den Exit-Code: 0 heisst, der Build laeuft weiter - alles andere
 * heisst, der Build bricht ab.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'pruefe-important.js');

/** Fuehrt das Pruefskript aus - ohne Ordner prueft es das echte public/. */
function pruefe(ordner) {
  const argumente = ordner ? [SKRIPT, ordner] : [SKRIPT];
  return spawnSync(process.execPath, argumente, { encoding: 'utf8' });
}

/** Legt einen Wegwerf-Ordner mit den angegebenen Dateien an. */
function ordnerMit(dateien) {
  const ordner = mkdtempSync(path.join(tmpdir(), 'zoodle-important-'));
  for (const [name, inhalt] of Object.entries(dateien)) {
    mkdirSync(path.dirname(path.join(ordner, name)), { recursive: true });
    writeFileSync(path.join(ordner, name), inhalt);
  }
  return ordner;
}

test('das echte public/ enthaelt kein !important', () => {
  const ergebnis = pruefe();
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
});

test('ein !important in einer CSS-Datei laesst den Build scheitern', (t) => {
  const ordner = ordnerMit({
    'css/sauber.css': '.a { color: red; }\n',
    'css/verboten.css': '.b {\n  display: none !important;\n}\n',
  });
  t.after(() => rmSync(ordner, { recursive: true }));

  const ergebnis = pruefe(ordner);
  assert.equal(ergebnis.status, 1);
  // Die Meldung nennt Datei und Zeile, damit man den Verstoss sofort findet.
  assert.match(ergebnis.stderr, /verboten\.css:2/);
  assert.doesNotMatch(ergebnis.stderr, /sauber\.css/);
});

test('auch ein !important im HTML laesst den Build scheitern', (t) => {
  const ordner = ordnerMit({
    'index.html': '<p style="color: red !important">Hallo</p>\n',
  });
  t.after(() => rmSync(ordner, { recursive: true }));

  assert.equal(pruefe(ordner).status, 1);
});

test('ein Ordner ohne !important besteht die Pruefung', (t) => {
  const ordner = ordnerMit({
    'css/a.css': '@layer a { .a { display: flex; } }\n',
    'js/b.js': "console.log('wichtig');\n",
  });
  t.after(() => rmSync(ordner, { recursive: true }));

  assert.equal(pruefe(ordner).status, 0);
});
