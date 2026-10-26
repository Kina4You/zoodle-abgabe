/**
 * Zoodle - Clientseitiges JavaScript
 * ==================================
 *
 * Verantwortlich für:
 *   - Umschalten zwischen Anmeldung, Lobby und Spielfeld
 *   - Senden von Nachrichten an den Server
 *   - Reagieren auf Nachrichten vom Server
 *
 * Alles, was nur die Lobby betrifft (Liste, Dialoge, Passwortfelder), steht
 * in lobby.js.
 *
 * Die Spielregeln liegen bewusst NICHT hier, sondern auf dem Server.
 * Dieser Client ist reine Darstellung: Er kennt das gesuchte Tier nicht.
 */

import { erstelleVorschlaege } from './vorschlaege.js';
import {
  setzeKategorien,
  fuegeTippHinzu,
  leereTabelle,
  hinweisAlsSatz,
  zeichneFelder,
  fuegeSpurHinzu,
  setzeStufe,
  baueEndstandSeite,
} from './spielfeld.js';
import {
  geknackt,
  gefahrenstufe,
  meilenstein,
  fehlende,
  aufzaehlung,
  STUFENTEXT,
} from './fortschritt.js';
import { erstelleLobby, haltOffen, setzeFeldfehler } from './lobby.js';
import { erstelleZuguhr } from './zuguhr.js';

// "io" stammt aus /socket.io/socket.io.js, das im HTML eingebunden ist.
const socket = io();

// --- Elemente einmalig einsammeln ----------------------------------------
const anmeldeDialog = document.querySelector('#anmelde-dialog');
const dialogTitel = document.querySelector('#dialog-titel');
const dialogText = document.querySelector('#dialog-text');
const dialogMeldung = document.querySelector('#dialog-meldung');
const anmeldeFormular = document.querySelector('#anmelde-formular');
const feldName = document.querySelector('#feld-name');

const spielbereich = document.querySelector('#spielbereich');
const feldTipp = document.querySelector('#feld-tipp');
const listeElement = document.querySelector('#vorschlaege');
const spielerLeiste = document.querySelector('#spieler');
const spielMeldung = document.querySelector('#spiel-meldung');
const duellInfo = document.querySelector('#duell-info');
const verlassenKnopf = document.querySelector('#partie-verlassen-knopf');
const feldTippLabel = document.querySelector('label[for="feld-tipp"]');

/** Platzhalter und Beschriftung des Eingabefelds beim normalen Raten. */
const RATEN_TEXT = 'Tier oder Kategorie eingeben';

// Duell: die beiden Bretter und der Endstand
const gegnerBrett = document.querySelector('#gegner-brett');
const gegnerTitel = document.querySelector('#gegner-titel');
const gegnerUnter = document.querySelector('#gegner-unter');
const gegnerTippt = document.querySelector('#gegner-tippt');
const gegnerStufe = document.querySelector('#gegner-stufe');
const gegnerFelder = document.querySelector('#gegner-felder');
const gegnerAnzahl = document.querySelector('#gegner-anzahl');
const gegnerMeilenstein = document.querySelector('#gegner-meilenstein');
const gegnerSpuren = document.querySelector('#gegner-spuren');
const eigenesBrett = document.querySelector('#eigenes-brett');
const eigenesUnter = document.querySelector('#eigenes-unter');
const eigeneFelder = document.querySelector('#eigene-felder');
const eigeneAnzahl = document.querySelector('#eigene-anzahl');
const brettTabelle = document.querySelector('#brett-tabelle');
const tabelleHuelle = document.querySelector('#tabelle-huelle');
const tippTabelle = document.querySelector('#tipp-tabelle');
const tabellenTitel = document.querySelector('#tabellen-titel');
const endstand = document.querySelector('#endstand');
const endstandFazit = document.querySelector('#endstand-fazit');

/** Die Beschriftung der Tabelle beim Zufallstier (im Duell steht dort etwas anderes). */
const TABELLEN_TITEL_ZUFALL = tabellenTitel.textContent;

const endeKarte = document.querySelector('#ende');
const endeTitel = document.querySelector('#ende-titel');
const endeText = document.querySelector('#ende-text');
const revancheKnopf = document.querySelector('#revanche-knopf');
const zurLobbyKnopf = document.querySelector('#zur-lobby-knopf');

const regelnKnopf = document.querySelector('#regeln-knopf');
const regeln = document.querySelector('#regeln');
const poolInfo = document.querySelector('#pool-info');
const ansage = document.querySelector('#ansage');

/** Alles, was der Client über die laufende Partie weiß. */
const zustand = {
  // Erst nach der Anmeldung darf der Anmeldedialog zugehen.
  angemeldet: false,
  gegnerName: '',
  binAmZug: false,
  laeuft: false,
  // 'zufall' oder 'duell' - kommt mit spielStart.
  modus: 'zufall',
  // Nur im Duell: 'wahl' (beide wählen ein Tier für den anderen) oder 'raten'.
  phase: 'raten',
  meineWahl: '', // das Tier, das ich für den Gegner gewählt habe
  gegnerHatGewaehlt: false,
  // Sekunden pro Zug (0 = ohne Limit) - kommt mit spielStart.
  zugzeit: 0,
  // Nur im Duell: Sekunden für die Wahl - kommt mit spielStart.
  wahlzeit: 0,
  // Nur im Duell: die Tipps beider Seiten - daraus berechnet fortschritt.js
  // Fortschritt, Gefahrenstufe und Meilensteine.
  meineTipps: [],
  gegnerTipps: [],
  // Das Tier, das ich gesucht habe - erst am Ende bekannt (für den Endstand).
  meinZiel: '',
  // Ist die Verbindung tot, hilft kein Knopf mehr - nur noch Neuladen.
  verbindungWeg: false,
};

const vorschlaege = erstelleVorschlaege({
  eingabe: feldTipp,
  liste: listeElement,
  hinweis: document.querySelector('#vorschlaege-hinweis'),
  aufAuswahl: (name) => {
    if (!zustand.laeuft) return;
    spielMeldung.textContent = '';
    // Im Duell wählt dasselbe Feld zuerst das Tier für den Gegner.
    if (zustand.phase === 'wahl') {
      if (!zustand.meineWahl) socket.emit('tierWaehlen', name);
      return;
    }
    if (!zustand.binAmZug) return;
    socket.emit('raten', name);
  },
});

