#!/usr/bin/env bash
# R6 — backup script: Postgres dump + artifacts archive, with rotation.
#
# Usage:
#   ./scripts/backup.sh
#
# Env (falls back to backend/.env):
#   DATABASE_URL   Postgres connection string (required)
#   ARTIFACT_DIR   directory with generated media (default /data/artifacts)
#   BACKUP_DIR     where backups land (default <repo>/backups)
#   BACKUP_KEEP    daily backups to keep (default 7)
#
# Restore: see docs/operations.md.
set -euo pipefail

cd "$(dirname "$0")/.."
if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

: "${DATABASE_URL:?set DATABASE_URL in .env or the environment}"
ARTIFACT_DIR="${ARTIFACT_DIR:-/data/artifacts}"
BACKUP_DIR="${BACKUP_DIR:-$(pwd)/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_FILE="$BACKUP_DIR/veo-db-$STAMP.dump"
ART_FILE="$BACKUP_DIR/veo-artifacts-$STAMP.tar.gz"

echo "→ dumping postgres to $DB_FILE"
pg_dump --format=custom --no-owner --file="$DB_FILE" "$DATABASE_URL"

if [ -d "$ARTIFACT_DIR" ]; then
  echo "→ archiving $ARTIFACT_DIR to $ART_FILE"
  tar -czf "$ART_FILE" -C "$(dirname "$ARTIFACT_DIR")" "$(basename "$ARTIFACT_DIR")"
else
  echo "→ ARTIFACT_DIR $ARTIFACT_DIR missing, skipping artifacts archive"
fi

echo "→ rotating: keeping last $BACKUP_KEEP of each kind"
ls -t "$BACKUP_DIR"/veo-db-*.dump 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f
ls -t "$BACKUP_DIR"/veo-artifacts-*.tar.gz 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f

echo "done. backups in $BACKUP_DIR:"
ls -lh "$BACKUP_DIR" | tail -n +2
