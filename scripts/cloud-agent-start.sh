#!/usr/bin/env bash
set -euo pipefail

DEFAULT_DATA_DIR="/data/db"
if [[ ! -d "$DEFAULT_DATA_DIR" ]] || [[ ! -w "$DEFAULT_DATA_DIR" ]]; then
  DEFAULT_DATA_DIR="${HOME}/.vyom/mongo-data"
fi

MONGO_DATA_DIR="${MONGO_DATA_DIR:-$DEFAULT_DATA_DIR}"
MONGO_LOG_PATH="${MONGO_LOG_PATH:-${HOME}/.vyom/mongod.log}"
MONGO_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017/vyom}"

mkdir -p "$MONGO_DATA_DIR" "$(dirname "$MONGO_LOG_PATH")"

if ! pgrep -x mongod >/dev/null 2>&1; then
  mongod --dbpath "$MONGO_DATA_DIR" --bind_ip 127.0.0.1 --fork --logpath "$MONGO_LOG_PATH"
fi

for _ in $(seq 1 30); do
  if mongosh --quiet "$MONGO_URI" --eval 'db.runCommand({ ping: 1 })' >/dev/null 2>&1; then
    echo "MongoDB is ready at $MONGO_URI"
    exit 0
  fi
  sleep 1
done

echo "MongoDB failed to become ready within 30 seconds" >&2
exit 1