// --- Ansagen für Screenreader ---------------------------------------------

let ansageTimer;

/**
 * Lässt den Screenreader einen Text vorlesen - über eine Live-Region.
 *
 * Normalerweise ist das #ansage. Ist aber ein Dialog offen, sperrt der
 * Browser alles außerhalb des Dialogs für Screenreader - auch #ansage.
 * Dann schreibt sage() in die Region IM offenen Dialog (.dialog__ansage).
 *
 * Ein Screenreader liest die Region nur vor, wenn sich ihr Inhalt AENDERT.
 * Zweimal hintereinander "Du bist dran" wäre aber keine Änderung. Deshalb
 * wird die Region erst geleert und der Text einen Moment später eingesetzt.
 *
 * Kommt eine neue Ansage, bevor die alte eingesetzt wurde, gewinnt die neue.
 * Das ist gewollt: Beim Siegtipp folgt das Spielende unmittelbar auf den Zug,
 * und dann zählt nur noch das Ergebnis.
 *
 * @param {string} text  Kurze ganze Sätze, ohne Sonderzeichen wie ✓
 */
function sage(text) {
  clearTimeout(ansageTimer);
  const region = document.querySelector('dialog[open] .dialog__ansage') ?? ansage;
  region.textContent = '';
  ansageTimer = setTimeout(() => {
    region.textContent = text;
  }, 100);
}

const lobby = erstelleLobby({
  sende: (ereignis, daten) => socket.emit(ereignis, daten),
  sage,
});

// Die Uhr zeigt nur an - gemessen wird auf dem Server (server/zugzeit.js).
const zuguhr = erstelleZuguhr({ sage });
zuguhr.fuegeAnzeigeHinzu(document.querySelector('#zuguhr'));
// Im Duell steht die Uhr des Gegners zusätzlich in seinem Brett.
zuguhr.fuegeAnzeigeHinzu(document.querySelector('#gegner-zuguhr'), { nurWennGegnerDran: true });

/** Startet die Anzeige mit der Restzeit, die der Server geschickt hat. */
function starteUhr(restzeitMs) {
  zuguhr.starte({
    restzeitMs,
    zugzeit: zustand.zugzeit,
    binDran: zustand.binAmZug,
    gegnerName: zustand.gegnerName,
  });
}

/**
 * Duell: dieselbe Uhr für die Wahlfrist. Solange ich noch nicht gewählt
 * habe, ist es "Deine Zeit", danach die Zeit des Gegners.
 */
function starteWahluhr(restzeitMs) {
  zuguhr.starte({
    restzeitMs,
    zugzeit: zustand.wahlzeit,
    binDran: !zustand.meineWahl,
    gegnerName: zustand.gegnerName,
  });
}

/** "Du bist dran." oder "Ben ist dran." */
function werIstDran(binAmZug) {
  return binAmZug ? 'Du bist dran.' : `${zustand.gegnerName} ist dran.`;
}

// --- Darstellung ----------------------------------------------------------

/** Zeigt den Startdialog mit Namensfeld. */
function zeigeStart() {
  spielbereich.hidden = true;
  // showModal() statt show(): Nur so legt der Browser den Dialog über die
  // Seite, dunkelt sie ab und sperrt alles dahinter.
  if (!anmeldeDialog.open) anmeldeDialog.showModal();
  feldName.focus();
}

/** Blendet Lobby und Dialoge aus und das Spielfeld ein. */
function zeigeSpiel() {
  lobby.verberge();
  spielbereich.hidden = false;
}

/** Die kleine Notiz in der Spielermarke: "ist dran", "wartet", "wählt" ... */
function notizFuer(dran, hatGewaehlt, ich) {
  if (!zustand.laeuft) return '';
  // Der eigene Eintrag heißt "Du" - dazu gehört die Du-Form: "Du bist dran".
  if (zustand.phase === 'wahl') {
    if (hatGewaehlt) return ich ? 'hast gewählt' : 'hat gewählt';
    return ich ? 'wählst' : 'wählt';
  }
  if (dran) return ich ? 'bist dran' : 'ist dran';
  return ich ? 'wartest' : 'wartet';
}

/** Zeichnet die beiden Spielermarken neu. */
function zeichneSpieler() {
  spielerLeiste.replaceChildren();

  // Während der Duell-Wahl ist niemand "dran" - beide wählen gleichzeitig.
  const raten = zustand.phase === 'raten';
  const eintraege = [
    {
      name: 'Du',
      ich: true,
      dran: raten && zustand.binAmZug,
      gewaehlt: Boolean(zustand.meineWahl),
      klasse: 'spielermarke--ich-dran',
    },
    {
      name: zustand.gegnerName,
      ich: false,
      dran: raten && !zustand.binAmZug,
      gewaehlt: zustand.gegnerHatGewaehlt,
      klasse: 'spielermarke--gegner-dran',
    },
  ];

  for (const eintrag of eintraege) {
    const marke = document.createElement('span');
    marke.className = 'spielermarke' + (zustand.laeuft && eintrag.dran ? ` ${eintrag.klasse}` : '');
    // Der Name in einem eigenen Element: Nur er wird bei Überlänge gekürzt,
    // die Notiz ("ist dran") bleibt immer ganz lesbar.
    const name = document.createElement('span');
    name.className = 'spielermarke__name';
    name.textContent = eintrag.name;
    name.title = eintrag.name; // ganz lesbar beim Zeigen mit der Maus

    const notiz = document.createElement('span');
    notiz.className = 'spielermarke__notiz';
    notiz.textContent = notizFuer(eintrag.dran, eintrag.gewaehlt, eintrag.ich);
    marke.append(name, notiz);

    spielerLeiste.append(marke);
  }
}

/**
 * Die Infozeile im Duell: wer gerade wählt und wer worauf rät.
 * Beim Zufallstier bleibt sie verborgen.
 */
