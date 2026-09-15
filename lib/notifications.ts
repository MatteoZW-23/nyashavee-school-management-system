import type { getDb } from "@/db";

type Db = ReturnType<typeof getDb>;

// In-app staff notifications for the academic workflow — lightweight bell items,
// separate from the parent-facing announcement/outbox channel.
export async function notifyMemberships(
  db: Db,
  schoolId: string,
  membershipIds: string[],
  title: string,
  body: string,
  link?: string
) {
  const unique = [...new Set(membershipIds.filter(Boolean))];
  if (!unique.length) return { notified: 0 };
  await db.notification.createMany({
    data: unique.map((membershipId) => ({
      id: crypto.randomUUID(),
      schoolId,
      membershipId,
      title,
      body,
      link: link || null,
    })),
  });
  return { notified: unique.length };
}

export async function notifyRole(db: Db, schoolId: string, roles: string[], title: string, body: string, link?: string) {
  const memberships = await db.schoolMembership.findMany({
    where: { schoolId, role: { in: roles }, active: true },
    select: { id: true },
  });
  return notifyMemberships(db, schoolId, memberships.map((m) => m.id), title, body, link);
}
