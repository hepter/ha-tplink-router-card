#!/usr/bin/env bash
# Stops virtual modems started by start_lab.sh (uses the runner's per-port lock files).
# Usage: virtual_modems/stop_lab.sh [port]   (no port stops every runner)
set -euo pipefail

LOG_DIR="${TMPDIR:-/tmp}/virtual_modems"
if [ -n "${1:-}" ]; then
  STATE_FILES=("$LOG_DIR/active_modem_$1.json")
else
  STATE_FILES=("$LOG_DIR"/active_modem_*.json)
fi

FOUND=0
for STATE_FILE in "${STATE_FILES[@]}"; do
  [ -f "$STATE_FILE" ] || continue
  FOUND=1
  PID="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('pid',0))" "$STATE_FILE" 2>/dev/null || echo 0)"
  if [ "$PID" != "0" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || sudo kill "$PID"
    echo "stopped pid=$PID ($(basename "$STATE_FILE"))"
  else
    echo "process $PID not running; removing stale lock $(basename "$STATE_FILE")"
  fi
  rm -f "$STATE_FILE" 2>/dev/null || sudo rm -f "$STATE_FILE"
done

if [ "$FOUND" -eq 0 ]; then
  echo "no running virtual_modems profile (lock file missing)"
fi
