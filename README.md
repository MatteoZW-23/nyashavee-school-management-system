# Nyashavee School Management System

A full school-management system for Zimbabwean schools — admissions to graduation —
built with Next.js 16, React 19, Prisma, Auth.js and Tailwind 4.

## Maintaining the codebase

The application keeps Next.js pages and API URLs in `app/` because their paths
are part of the public application contract. Most current workflow code lives
in the route modules; shared infrastructure lives in `lib/`. Do not claim a
separate `features/` layer exists until it has actually been introduced.

- `app/api/` — authenticated HTTP routes and current workflow orchestration.
- `components/` — reusable interface pieces and feature workspaces.
- `lib/` — cross-cutting infrastructure such as database access, auth, messaging and security.
- `prisma/` — schemas, migrations and development seed data; never delete applied migrations.

For a safe refactor, extract one complete workflow into a real domain module,
make the old route call it, then run typecheck, tests, smoke tests and a
production build. Do not create duplicate service files during that migration.

## Running locally (SQLite — no Docker required)

```bash
npm install
cp .env.example .env
npm run db:push      # creates prisma/dev.db from schema.prisma (provider sqlite)
npm run db:seed      # demo school, users, students, classes, finance data
npm run dev          # http://localhost:3000
```

## Running with Docker (PostgreSQL)

```powershell
docker compose up --build
```

The container starts PostgreSQL 16, applies the checked-in migrations in
`prisma/migrations/` (`prisma migrate deploy` against
`prisma/schema.postgres.prisma`), runs the idempotent seed and starts the
app on `http://localhost:3000`.

## Production deployment

`Dockerfile.prod` builds an optimized standalone image (multi-stage, non-root
user, `next build` output — no dev server, no source bind-mounts):

```powershell
# .env must define: AUTH_SECRET, POSTGRES_PASSWORD (and optionally
# RESEND_API_KEY, RESEND_FROM, SMS_WEBHOOK_URL, RUN_SEED=1 for demo data)
docker compose -f docker-compose.prod.yml up --build -d
```

`DATABASE_URL` must be a complete PostgreSQL URL with its password URL-encoded;
the production entrypoint refuses SQLite or missing database URLs. Production
also starts a private Redis service for shared rate limiting. For multiple-host
deployment, set `REDIS_URL` to the managed Redis endpoint instead.

Before putting any real school data into production, complete
[the go-live checklist](docs/go-live-checklist.md). It covers the provider,
finance, backup, privacy and real-device work that source code alone cannot do.

The entrypoint runs `prisma migrate deploy` on every start, then serves the
compiled app. A fresh production database is **empty by design** — open
`http://<server>:<port>/setup` once to create the school and the first
administrator; the setup endpoint then locks itself permanently (every further
call returns 409). `RUN_SEED=1` exists only for demos and requires
`DEMO_SEED_ACKNOWLEDGEMENT=I_UNDERSTAND_DEMO_DATA_WILL_BE_CREATED`.

Append a connection pool to the production `DATABASE_URL` — Prisma's default
(9 connections) starves under concurrency:
`postgresql://…/nyashavee?connection_limit=60&pool_timeout=20`.

## Offline / LAN operation

The whole system runs without internet — Docker keeps Postgres and the app on
one machine. To serve the school network:

```powershell
# .env — the machine's LAN address (give it a static IP or DHCP reservation)
AUTH_URL="http://192.168.1.50:3000"
NEXT_PUBLIC_APP_URL="http://192.168.1.50:3000"
AUTH_TRUST_HOST="true"
```

Then allow inbound TCP 3000 through Windows Firewall on that machine; every
computer/tablet on the school Wi-Fi opens `http://192.168.1.50:3000`.

If the LAN or server drops while staff are working:

- A service worker keeps the app shell loading; navigation shows a branded
  offline notice instead of a browser error.
- Submitted changes (payments, registers, marks, notices) are captured into an
  on-device outbox — the top banner says "Offline — queued, not saved yet" and
  a queue badge shows pending items.
- On reconnect the queue replays oldest-first with the original
  `Idempotency-Key`, so a payment that actually reached the server cannot be
  recorded twice. Server rejections are marked "needs review" in the queue
  panel — they are never silently discarded.

