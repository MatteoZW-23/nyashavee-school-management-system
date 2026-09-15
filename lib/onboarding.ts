import { PrismaClient } from "@prisma/client";
import type { SchoolContext } from "@/lib/request-context";
import { isProviderDeliverableEmail } from "@/lib/messaging";
import { activationIdentifier, createActivationToken, hashActivationToken, normalizeEmail, sendPortalActivationEmail } from "@/lib/portal-activation";

function isEmail(value: string | null | undefined): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

export type OnboardingResult = {
  parentInvitation: { email: string; sent: boolean; existingAccount: boolean; devInviteUrl?: string } | null;
  letterPath: string;
  notified: boolean;
};

async function invitePortalAccess(
  db: PrismaClient,
  context: SchoolContext,
  input: { email: string; displayName: string; role: "parent"; profileId: string; introduction?: string },
) {
  const email = normalizeEmail(input.email);
  if (!isProviderDeliverableEmail(email)) return null;
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { email, sent: false, existingAccount: true };
  const userId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const rawToken = createActivationToken();
  const token = hashActivationToken(rawToken);
  const identifier = activationIdentifier({ userId, membershipId, profileType: input.role, profileId: input.profileId });
  await db.$transaction(async (tx) => {
    await tx.user.create({ data: { id: userId, email, name: input.displayName, active: true } });
    await tx.schoolMembership.create({ data: { id: membershipId, schoolId: context.schoolId, userId, displayName: input.displayName, role: input.role, active: false } });
    await tx.verificationToken.create({ data: { identifier, token, expires: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  });
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const appUrl = base || "";
  let sent = false;
  try {
    if (appUrl) sent = await sendPortalActivationEmail(email, input.displayName, context.schoolName, `${appUrl}/activate?token=${rawToken}`, input.introduction);
  } catch {
    sent = false;
  }
  if (!sent) {
    // No mail provider in development — keep the invitation and surface the
    // one-time link so staff can share it manually. Production still rolls back.
    if (process.env.NODE_ENV !== "production") {
      return { email, sent: false, existingAccount: false, devInviteUrl: `${appUrl}/activate?token=${rawToken}` };
    }
    await db.$transaction([
      db.verificationToken.deleteMany({ where: { token } }),
      db.schoolMembership.delete({ where: { id: membershipId } }),
      db.user.delete({ where: { id: userId } }),
    ]);
  }
  return { email, sent, existingAccount: false };
}

/**
 * Provision portal access for a newly registered learner and notify the
 * guardian. Runs best-effort after the registration transaction — a delivery
 * failure never rolls back the enrolment.
 */
export async function onboardStudent(
  db: PrismaClient,
  context: SchoolContext,
  studentId: string,
): Promise<OnboardingResult> {
  const student = await db.student.findFirst({
    where: { id: studentId, schoolId: context.schoolId },
    select: {
      id: true, firstName: true, middleName: true, lastName: true, email: true,
      admissionNumber: true, admissionDate: true, portalUserId: true,
      classroom: { select: { name: true } },
      school: { select: { name: true, code: true } },
      studentGuardians: {
        where: { isPrimaryContact: true },
        select: { guardian: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, portalUserId: true } } },
        take: 1,
      },
    },
  });
  if (!student) return { parentInvitation: null, letterPath: "", notified: false };

  const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
  const guardian = student.studentGuardians[0]?.guardian ?? null;
  const letterPath = `/print/acceptance/${student.id}`;

  // ── Student portal invitation ─────────────────────────────────────────
  // Do not manufacture a school-domain address or a staff-known password.

  // ── Parent portal login ───────────────────────────────────────────────
  let parentInvitation: OnboardingResult["parentInvitation"] = null;
  if (guardian && isEmail(guardian.email) && !guardian.portalUserId) {
    const invite = await invitePortalAccess(db, context, {
      email: guardian.email,
      displayName: `${guardian.firstName} ${guardian.lastName}`,
      role: "parent",
      profileId: guardian.id,
      introduction: `${fullName} has been successfully enrolled at ${student.school.name}. Admission number: ${student.admissionNumber}. Official acceptance letter: ${process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}${letterPath}` : "available from the school office."}`,
    });
    if (invite) parentInvitation = invite;
  } else if (guardian?.portalUserId) {
    const linked = await db.user.findUnique({ where: { id: guardian.portalUserId }, select: { email: true } });
    if (linked) parentInvitation = { email: linked.email, sent: false, existingAccount: true };
  }

  await db.auditLog.create({
    data: {
      schoolId: context.schoolId,
      actorMembershipId: context.membershipId,
      action: "student.onboarded",
      entityType: "student",
      entityId: student.id,
      details: JSON.stringify({
        parentInvitationSent: Boolean(parentInvitation?.sent),
        parentExistingAccount: Boolean(parentInvitation?.existingAccount),
      }),
    },
  });

  return { parentInvitation, letterPath, notified: Boolean(parentInvitation?.sent) };
}
