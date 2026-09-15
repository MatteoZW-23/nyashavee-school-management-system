import { createHash } from "node:crypto";
import type { getDb } from "@/db";
import type { SchoolRole } from "@/lib/permissions";
import type { SchoolContext } from "@/lib/request-context";

type Db = ReturnType<typeof getDb>;
type DeliveryChannel = "email" | "sms";

export const MESSAGE_PROVIDER_TIMEOUT_MS = 10_000;

export const staffRoles = [
  "super_admin",
  "school_admin",
  "headmaster",
  "deputy_head",
  "bursar",
  "admissions_officer",
  "teacher",
  "class_teacher",
  "hod",
  "librarian",
  "boarding_staff",
  "transport_staff",
  "clinic_staff",
  "it_admin",
] as const satisfies readonly Exclude<SchoolRole, "parent">[];

const reservedEmailDomains = ["local", "test", "invalid"];

export function isProviderDeliverableEmail(value: string) {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1 || email.indexOf("@") !== at || /\s/.test(email)) return false;
  const domain = email.slice(at + 1);
  if (domain === "example.com" || domain.endsWith(".example.com")) return false;
  return !reservedEmailDomains.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`));
}

export function deduplicateRecipients(values: Array<string | null | undefined>, channel: DeliveryChannel) {
  const recipients = new Map<string, string>();
  for (const value of values) {
    const recipient = value?.trim();
    if (!recipient || (channel === "email" && !isProviderDeliverableEmail(recipient))) continue;
    const key = channel === "email" ? recipient.toLowerCase() : recipient;
    if (!recipients.has(key)) recipients.set(key, recipient);
  }
  return [...recipients.values()];
}

export function emailDeliveryIdempotencyKey(announcementId: string, recipient: string) {
  const digest = createHash("sha256")
    .update(`${announcementId}\0${recipient.trim().toLowerCase()}`)
    .digest("hex");
  return `school-announcement-${digest}`;
}

export function isEmailProviderConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM?.trim());
}

export const audienceGroups = ["staff", "parents", "students"] as const;
export type AudienceGroup = (typeof audienceGroups)[number];

export async function countAudienceGroup(db: Db, context: SchoolContext, group: AudienceGroup) {
  if (group === "staff") {
    return db.schoolMembership.count({
      where: { schoolId: context.schoolId, active: true, role: { in: [...staffRoles] } },
    });
  }
  if (group === "parents") {
    return db.guardian.count({ where: { schoolId: context.schoolId } });
  }
  return db.student.count({ where: { schoolId: context.schoolId, status: "active", archivedAt: null } });
}

// Resolve actual recipient addresses for an audience group. The special group
// "student:<id>" targets the guardians linked to one learner — used for
// incident and clinic notifications.
async function recipientAddresses(db: Db, context: SchoolContext, group: string, channel: DeliveryChannel) {
  if (group.startsWith("student:")) {
    const studentId = group.slice("student:".length);
    const links = await db.studentGuardian.findMany({
      where: { studentId, student: { schoolId: context.schoolId }, guardian: { schoolId: context.schoolId } },
      select: { guardian: { select: { email: true, phone: true } } },
    });
    return deduplicateRecipients(
      links.map((link) => (channel === "email" ? link.guardian.email : link.guardian.phone)),
      channel,
    );
  }
  if (group === "parents") {
    const guardians = await db.guardian.findMany({
      where: { schoolId: context.schoolId },
      select: { email: true, phone: true },
    });
    return deduplicateRecipients(
      guardians.map((guardian) => (channel === "email" ? guardian.email : guardian.phone)),
      channel,
    );
  }
  if (group === "staff") {
    const members = await db.schoolMembership.findMany({
      where: { schoolId: context.schoolId, active: true, role: { in: [...staffRoles] } },
      select: {
        user: { select: { email: true } },
        staffProfile: { select: { email: true, phone: true } },
      },
    });
    return deduplicateRecipients(
      members.map((member) => (
        channel === "email"
          ? [member.staffProfile?.email, member.user.email]
              .find((email): email is string => Boolean(email && isProviderDeliverableEmail(email)))
          : member.staffProfile?.phone
      )),
      channel,
    );
  }
  if (group !== "students" || channel === "sms") return [];
  const students = await db.student.findMany({
    where: { schoolId: context.schoolId, status: "active", archivedAt: null, portalUserId: { not: null } },
    select: { portalUserId: true },
  });
  const portalIds = students.flatMap((s) => (s.portalUserId ? [s.portalUserId] : []));
  if (!portalIds.length) return [];
  const users = await db.user.findMany({ where: { id: { in: portalIds } }, select: { email: true } });
  return deduplicateRecipients(users.map((user) => user.email), channel);
}

// Publish an announcement and queue outbox rows — one broadcast row for
// in-app notices, one row per resolved recipient group for provider channels.
export async function publishAnnouncement(
  db: Db,
  context: SchoolContext,
  item: { id: string; audience: string; channel: string },
) {
  const now = new Date();
  const groups: AudienceGroup[] = item.audience === "all" ? [...audienceGroups] : [item.audience as AudienceGroup];
  const outboxData: {
    id: string;
    schoolId: string;
    announcementId: string;
    channel: string;
    recipientGroup: string;
    status: string;
    failureReason?: string;
  }[] = [];

  if (item.channel === "in_app") {
    outboxData.push({ id: crypto.randomUUID(), schoolId: context.schoolId, announcementId: item.id, channel: item.channel, recipientGroup: item.audience, status: "available" });
  } else {
    const channel = item.channel as DeliveryChannel;
    const recipients = await Promise.all(groups.map((group) => recipientAddresses(db, context, group, channel)));
    groups.forEach((group, index) => {
      const deliverable = recipients[index].length > 0;
      outboxData.push({
        id: crypto.randomUUID(),
        schoolId: context.schoolId,
        announcementId: item.id,
        channel: item.channel,
        recipientGroup: group,
        status: deliverable ? "queued" : "unavailable",
        ...(deliverable ? {} : { failureReason: "no_recipients" }),
      });
    });
  }

  await db.$transaction([
    db.announcement.update({
      where: { id: item.id, schoolId: context.schoolId },
      data: { status: "published", publishAt: now },
    }),
    ...outboxData.map((entry) => db.communicationOutbox.create({ data: entry })),
  ]);
  if (item.channel === "in_app") return "available";
  return outboxData.some((entry) => entry.status === "queued") ? "queued" : "unavailable";
}

// Real delivery: email via the Resend API (RESEND_API_KEY, RESEND_FROM), SMS via
// a generic webhook (SMS_WEBHOOK_URL receives {to, text} per recipient).
export async function deliverEntry(
  db: Db,
  context: SchoolContext,
  entry: { id: string; announcementId: string; channel: string; recipientGroup: string; attemptCount: number },
) {
  const announcement = await db.announcement.findFirst({
    where: { id: entry.announcementId, schoolId: context.schoolId },
    select: { title: true, body: true },
  });
  if (!announcement) throw new Error("announcement_missing");
  const text = `${announcement.title}\n\n${announcement.body}`;

  if (entry.channel === "email") {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESEND_FROM?.trim();
    if (!apiKey || !from) throw new Error("no_email_provider");
    const recipients = await recipientAddresses(db, context, entry.recipientGroup, "email");
    if (!recipients.length) throw new Error("no_recipients");
    for (const to of recipients) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": emailDeliveryIdempotencyKey(entry.announcementId, to),
        },
        body: JSON.stringify({ from, to: [to], subject: announcement.title, text }),
        signal: AbortSignal.timeout(MESSAGE_PROVIDER_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`resend_${response.status}`);
    }
    return { delivered: recipients.length };
  }

  if (entry.channel === "sms") {
    const webhook = process.env.SMS_WEBHOOK_URL?.trim();
    if (!webhook) throw new Error("no_sms_provider");
    const recipients = await recipientAddresses(db, context, entry.recipientGroup, "sms");
    if (!recipients.length) throw new Error("no_recipients");
    for (const to of recipients) {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, text }),
        signal: AbortSignal.timeout(MESSAGE_PROVIDER_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`sms_${response.status}`);
    }
    return { delivered: recipients.length };
  }

  // in_app entries are already "available" — nothing to send.
  return { delivered: 0 };
}

// Queue (and attempt) a targeted notice to one learner's guardians — used when
// staff tick "guardian notified" on discipline or clinic records.
export async function notifyStudentGuardians(db: Db, context: SchoolContext, studentId: string, title: string, body: string) {
  const emailRecipients = await recipientAddresses(db, context, `student:${studentId}`, "email");
  const smsRecipients = emailRecipients.length
    ? []
    : await recipientAddresses(db, context, `student:${studentId}`, "sms");
  if (!emailRecipients.length && !smsRecipients.length) return { queued: false, reason: "no_guardian_contacts" };
  const channel = emailRecipients.length ? "email" : "sms";
  const announcement = await db.announcement.create({
    data: {
      schoolId: context.schoolId,
      title,
      body,
      audience: "parents",
      channel,
      status: "published",
      publishAt: new Date(),
      createdById: context.membershipId,
    },
  });
  const entry = await db.communicationOutbox.create({
    data: {
      schoolId: context.schoolId,
      announcementId: announcement.id,
      channel,
      recipientGroup: `student:${studentId}`,
      status: "queued",
    },
  });
  try {
    const result = await deliverEntry(db, context, entry);
    await db.communicationOutbox.update({
      where: { id: entry.id },
      data: { status: "sent", attemptCount: 1, sentAt: new Date() },
    });
    return { queued: true, delivered: result.delivered };
  } catch (error) {
    await db.communicationOutbox.update({
      where: { id: entry.id },
      data: { status: "failed", attemptCount: 1, failureReason: error instanceof Error ? error.message : "delivery_failed" },
    });
    return { queued: true, delivered: 0 };
  }
}
