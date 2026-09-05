#!/usr/bin/env bash
# Stops the virtual modem started by start_lab.sh (uses the runner's lock file).
set -euo pipefail

LOG_DIR="${TMPDIR:-/tmp}/virtual_modems"
STATE_FILE="$LOG_DIR/active_modem.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "no running virtual_modems profile (lock file missing)"
  exit 0
fi

PID="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('pid',0))" "$STATE_FILE" 2>/dev/null || echo 0)"
if [ "$PID" != "0" ] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null || sudo kill "$PID"
  echo "stopped pid=$PID"
else
  echo "process $PID not running; removing stale lock"
fi
rm -f "$STATE_FILE" 2>/dev/null || sudo rm -f "$STATE_FILE"
