/**
 * Tests der Spiellogik.
 *
 * Ausgefuehrt mit "npm test". Verwendet den in Node eingebauten Test-Runner
 * (node:test) - dafuer ist KEINE zusaetzliche Abhaengigkeit noetig.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { KATEGORIEN, Spiel, vergleiche, formatiereGewicht, formatiereGroesse } from '../server/spiel.js';
import { ALLE_TIERE } from '../server/tierdaten.js';

/** Baut ein Testtier - alle Felder haben sinnvolle Vorgaben. */
function tier(eigenschaften = {}) {
  return {
    name: 'Testtier',
    klasse: 'Säugetier',
    lebensraum: 'Wald',
    ernaehrung: 'Fleischfresser',
    gewichtKg: 100,
    groesseCm: 100,
    alterJahre: 10,
    aktivitaet: 'tagaktiv',
    ...eigenschaften,
  };
}

/** Liest die Bewertung einer bestimmten Kategorie aus dem Ergebnis. */
const hinweis = (hinweise, schluessel) => hinweise.find((h) => h.schluessel === schluessel);

// --------------------------------------------------------------------------
test('ein identisches Tier ist in allen Kategorien ein Treffer', () => {
  const ziel = tier();
  const hinweise = vergleiche(tier(), ziel);

  assert.equal(hinweise.length, KATEGORIEN.length);
  for (const h of hinweise) {
    assert.equal(h.bewertung, 'treffer', `${h.schluessel} sollte ein Treffer sein`);
    assert.equal(h.richtung, null, `${h.schluessel} darf keinen Pfeil haben`);
  }
});

test('verwandte Klassen gelten als "nah dran"', () => {
  const hinweise = vergleiche(tier({ klasse: 'Reptil' }), tier({ klasse: 'Amphibie' }));
  assert.equal(hinweis(hinweise, 'klasse').bewertung, 'nah');
});

test('nicht verwandte Klassen gelten als "daneben"', () => {
  const hinweise = vergleiche(tier({ klasse: 'Säugetier' }), tier({ klasse: 'Insekt' }));
  assert.equal(hinweis(hinweise, 'klasse').bewertung, 'daneben');
});

test('"Allesfresser" ist die Bruecke zwischen Fleisch- und Pflanzenfressern', () => {
  const nah = vergleiche(tier({ ernaehrung: 'Allesfresser' }), tier({ ernaehrung: 'Pflanzenfresser' }));
  assert.equal(hinweis(nah, 'ernaehrung').bewertung, 'nah');

  const daneben = vergleiche(tier({ ernaehrung: 'Fleischfresser' }), tier({ ernaehrung: 'Pflanzenfresser' }));
  assert.equal(hinweis(daneben, 'ernaehrung').bewertung, 'daneben');
});

test('"dämmerungsaktiv" ist die Bruecke zwischen tag- und nachtaktiv', () => {
  const hinweise = vergleiche(tier({ aktivitaet: 'dämmerungsaktiv' }), tier({ aktivitaet: 'nachtaktiv' }));
  assert.equal(hinweis(hinweise, 'aktivitaet').bewertung, 'nah');
});

// --------------------------------------------------------------------------
test('Zahlen: bis 10 Prozent Abweichung ist ein Treffer, ohne Pfeil', () => {
  const hinweise = vergleiche(tier({ gewichtKg: 105 }), tier({ gewichtKg: 100 }));
  const gewicht = hinweis(hinweise, 'gewichtKg');

  assert.equal(gewicht.bewertung, 'treffer');
  assert.equal(gewicht.richtung, null, 'eine gruene Kachel darf keinen Pfeil zeigen');
});

test('Zahlen: der Pfeil zeigt, wo das GESUCHTE Tier liegt', () => {
  const zuLeicht = hinweis(vergleiche(tier({ gewichtKg: 10 }), tier({ gewichtKg: 100 })), 'gewichtKg');
  assert.equal(zuLeicht.richtung, 'hoeher', 'geraten 10 kg, gesucht 100 kg -> Pfeil nach oben');

  const zuSchwer = hinweis(vergleiche(tier({ gewichtKg: 1000 }), tier({ gewichtKg: 100 })), 'gewichtKg');
  assert.equal(zuSchwer.richtung, 'niedriger');
});

test('Zahlen: Faktor 2 ist "nah dran", Faktor 10 ist "daneben"', () => {
  assert.equal(hinweis(vergleiche(tier({ alterJahre: 20 }), tier({ alterJahre: 10 })), 'alterJahre').bewertung, 'nah');
  assert.equal(hinweis(vergleiche(tier({ alterJahre: 100 }), tier({ alterJahre: 10 })), 'alterJahre').bewertung, 'daneben');
});

