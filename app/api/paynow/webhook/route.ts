import { getDb } from "@/db";
import { isPaynowConfigured, verifyResultPayload } from "@/lib/paynow";
import { settleOnlinePayment } from "@/lib/online-payment";
import { clientIp, rateLimit, rateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Paynow posts the payment result here when a checkout completes. The hash is
// verified against the integration key before anything is trusted, and
// settlement is idempotent on the OnlinePayment record.
export async function POST(request: Request) {
  if (!isPaynowConfigured()) return new Response("paynow not configured", { status: 404 });
  // Throttle hash-guessing floods: 60 posts per IP per minute is far above
  // anything Paynow legitimately sends.
  const limit = await rateLimit(`paynow:${clientIp(request)}`, 60, 60_000);
  if (!limit.allowed) return rateLimited(limit.retryAfterSeconds, limit.unavailable);
  try {
    const text = await request.text();
    const pairs: Array<[string, string]> = [];
    for (const part of text.split("&")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      pairs.push([decodeURIComponent(part.slice(0, eq)), decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "))]);
    }
    if (!verifyResultPayload(pairs)) return new Response("invalid hash", { status: 400 });

    const fields = new Map(pairs.map(([key, value]) => [key.toLowerCase(), value]));
    const reference = fields.get("reference") ?? "";
    const status = (fields.get("status") ?? "").toLowerCase();
    const paynowRef = fields.get("paynowreference") ?? null;
    if (!reference) return new Response("missing reference", { status: 400 });

    const db = getDb();
    const record = await db.onlinePayment.findFirst({ where: { reference } });
    if (!record) return new Response("ok", { status: 200 }); // unknown reference — ack anyway

    if (status === "paid") {
      await settleOnlinePayment(db, record.id, paynowRef);
    } else if (["cancelled", "failed", "disputed"].includes(status) && record.status === "pending") {
      await db.onlinePayment.update({ where: { id: record.id }, data: { status: "failed", paynowRef: paynowRef || undefined } });
    }
    return new Response("ok", { status: 200 });
  } catch {
    return new Response("error", { status: 500 });
  }
}