function zeichneDuellInfo() {
  // In der Ratephase sagen die Untertitel der Bretter dasselbe.
  duellInfo.hidden = zustand.modus !== 'duell' || zustand.phase === 'raten';
  // In JEDER laufenden Partie: Ohne Zeitlimit könnte der Gegner sonst ewig
  // nicht raten, und man käme nur durch Schließen des Tabs heraus.
  verlassenKnopf.hidden = !zustand.laeuft;
  const gegner = zustand.gegnerName;

  if (zustand.phase === 'wahl' && !zustand.meineWahl) {
    duellInfo.textContent = `Duell: Wähle ein Tier, das ${gegner} erraten muss.`;
  } else if (zustand.phase === 'wahl') {
    duellInfo.textContent = `Du hast ${zustand.meineWahl} für ${gegner} gewählt. ${gegner} wählt noch …`;
  } else {
    duellInfo.textContent = `Duell: Du rätst das Tier, das ${gegner} für dich gewählt hat. ${gegner} rät ${zustand.meineWahl}.`;
  }
}

/**
 * Sperrt oder entsperrt das Eingabefeld.
 *
 * Bewusst readonly + aria-disabled statt "disabled": Ein mit "disabled"
 * gesperrtes Feld verliert den Fokus - nach dem eigenen Tipp läge er auf der
 * ganzen Seite, und ein Tab spränge an den Anfang (WCAG 2.4.3). So bleibt er
 * im Feld, der Screenreader sagt "abgeblendet", und tippen geht trotzdem nicht.
 * Ob jemand wirklich dran ist, prüft ohnehin der Server.
 */
function sperreTippfeld(gesperrt) {
  feldTipp.readOnly = gesperrt;
  feldTipp.setAttribute('aria-disabled', String(gesperrt));
  if (gesperrt) {
    vorschlaege.schliessen();
    return;
  }
  // Nur ins Feld springen, wenn der Fokus gerade nirgends steht - wer
  // währenddessen z. B. mit dem Screenreader die Tabelle liest, wird nicht
  // herausgerissen. Die Ansage "Du bist dran" kommt so oder so.
  const fokus = document.activeElement;
  if (!fokus || fokus === document.body || fokus === feldTipp) feldTipp.focus();
}

/** Duell: Das Eingabefeld dient jetzt zum Wählen - bis man gewählt hat. */
function setzeWahl() {
  const text = `Tier für ${zustand.gegnerName} wählen`;
  feldTipp.placeholder = `${text} …`;
  feldTippLabel.textContent = text;
  sperreTippfeld(Boolean(zustand.meineWahl));
  zeichneSpieler();
  zeichneDuellInfo();
}

/** Sperrt oder entsperrt die Eingabe, je nachdem wer am Zug ist. */
function setzeZugrecht(binAmZug) {
  // Im Duell sagt der Platzhalter, wer gerade dran ist ("Lena ist dran ...").
  const istDuell = zustand.modus === 'duell';
  feldTipp.placeholder =
    istDuell && !binAmZug && zustand.laeuft
      ? `${zustand.gegnerName} ist dran …`
      : `${RATEN_TEXT} …`;
  feldTippLabel.textContent = RATEN_TEXT;
  const wirdDran = binAmZug && !zustand.binAmZug;
  // Ein neuer Zug beginnt: Das erste "tippt" darf sofort raus - die Bremse
  // soll nur innerhalb eines Zuges drosseln, nicht vom vorigen Zug nachwirken.
  if (wirdDran) zuletztGetipptGesendet = 0;
  zustand.binAmZug = binAmZug;
  sperreTippfeld(!binAmZug || !zustand.laeuft);
  zeichneSpieler();
  // Nur beim Wechsel zu einem selbst stupst die eigene Marke an. Die Marken
  // sind gerade neu gebaut - die Animation startet also sicher von vorn.
  if (wirdDran)
    spielerLeiste.querySelector('.spielermarke--ich-dran')?.classList.add('spielermarke--stups');
}

/**
 * Setzt die beiden Knöpfe der Endkarte.
 *
 * Alle Zustände laufen durch diese eine Funktion. Sonst müsste man an
 * jeder der sechs Stellen selbst daran denken, Beschriftung, Sperre UND
 * Hervorhebung wieder zurückzunehmen - und genau das vergisst man.
 *
 * Ohne Angabe stehen beide Knöpfe im Ausgangszustand.
 */
function setzeEndknoepfe({ revancheText = 'Revanche', revancheAktiv = true, ruft = false } = {}) {
  revancheKnopf.textContent = revancheText;
  revancheKnopf.disabled = !revancheAktiv;
  revancheKnopf.classList.toggle('knopf--ruft', ruft);
}

/** Der Spieler hat selbst eine Revanche angeboten und wartet nun. */
function zeigeWarteAufRevanche() {
  setzeEndknoepfe({ revancheText: 'Warte auf deinen Gegner …', revancheAktiv: false });
}

/**
 * Zeigt die Endkarte und beendet die Partie in der Anzeige.
 * @param {object} ende
 * @param {boolean | null} ende.gewonnen  true/false färbt die Karte als Sieg
 *   oder Niederlage, null lässt sie neutral - bei einem Abbruch hat niemand
 *   gewonnen oder verloren.
 */
function zeigeEnde({ titel, text, gewonnen, revancheMoeglich = true }) {
  zustand.laeuft = false;
  zuguhr.stoppe();
  setzeZugrecht(false);
  verlassenKnopf.hidden = true;
  endeTitel.textContent = titel;
  endeText.textContent = text;
  endeKarte.classList.toggle('ende--sieg', gewonnen === true);
  endeKarte.classList.toggle('ende--nieder', gewonnen === false);
  endeKarte.hidden = false;
  if (gewonnen === true) feiereSieg();
  spielMeldung.textContent = '';
  // Das Eingabefeld ist jetzt gesperrt und hat den Fokus verloren. Er geht
  // auf die Überschrift der Endkarte: Tastaturnutzer stehen damit direkt vor
  // "Revanche" und "Zur Lobby", Screenreader lesen das Ergebnis vor.
  endeTitel.focus();

  // Ist der Gegner nachweislich weg, hat eine Revanche von vornherein
  // keinen Adressaten - der Knopf sagt das lieber selbst, statt in eine
  // Fehlermeldung zu laufen.
  if (revancheMoeglich) {
    setzeEndknoepfe();
  } else {
    setzeEndknoepfe({ revancheText: 'Gegner ist weg', revancheAktiv: false });
  }
}

