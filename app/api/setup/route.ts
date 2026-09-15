// First-run bootstrap. A fresh deployment starts with an empty database — no
// school, no accounts. This endpoint exists exactly once: it creates the
// school, the first administrator, and then locks itself forever. Every call
// after that returns 409, so there is no standing unauthenticated write.
import { getDb } from "@/db";
import { passwordPolicyError } from "@/lib/password-policy";
import { clientIp, rateLimit, rateLimited } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";

function routeError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please check the setup details.", fields: error.flatten().fieldErrors }, { status: 400 });
  return Response.json({ error: "Setup could not be completed." }, { status: 500 });
}

const setupInput = z.object({
  schoolName: z.string().trim().min(3).max(120),
  schoolCode: z.string().trim().min(2).max(12).regex(/^[A-Z0-9]+$/, "Use capitals and digits only, e.g. NPS"),
  adminName: z.string().trim().min(3).max(120),
  adminEmail: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(12).max(120),
  motto: z.string().trim().max(160).optional(),
  address: z.string().trim().max(240).optional(),
  phone: z.string().trim().max(40).optional(),
  schoolEmail: z.string().trim().toLowerCase().email().max(160).optional().or(z.literal("")),
});

async function hasSchool() {
  const db = getDb();
  return (await db.school.count()) > 0;
}

export async function GET() {
  try {
    return Response.json({ needsSetup: !(await hasSchool()) });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const limit = await rateLimit(`setup:${clientIp(request)}`, 5, 60 * 60 * 1000);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds, limit.unavailable);

    if (await hasSchool()) {
      return Response.json({ error: "Setup has already been completed." }, { status: 409 });
    }

    const input = setupInput.parse(await request.json());
    const passwordError = passwordPolicyError(input.password);
    if (passwordError) return Response.json({ error: passwordError }, { status: 400 });

    const db = getDb();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const tenant = await db.tenant.create({ data: { name: input.schoolName } });
    const school = await db.school.create({
      data: {
        tenantId: tenant.id,
        name: input.schoolName,
        code: input.schoolCode,
        currency: "USD",
        timezone: "Africa/Harare",
        motto: input.motto || null,
        address: input.address || null,
        phone: input.phone || null,
        email: input.schoolEmail || null,
      },
    });
    const user = await db.user.create({
      data: { email: input.adminEmail, name: input.adminName, passwordHash },
    });
    await db.schoolMembership.create({
      data: { schoolId: school.id, userId: user.id, displayName: input.adminName, role: "school_admin" },
    });
    await db.auditLog.create({
      data: {
        schoolId: school.id,
        actorMembershipId: null,
        action: "setup.completed",
        entityType: "school",
        entityId: school.id,
        details: JSON.stringify({ schoolName: input.schoolName, adminEmail: input.adminEmail }),
      },
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
