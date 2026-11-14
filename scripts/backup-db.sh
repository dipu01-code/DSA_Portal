#!/usr/bin/env bash
set -euo pipefail

# Database Backup Runner Script
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/dsa_portal}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/dsa_portal_backup_${TIMESTAMP}.sql.gz"

echo "=== DSA Portal Database Backup ==="
echo "Target: $BACKUP_FILE"

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$DATABASE_URL" --clean --if-exists --no-owner --no-privileges | gzip > "$BACKUP_FILE"
  SHA256=$(shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')
  SIZE=$(wc -c < "$BACKUP_FILE" | tr -d ' ')
  
  cat <<EOF > "${BACKUP_FILE}.manifest.json"
{
  "id": "backup_${TIMESTAMP}",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "database": "dsa_portal",
  "fileName": "$(basename "$BACKUP_FILE")",
  "fileSizeBytes": $SIZE,
  "sha256": "$SHA256",
  "retentionDays": $RETENTION_DAYS
}
EOF
  echo "Backup successfully created. SHA256: $SHA256"
else
  echo "Node tsx fallback backup runner..."
  npx tsx scripts/backup-db.ts
fi
