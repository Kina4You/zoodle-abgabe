/**
 * Lobby - alles zwischen Anmeldung und Spielfeld.
 *
 * Drei Wege ins Spiel: oeffentliche Warteschlange, eigene private Lobby
 * erstellen, einer privaten Lobby aus der Liste beitreten.
 *
 * Dieses Modul kennt kein Socket.io. Es bekommt von client.js eine Funktion
 * "sende", mit der es Nachrichten an den Server schickt, und client.js ruft
 * umgekehrt die Methoden des zurueckgegebenen Objekts auf, wenn der Server
 * antwortet. Die Regeln (Passwortlaenge, Sperre, Modus) prueft der Server -
 * was hier geprueft wird, ist nur Komfort fuer ehrliche Spieler.
 *
 * Namen anderer Spieler landen ausschliesslich per textContent im Dokument.
 */

const MIN_PASSWORTLAENGE = 4;
const MAX_PASSWORTLAENGE = 32;

/** So heissen die Modi in der Anzeige. */
const MODUSNAMEN = { zufall: 'Zufallstier', duell: 'Duell' };

/** Fehlertexte zu den Gruenden, die der Server bei "beitrittAbgelehnt" nennt. */
function beitrittsFehler(grund, erstellerName) {
  switch (grund) {
    case 'passwort': return `Das Passwort stimmt nicht. Frag ${erstellerName} nach dem richtigen.`;
    case 'gesperrt': return 'Zu viele Versuche. Warte kurz.';
    case 'voll':     return 'Diese Lobby ist schon voll.';
    default:         return 'Diese Lobby gibt es nicht mehr.';
  }
}

/** Fehlertexte zu den Gruenden, die der Server bei "erstellenAbgelehnt" nennt. */
function erstellFehler(grund) {
  switch (grund) {
    case 'modus': return 'Diesen Modus gibt es noch nicht.';
    case 'zugzeit': return 'Diese Zeit pro Zug gibt es nicht.';
    case 'voll':  return 'Gerade gibt es zu viele Lobbys. Versuch es gleich noch einmal.';
    default:      return `Das Passwort braucht ${MIN_PASSWORTLAENGE} bis ${MAX_PASSWORTLAENGE} Zeichen.`;
  }
}

/** Kopiert den Inhalt einer <template>-Vorlage aus index.html. */
function ausVorlage(id) {
  return document.querySelector(id).content.firstElementChild.cloneNode(true);
}

/** Die Modus-Plakette ("Zufallstier" oder "Duell") - Symbol UND Text. */
function plakette(modus) {
  return ausVorlage(modus === 'duell' ? '#vorlage-plakette-duell' : '#vorlage-plakette-zufall');
}

/** Die Zugzeit in Worten - fuer Plaketten und Screenreader. */
function zeitKurz(zugzeit) {
  return zugzeit ? `${zugzeit} s` : 'ohne Limit';
}
function zeitLang(zugzeit) {
  return zugzeit ? `${zugzeit} Sekunden pro Zug` : 'ohne Zeitlimit';
}

/** Die Zeit-Plakette ("30 s" oder "ohne Limit") - Uhr-Symbol UND Text. */
function zeitPlakette(zugzeit) {
  const element = ausVorlage('#vorlage-plakette-zeit');
  element.querySelector('.zeit-plakette__text').textContent = zeitKurz(zugzeit);
  return element;
}

/**
 * Haelt einen Dialog offen, solange er offen sein soll - Esc schliesst ihn
 * dann NICHT. Gebraucht fuer Anmeldung und die beiden Wartedialoge: Dort
 * soll niemand versehentlich die Lobby schliessen oder die Anmeldung
 * ueberspringen.
 *
 * Zwei Stufen, weil Chrome sich das Schliessen per Esc nicht immer verbieten
 * laesst (ohne vorherigen Klick, oder beim zweiten Esc in Folge):
 *   1. "cancel" abfangen - das reicht in den meisten Faellen.
 *   2. Geht der Dialog trotzdem zu, sofort wieder oeffnen.
 *
 * @param {HTMLDialogElement} dialog
 * @param {() => boolean} sollOffenSein  Fragt den aktuellen Zustand ab
 */