Features that still need internet: Paynow online checkout and email/SMS
delivery (they degrade gracefully — dev invite links and the queued outbox
cover the gaps).

## Backups and restore

```powershell
# PowerShell — creates data/backups/nyashavee-<ts>.sql + uploads-<ts>.tar.gz
powershell -File scripts/backup.ps1 -ComposeFile docker-compose.prod.yml

# Verify checksums and the uploads archive before moving it off-site
powershell -File scripts/verify-backup.ps1 -Timestamp <timestamp>

# Git Bash
bash scripts/backup.sh docker-compose.prod.yml
```

Restore:

```powershell
# Database
Get-Content data/backups/nyashavee-<ts>.sql | docker compose -f docker-compose.prod.yml exec -T postgres psql -U nyashavee -d nyashavee

# Uploads
docker run --rm -v desktopprod_uploads_data:/data -v ${PWD}/data/backups:/backup alpine tar xzf /backup/uploads-<ts>.tar.gz -C /data
```

## Two Prisma schema variants

Prisma cannot read the provider from an environment variable, so the repo keeps
two identical schemas that differ only in the datasource provider:

| File | Provider | Used by |
| --- | --- | --- |
| `prisma/schema.prisma` | `sqlite` | local dev (`db:push`, `db:seed`, `npm run dev`) |
| `prisma/schema.postgres.prisma` | `postgresql` | Dockerfile, `npm run db:push:pg`, `db:generate:pg` |

**Keep them in sync** — when you change `schema.prisma`, copy the same model
changes into `schema.postgres.prisma` (only the `datasource` block differs).

`prisma/migrations/` contains PostgreSQL migrations (used by
`prisma migrate deploy` in Docker). Local SQLite dev uses `db:push` and does
not read the migrations folder — do not run `prisma migrate dev` against the
SQLite schema. After changing the schema, regenerate the Postgres migration
with:

```powershell
$migrationName = "describe-change"
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$migrationDir = Join-Path "prisma/migrations" "${timestamp}_${migrationName}"
$tempSql = Join-Path ([System.IO.Path]::GetTempPath()) "${timestamp}_${migrationName}.sql"

npx prisma migrate diff `
  --from-migrations prisma/migrations `
  --to-schema-datamodel prisma/schema.postgres.prisma `
  --script `
  --output $tempSql

if ($LASTEXITCODE -ne 0) { throw "Prisma migrate diff failed." }
New-Item -ItemType Directory -Path $migrationDir -ErrorAction Stop | Out-Null
Move-Item -LiteralPath $tempSql -Destination (Join-Path $migrationDir "migration.sql") -ErrorAction Stop
```

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@nyashavee.local` | `admin123` |
| Head teacher | `head@nyashavee.local` | `head123` |
| Bursar | `bursar@nyashavee.local` | `bursar123` |
| Class teacher | `teacher@nyashavee.local` | `teacher123` |
| Parent portal | `parent@nyashavee.local` | `parent123` |

The seeded parent has four children — one is fee-cleared (report card visible),
one still owes (report card withheld until fees are paid in full).

## Useful commands

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # node --test tests/permissions.test.ts
npm run db:studio    # Prisma Studio
npm run docker:up    # docker compose up -d
SMOKE_URL=http://localhost:3001 npx tsx scripts/smoke.ts   # end-to-end suite (127 checks)
```

## Documentation

- `docs/architecture.md` — system design, tenancy model, data flows
- `docs/permissions.md` — full role/permission matrix (generated from `lib/permissions.ts`)
- `docs/implementation-checklist.md` — delivery checklist

## Feature highlights

- **Staff lifecycle** — government (PSC) vs school-paid split, payroll enforcement, statutory numbers (PAYE/NSSA/PSC), printable payslips at `/print/payslips/<runId>`, leave requests + approvals, transfers/retirement with teaching-load handover
- **Timetable** — clash detection across class, teacher and room
- **Projects & stock** — suppliers, purchase invoices, budgets vs actuals (% used), stock movements linked to ledger entries atomically
- **Exams** — scheduled sessions with venue/invigilator clash detection, auto-generated seating plans printable at `/print/seating/<sessionId>`
- **Admissions** — auto acceptance letter + parent portal credentials emailed on registration (`/print/acceptance/<studentId>`)
