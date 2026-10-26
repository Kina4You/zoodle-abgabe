#!/bin/sh
# Startet Zoodle - aber nur, wenn es auf diesem Port nicht schon läuft.
#
# Gedacht für den Dauerbetrieb auf einem Server: cron ruft das Skript beim
# Hochfahren und alle 5 Minuten auf. Läuft Zoodle, passiert nichts. Ist es
# weg (Neustart des Rechners, Prozess beendet), startet es neu und schreibt
# eine Zeile mit Uhrzeit ins Log. Einrichten: siehe README, "Autostart".
#
# Aufruf:  scripts/zoodle-start.sh          Port 3333
#          scripts/zoodle-start.sh 8080     anderer Port

PORT="${1:-3333}"

# Der Projektordner ist der Ordner über scripts/ - egal, von wo cron startet.
PROJEKT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJEKT" || exit 1

# cron kennt den PATH der Anmeldung nicht. Ist Node über nvm installiert,
# liegt es unter ~/.nvm/versions/node/<version>/bin/node. nvm selbst laden
# geht hier nicht: cron startet das Skript mit /bin/sh, und nvm läuft nur in
# bash. Deshalb wird Node direkt im nvm-Ordner gesucht (die letzte Version).
NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  for kandidat in "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$kandidat" ]; then NODE="$kandidat"; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "zoodle-start.sh: node nicht gefunden" >&2
  exit 1
fi

# Läuft Zoodle auf diesem Port schon? Dann nichts tun.
if pgrep -f "node server/server.js $PORT\$" > /dev/null; then
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] zoodle-start.sh: Zoodle lief nicht - wird gestartet" >> zoodle.log
nohup "$NODE" server/server.js "$PORT" >> zoodle.log 2>&1 < /dev/null &
