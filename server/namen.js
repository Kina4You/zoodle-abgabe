/**
 * Spielernamen bereinigen, bevor der Server sie speichert und an den Gegner
 * schickt.
 *
 * Ein Name landet beim Gegner in Spielermarke, Zuguhr, Brett und Endkarte.
 * Unsichtbare Unicode-Zeichen könnten dort Unfug treiben: U+202E dreht den
 * folgenden Text um ("ist dran" wird rückwärts), Null-Breite-Zeichen machen
 * einen Namen unsichtbar, gestapelte Akzente ("Zalgo") malen über die
 * Nachbarzeilen. Wie lobbys.js kennt dieses Modul kein Socket.io - siehe
 * tests/namen.test.js.
 */

/** Höchstens so viele sichtbare Zeichen hat ein Name. */
export const MAX_NAMENSLAENGE = 20;

/**
 * Obergrenze in UTF-16-Einheiten. Nötig, weil ein einziges "Zeichen" beliebig
 * lang sein kann: Hundert mit U+200D verbundene Emoji gelten als EIN Graphem.
 */
const MAX_CODEEINHEITEN = 80;

/** Höchstens so viele Akzente dürfen auf einem Buchstaben sitzen (z. B. "ệ"). */
const MAX_AKZENTE = 2;

/**
 * Steuer- (\p{Cc}) und Formatzeichen (\p{Cf}) sowie Zeilen- und
 * Absatztrenner. Ausnahme: Der Verbinder U+200D zwischen zwei Emoji bleibt -
 * aus ihm entstehen Familien-Emoji wie 👨‍👩‍👧. Steht er zwischen zwei Emoji,
 * greift die linke Alternative und füllt die Gruppe "verbinder".
 */
const UNSICHTBAR =
  /(?<=\p{Extended_Pictographic}️?)(?<verbinder>‍)(?=\p{Extended_Pictographic})|[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Mehr als MAX_AKZENTE Akzente hintereinander: die überzähligen fallen weg. */
const ZU_VIELE_AKZENTE = new RegExp(`(\\p{M}{${MAX_AKZENTE}})\\p{M}+`, 'gu');

/**
 * Zerlegt Text in Grapheme - das, was ein Mensch als EIN Zeichen sieht.
 * "😀" sind zwei UTF-16-Einheiten, "👨‍👩‍👧" sogar acht, aber jeweils ein
 * Graphem. Mit .slice() würde ein Emoji an der Grenze zerschnitten.
 */
const zerleger = new Intl.Segmenter('de', { granularity: 'grapheme' });

/**
 * @param {unknown} roh  Was der Client geschickt hat
 * @returns {string} Der bereinigte Name - leer, wenn nichts Sichtbares übrig bleibt
 */
export function bereinigeName(roh) {
  if (typeof roh !== 'string') return '';

  const sauber = roh
    // Das letzte Argument enthält die benannten Gruppen: Nur ein Verbinder
    // zwischen Emoji bleibt stehen, alles andere wird entfernt.
    .replace(UNSICHTBAR, (...treffer) => treffer.at(-1).verbinder ?? '')
    .replace(ZU_VIELE_AKZENTE, '$1')
    .trim();

  // Ganze Zeichen anhängen, bis eine der beiden Grenzen erreicht ist.
  let name = '';
  let anzahl = 0;
  for (const { segment } of zerleger.segment(sauber)) {
    if (anzahl === MAX_NAMENSLAENGE || name.length + segment.length > MAX_CODEEINHEITEN) break;
    name += segment;
    anzahl += 1;
  }
  return name.trim();
}
