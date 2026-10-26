/**
 * Die echte IP-Adresse eines Spielers - auch hinter einem Proxy.
 *
 * Auf dem DHBW-Server nimmt Caddy die HTTPS-Verbindungen an und reicht sie
 * von 127.0.0.1 an Zoodle weiter. Ohne diese Funktion sähe Zoodle für ALLE
 * Spieler dieselbe Adresse - und die Grenzen je Adresse (3 offene Lobbys,
 * Passwort-Sperre) gälten für den ganzen Kurs gemeinsam.
 *
 * Caddy schreibt die echte Adresse in die Kopfzeile "X-Forwarded-For". Der
 * wird aber NUR geglaubt, wenn die Verbindung von diesem Rechner selbst kommt:
 * Port 3333 ist auch von außen erreichbar, und dort könnte jeder die
 * Kopfzeile fälschen und sich bei jedem Versuch eine neue Adresse ausdenken.
 *
 * Wie lobbys.js kennt dieses Modul kein Socket.io - siehe tests/adresse.test.js.
 */

/** Von diesen Adressen kommt nur der eigene Proxy (Caddy auf demselben Rechner). */
const EIGENER_RECHNER = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

/**
 * @param {string} direkt  Die Adresse, von der die Verbindung kommt
 *                         (socket.handshake.address)
 * @param {string | string[] | undefined} weitergeleitet  Die Kopfzeile
 *                         "x-forwarded-for", falls vorhanden
 * @returns {string} Die Adresse, die für Sperren und Grenzen zählt
 */
export function echteAdresse(direkt, weitergeleitet) {
  if (!EIGENER_RECHNER.includes(direkt) || typeof weitergeleitet !== 'string') {
    return direkt;
  }

  // Stehen mehrere Adressen drin ("a, b"), gilt die LETZTE: Die hat Caddy
  // selbst angehängt. Alles davor kann der Browser mitgeschickt haben.
  const letzte = weitergeleitet.split(',').at(-1).trim();
  return letzte === '' ? direkt : letzte;
}