const KONFETTI_SCHNIPSEL = 14;
const KONFETTI_DAUER_MS = 3000; // längste Verzögerung + Fallzeit, mit Luft

/**
 * Konfetti auf der Sieg-Karte: Die Schnipsel fallen einmal herab, danach
 * ist der Behälter wieder weg. Reine Dekoration - für Screenreader
 * unsichtbar (aria-hidden), der Sieg steht ohnehin im Text der Karte.
 */
function feiereSieg() {
  // Wie beim Herzschlag: Bei "Bewegung reduzieren" gar nicht erst bauen.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  endeKarte.querySelector('.konfetti')?.remove();

  const konfetti = document.createElement('div');
  konfetti.className = 'konfetti';
  konfetti.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < KONFETTI_SCHNIPSEL; i++) {
    const schnipsel = document.createElement('span');
    schnipsel.className = 'konfetti__schnipsel';
    // Nur Ort, Start und Drehung sind zufällig - als CSS-Variablen, die
    // Farben und der Ablauf stehen im CSS. (Werte über style.setProperty
    // erlaubt die Content-Security-Policy, ein style-Attribut nicht.)
    schnipsel.style.setProperty('--links', `${Math.round(Math.random() * 100)}%`);
    schnipsel.style.setProperty('--start', `${(Math.random() * 0.6).toFixed(2)}s`);
    schnipsel.style.setProperty('--drehung', `${Math.round(Math.random() * 720 - 360)}deg`);
    konfetti.append(schnipsel);
  }
  endeKarte.append(konfetti);
  setTimeout(() => konfetti.remove(), KONFETTI_DAUER_MS);
}

// --- Duell: zwei Bretter und Live-Druck -------------------------------------

/** "Lenas", aber "Hans'" - der Genitiv für "… Brett" und "… Tier". */
function genitiv(name) {
  return /[sßxz]$/i.test(name) ? `${name}’` : `${name}s`;
}

/**
 * Hängt die große Tabelle um: Im Duell steht sie in "Dein Brett" (mit
 * nur den eigenen Tipps), sonst an ihrem gewohnten Platz. So gibt es nur EINE
 * Tabelle und nur EINEN Code, der sie füllt.
 */
function zeigeBretter(an) {
  (an ? brettTabelle : tabelleHuelle).append(tippTabelle);
  tabelleHuelle.hidden = an;
  gegnerBrett.hidden = !an;
  eigenesBrett.hidden = !an;
  tabellenTitel.textContent = an ? 'Deine Tipps, neuester zuerst' : TABELLEN_TITEL_ZUFALL;
}

/** Alles, was ein Duell hinterlässt, auf Anfang - vor jeder neuen Partie. */
function setzeDuellZurueck() {
  zustand.meineTipps = [];
  zustand.gegnerTipps = [];
  zustand.meinZiel = '';
  gegnerSpuren.replaceChildren();
  gegnerMeilenstein.hidden = true;
  gegnerBrett.classList.remove('brett--heiss', 'brett--gleich', 'brett--puls');
  verbergeTippen();
  endstand.hidden = true;
  endstand.querySelectorAll('.endstand__seite').forEach((seite) => seite.remove());
  zeigeBretter(false);
}

/** Zeichnet Titel, Untertitel, Fortschritt und Stufe beider Bretter neu. */
function zeichneBretter() {
  const gegner = zustand.gegnerName;
  const gegnerGeknackt = geknackt(zustand.gegnerTipps);
  const meinGeknackt = geknackt(zustand.meineTipps);
  const stufe = gefahrenstufe(gegnerGeknackt.size);

  gegnerTitel.textContent = `${genitiv(gegner)} Brett`;
  gegnerSpuren.setAttribute('aria-label', `${genitiv(gegner)} Tipps, neuester zuerst`);
  // Während der Partie im Präsens, am Ende in der Vergangenheit.
  gegnerUnter.textContent = zustand.laeuft
    ? `${gegner} sucht dein Tier: ${zustand.meineWahl}.`
    : `${gegner} suchte dein Tier: ${zustand.meineWahl}.`;
  eigenesUnter.textContent =
    zustand.laeuft || !zustand.meinZiel
      ? `Du suchst ${genitiv(gegner)} Tier.`
      : `Du suchtest ${genitiv(gegner)} Tier: ${zustand.meinZiel}.`;

  zeichneFelder(gegnerFelder, gegnerGeknackt, gegner);
  zeichneFelder(eigeneFelder, meinGeknackt, 'dir');
  gegnerAnzahl.textContent = `${gegnerGeknackt.size} von 7 geknackt`;
  eigeneAnzahl.textContent = `${meinGeknackt.size} von 7 geknackt`;

  // Die Stufe steht nur auf dem Brett des Gegners - der Druck kommt von ihm.
  setzeStufe(gegnerStufe, stufe);
  gegnerBrett.classList.toggle('brett--heiss', stufe === 'heiss');
  gegnerBrett.classList.toggle('brett--gleich', stufe === 'gleich');
}

/**
 * Herzschlag: drei Schläge, dann Ruhe (WCAG 2.2.2 erlaubt keine
 * Dauerbewegung über fünf Sekunden). Die Klasse wird zuerst entfernt und
 * nach einem Moment neu gesetzt, damit die Animation auch dann von vorn
 * beginnt, wenn der letzte Herzschlag noch läuft.
 */
function herzschlag() {
  // Wer "Bewegung reduzieren" eingestellt hat, bekäme ohnehin keine
  // Animation - und ohne Animation käme auch nie "animationend", die Klasse
  // bliebe einfach hängen. Rahmen und Stufen-Wort zeigen die Gefahr trotzdem.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  gegnerBrett.classList.remove('brett--puls');
  void gegnerBrett.offsetWidth; // zwingt den Browser, das Entfernen zu bemerken
  gegnerBrett.classList.add('brett--puls');
}

