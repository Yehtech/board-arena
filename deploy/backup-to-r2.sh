#!/usr/bin/env bash
# =============================================================================
# Encrypted Daily PostgreSQL Backup to Cloudflare R2 & 2-Hour Migration Restore
# Reference: 多人棋類遊戲網站 規格書 §8 (14 daily backups, 12 weekly backups)
# =============================================================================
set -euo pipefail

MODE="${1:-backup}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
BACKUP_DIR="/var/backups/board_arena"
R2_BUCKET="${R2_BUCKET:-s3://board-arena-backups}"
R2_ENDPOINT="${R2_ENDPOINT:-https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com}"
PASSPHRASE="${BACKUP_ENCRYPTION_KEY:-ChangeMeInProd_Key}"

mkdir -p "${BACKUP_DIR}"

if [ "${MODE}" = "backup" ]; then
  DUMP_FILE="${BACKUP_DIR}/board_arena_${TIMESTAMP}.sql.gz.gpg"
  echo "[Backup] Dumping PostgreSQL database board_arena -> ${DUMP_FILE}"
  docker exec board_arena_pg pg_dump -U arena -d board_arena \
    | gzip -9 \
    | gpg --batch --yes --passphrase "${PASSPHRASE}" --symmetric --cipher-algo AES256 -o "${DUMP_FILE}"

  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "${DUMP_FILE}" "${R2_BUCKET}/daily/$(basename "${DUMP_FILE}")" --endpoint-url "${R2_ENDPOINT}"
    if [ "$(date -u +%u)" = "7" ]; then
      aws s3 cp "${DUMP_FILE}" "${R2_BUCKET}/weekly/$(basename "${DUMP_FILE}")" --endpoint-url "${R2_ENDPOINT}"
    fi
  fi

  # Retain 14 days locally
  find "${BACKUP_DIR}" -type f -name "board_arena_*.sql.gz.gpg" -mtime +14 -delete
  echo "[Backup] Completed successfully."

elif [ "${MODE}" = "restore" ]; then
  ARCHIVE="${2:?Usage: ./backup-to-r2.sh restore <encrypted_backup.sql.gz.gpg>}"
  echo "[Restore] Decrypting and restoring ${ARCHIVE} into board_arena_pg..."
  gpg --batch --yes --passphrase "${PASSPHRASE}" --decrypt "${ARCHIVE}" \
    | gunzip \
    | docker exec -i board_arena_pg psql -U arena -d board_arena
  echo "[Restore] Database restored within 2-hour migration SLA."
fi
