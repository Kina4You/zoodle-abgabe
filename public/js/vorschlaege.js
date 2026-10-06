/**
 * Vorschlagsliste fuer das Eingabefeld.
 *
 * Gesucht wird in zwei Durchgaengen:
 *   1. nach Tiernamen  ("löw"  -> Löwe)
 *   2. nach Kategorien ("säug" -> alle 81 Säugetiere)
 *
 * Namenstreffer stehen immer oben, innerhalb davon nach Relevanz sortiert
 * (siehe sucheTiere). Umlaute und Gross-/Kleinschreibung sind egal:
 * "saugetier" findet ebenso wie "Säugetier".
 *
 * Bewusst selbst gebaut statt <datalist>: Nur so lassen sich geratene Tiere
 * ausblenden, Kategorien durchsuchen und Pfeiltasten unterstuetzen.
 */

/**
 * Obergrenze fuer die Zahl angezeigter Vorschlaege.
 *
 * Bewusst groesser als die gesamte Tierliste (148 Eintraege): Die
 * Kategoriesuche soll ALLE passenden Tiere zeigen. Auf "Säugetier" passen 81
 * Tiere - bei einer Grenze von 60 fiel alles ab "Schneeleopard" weg, Tiger,
 * Wolf und Zebra waren ueber die Kategorie also nie zu finden.
 *
 * Die Grenze bleibt als Sicherheitsnetz stehen, falls die Tierliste einmal
 * stark waechst; im heutigen Spiel greift sie nicht.
 */
export const MAX_TREFFER = 150;

/** Die Kategorien, in denen zusaetzlich zum Namen gesucht wird. */
const KATEGORIE_FELDER = ['klasse', 'lebensraum', 'ernaehrung', 'aktivitaet'];

/**
 * Macht Suchtext vergleichbar: Kleinbuchstaben, Umlaute aufgeloest.
 * Aus "Säugetier" wird "saugetier", aus "Süßwasser" wird "susswasser".
 */
function normalisiere(text) {
  return text
    .toLowerCase()
    .replaceAll('ä', 'a').replaceAll('ö', 'o').replaceAll('ü', 'u')
    .replaceAll('ß', 'ss')
    .trim();
}

/**
 * Wie gut passt ein Tiername zum Suchtext? Kleinere Zahl = weiter oben.
 *
 *   0  der Name IST der Suchtext          ("ameise"  -> Ameise)
 *   1  der Name beginnt mit dem Suchtext  ("eis"     -> Eisbär)
 *   2  der Suchtext steckt irgendwo drin  ("bär"     -> Braunbär)
 *  -1  passt gar nicht
 *
 * @param {string} name       Tiername, noch nicht normalisiert
 * @param {string} suchtext   bereits normalisierter Suchtext
 */
function bewerteNamen(name, suchtext) {
  const normalisiert = normalisiere(name);
  if (normalisiert === suchtext) return 0;
  if (normalisiert.startsWith(suchtext)) return 1;
  if (normalisiert.includes(suchtext)) return 2;
  return -1;
}

/**
 * Sucht alle passenden Tiere und bringt sie in die Reihenfolge, in der sie
 * angezeigt werden. Bewusst eine eigene, exportierte Funktion ohne jeden
 * DOM-Zugriff: So laesst sich die Reihenfolge testen, ohne einen Browser.
 *
 * Zuerst die Namenstreffer, sortiert nach
 *   1. Stufe (exakt, beginnt mit, enthaelt - siehe bewerteNamen),
 *   2. Fundstelle: je weiter vorne der Suchtext im Namen steht, desto eher
 *      ist er gemeint ("bär" -> Eisbär vor Braunbär vor Ameisenbär),
 *   3. Alphabet.
 * Danach die Kategorietreffer in der Reihenfolge der uebergebenen Liste.
 *
 * Wichtig fuer die Enter-Taste: Sie waehlt den ersten Eintrag - der muss
 * deshalb der plausibelste sein und nicht bloss der alphabetisch erste.
 *
 * @param {ReadonlyArray<object>} tiere  Die waehlbaren Tiere (alphabetisch)
 * @param {string} eingabetext           Was der Spieler getippt hat
 * @returns {{ treffer: Array<{tier: object, grund: string}>, gesamt: number }}
 *          treffer ist auf MAX_TREFFER gekuerzt, gesamt zaehlt alle Fundstellen
 */