export function haltOffen(dialog, sollOffenSein) {
  dialog.addEventListener('cancel', (ereignis) => ereignis.preventDefault());
  dialog.addEventListener('close', () => {
    if (sollOffenSein()) dialog.showModal();
  });
}

/**
 * Verbindet einen "Anzeigen"-Knopf mit einem Passwortfeld.
 * aria-pressed sagt dem Screenreader, ob der Knopf gerade gedrueckt ist.
 */
function verbindeAnzeigen(knopf, feld) {
  knopf.addEventListener('click', () => {
    const zeigen = feld.type === 'password';
    feld.type = zeigen ? 'text' : 'password';
    knopf.setAttribute('aria-pressed', String(zeigen));
    knopf.textContent = zeigen ? 'Verbergen' : 'Anzeigen';
  });
}

/** Setzt einen "Anzeigen"-Knopf zurueck, damit ein Passwort nie offen stehen bleibt. */
function verbirgPasswort(knopf, feld) {
  feld.type = 'password';
  knopf.setAttribute('aria-pressed', 'false');
  knopf.textContent = 'Anzeigen';
}

/**
 * Ein Passwortfeld samt Hinweis und Fehlermeldung.
 *
 * Der Fehler ist nie nur ein roter Rahmen: Es steht immer ein Text darunter,
 * aria-invalid meldet den Fehler dem Screenreader, und aria-describedby
 * haengt den Fehlertext an das Feld - aber nur, solange er sichtbar ist.
 */
function passwortFeld(feld, hinweis, fehler) {
  return {
    zeigeFehler(text) {
      fehler.textContent = `✕ ${text}`;
      fehler.hidden = false;
      feld.setAttribute('aria-invalid', 'true');
      feld.setAttribute('aria-describedby', `${hinweis.id} ${fehler.id}`);
    },
    loescheFehler() {
      fehler.textContent = '';
      fehler.hidden = true;
      feld.removeAttribute('aria-invalid');
      feld.setAttribute('aria-describedby', hinweis.id);
    },
  };
}

/**
 * @param {object} optionen
 * @param {(ereignis: string, daten?: object) => void} optionen.sende  Schickt an den Server
 * @param {(text: string) => void} optionen.sage  Ansage fuer Screenreader
 */
