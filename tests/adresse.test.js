/**
 * Tests der echten Spieleradresse hinter dem Proxy (server/adresse.js).
 *
 * Wichtig ist vor allem der zweite Test: Wer direkt (nicht über Caddy) auf
 * Port 3333 kommt, darf sich mit einer gefälschten Kopfzeile keine neue
 * Adresse ausdenken - sonst wäre die Passwort-Sperre wieder umgehbar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { echteAdresse } from '../server/adresse.js';

test('ueber Caddy: die Adresse aus X-Forwarded-For zaehlt', () => {
  assert.equal(echteAdresse('127.0.0.1', '2001:db8::7'), '2001:db8::7');
  assert.equal(echteAdresse('::ffff:127.0.0.1', '10.0.0.7'), '10.0.0.7');
  assert.equal(echteAdresse('::1', '10.0.0.7'), '10.0.0.7');
});

test('direkt von aussen: eine gefaelschte Kopfzeile wird ignoriert', () => {
  assert.equal(echteAdresse('2001:db8::66', '1.2.3.4'), '2001:db8::66');
  assert.equal(echteAdresse('10.0.0.9', 'irgendwas'), '10.0.0.9');
});

test('mehrere Adressen: es gilt die letzte, die Caddy angehaengt hat', () => {
  // Der Browser hat "1.2.3.4" selbst mitgeschickt, Caddy hat die echte angehängt.
  assert.equal(echteAdresse('127.0.0.1', '1.2.3.4, 2001:db8::7'), '2001:db8::7');
});

test('ohne Kopfzeile oder mit Unsinn: die direkte Adresse', () => {
  assert.equal(echteAdresse('127.0.0.1', undefined), '127.0.0.1');
  assert.equal(echteAdresse('127.0.0.1', ''), '127.0.0.1');
  assert.equal(echteAdresse('127.0.0.1', ' , '), '127.0.0.1');
  assert.equal(echteAdresse('127.0.0.1', ['a', 'b']), '127.0.0.1');
});