export function sucheTiere(tiere, eingabetext) {
  const suchtext = normalisiere(eingabetext);
  if (suchtext.length === 0) return { treffer: [], gesamt: 0 };

  // 1. Durchgang: Treffer im Tiernamen.
  const nachName = tiere
    .map((tier) => ({
      tier,
      stufe: bewerteNamen(tier.name, suchtext),
      stelle: normalisiere(tier.name).indexOf(suchtext),
    }))
    .filter((eintrag) => eintrag.stufe >= 0)
    .sort((a, b) =>
      a.stufe - b.stufe
      || a.stelle - b.stelle
      || a.tier.name.localeCompare(b.tier.name, 'de'))
    .map(({ tier }) => ({ tier, grund: '' }));

  const schonDrin = new Set(nachName.map((eintrag) => eintrag.tier.name));

  // 2. Durchgang: Treffer in einer der Kategorien.
  const nachKategorie = [];
  for (const tier of tiere) {
    if (schonDrin.has(tier.name)) continue;
    const feld = KATEGORIE_FELDER.find((f) => normalisiere(tier[f]).includes(suchtext));
    // Bei einem Kategorietreffer zeigen wir spaeter, WARUM das Tier passt.
    if (feld) nachKategorie.push({ tier, grund: tier[feld] });
  }

  const alle = [...nachName, ...nachKategorie];
  return { treffer: alle.slice(0, MAX_TREFFER), gesamt: alle.length };
}

/**
 * Der kleine graue Text rechts neben dem Tiernamen.
 *
 * Die Klasse steht bei JEDEM Vorschlag. Vorher erschien sie nur bei einer
 * Kategoriesuche - wer "Bär" tippte, sah also nicht, ob Braunbär und
 * Ameisenbär ueberhaupt zur selben Tierklasse gehoeren.
 *
 * Kam der Treffer ueber eine andere Kategorie als die Klasse, steht diese
 * zusaetzlich dahinter ("Säugetier · Savanne"). So bleibt sichtbar, WARUM
 * das Tier vorgeschlagen wird, ohne die Klasse doppelt zu nennen.
 *
 * @param {object} tier
 * @param {string} grund  Der Kategoriewert, ueber den der Treffer kam - oder ''
 */
export function beschriftung(tier, grund) {
  if (!grund || grund === tier.klasse) return tier.klasse;
  return `${tier.klasse} · ${grund}`;
}

/**
 * @param {object} optionen
 * @param {HTMLInputElement} optionen.eingabe   Das Textfeld
 * @param {HTMLElement}      optionen.liste     Container fuer die Vorschlaege
 * @param {(name: string) => void} optionen.aufAuswahl  Wird mit dem gewaehlten Namen gerufen
 */
