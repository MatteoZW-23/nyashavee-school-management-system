import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb } from "@/db";
import { hashActivationToken, parseActivationIdentifier } from "@/lib/portal-activation";
import { clientIp, rateLimit, rateLimited } from "@/lib/rate-limit";
import { passwordPolicyError } from "@/lib/password-policy";

const inputSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(12).max(120),
});

export async function POST(request: Request) {
  try {
    const limit = await rateLimit(`activate:${clientIp(request)}`, 10, 10 * 60 * 1000);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds, limit.unavailable);
    const input = inputSchema.parse(await request.json());
    const passwordError = passwordPolicyError(input.password);
    if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
    const db = getDb();
    const token = await db.verificationToken.findFirst({
      where: { token: hashActivationToken(input.token), expires: { gt: new Date() } },
    });
    const target = token ? parseActivationIdentifier(token.identifier) : null;
    if (!token || !target) return Response.json({ error: "This activation link is invalid or has expired." }, { status: 400 });

    const [user, membership] = await Promise.all([
      db.user.findUnique({ where: { id: target.userId }, select: { id: true } }),
      db.schoolMembership.findUnique({ where: { id: target.membershipId }, select: { id: true, userId: true, schoolId: true, active: true, role: true } }),
    ]);
    if (!user || !membership || membership.userId !== user.id || membership.active) {
      return Response.json({ error: "This activation link can no longer be used." }, { status: 400 });
    }
    if (target.profileType === "parent") {
      const guardian = await db.guardian.findFirst({ where: { id: target.profileId, schoolId: membership.schoolId }, select: { portalUserId: true } });
      if (!guardian || guardian.portalUserId) return Response.json({ error: "This profile has already been linked. Contact the school office." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    await db.$transaction(async (tx) => {
      if (target.profileType === "parent") {
        const linked = await tx.guardian.updateMany({ where: { id: target.profileId, schoolId: membership.schoolId, portalUserId: null }, data: { portalUserId: user.id } });
        if (linked.count !== 1) throw new Error("profile_linked");
      }
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date(), active: true } });
      await tx.schoolMembership.update({ where: { id: membership.id }, data: { active: true } });
      await tx.verificationToken.delete({ where: { identifier_token: { identifier: token.identifier, token: token.token } } });
      await tx.auditLog.create({
        data: {
          schoolId: membership.schoolId,
          actorMembershipId: membership.id,
          action: "portal.invitation_accepted",
          entityType: "school_membership",
          entityId: membership.id,
          details: JSON.stringify({ role: membership.role, profileType: target.profileType ?? null }),
        },
      });
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Use a password of at least 12 characters." }, { status: 400 });
    if (error instanceof Error && error.message === "profile_linked") return Response.json({ error: "This profile has already been linked. Contact the school office." }, { status: 409 });
    return Response.json({ error: "The portal account could not be activated." }, { status: 500 });
  }
}
