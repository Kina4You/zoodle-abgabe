/**
 * Tests der Farbkontraste nach WCAG 2.2.
 *
 * Gerechnet wird mit den Farbwerten aus tokens.css und den Regeln aus den
 * übrigen CSS-Dateien - ohne Browser. Rutscht eine Farbe unter die Grenze
 * (Text 4,5 : 1, Rahmen von Bedienelementen 3 : 1), wird der Test rot,
 * bevor es jemand im Spiel bemerkt. Die Messung im Browser, aus der diese
 * Tests stammen, steht in review-befunde.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'css');
const lies = (datei) => readFileSync(path.join(CSS, datei), 'utf8');

// Alle Farb-Tokens: entweder ein Hex-Wert oder ein Verweis auf ein anderes Token.
const TOKENS = new Map();
for (const [, name, wert] of lies('tokens.css').matchAll(
  /--([\w-]+):\s*(#[0-9a-f]{6}|var\(--[\w-]+\));/g,
)) {
  TOKENS.set(name, wert);
}

/** Hex-Wert eines Tokens, Verweise wie var(--akzent-2-700) werden aufgelöst. */
function farbe(name) {
  const wert = TOKENS.get(name);
  assert.ok(wert, `Token --${name} fehlt in tokens.css`);
  const verweis = wert.match(/^var\(--([\w-]+)\)$/);
  return verweis ? farbe(verweis[1]) : wert;
}

