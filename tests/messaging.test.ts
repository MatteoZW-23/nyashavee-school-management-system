import assert from "node:assert/strict";
import test from "node:test";
import {
  countAudienceGroup,
  deduplicateRecipients,
  deliverEntry,
  publishAnnouncement,
  staffRoles,
} from "../lib/messaging.ts";

const context = { schoolId: "school-1", membershipId: "member-1", role: "school_admin" };

test("staff audiences exclude parent and student roles", async () => {
  let where: unknown;
  const db = {
    schoolMembership: {
      count: async (input: { where: unknown }) => {
        where = input.where;
        return 3;
      },
    },
  };

  assert.equal(await countAudienceGroup(db as never, context as never, "staff"), 3);
  assert.equal(staffRoles.includes("parent" as never), false);
  assert.equal(staffRoles.includes("student" as never), false);
  assert.deepEqual(where, {
    schoolId: "school-1",
    active: true,
    role: { in: [...staffRoles] },
  });
});

test("provider recipients are non-empty, deduplicated, and omit reserved email domains", () => {
  assert.deepEqual(
    deduplicateRecipients(
      [null, "", " Person@School.co.zw ", "person@school.co.zw", "demo@school.local", "user@example.com"],
      "email",
    ),
    ["Person@School.co.zw"],
  );
  assert.deepEqual(
    deduplicateRecipients([null, "", " +263771234567 ", "+263771234567", "+263772345678"], "sms"),
    ["+263771234567", "+263772345678"],
  );
});

test("publishing records unavailable instead of queueing when a channel has no recipients", async () => {
  const outbox: Array<Record<string, unknown>> = [];
  const db = {
    announcement: { update: async () => ({}) },
    communicationOutbox: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        outbox.push(data);
        return data;
      },
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  };

  const status = await publishAnnouncement(
    db as never,
    context as never,
    { id: "announcement-without-sms", audience: "students", channel: "sms" },
  );
  assert.equal(status, "unavailable");
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].status, "unavailable");
  assert.equal(outbox[0].failureReason, "no_recipients");
});

test("Resend delivery sends one recipient per request with stable idempotency and timeouts", async () => {
  const requests: RequestInit[] = [];
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM;
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM = "School Notices <notices@school.co.zw>";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
  };
  const db = {
    announcement: { findFirst: async () => ({ title: "Term notice", body: "School closes Friday." }) },
    guardian: {
      findMany: async () => [
        { email: "one@school.co.zw", phone: null },
        { email: " ONE@school.co.zw ", phone: null },
        { email: null, phone: "+263771111111" },
        { email: "two@school.co.zw", phone: null },
        { email: "demo@school.local", phone: null },
      ],
    },
  };
  const entry = { id: "outbox-1", announcementId: "announcement-1", channel: "email", recipientGroup: "parents", attemptCount: 0 };

  try {
    assert.deepEqual(await deliverEntry(db as never, context as never, entry), { delivered: 2 });
    const firstKeys = requests.map((request) => new Headers(request.headers).get("Idempotency-Key"));
    assert.deepEqual(await deliverEntry(db as never, context as never, entry), { delivered: 2 });
    assert.deepEqual(requests.slice(2).map((request) => new Headers(request.headers).get("Idempotency-Key")), firstKeys);
    for (const request of requests) {
      const payload = JSON.parse(String(request.body)) as { to: string[] };
      assert.equal(payload.to.length, 1);
      assert.ok(payload.to[0]);
      assert.ok(request.signal instanceof AbortSignal);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = originalFrom;
  }
});

test("SMS delivery preserves the generic payload while deduplicating phone numbers", async () => {
  const requests: RequestInit[] = [];
  const originalFetch = globalThis.fetch;
  const originalWebhook = process.env.SMS_WEBHOOK_URL;
  process.env.SMS_WEBHOOK_URL = "https://sms.test/messages";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return new Response(null, { status: 204 });
  };
  const db = {
    announcement: { findFirst: async () => ({ title: "Clinic notice", body: "Please contact the office." }) },
    studentGuardian: {
      findMany: async () => [
        { guardian: { email: null, phone: "+263771111111" } },
        { guardian: { email: "guardian@school.co.zw", phone: " +263771111111 " } },
        { guardian: { email: null, phone: "+263772222222" } },
        { guardian: { email: null, phone: null } },
      ],
    },
  };

  try {
    const result = await deliverEntry(
      db as never,
      context as never,
      { id: "outbox-2", announcementId: "announcement-2", channel: "sms", recipientGroup: "student:student-1", attemptCount: 0 },
    );
    assert.deepEqual(result, { delivered: 2 });
    assert.deepEqual(
      requests.map((request) => JSON.parse(String(request.body))),
      [
        { to: "+263771111111", text: "Clinic notice\n\nPlease contact the office." },
        { to: "+263772222222", text: "Clinic notice\n\nPlease contact the office." },
      ],
    );
    assert.ok(requests.every((request) => request.signal instanceof AbortSignal));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWebhook === undefined) delete process.env.SMS_WEBHOOK_URL;
    else process.env.SMS_WEBHOOK_URL = originalWebhook;
  }
});
