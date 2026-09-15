#!/usr/bin/env bash
# Backup the Nyashavee stack: Postgres dump + uploads volume archive.
# Usage: bash scripts/backup.sh [compose-file]   (run from the repo root)
set -euo pipefail

COMPOSE_FILE="${1:-docker-compose.yml}"
OUT_DIR="data/backups"
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"
ABS_OUT="$(cd "$OUT_DIR" && { pwd -W 2>/dev/null || pwd; })"
# Git Bash mangles C:\ paths in docker args — pass them literally.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

echo "[backup] Dumping Postgres..."
docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U nyashavee -d nyashavee > "$OUT_DIR/nyashavee-$TS.sql"

echo "[backup] Archiving uploads volume..."
VOLUME="$(docker volume ls -q --filter name=uploads_data | head -1)"
if [ -z "$VOLUME" ]; then echo "uploads_data volume not found" >&2; exit 1; fi
docker run --rm -v "$VOLUME:/data:ro" -v "$ABS_OUT:/backup" alpine tar czf "/backup/uploads-$TS.tar.gz" -C /data .

echo "[backup] Done:"
ls -lh "$OUT_DIR"/*"$TS"* | awk '{print "  " $NF "  " $5}'
