/**
 * Wird von "npm run build" aufgerufen.
 *
 * Es gibt bei diesem Projekt nichts zu übersetzen - HTML, CSS und JavaScript
 * laufen so, wie sie im Repository liegen. Der Build-Schritt prüft deshalb
 * stattdessen, ob das Projekt überhaupt startfähig ist: Ist die
 * Tierliste vollständig und fehlerfrei?
 *
 * Damit schlägt "npm run build" fehl, BEVOR der Server startet und mitten im
 * Spielbetrieb über kaputte Daten stolpert.
 */

import { ALLE_TIERE, SUCH_TIERE } from '../server/tierdaten.js';
import { KATEGORIEN, vergleiche } from '../server/spiel.js';

// Das bloße Importieren von tierdaten.js prüft bereits alle Pflichtfelder
// und Zahlenwerte - bei einem Fehler wirft es und der Build bricht ab.

const namen = new Set(ALLE_TIERE.map((tier) => tier.name));
if (namen.size !== ALLE_TIERE.length) {
  throw new Error('Die Tierliste enthaelt doppelte Namen.');
}

// Stichprobe: Lässt sich jedes Tier gegen jedes andere bewerten, ohne dass
// eine Kategorie leer bleibt? (Fängt z. B. Tippfehler in Kategoriewerten.)
for (const tier of ALLE_TIERE) {
  const hinweise = vergleiche(tier, ALLE_TIERE[0]);
  if (hinweise.length !== KATEGORIEN.length) {
    throw new Error(
      `Bewertung von "${tier.name}" liefert ${hinweise.length} statt ${KATEGORIEN.length} Hinweise.`,
    );
  }
  for (const hinweis of hinweise) {
    if (!hinweis.anzeige) {
      throw new Error(
        `Tier "${tier.name}": Kategorie "${hinweis.schluessel}" hat keinen Anzeigewert.`,
      );
    }
  }
}

console.log(
  `Build OK - ${ALLE_TIERE.length} Tiere, ${KATEGORIEN.length} Kategorien, ${SUCH_TIERE.length} Sucheintraege.`,
);
