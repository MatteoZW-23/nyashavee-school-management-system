import { createHash } from "node:crypto";
import type { getDb } from "@/db";
import type { SchoolContext } from "@/lib/request-context";

type Db = ReturnType<typeof getDb>;

// Optional idempotency for non-finance mutations. If the client sends an
// Idempotency-Key header, a retried request replays the stored response
// instead of creating a second record. Requests without a key run normally.
export function idempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key");
  return key && key.length <= 64 ? key : null;
}

export function requestHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function replayIdempotent(db: Db, context: SchoolContext, operation: string, key: string | null, hash: string) {
  if (!key) return null;
  const row = await db.financeIdempotencyKey.findUnique({
    where: { schoolId_operation_idempotencyKey: { schoolId: context.schoolId, operation, idempotencyKey: key } },
    select: { requestHash: true, responseStatus: true, responseJson: true },
  });
  if (!row) return null;
  if (row.requestHash !== hash) {
    return Response.json({ error: "This idempotency key was already used for different request details." }, { status: 409 });
  }
  return Response.json(JSON.parse(row.responseJson), { status: row.responseStatus, headers: { "Idempotent-Replay": "true" } });
}

export async function storeIdempotent(db: Db, context: SchoolContext, operation: string, key: string | null, hash: string, status: number, body: object) {
  if (!key) return;
  await db.financeIdempotencyKey.create({
    data: {
      schoolId: context.schoolId,
      operation,
      idempotencyKey: key,
      requestHash: hash,
      actorMembershipId: context.membershipId,
      responseStatus: status,
      responseJson: JSON.stringify(body),
    },
  }).catch(() => undefined); // unique-violation on a concurrent retry is safe to ignore
}
