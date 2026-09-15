import { getDb } from "@/db";
import { createClient } from "redis";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    await db.$queryRaw`SELECT 1`;
    const redisUrl = process.env.REDIS_URL?.trim();
    if (redisUrl) {
      const redis = createClient({ url: redisUrl, socket: { connectTimeout: 2_000 } });
      try {
        await redis.connect();
        await redis.ping();
      } finally {
        if (redis.isOpen) redis.disconnect();
      }
    }
    return Response.json(
      { ok: true, database: "connected", redis: redisUrl ? "connected" : "not_configured" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ ok: false, database: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