/** Kurzform: Wie wird ein Gewicht von x gegen ein Ziel von 100 bewertet? */
const bewerteGewicht = (x) => hinweis(vergleiche(tier({ gewichtKg: x }), tier({ gewichtKg: 100 })), 'gewichtKg').bewertung;

test('Grenzwert Treffer: genau 10 Prozent Abweichung zaehlt noch als Treffer', () => {
  // Diese vier Werte legen fest, wie schwer das Spiel ist. Ein Tippfehler in
  // ZAHL_TREFFER wuerde ohne diesen Test unbemerkt durchgehen.
  assert.equal(bewerteGewicht(90), 'treffer', '90 zu 100 = genau -10 %');
  assert.equal(bewerteGewicht(110), 'treffer', '110 zu 100 = genau +10 %');

  assert.equal(bewerteGewicht(89), 'nah', 'knapp darunter ist kein Treffer mehr');
  assert.equal(bewerteGewicht(111), 'nah', 'knapp darueber ebenso wenig');
});

test('Grenzwert nah dran: Verhaeltnis 0,4 und 2,5 zaehlen noch als "nah"', () => {
  assert.equal(bewerteGewicht(40), 'nah', '40 zu 100 = Verhaeltnis 0,4');
  assert.equal(bewerteGewicht(250), 'nah', '250 zu 100 = Verhaeltnis 2,5');

  assert.equal(bewerteGewicht(39), 'daneben', 'knapp darunter ist daneben');
  assert.equal(bewerteGewicht(251), 'daneben', 'knapp darueber ist daneben');
});

test('die Pfeilrichtung kippt genau an der Treffergrenze', () => {
  // Ein Treffer bekommt NIE einen Pfeil - eine gruene Kachel mit Pfeil
  // waere widerspruechlich. Direkt daneben muss der Pfeil aber da sein.
  const pfeil = (x) => hinweis(vergleiche(tier({ gewichtKg: x }), tier({ gewichtKg: 100 })), 'gewichtKg').richtung;

  assert.equal(pfeil(90), null, 'noch Treffer, also kein Pfeil');
  assert.equal(pfeil(89), 'hoeher', 'zu leicht - gesucht ist schwerer');
  assert.equal(pfeil(110), null, 'noch Treffer, also kein Pfeil');
  assert.equal(pfeil(111), 'niedriger', 'zu schwer - gesucht ist leichter');
});

// --------------------------------------------------------------------------
test('Gewichte werden lesbar formatiert', () => {
  assert.equal(formatiereGewicht(150000), '150 t');
  assert.equal(formatiereGewicht(190), '190 kg');
  assert.equal(formatiereGewicht(0.02), '20 g');
});

test('Groessen werden lesbar formatiert', () => {
  assert.equal(formatiereGroesse(2500), '25 m');
  assert.equal(formatiereGroesse(250), '2,5 m');
  assert.equal(formatiereGroesse(100), '1 m');
  assert.equal(formatiereGroesse(80), '80 cm');
});

test('auch Groessen unter einem Zentimeter nutzen das deutsche Komma', () => {
  // Diese drei Werte stehen so in den Tierdaten. Vorher kam hier ein
  // Dezimalpunkt heraus - "0.6 cm" neben "2,5 m" auf demselben Spielfeld.
  assert.equal(formatiereGroesse(0.6), '0,6 cm');  // Ameise
  assert.equal(formatiereGroesse(1.5), '1,5 cm');  // Honigbiene
  assert.equal(formatiereGroesse(0.7), '0,7 cm');  // Marienkäfer
});

test('kein einziger Anzeigewert enthaelt einen Dezimalpunkt', () => {
  // Der eigentliche Schutz: Statt einzelner Stichproben wird die GESAMTE
  // Tierliste durchgerechnet. Ein neues Tier mit krummem Wert faellt sofort auf.
  for (const tier of ALLE_TIERE) {
    for (const [feld, formatiere] of [['gewichtKg', formatiereGewicht], ['groesseCm', formatiereGroesse]]) {
      const anzeige = formatiere(tier[feld]);
      assert.ok(!anzeige.includes('.'), `"${tier.name}" zeigt ${feld} als "${anzeige}"`);
    }
  }
});

// --------------------------------------------------------------------------
test('nach einem falschen Tipp ist der Gegner am Zug', () => {
  const spiel = new Spiel('a', 'b', tier({ name: 'Loesung' }));
  const ersterSpieler = spiel.amZug;
  const zweiterSpieler = spiel.gegnerVon(ersterSpieler);

  spiel.rate(ersterSpieler, tier({ name: 'Falsch' }));

  assert.equal(spiel.amZug, zweiterSpieler);
  assert.equal(spiel.beendet, false);
  assert.equal(spiel.istAmZug(ersterSpieler), false);
});

