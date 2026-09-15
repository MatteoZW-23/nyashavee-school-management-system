import type { PrismaClient } from "@prisma/client";
import { notifyStudentGuardians } from "@/lib/messaging";
import type { SchoolContext } from "@/lib/request-context";

type Db = PrismaClient;

function receiptNumber(schoolCode: string) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `RCT-${schoolCode}-${date}-${suffix}`;
}

/**
 * Convert a confirmed gateway payment into a permanent receipt.
 * Idempotent — if the OnlinePayment is already settled the linked payment is
 * returned untouched, so webhook retries and manual status polls can't
 * double-credit a learner.
 */
export async function settleOnlinePayment(db: Db, onlinePaymentId: string, paynowRef: string | null) {
  const record = await db.onlinePayment.findFirst({
    where: { id: onlinePaymentId },
    select: {
      id: true, schoolId: true, studentId: true, initiatedById: true, amountMinor: true, currency: true,
      status: true, paymentId: true, reference: true,
      student: { select: { firstName: true, lastName: true, admissionNumber: true } },
      initiatedBy: { select: { displayName: true } },
      school: { select: { code: true } },
    },
  });
  if (!record) throw new Error("online_payment_missing");
  if (record.status === "settled" && record.paymentId) return { paymentId: record.paymentId, alreadySettled: true };

  const paymentId = crypto.randomUUID();
  const studentName = `${record.student.firstName} ${record.student.lastName}`;

  await db.$transaction(async (tx) => {
    // Auto-allocate oldest-first across the learner's open invoices in this currency.
    const openInvoices = await tx.feeInvoice.findMany({
      where: {
        schoolId: record.schoolId, studentId: record.studentId, currency: record.currency, state: "issued",
        financeReversals: { none: {} },
      },
      select: { id: true, totalMinor: true, dueDate: true, paymentAllocations: { where: { financeReversals: { none: {} } }, select: { amountMinor: true } } },
      orderBy: { dueDate: "asc" },
    });
    let remaining = record.amountMinor;
    const allocations: Array<{ invoiceId: string; amountMinor: number }> = [];
    for (const invoice of openInvoices) {
      if (remaining <= 0) break;
      const allocated = invoice.paymentAllocations.reduce((sum, row) => sum + row.amountMinor, 0);
      const outstanding = Math.max(0, invoice.totalMinor - allocated);
      const apply = Math.min(outstanding, remaining);
      if (apply > 0) {
        allocations.push({ invoiceId: invoice.id, amountMinor: apply });
        remaining -= apply;
      }
    }

    await tx.payment.create({
      data: {
        id: paymentId, schoolId: record.schoolId, studentId: record.studentId,
        receiptNumber: receiptNumber(record.school.code), paymentDate: new Date(),
        method: "paynow", currency: record.currency, amountMinor: record.amountMinor,
        reference: record.reference + (paynowRef ? ` / ${paynowRef}` : ""),
        payerNameSnapshot: record.initiatedBy.displayName,
        studentNameSnapshot: studentName,
        admissionNumberSnapshot: record.student.admissionNumber,
        issuerNameSnapshot: "Online gateway (Paynow)",
        recordedById: record.initiatedById,
      },
    });
    if (allocations.length) {
      await tx.paymentAllocation.createMany({
        data: allocations.map((item) => ({
          id: crypto.randomUUID(), schoolId: record.schoolId, studentId: record.studentId, currency: record.currency,
          paymentId, invoiceId: item.invoiceId, amountMinor: item.amountMinor, allocatedById: record.initiatedById,
        })),
      });
    }
    await tx.onlinePayment.update({
      where: { id: record.id },
      data: { status: "settled", paymentId, paynowRef: paynowRef || undefined },
    });
    await tx.auditLog.create({
      data: {
        schoolId: record.schoolId,
        actorMembershipId: record.initiatedById,
        action: "payment.online_settled",
        entityType: "online_payment",
        entityId: record.id,
        details: JSON.stringify({ reference: record.reference, amountMinor: record.amountMinor, currency: record.currency, paymentId, allocated: allocations.length }),
      },
    });
  });

  return { paymentId, alreadySettled: false };
}

/** Best-effort guardian notice after an online payment settles. */
export async function notifyOnlinePayment(db: Db, context: SchoolContext, onlinePaymentId: string) {
  const record = await db.onlinePayment.findUnique({ where: { id: onlinePaymentId }, select: { studentId: true, reference: true, amountMinor: true, currency: true, payment: { select: { receiptNumber: true } } } });
  if (!record) return;
  const label = record.currency === "ZWG" ? "ZiG" : record.currency;
  await notifyStudentGuardians(
    db, context, record.studentId,
    `Online payment received — ${record.payment?.receiptNumber ?? record.reference}`,
    `${label} ${(record.amountMinor / 100).toFixed(2)} was received online (reference ${record.reference}) and receipted automatically. Thank you.`,
  );
}