// Nach den drei Schlägen ist die Klasse überflüssig. (Andere Animationen
// im Brett - etwa neue Spurkarten - melden ihr Ende hier ebenfalls.)
gegnerBrett.addEventListener('animationend', (ereignis) => {
  if (ereignis.animationName === 'herzschlag') gegnerBrett.classList.remove('brett--puls');
});

/**
 * Verarbeitet einen Zug im Duell: eigener Tipp in die Tabelle, Tipp des
 * Gegners als Spurkarte. Liefert den Meilenstein-Satz (oder null) für die
 * Ansage.
 */
function zugImDuell(zug) {
  if (zug.vonMir) {
    zustand.meineTipps.push(zug);
    fuegeTippHinzu(zug, { beschriftung: `Tipp ${zustand.meineTipps.length}` });
    zeichneBretter();
    return null;
  }

  const vorher = geknackt(zustand.gegnerTipps);
  zustand.gegnerTipps.push(zug);
  const nachher = geknackt(zustand.gegnerTipps);
  fuegeSpurHinzu(gegnerSpuren, zug, zustand.gegnerTipps.length);
  verbergeTippen();

  // Ein Meilenstein ersetzt den vorigen; ohne Neues bleibt der alte stehen.
  const satz = meilenstein(vorher, nachher, zustand.gegnerName);
  if (satz) {
    gegnerMeilenstein.querySelector('.meilenstein__text').textContent = satz;
    gegnerMeilenstein.hidden = false;
  }

  zeichneBretter();
  if (['heiss', 'gleich'].includes(gefahrenstufe(nachher.size))) herzschlag();
  return satz;
}

// --- "Lena tippt ..." ----------------------------------------------------

const TIPPT_SENDEN_ABSTAND_MS = 1500; // höchstens so oft senden
const TIPPT_ANZEIGE_MS = 3000; // so lange ohne neues Signal sichtbar

let zuletztGetipptGesendet = 0;
let tipptTimer;

// Wer im Duell am Zug ist und tippt, sendet ein Signal - nie die Buchstaben.
feldTipp.addEventListener('input', () => {
  if (zustand.modus !== 'duell' || zustand.phase !== 'raten' || !zustand.binAmZug) return;
  const jetzt = Date.now();
  if (jetzt - zuletztGetipptGesendet < TIPPT_SENDEN_ABSTAND_MS) return;
  zuletztGetipptGesendet = jetzt;
  socket.emit('tippt');
});

function verbergeTippen() {
  clearTimeout(tipptTimer);
  gegnerTippt.hidden = true;
}

// Bewusst ohne sage(): Das Signal kommt über eine Sekunde hinweg immer
// wieder - vorgelesen wäre es nur Lärm.
socket.on('gegnerTippt', () => {
  if (zustand.modus !== 'duell' || !zustand.laeuft) return;
  gegnerTippt.querySelector('.tippt__text').textContent = `${zustand.gegnerName} tippt`;
  // Kurz aus- und wieder einblenden startet die Punkte neu: Sie pulsieren
  // nur viermal (duell.css), jedes neue Signal ist eine neue kurze Bewegung.
  gegnerTippt.hidden = true;
  void gegnerTippt.offsetWidth; // zwingt den Browser, das Ausblenden zu bemerken
  gegnerTippt.hidden = false;
  clearTimeout(tipptTimer);
  tipptTimer = setTimeout(verbergeTippen, TIPPT_ANZEIGE_MS);
});

/**
 * Das große Finale im Duell: Endkarte mit Duell-Text, Endstand (beide
 * Tiere aufgedeckt) und Fazit. Beide Tiere kennt der Browser jetzt: das
 * eigene Ziel kommt mit spielEnde, das des Gegners hat man selbst gewählt.
 */
function duellEnde({ duHastGewonnen, gewinnerName, geheimnis, anzahlTipps }) {
  const gegner = zustand.gegnerName;
  zustand.meinZiel = geheimnis?.name ?? '';
  const meinGeknackt = geknackt(zustand.meineTipps);
  const gegnerGeknackt = geknackt(zustand.gegnerTipps);
  const verliererGeknackt = duHastGewonnen ? gegnerGeknackt : meinGeknackt;
  const verliererStufe = gefahrenstufe(verliererGeknackt.size);
  const tippWort = anzahlTipps === 1 ? 'Tipp' : 'Tipps';
  // "fehlten noch 2 Eigenschaften" / "fehlte noch 1 Eigenschaft" / "fehlte keine mehr"
  const fehlen = 7 - verliererGeknackt.size;
  const fehlenText =
    fehlen === 0
      ? 'fehlte keine Eigenschaft mehr'
      : fehlen === 1
        ? 'fehlte noch 1 Eigenschaft'
        : `fehlten noch ${fehlen} Eigenschaften`;

  zeigeEnde({
    titel: duHastGewonnen ? `Du gewinnst — ${zustand.meinZiel}!` : `${gewinnerName} gewinnt.`,
    text: duHastGewonnen
      ? `Du hast ${genitiv(gegner)} Tier in ${anzahlTipps} ${tippWort} erraten. ${gegner} ${fehlenText}.`
      : `${gegner} hat dein Tier in ${anzahlTipps} ${tippWort} erraten. Dir ${fehlenText}.`,
    gewonnen: duHastGewonnen,
  });

  // Endstand: zwei Seiten, die Gewinnerseite hervorgehoben.
  const seiten = [
    baueEndstandSeite({
      wer: 'Du',
      sieger: duHastGewonnen,
      verb: 'suchtest',
      tier: zustand.meinZiel,
      tipps: zustand.meineTipps.length,
      geknackt: meinGeknackt.size,
      stufe: gefahrenstufe(meinGeknackt.size),
    }),
    baueEndstandSeite({
      wer: gegner,
      sieger: !duHastGewonnen,
      verb: 'suchte',
      tier: zustand.meineWahl,
      tipps: zustand.gegnerTipps.length,
      geknackt: gegnerGeknackt.size,
      stufe: gefahrenstufe(gegnerGeknackt.size),
    }),
  ];
  endstand.querySelectorAll('.endstand__seite').forEach((seite) => seite.remove());
  endstandFazit.before(...seiten);

  // Fazit: knapp oder klar?
  const knapp = ['heiss', 'gleich'].includes(verliererStufe);
  const wer = duHastGewonnen ? `${gegner} war` : 'Du warst';
  const offen = aufzaehlung(fehlende(verliererGeknackt));
  const stufenWort = document.createElement('strong');
  stufenWort.textContent = STUFENTEXT[verliererStufe];
  if (knapp) {
    const rest = offen
      ? ` – es fehlten nur noch ${offen}.`
      : ' – alle sieben Eigenschaften waren schon geknackt.';
    endstandFazit.replaceChildren(`Knapp! ${wer} schon `, stufenWort, rest);
  } else {
    endstandFazit.replaceChildren(
      duHastGewonnen
        ? `Klarer Sieg – ${gegner} hatte erst ${verliererGeknackt.size} von 7.`
        : `Klarer Sieg für ${gegner} – du hattest erst ${verliererGeknackt.size} von 7.`,
    );
  }
  endstand.hidden = false;
  feldTipp.placeholder = 'Partie beendet';

  verbergeTippen();
  zeichneBretter(); // Untertitel jetzt in der Vergangenheit

  sage(
    `${duHastGewonnen ? 'Du gewinnst.' : `${gewinnerName} gewinnt.`} ` +
      `Du suchtest ${zustand.meinZiel}, ${gegner} suchte ${zustand.meineWahl}. ${endstandFazit.textContent}`,
  );
}