/** Kontrastverhältnis zweier Hex-Farben nach der WCAG-Formel. */
function kontrast(a, b) {
  const helligkeit = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const kanal = parseInt(hex.slice(i, i + 2), 16) / 255;
      return kanal <= 0.04045 ? kanal / 12.92 : ((kanal + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hell, dunkel] = [helligkeit(a), helligkeit(b)].sort((x, y) => y - x);
  return (hell + 0.05) / (dunkel + 0.05);
}

/** Alle Regelblöcke mit genau diesem Selektor (bis zur ersten schließenden Klammer). */
function bloecke(datei, selektor) {
  const css = lies(datei);
  const funde = [];
  for (let start = css.indexOf(selektor); start !== -1; start = css.indexOf(selektor, start + 1)) {
    // Direkt danach muss "{" kommen - Leerzeichen dazwischen sind erlaubt,
    // weil die Stufen-Regeln in duell.css bündig ausgerichtet sind.
    if (!/^\s*\{/.test(css.slice(start + selektor.length))) continue;
    funde.push(css.slice(start, css.indexOf('}', start)));
  }
  assert.ok(funde.length > 0, `${selektor} nicht in ${datei} gefunden`);
  return funde;
}

/** Das Token, das in einem Regelblock für eine Eigenschaft steht. */
function tokenIn(block, eigenschaft) {
  // "color" darf nicht in "border-color" gefunden werden, und bei
  // "border: 1px solid var(--x)" steht das Token nicht am Anfang.
  const fund = block.match(new RegExp(`(?<![\\w-])${eigenschaft}:[^;]*var\\(--([\\w-]+)\\)`));
  assert.ok(fund, `${eigenschaft} mit var(--…) erwartet in:\n${block}`);
  return fund[1];
}

test('Kacheln: Schrift und Zeichen erreichen auf allen drei Bewertungen 4,5 : 1', () => {
  for (const art of ['treffer', 'nah', 'daneben']) {
    const wert = kontrast(farbe(`${art}-text`), farbe(`${art}-grund`));
    assert.ok(wert >= 4.5, `${art}: ${wert.toFixed(2)} : 1`);
  }
  // Die Zeichen ✓ ~ ✕ stehen in derselben Farbe wie der Text - durchsichtig
  // gemacht fielen sie auf 4,0 : 1 und damit durch.
  const [zeichen] = bloecke('spielfeld.css', '.kachel__zeichen');
  assert.doesNotMatch(zeichen, /opacity/);
});

test('Hauptknopf: dunkle Schrift auf Orange mit Abstand zur Grenze', () => {
  const [knopf] = bloecke('komponenten.css', '.knopf--primaer');
  const wert = kontrast(farbe(tokenIn(knopf, 'color')), farbe(tokenIn(knopf, 'background')));
  // 4,5 : 1 ist die Grenze. 5 : 1 verlangt der Test, damit eine kleine
  // Farbänderung den wichtigsten Knopf nicht gleich durchfallen lässt.
  assert.ok(wert >= 5, `${wert.toFixed(2)} : 1`);
});

test('Papier ist undurchsichtig - die Szene dahinter drückt keinen Kontrast', () => {
  // Schon 4 % Durchsicht reichten: Über dem dunklen Wald fielen die
  // Spaltenköpfe der Tabelle auf 4,49 : 1.
  const papier = lies('tokens.css').match(/--papier:\s*([^;]+);/)[1];
  assert.doesNotMatch(papier, /transparent/);
  assert.ok(kontrast(farbe('neutral-700'), farbe('papier')) >= 4.5);
});

test('Gewählte Option (Modus, Zugzeit): Rahmen mit Abstand über 3 : 1', () => {
  // WCAG verlangt 3 : 1 für Rahmen von Bedienelementen. --farbe-akzent lag
  // mit 3,03 : 1 genau auf der Kante, deshalb verlangt der Test 3,5 : 1.
  // Zwei Kartenarten in lobby.css, beide mit derselben Regel.
  const gewaehlt = bloecke('lobby.css', '&:has(input:checked)');
  assert.equal(gewaehlt.length, 2);
  for (const block of gewaehlt) {
    const wert = kontrast(farbe(tokenIn(block, 'border-color')), farbe('papier'));
    assert.ok(wert >= 3.5, `${wert.toFixed(2)} : 1`);
  }
});

test('Schrift auf farbigen Flächen außerhalb der Kacheln: mindestens 4,5 : 1', () => {
  const stellen = [
    ['komponenten.css', '.spielermarke--ich-dran'],
    ['komponenten.css', '.spielermarke--gegner-dran'],
    ['duell.css', '.stufe--kalt'],
    ['duell.css', '.stufe--warm'],
    ['duell.css', '.stufe--heiss'],
    ['duell.css', '.stufe--gleich'],
    ['duell.css', '.endstand__plakette'],
  ];
  for (const [datei, selektor] of stellen) {
    const [block] = bloecke(datei, selektor);
    const wert = kontrast(farbe(tokenIn(block, 'color')), farbe(tokenIn(block, 'background')));
    assert.ok(wert >= 4.5, `${selektor}: ${wert.toFixed(2)} : 1`);
  }
  // "Du" bzw. der Gegnername unter jedem Tipp, auf der Fläche der Namenszelle.
  for (const selektor of ['.tipp__von--ich', '.tipp__von--gegner']) {
    const [block] = bloecke('spielfeld.css', selektor);
    const wert = kontrast(farbe(tokenIn(block, 'color')), farbe('farbe-flaeche'));
    assert.ok(wert >= 4.5, `${selektor}: ${wert.toFixed(2)} : 1`);
  }
  // Fehlermeldungen stehen ohne eigene Fläche auf dem Papier.
  const [meldung] = bloecke('komponenten.css', '.meldung');
  assert.ok(kontrast(farbe(tokenIn(meldung, 'color')), farbe('papier')) >= 4.5);
});

test('Rahmen, die man ohne Text erkennen muss: mindestens 3 : 1 zum Papier', () => {
  // WCAG 1.4.11: wo ein Eingabefeld ist, wo der Fokus steht, welche Kachel
  // ein Treffer ist.
  const [feld] = bloecke('komponenten.css', '.feld');
  const [fokus] = bloecke('komponenten.css', ':where(.feld, .knopf):focus-visible');
  const rahmen = {
    Eingabefeld: tokenIn(feld, 'border'),
    Fokusrahmen: tokenIn(fokus, 'outline'),
    Trefferrand: 'treffer-rand',
  };
  for (const [was, token] of Object.entries(rahmen)) {
    const wert = kontrast(farbe(token), farbe('papier'));
    assert.ok(wert >= 3, `${was}: ${wert.toFixed(2)} : 1`);
  }
});