export function erstelleVorschlaege({ eingabe, liste, aufAuswahl }) {
  let alleTiere = [];
  let verbraucht = new Set();
  let treffer = [];
  let gesamt = 0;
  let markiert = -1;

  function schliessen() {
    treffer = [];
    gesamt = 0;
    markiert = -1;
    liste.replaceChildren();
    liste.hidden = true;
    eingabe.setAttribute('aria-expanded', 'false');
    eingabe.removeAttribute('aria-activedescendant');
  }

  function waehlen(name) {
    schliessen();
    eingabe.value = '';
    aufAuswahl(name);
  }

  /**
   * Baut einen einzelnen Eintrag der Liste.
   *
   * Muster "Combobox" des W3C: Der Tastaturfokus bleibt IMMER im Eingabefeld.
   * Die Pfeiltasten verschieben nur die Markierung, und das Feld sagt dem
   * Screenreader per aria-activedescendant, welcher Eintrag gerade markiert
   * ist. Dafuer braucht jeder Eintrag eine id. tabindex="-1" nimmt die
   * Eintraege aus der Tab-Reihenfolge - Tab verlaesst das Feld also wie
   * gewohnt, statt durch 81 Saeugetiere zu wandern.
   */
  function baueEintrag({ tier, grund }, i) {
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.id = `vorschlag-${i}`;
    knopf.tabIndex = -1;
    knopf.className = 'vorschlag' + (i === markiert ? ' vorschlag--aktiv' : '');
    knopf.setAttribute('role', 'option');
    knopf.setAttribute('aria-selected', String(i === markiert));

    const name = document.createElement('span');
    name.className = 'vorschlag__name';
    name.textContent = tier.name;
    knopf.append(name);

    const info = document.createElement('span');
    info.className = 'vorschlag__info';
    info.textContent = beschriftung(tier, grund);
    knopf.append(info);

    // mousedown statt click: feuert vor dem blur des Eingabefelds.
    knopf.addEventListener('mousedown', (e) => { e.preventDefault(); waehlen(tier.name); });
    return knopf;
  }

  function zeichnen() {
    liste.replaceChildren();

    // Greift erst, wenn die Tierliste groesser als MAX_TREFFER wird - heute
    // also nie. Steht hier, damit die gekuerzte Liste nicht stillschweigend
    // so tut, als waere sie vollstaendig.
    if (gesamt > treffer.length) {
      const kopf = document.createElement('p');
      kopf.className = 'vorschlaege__kopf';
      kopf.textContent = `${gesamt} Tiere passen – angezeigt werden die ersten ${treffer.length}.`;
      liste.append(kopf);
    }

    treffer.forEach((eintrag, i) => liste.append(baueEintrag(eintrag, i)));

    const offen = treffer.length > 0;
    liste.hidden = !offen;
    eingabe.setAttribute('aria-expanded', String(offen));
    liste.scrollTop = 0;

    if (markiert >= 0) {
      eingabe.setAttribute('aria-activedescendant', `vorschlag-${markiert}`);
    } else {
      eingabe.removeAttribute('aria-activedescendant');
    }
  }

  function suchen() {
    if (eingabe.disabled || normalisiere(eingabe.value).length === 0) {
      schliessen();
      return;
    }

    // Bereits geratene Tiere gar nicht erst vorschlagen.
    const offen = alleTiere.filter((tier) => !verbraucht.has(tier.name));

    const ergebnis = sucheTiere(offen, eingabe.value);
    treffer = ergebnis.treffer;
    gesamt = ergebnis.gesamt;
    markiert = -1;
    zeichnen();
  }

  eingabe.addEventListener('input', suchen);
  eingabe.addEventListener('blur', () => setTimeout(schliessen, 120));

  eingabe.addEventListener('keydown', (ereignis) => {
    if (ereignis.key === 'Escape') {
      schliessen();
      return;
    }
    if (ereignis.key === 'Enter') {
      ereignis.preventDefault();
      const eintrag = treffer[markiert >= 0 ? markiert : 0];
      if (eintrag) waehlen(eintrag.tier.name);
      return;
    }
    if (ereignis.key !== 'ArrowDown' && ereignis.key !== 'ArrowUp') return;
    if (treffer.length === 0) return;

    ereignis.preventDefault();
    const schritt = ereignis.key === 'ArrowDown' ? 1 : -1;
    // Modulo sorgt dafuer, dass die Auswahl am Ende wieder oben beginnt.
    markiert = (markiert + schritt + treffer.length) % treffer.length;
    zeichnen();
    // Die markierte Zeile in den sichtbaren Bereich scrollen.
    liste.querySelector('.vorschlag--aktiv')?.scrollIntoView({ block: 'nearest' });
  });

  return {
    /** Setzt die Gesamtliste aller waehlbaren Tiere (einmalig beim Laden). */
    setzeTiere(tiere) {
      alleTiere = tiere;
    },
    /** Gibt alle Tiere wieder frei - zu Beginn einer neuen Partie. */
    zuruecksetzen() {
      verbraucht = new Set();
      schliessen();
    },
    /** Blendet ein bereits geratenes Tier aus den Vorschlaegen aus. */
    verbrauche(name) {
      verbraucht.add(name);
    },
    schliessen,
  };
}
