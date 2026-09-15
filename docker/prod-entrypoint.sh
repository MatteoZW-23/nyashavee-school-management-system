#!/bin/sh
set -e

case "${DATABASE_URL:-}" in
  postgresql://*|postgres://*) ;;
  *)
    echo "[entrypoint] DATABASE_URL must be a PostgreSQL connection string in production."
    exit 1
    ;;
esac

echo "[entrypoint] Applying database migrations..."
prisma migrate deploy --schema prisma/schema.postgres.prisma

if [ "${RUN_SEED:-0}" = "1" ]; then
  if [ "${DEMO_SEED_ACKNOWLEDGEMENT:-}" != "I_UNDERSTAND_DEMO_DATA_WILL_BE_CREATED" ]; then
    echo "[entrypoint] Refusing demo seed in production without DEMO_SEED_ACKNOWLEDGEMENT."
    exit 1
  fi
  echo "[entrypoint] RUN_SEED=1 — seeding demo data"
  tsx prisma/seed.ts
fi

echo "[entrypoint] Starting server..."
exec node server.js
