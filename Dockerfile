FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source
COPY . .

# Generate the Prisma client for PostgreSQL (the container connects to
# Postgres, so the client must be generated from the postgres schema variant)
RUN npx prisma generate --schema prisma/schema.postgres.prisma

EXPOSE 3000

# Apply the checked-in PostgreSQL migrations, seed (idempotent upserts) and
# start the dev server. For a production image swap `npm run dev` for
# `npm run build && npm start`.
# Regenerate the client at start too — the /app/node_modules named volume can
# outlive image rebuilds, so a build-time generate alone can leave a stale client.
CMD ["sh", "-c", "npx prisma generate --schema prisma/schema.postgres.prisma && npx prisma migrate deploy --schema prisma/schema.postgres.prisma && npx tsx prisma/seed.ts && npm run dev"]