// --- Vom Browser zum Server ----------------------------------------------

// Anmelden ist Pflicht - ohne Namen gibt es keine Lobby. Esc schließt den
// Dialog deshalb nicht (Einzelheiten bei haltOffen in lobby.js). Nach einem
// Verbindungsabbruch bleibt er ebenfalls offen und zeigt die Meldung.
haltOffen(anmeldeDialog, () => !zustand.angemeldet || zustand.verbindungWeg);

anmeldeFormular.addEventListener('submit', (ereignis) => {
  ereignis.preventDefault();

  const name = feldName.value.trim();
  if (name.length === 0) {
    dialogMeldung.textContent = 'Bitte gib einen Namen ein.';
    // Nicht nur die Meldung: Auch das Feld selbst sagt "ungültig" und
    // nennt beim Vorlesen den Grund (gleiches Muster wie die Passwortfelder).
    setzeFeldfehler(feldName, dialogMeldung, true);
    feldName.focus();
    return;
  }
  dialogMeldung.textContent = '';
  setzeFeldfehler(feldName, dialogMeldung, false);
  socket.emit('anmelden', name);
});

/**
 * Dieselbe Endkarte erscheint auch bei Verbindungsverlust. Dann ist der
 * Socket tot: Ein emit verschwindet spurlos, der Spieler klickt ins Leere
 * und wartet auf eine Antwort, die nie kommt. Neuladen ist hier die einzige
 * ehrliche Reaktion - der Server kennt uns danach ohnehin nicht mehr.
 *
 * @returns {boolean} true, wenn die Seite gerade neu geladen wird
 */
function neuLadenStattSenden() {
  if (!zustand.verbindungWeg) return false;
  window.location.reload();
  return true;
}

// Mitten in einer Partie fragt der Browser nach, bevor der Tab zugeht oder man
// zurückgeht: Sonst wäre die Partie für beide sofort vorbei. Den Text der
// Rückfrage bestimmt der Browser selbst, eigene Texte zeigt er nicht mehr an.
window.addEventListener('beforeunload', (ereignis) => {
  if (zustand.laeuft) ereignis.preventDefault();
});

revancheKnopf.addEventListener('click', () => {
  if (neuLadenStattSenden()) return;

  socket.emit('revanche');
  // Sofort sperren: Der Server antwortet zwar gleich, aber bis dahin soll
  // niemand den Knopf noch dreimal drücken.
  zeigeWarteAufRevanche();
});

// Der Server beendet die Partie und antwortet mit "lobbyBetreten".
verlassenKnopf.addEventListener('click', () => {
  if (neuLadenStattSenden()) return;
  socket.emit('aufgeben');
});

zurLobbyKnopf.addEventListener('click', () => {
  if (neuLadenStattSenden()) return;

  // Die Revanche ist damit vom Tisch - der Server vergisst sie ebenfalls.
  // Er antwortet mit "lobbyBetreten", und erst dann wird umgeschaltet.
  socket.emit('zurLobby');
});

regelnKnopf.addEventListener('click', () => {
  const jetztOffen = regeln.hidden;
  regeln.hidden = !jetztOffen;
  regelnKnopf.setAttribute('aria-expanded', String(jetztOffen));
});

// --- Vom Server zum Browser ----------------------------------------------

// --- Lobby ----------------------------------------------------------------

/**
 * Der Spieler steht (wieder) in der Lobby: nach der Anmeldung, nach "Zur
 * Lobby", nach dem Verlassen der Warteschlange oder der eigenen Lobby.
 */
socket.on('lobbyBetreten', ({ name } = {}) => {
  zustand.angemeldet = true;
  zustand.laeuft = false;
  zuguhr.stoppe();
  setzeDuellZurueck();
  spielbereich.hidden = true;
  if (anmeldeDialog.open) anmeldeDialog.close();
  lobby.zeige(String(name ?? ''));
});

socket.on('lobbyListe', (liste) => {
  if (Array.isArray(liste)) lobby.setzeListe(liste);
});

socket.on('warten', ({ modus, zugzeit } = {}) => lobby.zeigeWarteschlange(modus, zugzeit));
socket.on('lobbyErstellt', ({ modus, zugzeit } = {}) => lobby.zeigeEigeneLobby(modus, zugzeit));
socket.on('erstellenAbgelehnt', ({ grund } = {}) => lobby.erstellenAbgelehnt(grund));
socket.on('beitrittAbgelehnt', ({ grund } = {}) => lobby.beitrittAbgelehnt(grund));

