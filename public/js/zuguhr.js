/**
 * Zuguhr - zeigt die Restzeit des Spielers am Zug an.
 *
 * WICHTIG: Diese Uhr entscheidet nichts. Gemessen wird ausschließlich auf
 * dem Server (server/zugzeit.js). Er schickt bei jedem Zugwechsel die
 * Restzeit in Millisekunden, und dieses Modul zählt sie nur für die Anzeige
 * herunter. Läuft die Zeit ab, meldet sich der Server mit "zeitAbgelaufen" -
 * nicht diese Uhr.
 *
 * Mehrere Anzeigen sind möglich (in der Leiste und im Duell zusätzlich im
 * Brett des Gegners). Jede Anzeige hat diesen Aufbau (siehe index.html):
 *   .zuguhr  >  .zuguhr__wer, .zuguhr__sekunden, .zuguhr__fuellung
 */

/** So oft wird die Anzeige aufgefrischt - oft genug für einen ruhigen Balken. */
const TAKT_MS = 200;

/** Ab hier wird es knapp (orange) bzw. kritisch (dunkel, wackelt). */
const KNAPP_AB = 5;
const KRITISCH_AB = 3;

/**
 * @param {object} optionen
 * @param {(text: string) => void} optionen.sage  Ansage für Screenreader
 */
export function erstelleZuguhr({ sage }) {
  /** Alle Anzeigen:  { element, nurWennGegnerDran } */
  const anzeigen = [];

  let ende = 0; // performance.now(), wann die Zeit abgelaufen ist
  let gesamtMs = 1; // volle Zugzeit - für die Breite des Balkens
  let binDran = false;
  let gegnerName = '';
  let takt = null;
  let warnungGesagt = false;

  /** Rechnet die verbleibenden Sekunden aus und frischt alle Anzeigen auf. */
  function zeichne() {
    const restMs = Math.max(0, ende - performance.now());
    const sekunden = Math.ceil(restMs / 1000);

    for (const { element, nurWennGegnerDran } of anzeigen) {
      element.hidden = nurWennGegnerDran && binDran;
      element.querySelector('.zuguhr__wer').textContent = binDran
        ? 'Deine Zeit'
        : `Zeit von ${gegnerName}`;
      element.querySelector('.zuguhr__sekunden').textContent = String(sekunden);
      element
        .querySelector('.zuguhr__fuellung')
        .style.setProperty('--anteil', String(Math.min(1, restMs / gesamtMs)));
      element.classList.toggle('zuguhr--knapp', sekunden <= KNAPP_AB && sekunden > KRITISCH_AB);
      element.classList.toggle('zuguhr--kritisch', sekunden <= KRITISCH_AB);
    }

    // Nur wer selbst dran ist, bekommt die Warnung - und nur einmal je Zug.
    if (binDran && !warnungGesagt && sekunden <= KNAPP_AB && restMs > 0) {
      warnungGesagt = true;
      sage(`Noch ${KNAPP_AB} Sekunden.`);
    }

    // Bei null bleibt die Anzeige stehen. Wie es weitergeht, sagt der Server.
    if (restMs === 0) {
      clearInterval(takt);
      takt = null;
    }
  }

  return {
    /**
     * Meldet eine Anzeige an.
     * @param {HTMLElement} element
     * @param {{nurWennGegnerDran?: boolean}} [optionen]  Die Uhr im Brett des
     *   Gegners erscheint nur, wenn ER dran ist.
     */
    fuegeAnzeigeHinzu(element, { nurWennGegnerDran = false } = {}) {
      anzeigen.push({ element, nurWennGegnerDran });
    },

    /**
     * Startet die Anzeige neu - nach jedem Zugwechsel.
     * @param {object} daten
     * @param {number | null} daten.restzeitMs  Vom Server; null = ohne Limit
     * @param {number} daten.zugzeit            Volle Zugzeit in Sekunden
     * @param {boolean} daten.binDran
     * @param {string} daten.gegnerName
     */
    starte({ restzeitMs, zugzeit, binDran: dran, gegnerName: name }) {
      clearInterval(takt);
      takt = null;
      // Ohne Zeitlimit gibt es keine Uhr.
      if (restzeitMs === null || restzeitMs === undefined || !zugzeit) {
        this.stoppe();
        return;
      }

      ende = performance.now() + restzeitMs;
      gesamtMs = zugzeit * 1000;
      binDran = dran;
      gegnerName = name;
      warnungGesagt = false;

      for (const { element } of anzeigen) element.hidden = false;
      zeichne();
      takt = setInterval(zeichne, TAKT_MS);
    },

    /** Blendet alle Anzeigen aus - Spielende, Wahlphase, Lobby. */
    stoppe() {
      clearInterval(takt);
      takt = null;
      for (const { element } of anzeigen) {
        element.hidden = true;
        element.classList.remove('zuguhr--knapp', 'zuguhr--kritisch');
      }
    },
  };
}
