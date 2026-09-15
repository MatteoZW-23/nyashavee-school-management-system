import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getDb } from "@/db";
import { getSchoolContext, requirePermission, type SchoolContext } from "@/lib/request-context";
import { hasPermission } from "@/lib/permissions";
import { audienceGroups, countAudienceGroup, isEmailProviderConfigured } from "@/lib/messaging";
import { handleCommunicationAction } from "@/lib/communication-service";

function fail(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please check the required details." }, { status: 400 });
  const message = error instanceof Error ? error.message : "";
  if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") || /UNIQUE constraint/i.test(message)) return Response.json({ error: "That record already exists or is already active." }, { status: 409 });
  return Response.json({ error: "The school record could not be completed." }, { status: 500 });
}

async function audienceCounts(db: ReturnType<typeof getDb>, context: SchoolContext) {
  const [staff, parents, students] = await Promise.all(audienceGroups.map((group) => countAudienceGroup(db, context, group)));
  return { staff, parents, students, all: staff + parents + students };
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "communication.view");
    const db = getDb();

    const [announcementRows, outboxRows, audience] = await Promise.all([
      db.announcement.findMany({
        where: { schoolId: context.schoolId },
        select: {
          id: true,
          title: true,
          body: true,
          audience: true,
          channel: true,
          status: true,
          publishAt: true,
          createdAt: true,
          createdBy: { select: { displayName: true } },
          outbox: {
            where: { schoolId: context.schoolId },
            select: { status: true, attemptCount: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      db.communicationOutbox.findMany({
        where: { schoolId: context.schoolId },
        select: {
          id: true,
          announcementId: true,
          channel: true,
          recipientGroup: true,
          status: true,
          attemptCount: true,
          failureReason: true,
          sentAt: true,
          createdAt: true,
          announcement: { select: { title: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      audienceCounts(db, context),
    ]);

    const announcements = announcementRows.map((announcement) => ({
      id: announcement.id,
      title: announcement.title,
      body: announcement.body,
      audience: announcement.audience,
      channel: announcement.channel,
      status: announcement.status,
      publishAt: announcement.publishAt,
      createdAt: announcement.createdAt,
      createdByName: announcement.createdBy.displayName,
      deliveryStatus: announcement.outbox[0]?.status ?? null,
      attemptCount: announcement.outbox[0]?.attemptCount ?? null,
    }));

    const outbox = outboxRows.map((entry) => ({
      id: entry.id,
      announcementId: entry.announcementId,
      announcementTitle: entry.announcement.title,
      channel: entry.channel,
      recipientGroup: entry.recipientGroup,
      status: entry.status,
      attemptCount: entry.attemptCount,
      failureReason: entry.failureReason,
      sentAt: entry.sentAt,
      createdAt: entry.createdAt,
    }));

    return Response.json({
      announcements,
      outbox,
      audience,
      delivery: { email: isEmailProviderConfigured(), sms: Boolean(process.env.SMS_WEBHOOK_URL?.trim()) },
      permissions: { manage: hasPermission(context.role, "communication.manage") },
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

    return await handleCommunicationAction(db, context, raw, action);
  } catch (error) {
    return fail(error);
  }
}