// Der Server hat die eigene Lobby nach 10 Minuten ohne Gast geschlossen. Er
// schickt vorher "lobbyBetreten" - die Meldung kommt danach, damit sie bleibt.
socket.on('lobbyAbgelaufen', () => {
  const text = 'Deine Lobby wurde nach 10 Minuten geschlossen, weil niemand beigetreten ist.';
  lobby.zeigeMeldung(text);
  sage(text);
});

// --- Partie ---------------------------------------------------------------

socket.on(
  'spielStart',
  ({ gegnerName, duBistDran, kategorien, modus, zugzeit, wahlzeit, restzeitMs }) => {
    // Wer in seiner eigenen Lobby gewartet hat, hört, wer beigetreten ist.
    const ausEigenerLobby = lobby.wartetInEigenerLobby;

    zustand.gegnerName = gegnerName;
    zustand.laeuft = true;
    zustand.modus = modus === 'duell' ? 'duell' : 'zufall';
    zustand.phase = zustand.modus === 'duell' ? 'wahl' : 'raten';
    zustand.meineWahl = '';
    zustand.gegnerHatGewaehlt = false;
    zustand.zugzeit = Number(zugzeit) || 0;
    zustand.wahlzeit = Number(wahlzeit) || 0;

    setzeDuellZurueck(); // auch nach einer Revanche: alles auf Anfang
    setzeKategorien(kategorien);
    leereTabelle();
    vorschlaege.zuruecksetzen();

    endeKarte.hidden = true;
    setzeEndknoepfe(); // für das nächste Spielende wieder frisch
    spielMeldung.textContent = '';
    feldTipp.value = '';

    zeigeSpiel();
    zeichneDuellInfo();

    const beginn = ausEigenerLobby
      ? `${gegnerName} ist beigetreten. Die Partie beginnt.`
      : `Neue Partie gegen ${gegnerName}.`;

    if (zustand.phase === 'wahl') {
      setzeWahl();
      starteWahluhr(restzeitMs); // ohne Zeitlimit kommt null - dann keine Uhr
      sage(`${beginn} Duell: Wähle ein Tier, das ${gegnerName} erraten muss.`);
      return;
    }
    setzeZugrecht(duBistDran);
    starteUhr(restzeitMs);
    sage(`${beginn} ${werIstDran(duBistDran)}`);
  },
);

// --- Duell: die Wahl -------------------------------------------------------

socket.on('tierGewaehlt', ({ tierName, restzeitMs } = {}) => {
  zustand.meineWahl = String(tierName ?? '');
  feldTipp.value = '';
  setzeWahl();
  starteWahluhr(restzeitMs);
  sage(`Du hast ${zustand.meineWahl} gewählt. ${zustand.gegnerName} wählt noch.`);
});

socket.on('gegnerHatGewaehlt', () => {
  zustand.gegnerHatGewaehlt = true;
  zeichneSpieler();
  // Hat man selbst noch nicht gewählt, ist das ein Hinweis zum Beeilen.
  if (!zustand.meineWahl) sage(`${zustand.gegnerName} hat schon gewählt.`);
});

socket.on('duellStart', ({ duBistDran, restzeitMs } = {}) => {
  zustand.phase = 'raten';
  zeichneDuellInfo();
  zeigeBretter(true);
  zeichneBretter();
  setzeZugrecht(Boolean(duBistDran));
  starteUhr(restzeitMs);
  sage(`Beide haben gewählt. Das Duell beginnt. ${werIstDran(Boolean(duBistDran))}`);
});

socket.on('zug', (zug) => {
  // Im Duell: eigener Tipp in "Dein Brett", Tipp des Gegners als Spurkarte.
  const neuerMeilenstein = zustand.modus === 'duell' ? zugImDuell(zug) : null;
  if (zustand.modus !== 'duell') fuegeTippHinzu(zug);
  // Im Duell sucht jeder ein anderes Tier: Was der Gegner geraten hat,
  // kann genau meins sein - deshalb nur eigene Tipps aus der Liste nehmen.
  if (zustand.modus !== 'duell' || zug.vonMir) vorschlaege.verbrauche(zug.tierName);
  feldTipp.value = '';

  if (zug.richtig) {
    zuguhr.stoppe();
  } else {
    setzeZugrecht(zug.duBistDran);
    starteUhr(zug.restzeitMs);
  }

  // Ein Satz pro Hinweis, danach der Zugwechsel. Beim Siegtipp entfällt
  // der Zugwechsel - die Ansage zum Spielende folgt sofort.
  const wer = zug.vonMir ? 'Du hast' : `${zug.raterName} hat`;
  const saetze = [`${wer} ${zug.tierName} geraten.`, ...zug.hinweise.map(hinweisAlsSatz)];
  // Der Meilenstein hängt an derselben Ansage - keine zweite Live-Region.
  if (neuerMeilenstein) saetze.push(`Neu: ${neuerMeilenstein}`);
  if (!zug.richtig) saetze.push(werIstDran(zug.duBistDran));
  sage(saetze.join(' '));
});

// --- Zugzeit ---------------------------------------------------------------

/**
 * Die Zeit des Spielers am Zug ist abgelaufen - entschieden hat das der
 * Server. Der Zug geht ohne Tipp an den anderen.
 */
socket.on('zeitAbgelaufen', ({ duBistDran, restzeitMs } = {}) => {
  if (!zustand.laeuft) return;
  setzeZugrecht(Boolean(duBistDran));
  starteUhr(restzeitMs);
  // Beide erfahren den Zugwechsel, wie bei jedem anderen Zug auch.
  sage(
    duBistDran
      ? `Die Zeit von ${zustand.gegnerName} ist abgelaufen. Du bist dran.`
      : `Deine Zeit ist abgelaufen. ${zustand.gegnerName} ist dran.`,
  );
});

