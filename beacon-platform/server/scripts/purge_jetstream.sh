#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: purge_jetstream.sh [options] [STREAM ...]

Purge all messages from the specified JetStream streams. If no STREAM
arguments are provided, all streams in the connected account are purged.

Options:
  -s, --server <url>   NATS server URL (overrides NATS_URL env)
  -f, --force          Skip confirmation prompts (passes --force to purge)
  -h, --help           Show this help text and exit

Environment variables:
  NATS_URL   Default server URL (e.g. nats://localhost:4222)
  NATS_CLI   Path to the nats CLI binary (default: nats)
  PYTHON     Python interpreter used for JSON parsing (default: python3)
EOF
}

NATS_URL_ENV=${NATS_URL:-}
NATS_BIN=${NATS_CLI:-nats}
PYTHON_BIN=${PYTHON:-python3}

FORCE=0
declare -a STREAMS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--server)
      shift
      if [[ $# -eq 0 ]]; then
        echo "error: --server requires a value" >&2
        exit 1
      fi
      NATS_URL_ENV=$1
      shift
      ;;
    -f|--force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "error: unknown option '$1'" >&2
      usage >&2
      exit 1
      ;;
    *)
      STREAMS+=("$1")
      shift
      ;;
  esac
done

if [[ $# -gt 0 ]]; then
  STREAMS+=("$@")
fi

if ! command -v "$NATS_BIN" >/dev/null 2>&1; then
  echo "error: nats CLI not found. Install it from https://github.com/nats-io/natscli." >&2
  exit 1
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "error: python interpreter '$PYTHON_BIN' not found." >&2
  exit 1
fi

declare -a NATS_ARGS=("$NATS_BIN")
if [[ -n "$NATS_URL_ENV" ]]; then
  NATS_ARGS+=("--server" "$NATS_URL_ENV")
fi

if [[ ${#STREAMS[@]} -eq 0 ]]; then
  if ! stream_json=$("${NATS_ARGS[@]}" stream ls --json 2>/dev/null); then
    echo "error: failed to list JetStream streams." >&2
    exit 1
  fi

  mapfile -t STREAMS < <(printf '%s' "$stream_json" | "$PYTHON_BIN" - <<'PY'
import json
import sys

data = json.load(sys.stdin)

if isinstance(data, dict):
    streams = data.get("streams") or data.get("Streams") or []
else:
    streams = data

names = []
for item in streams:
    name = None
    if isinstance(item, dict):
        name = item.get("name") or item.get("config", {}).get("name")
    else:
        name = str(item)
    if name and name not in names:
        names.append(name)

for name in names:
    print(name)
PY
  )

  if [[ ${#STREAMS[@]} -eq 0 ]]; then
    echo "No JetStream streams found." >&2
    exit 0
  fi
fi

for stream in "${STREAMS[@]}"; do
  echo "Purging stream: $stream"
  purge_cmd=("${NATS_ARGS[@]}" stream purge "$stream")
  if [[ $FORCE -eq 1 ]]; then
    purge_cmd+=("--force")
  fi
  if ! "${purge_cmd[@]}"; then
    echo "error: failed to purge stream '$stream'." >&2
    exit 1
  fi
done

echo "JetStream purge complete."