test('ein richtiger Tipp beendet die Partie', () => {
  const loesung = tier({ name: 'Loesung' });
  const spiel = new Spiel('a', 'b', loesung);

  const versuch = spiel.rate(spiel.amZug, loesung);

  assert.equal(versuch.richtig, true);
  assert.equal(spiel.beendet, true);
  assert.equal(spiel.istAmZug('a'), false);
  assert.equal(spiel.istAmZug('b'), false);
});

test('bereits geratene Tiere werden erkannt', () => {
  const spiel = new Spiel('a', 'b', tier({ name: 'Loesung' }));

  assert.equal(spiel.schonGeraten('Falsch'), false);
  spiel.rate(spiel.amZug, tier({ name: 'Falsch' }));
  assert.equal(spiel.schonGeraten('Falsch'), true);
});

test('jede Partie zaehlt ihre Tipps mit', () => {
  const spiel = new Spiel('a', 'b', tier({ name: 'Loesung' }));

  spiel.rate(spiel.amZug, tier({ name: 'Eins' }));
  spiel.rate(spiel.amZug, tier({ name: 'Zwei' }));

  assert.equal(spiel.versuche.length, 2);
});

// --------------------------------------------------------------------------
// Modus Duell: jeder waehlt ein Tier fuer den anderen
// --------------------------------------------------------------------------

/** Eine Duell-Partie, in der beide schon gewaehlt haben. */
function duell({ fuerA = 'Loewe', fuerB = 'Adler' } = {}) {
  const spiel = new Spiel('a', 'b', null, 'duell');
  spiel.waehleTier('b', tier({ name: fuerA })); // b waehlt fuer a
  spiel.waehleTier('a', tier({ name: fuerB })); // a waehlt fuer b
  return spiel;
}

test('Duell: die Partie beginnt mit der Wahl, nicht mit dem Raten', () => {
  const spiel = new Spiel('a', 'b', null, 'duell');
  assert.equal(spiel.phase, 'wahl');
  assert.equal(spiel.istAmZug(spiel.amZug), false, 'waehrend der Wahl ist niemand am Zug');
});

test('Duell: wer waehlt, bestimmt das Tier des GEGNERS', () => {
  const spiel = new Spiel('a', 'b', null, 'duell');
  spiel.waehleTier('a', tier({ name: 'Adler' }));

  assert.equal(spiel.hatGewaehlt('a'), true);
  assert.equal(spiel.hatGewaehlt('b'), false);
  assert.equal(spiel.geheimnisVon('b').name, 'Adler', 'b muss erraten, was a gewaehlt hat');
  assert.equal(spiel.geheimnisVon('a'), undefined);
  assert.equal(spiel.phase, 'wahl', 'erst wenn beide gewaehlt haben, geht es los');
});

test('Duell: haben beide gewaehlt, beginnt das Raten', () => {
  const spiel = duell();
  assert.equal(spiel.phase, 'raten');
  assert.equal(spiel.istAmZug(spiel.amZug), true);
});

test('Duell: jeder wird gegen SEIN Tier bewertet', () => {
  const spiel = duell({ fuerA: 'Loewe', fuerB: 'Adler' });
  spiel.amZug = 'a';

  const tippA = spiel.rate('a', tier({ name: 'Adler' }));
  assert.equal(tippA.richtig, false, 'Adler ist das Tier von b, nicht von a');

  const tippB = spiel.rate('b', tier({ name: 'Adler' }));
  assert.equal(tippB.richtig, true);
  assert.equal(spiel.beendet, true);
});

test('Duell: "schon geraten" zaehlt nur die eigenen Tipps', () => {
  const spiel = duell();
  spiel.amZug = 'a';
  spiel.rate('a', tier({ name: 'Wolf' }));

  assert.equal(spiel.schonGeraten('Wolf', 'a'), true);
  assert.equal(spiel.schonGeraten('Wolf', 'b'), false, 'fuer b kann Wolf genau das gesuchte Tier sein');
});

test('Zufallstier: "schon geraten" zaehlt die Tipps beider', () => {
  const spiel = new Spiel('a', 'b', tier({ name: 'Loesung' }));
  spiel.amZug = 'a';
  spiel.rate('a', tier({ name: 'Wolf' }));

  assert.equal(spiel.schonGeraten('Wolf', 'b'), true);
  assert.equal(spiel.geheimnisVon('a'), spiel.geheimnisVon('b'), 'beide suchen dasselbe Tier');
});
