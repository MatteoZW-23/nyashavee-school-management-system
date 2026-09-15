import { z } from "zod";
import bcrypt from "bcryptjs";
import { getDb } from "@/db";
import { getSchoolContext } from "@/lib/request-context";

const changePassword = z.object({
  action: z.literal("change_password"),
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(120),
});

export async function POST(request: Request) {
  try {
    const context = await getSchoolContext(request);
    const input = changePassword.parse(await request.json());
    const db = getDb();

    const user = await db.user.findUnique({
      where: { id: context.userId },
      select: { id: true, passwordHash: true },
    });
    if (!user?.passwordHash) return Response.json({ error: "Account not found." }, { status: 404 });

    const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!valid) {
      await db.auditLog.create({
        data: {
          schoolId: context.schoolId,
          actorMembershipId: context.membershipId,
          action: "account.password_change_failed",
          entityType: "user",
          entityId: user.id,
          details: JSON.stringify({}),
        },
      });
      return Response.json({ error: "The current password is incorrect." }, { status: 403 });
    }

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        // passwordChangedAt revokes every session issued before this change.
        data: { passwordHash: await bcrypt.hash(input.newPassword, 10), passwordChangedAt: new Date() },
      }),
      db.auditLog.create({
        data: {
          schoolId: context.schoolId,
          actorMembershipId: context.membershipId,
          action: "account.password_changed",
          entityType: "user",
          entityId: user.id,
          details: JSON.stringify({}),
        },
      }),
    ]);
    return Response.json({ updated: true });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof z.ZodError) return Response.json({ error: "The new password must be at least 8 characters." }, { status: 400 });
    return Response.json({ error: "The password could not be changed." }, { status: 500 });
  }
}