export function erstelleLobby({ sende, sage }) {
  const bereich        = document.querySelector('#lobby');
  const nameAnzeige    = document.querySelector('#lobby-name');
  const meldung        = document.querySelector('#lobby-meldung');
  const schlangeKnopf  = document.querySelector('#warteschlange-knopf');
  const erstellenKnopf = document.querySelector('#lobby-erstellen-knopf');
  const raeumeTitel    = document.querySelector('#raeume-titel');
  const raeumeAnzahl   = document.querySelector('#raeume-anzahl');
  const raeumeListe    = document.querySelector('#raeume-liste');
  const raeumeLeer     = document.querySelector('#raeume-leer');
  const raeumeKeine    = document.querySelector('#raeume-keine');
  const filterBereich  = document.querySelector('#raeume-filter');
  const suche          = document.querySelector('#lobby-suche');

  const erstellenDialog    = document.querySelector('#erstellen-dialog');
  const erstellenFormular  = document.querySelector('#erstellen-formular');
  const erstellenAbbrechen = document.querySelector('#erstellen-abbrechen');
  const neuesPasswort      = document.querySelector('#feld-neues-passwort');
  const neuesAnzeigen      = document.querySelector('#neues-passwort-anzeigen');
  const neuesFeld = passwortFeld(neuesPasswort,
    document.querySelector('#feld-neues-passwort-hinweis'),
    document.querySelector('#feld-neues-passwort-fehler'));

  const beitretenDialog    = document.querySelector('#beitreten-dialog');
  const beitretenTitel     = document.querySelector('#beitreten-titel');
  const beitretenInfo      = document.querySelector('#beitreten-info');
  const beitretenFormular  = document.querySelector('#beitreten-formular');
  const beitretenAbbrechen = document.querySelector('#beitreten-abbrechen');
  const beitretenKnopf     = document.querySelector('#beitreten-knopf');
  const passwort           = document.querySelector('#feld-passwort');
  const passwortAnzeigen   = document.querySelector('#passwort-anzeigen');
  const beitrittsFeld = passwortFeld(passwort,
    document.querySelector('#feld-passwort-hinweis'),
    document.querySelector('#feld-passwort-fehler'));

  const eigeneDialog      = document.querySelector('#eigene-lobby-dialog');
  const eigeneInfo        = document.querySelector('#eigene-lobby-info');
  const schliessenKnopf   = document.querySelector('#lobby-schliessen-knopf');
  const schlangeDialog    = document.querySelector('#schlange-dialog');
  const schlangeInfo      = document.querySelector('#schlange-info');
  const verlassenKnopf    = document.querySelector('#schlange-verlassen-knopf');

  /** Worauf der Spieler gerade wartet: null, 'schlange' oder 'eigeneLobby'. */
  let wartetAuf = null;

  /** Die Lobby, deren Beitreten-Dialog offen ist - oder null. */
  let gewaehlteLobby = null;

  /** Der "Beitreten"-Knopf, der den Dialog geoeffnet hat. */
  let beitretenOeffner = null;

  /** Wartet, bis der Spieler kurz aufhoert zu tippen, bevor angesagt wird. */
  let suchAnsageTimer;

  haltOffen(schlangeDialog, () => wartetAuf === 'schlange');
  haltOffen(eigeneDialog, () => wartetAuf === 'eigeneLobby');

  verbindeAnzeigen(neuesAnzeigen, neuesPasswort);
  verbindeAnzeigen(passwortAnzeigen, passwort);

  // --- Liste der privaten Lobbys ------------------------------------------

  /** Baut einen Listeneintrag aus der Vorlage - Namen nur per textContent. */
  function baueRaum({ id, erstellerName, modus, zugzeit }) {
    const raum = ausVorlage('#vorlage-raum');
    raum.dataset.lobbyId = id;
    raum.dataset.name = erstellerName.toLowerCase(); // fuer die Suche
    raum.dataset.modus = modus;                      // fuer den Modus-Filter
    raum.querySelector('.raum__zeichen').textContent = [...erstellerName][0]?.toUpperCase() ?? '?';
    raum.querySelector('.raum__name').textContent = `Lobby von ${erstellerName}`;

    const knopf = raum.querySelector('.raum__knopf');
    raum.querySelector('.raum__plaketten').append(plakette(modus), zeitPlakette(zugzeit));
    // Der sichtbare Text "Beitreten" steht vorne, die Ergaenzung fuer den
    // Screenreader dahinter - so funktioniert auch Sprachsteuerung
    // ("Klicke Beitreten"), WCAG 2.5.3.
    knopf.querySelector('.nur-sr').textContent =
      ` – Lobby von ${erstellerName}, Modus ${MODUSNAMEN[modus]}, ${zeitLang(zugzeit)}`;
    knopf.addEventListener('click', () => oeffneBeitreten({ id, erstellerName, modus, zugzeit }, knopf));
    return raum;
  }

  /**
   * Zeichnet die Liste - ohne die vorhandenen Eintraege neu zu bauen.
   *
   * Nur verschwundene Lobbys werden entfernt und neue eingefuegt. Wuerde man
   * die ganze Liste neu bauen, liefe die Einblend-Animation bei jeder
   * Aenderung fuer ALLE Eintraege, und der Fokus ginge jedes Mal verloren.
   */
  function setzeListe(liste) {
    const ids = new Set(liste.map((lobby) => lobby.id));
    const fokusRaum = document.activeElement?.closest('.raum');

    for (const raum of [...raeumeListe.children]) {
      if (!ids.has(raum.dataset.lobbyId)) raum.remove();
    }

    // Die Liste kommt neueste zuerst. Vorhandene Eintraege behalten ihre
    // Reihenfolge, neue kommen an ihre Stelle.
    const vorhandene = new Map([...raeumeListe.children].map((raum) => [raum.dataset.lobbyId, raum]));
    liste.forEach((lobby, stelle) => {
      if (!vorhandene.has(lobby.id)) {
        raeumeListe.insertBefore(baueRaum(lobby), raeumeListe.children[stelle] ?? null);
      }
    });

    wendeFilterAn();

    // Stand der Fokus auf einer Lobby, die es nicht mehr gibt, faellt er auf
    // die Ueberschrift - statt unbemerkt auf der ganzen Seite zu landen.
    if (fokusRaum && !fokusRaum.isConnected) raeumeTitel.focus();

    // Die Lobby im offenen Beitreten-Dialog ist verschwunden.
    if (gewaehlteLobby && !ids.has(gewaehlteLobby.id) && beitretenDialog.open) {
      sperreBeitreten(beitrittsFehler('weg'));
    }
    // Aenderungen der Liste werden bewusst NICHT angesagt - das waere Laerm.
  }

  // --- Suche und Modus-Filter --------------------------------------------

  /**
   * Blendet alle Eintraege aus, die nicht zu Suche UND Modus-Filter passen,
   * und zaehlt mit.
   *
   * Gefiltert wird nur im Browser: Der Server schickt ohnehin die ganze
   * Liste, und bei hoechstens 50 Lobbys ist das sofort erledigt. Die
   * Eintraege bleiben dabei im Dokument - "hidden" blendet sie nur aus.
   */
  function wendeFilterAn() {
    const suchtext = suche.value.trim().toLowerCase();
    const modus = filterBereich.querySelector('input[name="lobby-filter"]:checked')?.value ?? 'alle';
    const raeume = [...raeumeListe.children];
    let sichtbar = 0;

    for (const raum of raeume) {
      const passt = raum.dataset.name.includes(suchtext)
        && (modus === 'alle' || raum.dataset.modus === modus);
      raum.hidden = !passt;
      if (passt) sichtbar += 1;
    }

    const gesamt = raeume.length;
    const gefiltert = sichtbar < gesamt;

    filterBereich.hidden = gesamt === 0;
    raeumeLeer.hidden = gesamt > 0;
    raeumeListe.hidden = sichtbar === 0;
    raeumeKeine.hidden = gesamt === 0 || sichtbar > 0;
    raeumeAnzahl.textContent = gefiltert ? `${sichtbar} von ${gesamt} offen` : `${gesamt} offen`;
    return sichtbar;
  }

  /** Suche oder Filter geaendert: neu filtern und (verzoegert) ansagen. */
  function filterGeaendert() {
    const sichtbar = wendeFilterAn();
    // Erst ansagen, wenn das Tippen kurz pausiert - sonst haette jeder
    // Buchstabe seine eigene Ansage.
    clearTimeout(suchAnsageTimer);
    suchAnsageTimer = setTimeout(() => {
      sage(sichtbar === 1 ? '1 Lobby gefunden.' : `${sichtbar} Lobbys gefunden.`);
    }, 600);
  }

  suche.addEventListener('input', filterGeaendert);
  // "change" kommt bei Radio-Knoepfen erst, wenn wirklich gewechselt wurde.
  filterBereich.addEventListener('change', (ereignis) => {
    if (ereignis.target.name === 'lobby-filter') filterGeaendert();
  });

  // --- Warteschlange ------------------------------------------------------

  schlangeKnopf.addEventListener('click', () => {
    zeigeMeldung('');
    // Jeder Modus hat seine eigene Warteschlange auf dem Server.
    const modus = document.querySelector('input[name="schnell-modus"]:checked')?.value ?? 'zufall';
    sende('warteschlangeBetreten', { modus });
  });

  /** Der Server hat den Spieler eingereiht - mit Modus und Zugzeit. */
  function zeigeWarteschlange(modus, zugzeit) {
    wartetAuf = 'schlange';
    schlangeInfo.replaceChildren(plakette(modus), zeitPlakette(zugzeit), ' Öffentliche Partie');
    if (!schlangeDialog.open) schlangeDialog.showModal();
  }

  verlassenKnopf.addEventListener('click', () => {
    wartetAuf = null;
    schlangeDialog.close(); // der Fokus kehrt zu "Warteschlange betreten" zurueck
    sende('warteschlangeVerlassen');
  });

  // --- Eigene Lobby erstellen ---------------------------------------------

  erstellenKnopf.addEventListener('click', () => {
    zeigeMeldung('');
    erstellenFormular.reset(); // Modus wieder Zufallstier, Feld leer
    neuesFeld.loescheFehler();
    verbirgPasswort(neuesAnzeigen, neuesPasswort);
    erstellenDialog.showModal(); // "autofocus" setzt den Fokus ins Passwortfeld
  });

  erstellenAbbrechen.addEventListener('click', () => erstellenDialog.close());

  erstellenFormular.addEventListener('submit', (ereignis) => {
    ereignis.preventDefault();

    // Geprueft wird erst beim Absenden, nicht bei jedem Tastendruck.
    const laenge = neuesPasswort.value.length;
    if (laenge < MIN_PASSWORTLAENGE || laenge > MAX_PASSWORTLAENGE) {
      zeigeErstellFehler(`Das Passwort braucht mindestens ${MIN_PASSWORTLAENGE} Zeichen.`);
      return;
    }

    neuesFeld.loescheFehler();
    const formular = new FormData(erstellenFormular);
    sende('lobbyErstellen', {
      modus: formular.get('modus'),
      zugzeit: Number(formular.get('zugzeit')),
      passwort: neuesPasswort.value,
    });
  });

  function zeigeErstellFehler(text) {
    neuesFeld.zeigeFehler(text);
    neuesPasswort.focus();
    sage(text);
  }

  /** Der Server hat die Lobby angelegt: Wartedialog statt Formular. */
  function zeigeEigeneLobby(modus, zugzeit) {
    erstellenFormular.reset(); // das Passwort bleibt nicht im Formular stehen
    erstellenDialog.close();

    eigeneInfo.replaceChildren(plakette(modus), zeitPlakette(zugzeit), ' ',
      ausVorlage('#vorlage-schloss'), ' Passwort gesetzt');
    wartetAuf = 'eigeneLobby';
    eigeneDialog.showModal();
    sage('Lobby erstellt. Warte auf Mitspieler.');
  }

  function erstellenAbgelehnt(grund) {
    zeigeErstellFehler(erstellFehler(grund));
  }

  schliessenKnopf.addEventListener('click', () => {
    wartetAuf = null;
    eigeneDialog.close();
    // Der Knopf, der den Wartedialog "geoeffnet" hat, sass im Formular, das
    // schon zu ist - deshalb den Fokus selbst zurueckgeben.
    erstellenKnopf.focus();
    sende('lobbySchliessen');
  });

  // --- Einer Lobby beitreten ----------------------------------------------

  function oeffneBeitreten(lobby, knopf) {
    zeigeMeldung('');
    gewaehlteLobby = lobby;
    beitretenOeffner = knopf;

    beitretenTitel.textContent = `Lobby von ${lobby.erstellerName}`;
    beitretenInfo.replaceChildren(plakette(lobby.modus), zeitPlakette(lobby.zugzeit),
      ` ${lobby.erstellerName} wartet auf einen Mitspieler.`);

    beitretenFormular.reset();
    beitrittsFeld.loescheFehler();
    verbirgPasswort(passwortAnzeigen, passwort);
    for (const element of [passwort, passwortAnzeigen, beitretenKnopf]) element.disabled = false;

    beitretenDialog.showModal();
    passwort.focus();
  }

  beitretenAbbrechen.addEventListener('click', () => beitretenDialog.close());

  beitretenDialog.addEventListener('close', () => {
    gewaehlteLobby = null;
    // Ist der Knopf, der den Dialog geoeffnet hat, inzwischen verschwunden
    // (Lobby weg), geht der Fokus auf die Ueberschrift der Liste.
    if (beitretenOeffner && !beitretenOeffner.isConnected && !bereich.hidden) raeumeTitel.focus();
    beitretenOeffner = null;
  });

  beitretenFormular.addEventListener('submit', (ereignis) => {
    ereignis.preventDefault();
    if (!gewaehlteLobby) return;

    if (passwort.value.length < MIN_PASSWORTLAENGE) {
      zeigeBeitrittsFehler(`Das Passwort braucht mindestens ${MIN_PASSWORTLAENGE} Zeichen.`);
      return;
    }

    beitrittsFeld.loescheFehler();
    sende('lobbyBeitreten', { lobbyId: gewaehlteLobby.id, passwort: passwort.value });
  });

  function zeigeBeitrittsFehler(text) {
    beitrittsFeld.zeigeFehler(text); // das Feld bleibt gefuellt
    passwort.focus();
    sage(text);
  }

  /** Die Lobby ist weg oder voll: Nur noch "Abbrechen" ist sinnvoll. */
  function sperreBeitreten(text) {
    beitrittsFeld.zeigeFehler(text);
    for (const element of [passwort, passwortAnzeigen, beitretenKnopf]) element.disabled = true;
    beitretenAbbrechen.focus();
    sage(text);
  }

  function beitrittAbgelehnt(grund) {
    if (!gewaehlteLobby) return;
    const text = beitrittsFehler(grund, gewaehlteLobby.erstellerName);
    if (grund === 'weg' || grund === 'voll') {
      sperreBeitreten(text);
    } else {
      zeigeBeitrittsFehler(text);
    }
  }

  // --- Ein- und Ausblenden ------------------------------------------------

  /** Zeigt eine Meldung ueber der Lobby - oder blendet sie mit '' aus. */
  function zeigeMeldung(text) {
    meldung.textContent = text;
    meldung.hidden = text === '';
  }

  /** Schliesst alle Lobby-Dialoge, ohne dass einer sich wieder oeffnet. */
  function schliesseDialoge() {
    wartetAuf = null;
    for (const dialog of [erstellenDialog, beitretenDialog, eigeneDialog, schlangeDialog]) {
      if (dialog.open) dialog.close();
    }
  }

  return {
    setzeListe,
    zeigeWarteschlange,
    zeigeEigeneLobby,
    erstellenAbgelehnt,
    beitrittAbgelehnt,
    zeigeMeldung,

    /** Wartet der Spieler gerade in seiner eigenen Lobby? */
    get wartetInEigenerLobby() {
      return wartetAuf === 'eigeneLobby';
    },

    /** Ist gerade ein Dialog der Lobby offen? */
    get dialogOffen() {
      return [erstellenDialog, beitretenDialog, eigeneDialog, schlangeDialog].some((d) => d.open);
    },

    /** Zeigt die Lobby an - nach Anmeldung, Warteschlange verlassen usw. */
    zeige(name) {
      schliesseDialoge();
      nameAnzeige.textContent = name;
      bereich.hidden = false;
      // Kommt der Spieler von woanders (Anmeldung, Endkarte), steht der Fokus
      // im Nichts. Dann geht er auf den ersten Weg ins Spiel.
      if (!bereich.contains(document.activeElement)) schlangeKnopf.focus();
    },

    /** Blendet die Lobby samt aller Dialoge aus - die Partie beginnt. */
    verberge() {
      schliesseDialoge();
      zeigeMeldung('');
      bereich.hidden = true;
    },
  };
}
