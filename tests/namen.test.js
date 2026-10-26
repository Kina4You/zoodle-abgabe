/**
 * Tests der Namensbereinigung (server/namen.js): Jeder Fall ist etwas, das
 * ein Spielername sonst beim Gegner anrichten könnte.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { bereinigeName, MAX_NAMENSLAENGE } from '../server/namen.js';

test('Steuer- und Formatzeichen werden entfernt', () => {
  assert.equal(bereinigeName('‮anna'), 'anna', 'U+202E wuerde den Text umdrehen');
  assert.equal(bereinigeName('a​b'), 'ab', 'Null-Breite-Leerzeichen');
  assert.equal(bereinigeName('\u0085x'), 'x', 'Steuerzeichen U+0085');
  assert.equal(bereinigeName('a b'), 'ab', 'Zeilentrenner');
  assert.equal(bereinigeName('﻿Lena'), 'Lena', 'Byte-Order-Mark');
});

test('ein Name nur aus unsichtbaren Zeichen ist leer', () => {
  assert.equal(bereinigeName('​​'), '');
  assert.equal(bereinigeName('‮ ‍ '), '');
});

test('hoechstens zwei Akzente auf einem Buchstaben ("Zalgo")', () => {
  const zalgo = 'Z̶̷̸̴̵algo';
  assert.equal(bereinigeName(zalgo), 'Z̶̷algo');
  // Zwei Akzente sind echte Schrift, z. B. im Vietnamesischen.
  assert.equal(bereinigeName('ế'), 'ế');
});

test('gekuerzt wird nach ganzen Zeichen - kein halbes Emoji an der Grenze', () => {
  assert.equal(bereinigeName('a'.repeat(19) + '😀'), 'a'.repeat(19) + '😀');
  assert.equal(bereinigeName('a'.repeat(30)), 'a'.repeat(MAX_NAMENSLAENGE));
  const familie = '👨‍👩‍👧';
  assert.equal(
    bereinigeName('a'.repeat(19) + familie),
    'a'.repeat(19) + familie,
    'Familie bleibt ganz',
  );
  assert.equal(bereinigeName('a'.repeat(20) + familie), 'a'.repeat(20), 'oder faellt ganz weg');
});

test('der Verbinder U+200D bleibt nur zwischen Emoji', () => {
  assert.equal(bereinigeName('👨‍👩 Nico'), '👨‍👩 Nico');
  assert.equal(bereinigeName('a‍b'), 'ab');
});

test('auch ein einziges, sehr langes Zeichen sprengt die Laenge nicht', () => {
  const kette = Array(100).fill('👨').join('‍'); // gilt als EIN Graphem
  assert.ok(bereinigeName(kette).length <= 80);
});

test('kein Text: leerer Name', () => {
  for (const unsinn of [undefined, null, 42, {}, ['Anna']]) assert.equal(bereinigeName(unsinn), '');
});
