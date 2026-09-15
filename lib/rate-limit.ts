import { createClient } from "redis";

type LimitResult = { allowed: boolean; retryAfterSeconds: number; unavailable?: boolean };
const buckets = new Map<string, number[]>();
type RedisClient = ReturnType<typeof createClient>;
let redisPromise: Promise<RedisClient | null> | null = null;

async function redis() {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      const client = createClient({ url });
      client.on("error", () => undefined);
      await client.connect();
      return client;
    })().catch(() => {
      redisPromise = null;
      return null;
    });
  }
  return redisPromise;
}

const slidingWindowLua = `
local key, now, window, max = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')[2]
  return {0, oldest + window - now}
end
redis.call('ZADD', key, now, tostring(now) .. ':' .. tostring(math.random()))
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

function localLimit(key: string, limit: number, windowMs: number): LimitResult {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((time) => time > now - windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, retryAfterSeconds: 0 };
}

// Redis performs the sliding-window update atomically, so rate limits apply
// across every production instance and survive an application restart.
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<LimitResult> {
  const client = await redis();
  if (client) {
    try {
      const response = await client.eval(slidingWindowLua, { keys: [`nyashavee:rate:${key}`], arguments: [String(Date.now()), String(windowMs), String(limit)] }) as [number, number];
      return { allowed: Number(response[0]) === 1, retryAfterSeconds: Math.max(1, Math.ceil(Number(response[1]) / 1000)) };
    } catch {
      if (process.env.NODE_ENV === "production") return { allowed: false, retryAfterSeconds: 30, unavailable: true };
    }
  }
  if (process.env.NODE_ENV === "production") return { allowed: false, retryAfterSeconds: 30, unavailable: true };
  return localLimit(key, limit, windowMs);
}

export function clientIp(request: Request) {
  if (process.env.TRUST_PROXY === "true") {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  }
  return "direct";
}

export function rateLimited(retryAfterSeconds: number, unavailable = false) {
  if (unavailable) return Response.json({ error: "Request protection is temporarily unavailable." }, { status: 503, headers: { "Retry-After": String(retryAfterSeconds) } });
  return Response.json({ error: `Too many attempts. Try again in ${retryAfterSeconds} seconds.` }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
}
