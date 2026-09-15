import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getDb } from "@/db";
import { getSchoolContext, requirePermission, type SchoolContext } from "@/lib/request-context";
import { canAssignRole, hasPermission } from "@/lib/permissions";
import { activationIdentifier, createActivationToken, hashActivationToken, normalizeEmail, sendPortalActivationEmail } from "@/lib/portal-activation";

const roles = z.enum(["super_admin", "school_admin", "headmaster", "deputy_head", "bursar", "admissions_officer", "teacher", "class_teacher", "hod", "librarian", "boarding_staff", "transport_staff", "clinic_staff", "it_admin", "parent"]);

function audit(context: SchoolContext, action: string, type: string, id: string, details: object = {}) {
  return getDb().auditLog.create({
    data: {
      schoolId: context.schoolId,
      actorMembershipId: context.membershipId,
      action,
      entityType: type,
      entityId: id,
      details: JSON.stringify(details),
    },
  });
}

function fail(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please check the administration details." }, { status: 400 });
  const message = error instanceof Error ? error.message : "";
  if (message === "profile_invalid") return Response.json({ error: "Select the linked profile for this portal account." }, { status: 400 });
  if (message === "profile_not_found") return Response.json({ error: "Linked profile not found." }, { status: 404 });
  if (message === "profile_linked") return Response.json({ error: "That profile is already linked to another account." }, { status: 409 });
  if (message === "user_linked") return Response.json({ error: "That account is already linked to a different profile." }, { status: 409 });
  if (message === "role_not_assignable") return Response.json({ error: "You cannot grant, change, or deactivate an account at that role level." }, { status: 403 });
  if (message === "invite_delivery_unavailable") return Response.json({ error: "A deliverable email provider is required before portal access can be invited." }, { status: 503 });
  const uniqueViolation = (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") || /UNIQUE constraint/i.test(message);
  if (uniqueViolation) return Response.json({ error: "That user already belongs to this school." }, { status: 409 });
  return Response.json({ error: "The administration request could not be completed." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "audit.view");
    const db = getDb();

    const [school, members, auditRows, students, users, auditEvents, classes, guardians] = await Promise.all([
      db.school.findUnique({
        where: { id: context.schoolId },
        select: { id: true, name: true, code: true, currency: true, timezone: true, createdAt: true, motto: true, address: true, phone: true, email: true, website: true, registrationNumber: true, bankDetails: true, enableRanking: true, enabledModules: true, exchangeRateZwgPerUsd: true },
      }),
      db.schoolMembership.findMany({
        where: { schoolId: context.schoolId },
        select: { id: true, userId: true, displayName: true, role: true, active: true, createdAt: true, user: { select: { email: true } } },
        orderBy: [{ active: "desc" }, { displayName: "asc" }],
      }),
      db.auditLog.findMany({
        where: { schoolId: context.schoolId },
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          details: true,
          createdAt: true,
          actorMembership: { select: { displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 150,
      }),
      db.student.count({ where: { schoolId: context.schoolId, status: "active", archivedAt: null } }),
      db.schoolMembership.count({ where: { schoolId: context.schoolId, active: true } }),
      db.auditLog.count({ where: { schoolId: context.schoolId } }),
      db.classroom.count({ where: { schoolId: context.schoolId, active: true } }),
      db.guardian.findMany({
        where: { schoolId: context.schoolId },
        select: { id: true, firstName: true, lastName: true, portalUserId: true },
      }),
    ]);

    const portalProfiles = [
      ...guardians.map((profile) => ({ profileType: "parent", id: profile.id, profileName: `${profile.firstName} ${profile.lastName}`, portalUserId: profile.portalUserId })),
    ].sort((a, b) => a.profileType.localeCompare(b.profileType) || a.profileName.localeCompare(b.profileName));

    return Response.json({
      school,
      memberships: members.map((member) => ({ ...member, userEmail: member.user?.email ?? null })),
      audit: auditRows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        details: row.details,
        createdAt: row.createdAt,
        actor: row.actorMembership?.displayName ?? "System",
      })),
      counts: { students, users, auditEvents, classes },
      portalProfiles,
      currentMembershipId: context.membershipId,
      assignableRoles: roles.options.filter((role) => canAssignRole(context.role, role)),
      permissions: {
        memberships: hasPermission(context.role, "memberships.manage"),
        rolesAssign: hasPermission(context.role, "roles.assign"),
        exports: hasPermission(context.role, "exports.manage"),
        settings: hasPermission(context.role, "settings.manage"),
      },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getSchoolContext(request);
    const raw = await request.json();
    const action = z.object({ action: z.string() }).parse(raw).action;
    const db = getDb();

    if (action === "update_school") {
      requirePermission(context, "settings.manage");
      const input = z.object({
        action: z.literal("update_school"),
        name: z.string().trim().min(3).max(140),
        currency: z.enum(["USD", "ZWG"]),
        timezone: z.string().trim().min(3).max(80),
        motto: z.string().trim().max(200).optional(),
        address: z.string().trim().max(300).optional(),
        phone: z.string().trim().max(60).optional(),
        email: z.string().trim().max(120).optional(),
        website: z.string().trim().max(160).optional(),
        registrationNumber: z.string().trim().max(80).optional(),
        bankDetails: z.string().trim().max(400).optional(),
        enableRanking: z.boolean().optional(),
        enabledModules: z.array(z.string().trim().max(40)).max(40).optional(),
        // Prevailing ZiG-per-USD rate used to settle cross-currency bills.
        exchangeRateZwgPerUsd: z.string().trim().regex(/^\d+(\.\d{1,6})?$/).optional().or(z.literal("")),
      }).parse(raw);
      const before = await db.school.findUnique({
        where: { id: context.schoolId },
        select: { name: true, currency: true, timezone: true },
      });
      await db.$transaction([
        db.school.update({
          where: { id: context.schoolId },
          data: {
            name: input.name, currency: input.currency, timezone: input.timezone,
            ...(input.motto !== undefined ? { motto: input.motto || null } : {}),
            ...(input.address !== undefined ? { address: input.address || null } : {}),
            ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
            ...(input.email !== undefined ? { email: input.email || null } : {}),
            ...(input.website !== undefined ? { website: input.website || null } : {}),
            ...(input.registrationNumber !== undefined ? { registrationNumber: input.registrationNumber || null } : {}),
            ...(input.bankDetails !== undefined ? { bankDetails: input.bankDetails || null } : {}),
            ...(input.enableRanking !== undefined ? { enableRanking: input.enableRanking } : {}),
            ...(input.enabledModules !== undefined ? { enabledModules: JSON.stringify(input.enabledModules) } : {}),
            ...(input.exchangeRateZwgPerUsd !== undefined ? { exchangeRateZwgPerUsd: input.exchangeRateZwgPerUsd || null } : {}),
          },
        }),
        audit(context, "school.settings.updated", "school", context.schoolId, { before }),
      ]);
      return Response.json({ updated: true });
    }

    requirePermission(context, "memberships.manage");

    if (action === "create_user_access") {
      const input = z.object({
        action: z.literal("create_user_access"),
        email: z.string().trim().email().max(254),
        displayName: z.string().trim().min(2).max(120),
        role: roles,
        profileKey: z.string().trim().optional(),
      }).parse(raw);
      if (!canAssignRole(context.role, input.role)) throw new Error("role_not_assignable");
      const email = normalizeEmail(input.email);

      const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        return Response.json({ error: "This email already has an account. Do not create or link access until the account holder has been verified." }, { status: 409 });
      }

      const userId = crypto.randomUUID();
      const membershipId = crypto.randomUUID();
      const rawToken = createActivationToken();
      const token = hashActivationToken(rawToken);
      let profileType: "parent" | undefined;
      let profileId: string | undefined;

      await db.$transaction(async (tx) => {
        await tx.user.create({ data: { id: userId, email, name: input.displayName, active: true } });
        await tx.schoolMembership.create({
          // A membership becomes usable only after the recipient sets their
          // own password through the one-time invitation link.
          data: { id: membershipId, schoolId: context.schoolId, userId, displayName: input.displayName, role: input.role, active: false },
        });
        if (input.role === "parent") {
          const [requestedProfileType, requestedProfileId] = (input.profileKey ?? "").split(":");
          if (requestedProfileType !== input.role || !z.string().min(1).max(64).safeParse(requestedProfileId).success) {
            throw new Error("profile_invalid");
          }
          profileType = "parent";
          profileId = requestedProfileId;
          // Never silently hijack a profile already linked to another login,
          // and do not link the profile until the invited recipient verifies it.
          if (input.role === "parent") {
            const profile = await tx.guardian.findFirst({ where: { id: profileId, schoolId: context.schoolId }, select: { id: true, portalUserId: true } });
            if (!profile) throw new Error("profile_not_found");
            if (profile.portalUserId) throw new Error("profile_linked");
          } else {
            const profile = await tx.student.findFirst({ where: { id: profileId, schoolId: context.schoolId }, select: { id: true, portalUserId: true } });
            if (!profile) throw new Error("profile_not_found");
            if (profile.portalUserId) throw new Error("profile_linked");
          }
        }
        await tx.verificationToken.create({
          data: {
            identifier: activationIdentifier({ userId, membershipId, profileType, profileId }),
            token,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        await tx.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: "membership.login_created",
            entityType: "school_membership",
            entityId: membershipId,
            details: JSON.stringify({ email, role: input.role, profileKey: input.profileKey || null, invitation: true }),
          },
        });
      });
      const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
      let delivered = false;
      try {
        delivered = await sendPortalActivationEmail(email, input.displayName, context.schoolName, `${base}/activate?token=${rawToken}`);
      } catch {
        delivered = false;
      }
      if (!delivered) {
        // Development/demo environments have no mail provider — surface the
        // one-time link so the administrator can share it manually. Production
        // keeps the honest rollback: no provider means no account.
        if (process.env.NODE_ENV !== "production") {
          return Response.json({ id: membershipId, email, invited: false, devInviteUrl: `${base}/activate?token=${rawToken}` }, { status: 201 });
        }
        await db.$transaction([
          db.verificationToken.deleteMany({ where: { token } }),
          db.schoolMembership.delete({ where: { id: membershipId } }),
          db.user.delete({ where: { id: userId } }),
        ]);
        throw new Error("invite_delivery_unavailable");
      }
      return Response.json({ id: membershipId, email, invited: true }, { status: 201 });
    }

    if (action === "reset_password") {
      // Passwords belong to the account holder.  A school-scoped administrator
      // must not be able to replace a shared user's global credential.
      return Response.json({ error: "Ask the account holder to use Forgot password. Administrators cannot set global passwords." }, { status: 403 });
    }

    if (action === "set_user_active") {
      const input = z.object({
        action: z.literal("set_user_active"),
        membershipId: z.string().min(1).max(64),
        active: z.boolean(),
      }).parse(raw);
      const membership = await db.schoolMembership.findFirst({
        where: { id: input.membershipId, schoolId: context.schoolId },
        select: { id: true, userId: true, role: true, user: { select: { active: true, email: true } } },
      });
      if (!membership) return Response.json({ error: "School member not found." }, { status: 404 });
      if (!canAssignRole(context.role, membership.role, membership.role)) throw new Error("role_not_assignable");
      if (membership.userId === context.userId && !input.active) {
        return Response.json({ error: "You cannot deactivate your own account." }, { status: 409 });
      }
      await db.$transaction([
        db.schoolMembership.update({ where: { id: membership.id }, data: { active: input.active } }),
        db.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: input.active ? "membership.reactivated" : "membership.deactivated",
            entityType: "school_membership",
            entityId: membership.id,
            details: JSON.stringify({ email: membership.user.email }),
          },
        }),
      ]);
      return Response.json({ updated: true });
    }

    const input = z.object({
      action: z.literal("update_membership"),
      membershipId: z.string().min(1).max(64),
      role: roles,
      active: z.boolean(),
    }).parse(raw);
    if (input.membershipId === context.membershipId) {
      return Response.json({ error: "You cannot alter your own access level or active session." }, { status: 409 });
    }
    const before = await db.schoolMembership.findFirst({
      where: { id: input.membershipId, schoolId: context.schoolId },
      select: { id: true, role: true, active: true },
    });
    if (!before) return Response.json({ error: "School member not found." }, { status: 404 });
    if (!canAssignRole(context.role, input.role, before.role)) throw new Error("role_not_assignable");
    if (before.active && ["school_admin", "super_admin"].includes(before.role) && (!input.active || !["school_admin", "super_admin"].includes(input.role))) {
      const administrators = await db.schoolMembership.count({
        where: { schoolId: context.schoolId, active: true, role: { in: ["school_admin", "super_admin"] } },
      });
      if (administrators <= 1) return Response.json({ error: "Keep at least one active school administrator." }, { status: 409 });
    }
    await db.$transaction(async (tx) => {
      await tx.schoolMembership.update({
        where: { id: input.membershipId },
        data: { role: input.role, active: input.active },
      });
      await tx.auditLog.create({
        data: {
          schoolId: context.schoolId,
          actorMembershipId: context.membershipId,
          action: "membership.updated",
          entityType: "school_membership",
          entityId: input.membershipId,
          details: JSON.stringify({ before, role: input.role, active: input.active }),
        },
      });
    });
    return Response.json({ updated: true });
  } catch (error) {
    return fail(error);
  }
}
