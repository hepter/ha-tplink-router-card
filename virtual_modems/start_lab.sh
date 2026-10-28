#!/usr/bin/env bash
# Starts a virtual modem profile in the background (Linux/macOS); one runner per port.
# Usage: virtual_modems/start_lab.sh [profile=lab] [port=80]
# Ports below 1024 need root; the script re-runs itself with sudo when necessary.
set -euo pipefail

PROFILE="${1:-lab}"
PORT="${2:-80}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PYTHON="$REPO_ROOT/virtual_modems/.venv/bin/python"
PYTHON="${PYTHON:-$([ -x "$VENV_PYTHON" ] && echo "$VENV_PYTHON" || command -v python3 || command -v python)}"
LOG_DIR="${TMPDIR:-/tmp}/virtual_modems"
STATE_FILE="$LOG_DIR/active_modem_$PORT.json"
LOG_FILE="$LOG_DIR/$PROFILE-$PORT.log"

mkdir -p "$LOG_DIR"

if [ -f "$STATE_FILE" ]; then
  RUNNING_PID="$("$PYTHON" -c "import json,sys;print(json.load(open(sys.argv[1])).get('pid',0))" "$STATE_FILE" 2>/dev/null || echo 0)"
  if [ "$RUNNING_PID" != "0" ] && kill -0 "$RUNNING_PID" 2>/dev/null; then
    echo "port $PORT already used by virtual_modems pid=$RUNNING_PID (see $STATE_FILE)"
    exit 0
  fi
fi

if [ "$PORT" -lt 1024 ] && [ "$(id -u)" -ne 0 ]; then
  echo "port $PORT needs root; re-running with sudo (use a port >= 1024 to avoid it)"
  exec sudo -E PYTHON="$PYTHON" "$0" "$PROFILE" "$PORT"
fi

cd "$REPO_ROOT"
nohup "$PYTHON" -m virtual_modems.run "$PROFILE" --port "$PORT" >"$LOG_FILE" 2>&1 &
PID=$!
sleep 1
if ! kill -0 "$PID" 2>/dev/null; then
  echo "failed to start; last log lines:" >&2
  tail -n 20 "$LOG_FILE" >&2
  exit 1
fi
echo "started virtual_modems profile=$PROFILE pid=$PID port=$PORT log=$LOG_FILE"
