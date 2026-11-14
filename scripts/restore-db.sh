#!/usr/bin/env bash
set -euo pipefail

# Database Restore Runner Script
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/dsa_portal}"
TARGET_FILE="${1:-}"

echo "=== DSA Portal Database Restore ==="

if [ -z "$TARGET_FILE" ]; then
  # Pick latest
  TARGET_FILE=$(ls -t "${BACKUP_DIR}"/*.manifest.json 2>/dev/null | head -n 1 || true)
  if [ -z "$TARGET_FILE" ]; then
    echo "Error: No backup manifests found in $BACKUP_DIR"
    exit 1
  fi
  TARGET_FILE=$(echo "$TARGET_FILE" | sed 's/\.manifest\.json//')
fi

echo "Selected backup: $TARGET_FILE"

# Run TS restore runner with full verification
npx tsx scripts/restore-db.ts "$TARGET_FILE"
