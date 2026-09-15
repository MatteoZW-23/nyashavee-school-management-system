import { handlers } from "@/auth";
import type { NextRequest } from "next/server";
import { clientIp, rateLimit, rateLimited } from "@/lib/rate-limit";

export const GET = handlers.GET;

export async function POST(request: NextRequest) {
  // Throttle credentials sign-in attempts: 10 tries per IP per 5 minutes.
  if (request.url.includes("/callback/credentials")) {
    const limit = await rateLimit(`login:${clientIp(request)}`, 20, 5 * 60 * 1000);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds, limit.unavailable);
  }
  return handlers.POST(request);
}
