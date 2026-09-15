import { createHash } from "node:crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getDb } from "@/db";
import { isProviderDeliverableEmail, MESSAGE_PROVIDER_TIMEOUT_MS } from "@/lib/messaging";
import { clientIp, rateLimit, rateLimited } from "@/lib/rate-limit";
import { parseActivationIdentifier } from "@/lib/portal-activation";
import { passwordPolicyError } from "@/lib/password-policy";

const requestSchema = z.object({
  action: z.literal("request"),
  email: z.string().trim().email().max(200),
});

const confirmSchema = z.object({
  action: z.literal("confirm"),
  token: z.string().min(20).max(200),
  password: z.string().min(12).max(120),
});

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function sendResetEmail(email: string, link: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !from || !isProviderDeliverableEmail(email)) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Reset your school portal password",
      text: `Use this link to set a new password (valid for 1 hour):\n\n${link}\n\nIf you did not request this, ignore this message.`,
    }),
    signal: AbortSignal.timeout(MESSAGE_PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`resend_${response.status}`);
  return true;
}

export async function POST(request: Request) {
  try {
    // 5 requests per IP per 10 minutes — reset links can trigger real email sends.
    const limit = await rateLimit(`reset:${clientIp(request)}`, 5, 10 * 60 * 1000);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds, limit.unavailable);
    const raw = await request.json();
    const action = z.object({ action: z.string() }).parse(raw).action;
    const db = getDb();

    if (action === "request") {
      const input = requestSchema.parse(raw);
      const user = await db.user.findUnique({
        where: { email: input.email.toLowerCase() },
        select: { id: true, email: true },
      });
      if (user) {
        const rawToken = crypto.randomUUID() + crypto.randomUUID();
        const identifier = input.email.toLowerCase();
        const token = hashToken(rawToken);
        await db.verificationToken.create({
          data: {
            identifier,
            token,
            expires: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
        const base = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
        let delivered = false;
        try {
          delivered = await sendResetEmail(identifier, `${base}/reset-password?token=${rawToken}`);
        } catch {
          // Keep the public response identical for unknown accounts and provider failures.
        }
        if (delivered) {
          await db.verificationToken.deleteMany({ where: { identifier, token: { not: token } } });
        } else {
          // A delivery outage must not invalidate an older reset link that may still be usable.
          await db.verificationToken.deleteMany({ where: { identifier, token } });
        }
      }
      // Always generic — never reveal whether the email exists.
      return Response.json({ ok: true });
    }

    if (action === "confirm") {
      const input = confirmSchema.parse(raw);
      const passwordError = passwordPolicyError(input.password);
      if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
      const token = await db.verificationToken.findFirst({
        where: { token: hashToken(input.token), expires: { gt: new Date() } },
      });
      if (!token || parseActivationIdentifier(token.identifier)) return Response.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
      const passwordHash = await bcrypt.hash(input.password, 12);
      const user = await db.user.findUnique({ where: { email: token.identifier }, select: { id: true } });
      const membership = user
        ? await db.schoolMembership.findFirst({ where: { userId: user.id }, select: { schoolId: true, id: true } })
        : null;
      await db.$transaction([
        // passwordChangedAt revokes every session issued before this reset.
        db.user.update({ where: { email: token.identifier }, data: { passwordHash, passwordChangedAt: new Date() } }),
        db.verificationToken.delete({ where: { identifier_token: { identifier: token.identifier, token: token.token } } }),
        // Audit the reset against the user's first school when one exists.
        ...(user && membership
          ? [db.auditLog.create({
              data: {
                schoolId: membership.schoolId,
                actorMembershipId: membership.id,
                action: "auth.password_reset_completed",
                entityType: "user",
                entityId: user.id,
                details: JSON.stringify({}),
              },
            })]
          : []),
      ]);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Please check the details provided." }, { status: 400 });
    return Response.json({ error: "The request could not be completed." }, { status: 500 });
  }
}
