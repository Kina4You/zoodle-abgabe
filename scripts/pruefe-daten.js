/**
 * Wird von "npm run build" aufgerufen.
 *
 * Es gibt bei diesem Projekt nichts zu uebersetzen - HTML, CSS und JavaScript
 * laufen so, wie sie im Repository liegen. Der Build-Schritt prueft deshalb
 * stattdessen, ob das Projekt ueberhaupt startfaehig ist: Ist die
 * Tierliste vollstaendig und fehlerfrei?
 *
 * Damit schlaegt "npm run build" fehl, BEVOR der Server startet und mitten im
 * Spielbetrieb ueber kaputte Daten stolpert.
 */

import { ALLE_TIERE, SUCH_TIERE } from '../server/tierdaten.js';
import { KATEGORIEN, vergleiche } from '../server/spiel.js';

// Das blosse Importieren von tierdaten.js prueft bereits alle Pflichtfelder
// und Zahlenwerte - bei einem Fehler wirft es und der Build bricht ab.

const namen = new Set(ALLE_TIERE.map((tier) => tier.name));
if (namen.size !== ALLE_TIERE.length) {
  throw new Error('Die Tierliste enthaelt doppelte Namen.');
}

// Stichprobe: Laesst sich jedes Tier gegen jedes andere bewerten, ohne dass
// eine Kategorie leer bleibt? (Faengt z. B. Tippfehler in Kategoriewerten.)
for (const tier of ALLE_TIERE) {
  const hinweise = vergleiche(tier, ALLE_TIERE[0]);
  if (hinweise.length !== KATEGORIEN.length) {
    throw new Error(`Bewertung von "${tier.name}" liefert ${hinweise.length} statt ${KATEGORIEN.length} Hinweise.`);
  }
  for (const hinweis of hinweise) {
    if (!hinweis.anzeige) {
      throw new Error(`Tier "${tier.name}": Kategorie "${hinweis.schluessel}" hat keinen Anzeigewert.`);
    }
  }
}

console.log(`Build OK - ${ALLE_TIERE.length} Tiere, ${KATEGORIEN.length} Kategorien, ${SUCH_TIERE.length} Sucheintraege.`);