socket.on('spielEnde', ({ gewinnerName, duHastGewonnen, geheimnis, anzahlTipps }) => {
  if (zustand.modus === 'duell') {
    duellEnde({ gewinnerName, duHastGewonnen, geheimnis, anzahlTipps });
    return;
  }
  const tippWort = anzahlTipps === 1 ? 'Tipp' : 'Tipps';
  zeigeEnde({
    titel: duHastGewonnen ? `Du gewinnst — ${geheimnis.name}!` : `${gewinnerName} gewinnt.`,
    text: duHastGewonnen
      ? `Erraten in ${anzahlTipps} ${tippWort}.`
      : `Gesucht war: ${geheimnis.name}.`,
    gewonnen: duHastGewonnen,
  });
  sage(
    duHastGewonnen
      ? `Du gewinnst. Gesucht war ${geheimnis.name}. Erraten in ${anzahlTipps} ${tippWort}.`
      : `${gewinnerName} gewinnt. Gesucht war ${geheimnis.name}.`,
  );
});

/**
 * Duell: Die Wahlfrist ist um. Wer gewählt hat, gewinnt - hat keiner
 * gewählt, endet die Partie ohne Sieger (duHastGewonnen ist dann null).
 */
socket.on('wahlAbgelaufen', ({ duHastGewonnen = null } = {}) => {
  let text = 'Keiner von euch hat ein Tier gewählt.';
  if (duHastGewonnen === true) text = `${zustand.gegnerName} hat kein Tier gewählt. Du gewinnst.`;
  if (duHastGewonnen === false) text = 'Du hast kein Tier gewählt. Die Partie ist verloren.';
  zeigeEnde({
    titel: 'Die Zeit zum Wählen ist abgelaufen',
    text,
    gewonnen: duHastGewonnen,
  });
  sage(`Die Zeit zum Wählen ist abgelaufen. ${text}`);
});

// --- Revanche -------------------------------------------------------------

socket.on('revancheWartet', zeigeWarteAufRevanche);

socket.on('revancheAngeboten', () => {
  // Der Gegner hat schon zugestimmt - das muss man sehen, sonst klickt
  // niemand und beide warten auf den jeweils anderen.
  setzeEndknoepfe({ revancheText: 'Revanche — dein Gegner ist bereit', ruft: true });
  sage(`${zustand.gegnerName} möchte eine Revanche.`);
});

socket.on('revancheGeplatzt', (grund) => {
  // Der Grund kommt vom Server und ist kurz genug für den Knopf selbst.
  setzeEndknoepfe({
    revancheText: String(grund ?? 'Revanche nicht möglich'),
    revancheAktiv: false,
  });
  spielMeldung.textContent =
    'Aus der Revanche wird nichts. Such dir in der Lobby einen neuen Gegner.';
});

socket.on('gegnerWeg', ({ geheimnis, aufgegeben } = {}) => {
  verbergeTippen();
  // "aufgegeben": Der Gegner hat "Partie verlassen" geklickt.
  const grund = aufgegeben
    ? 'Dein Gegner hat die Partie verlassen.'
    : 'Dein Gegner hat die Verbindung verloren.';
  zeigeEnde({
    titel: 'Partie abgebrochen',
    text: geheimnis ? `${grund} Gesucht war: ${geheimnis.name}.` : grund,
    gewonnen: null,
    revancheMoeglich: false,
  });
  sage(geheimnis ? `${grund} Gesucht war ${geheimnis.name}.` : grund);
});

socket.on('fehler', (nachricht) => {
  // Je nach Ansicht gehört die Meldung an eine andere Stelle.
  if (anmeldeDialog.open) {
    // Solange der Anmeldedialog offen ist, kann der Server nur den Namen
    // abgelehnt haben.
    dialogMeldung.textContent = nachricht;
    setzeFeldfehler(feldName, dialogMeldung, true);
  } else if (spielbereich.hidden) {
    lobby.zeigeMeldung(String(nachricht));
  } else {
    spielMeldung.textContent = nachricht;
  }
});

socket.on('disconnect', () => {
  // Der Spieler kann in ganz verschiedenen Ansichten stecken, und die
  // Meldung muss dorthin, wo er gerade hinschaut.
  //
  // Die Endkarte liegt IM Spielbereich. Ist der ausgeblendet - also
  // während Anmeldung, Lobby und Warten -, bliebe sie unsichtbar: Der
  // Wartende würde weiter "Warte auf ..." lesen und auf etwas warten, das
  // nie kommt, weil der Server gar nicht mehr da ist. Dann zeigt der
  // Anmeldedialog die Meldung.
  // Ab jetzt läuft jedes emit ins Leere - die Knöpfe laden stattdessen neu.
  zustand.verbindungWeg = true;

  if (!spielbereich.hidden) {
    zeigeEnde({
      titel: 'Verbindung verloren',
      text: 'Die Verbindung zum Server ist abgebrochen. Beide Knöpfe laden die Seite neu.',
      gewonnen: null,
    });
    return;
  }

  lobby.verberge();
  dialogTitel.textContent = 'Verbindung verloren';
  dialogText.textContent =
    'Die Verbindung zum Server ist abgebrochen. Bitte lade die Seite neu, sobald er wieder läuft.';
  anmeldeFormular.hidden = true;
  dialogMeldung.textContent = '';
  if (!anmeldeDialog.open) anmeldeDialog.showModal();
});

// --- Tierliste laden ------------------------------------------------------
//
// Die Liste kommt über einen normalen HTTP-Aufruf und nicht über Socket.io.
// Grund: So landet sie im Browser-Cache und wird nicht bei jeder Partie
// erneut übertragen. Sie enthält kein Geheimnis - nur, welche Tiere es gibt.

fetch('/api/tiere')
  .then((antwort) => {
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
    return antwort.json();
  })
  .then((tiere) => {
    vorschlaege.setzeTiere(tiere);
    poolInfo.textContent = `${tiere.length} Tiere im Spiel.`;
  })
  .catch((fehler) => {
    console.error('Tierliste konnte nicht geladen werden:', fehler);
    dialogMeldung.textContent =
      'Die Tierliste konnte nicht geladen werden. Bitte lade die Seite neu.';
  });

// --- Start ----------------------------------------------------------------
zeigeStart();
