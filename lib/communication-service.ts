import { z } from "zod";
import type { getDb } from "@/db";
import { requirePermission, type SchoolContext } from "@/lib/request-context";
import { deliverEntry, publishAnnouncement } from "@/lib/messaging";

type Db = ReturnType<typeof getDb>;
const uuid = z.string().min(1).max(64);

// All announcement endpoints call these functions. Keeping the workflow here
// prevents the legacy Operations route and the Communication route drifting.
export async function createAnnouncement(db: Db, context: SchoolContext, raw: unknown) {
  requirePermission(context, "communication.manage");
  const input = z.object({ action: z.literal("create_announcement"), title: z.string().trim().min(3).max(140), body: z.string().trim().min(5).max(3000), audience: z.enum(["all", "staff", "parents", "students"]), channel: z.enum(["in_app", "email", "sms"]) }).parse(raw);
  const id = crypto.randomUUID();
  await db.announcement.create({ data: { id, schoolId: context.schoolId, title: input.title, body: input.body, audience: input.audience, channel: input.channel, createdById: context.membershipId } });
  return Response.json({ id }, { status: 201 });
}

export async function publishDraftAnnouncement(db: Db, context: SchoolContext, raw: unknown) {
  requirePermission(context, "communication.manage");
  const input = z.object({ action: z.literal("publish_announcement"), announcementId: uuid }).parse(raw);
  const item = await db.announcement.findFirst({ where: { id: input.announcementId, schoolId: context.schoolId, status: "draft" }, select: { id: true, audience: true, channel: true } });
  if (!item) return Response.json({ error: "Draft announcement not found." }, { status: 404 });
  const deliveryStatus = await publishAnnouncement(db, context, item);
  return Response.json({ published: true, deliveryStatus });
}

export async function deliverCommunicationOutbox(db: Db, context: SchoolContext, raw: unknown) {
  requirePermission(context, "communication.manage");
  const input = z.object({ action: z.literal("deliver_outbox"), outboxId: uuid.optional() }).parse(raw);
  const entries = await db.communicationOutbox.findMany({
    where: { schoolId: context.schoolId, status: { in: ["queued", "failed"] }, channel: { in: ["email", "sms"] }, ...(input.outboxId ? { id: input.outboxId } : {}) },
    select: { id: true, announcementId: true, channel: true, recipientGroup: true, attemptCount: true }, take: 20,
  });
  if (!entries.length) return Response.json({ delivered: 0, failed: 0, attempted: 0 });
  let delivered = 0; let failed = 0;
  for (const entry of entries) {
    try {
      const result = await deliverEntry(db, context, entry);
      await db.communicationOutbox.update({ where: { id: entry.id }, data: { status: "sent", attemptCount: entry.attemptCount + 1, sentAt: new Date(), failureReason: null } });
      delivered += result.delivered;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "delivery_failed";
      await db.communicationOutbox.update({ where: { id: entry.id }, data: { status: "failed", attemptCount: entry.attemptCount + 1, failureReason: reason } });
      failed += 1;
    }
  }
  return Response.json({ delivered, failed, attempted: entries.length });
}

export function isCommunicationAction(action: string) {
  return action === "create_announcement" || action === "publish_announcement" || action === "deliver_outbox";
}

export async function handleCommunicationAction(db: Db, context: SchoolContext, raw: unknown, action: string): Promise<Response> {
  if (action === "create_announcement") return createAnnouncement(db, context, raw);
  if (action === "publish_announcement") return publishDraftAnnouncement(db, context, raw);
  if (action === "deliver_outbox") return deliverCommunicationOutbox(db, context, raw);
  throw new Response("Unsupported communication action.", { status: 400 });
}
