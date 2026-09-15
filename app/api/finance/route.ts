import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getDb } from "@/db";
import { getSchoolContext, guardMutation, requirePermission, type SchoolContext } from "@/lib/request-context";
import { hasPermission } from "@/lib/permissions";
import { notifyStudentGuardians } from "@/lib/messaging";

const currency = z.enum(["USD", "ZWG"]);
const money = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/);
const uploadsRoot = path.join(process.cwd(), "data", "uploads");
const allocationInput = z.object({ invoiceId: z.string().min(1).max(64), amount: money });

const createInvoice = z.object({
  action: z.literal("create_invoice"), studentId: z.string().min(1).max(64), termId: z.string().min(1).max(64).optional(),
  issueDate: z.string().date(), dueDate: z.string().date(), currency, notes: z.string().trim().max(500).optional(),
  items: z.array(z.object({ description: z.string().trim().min(2).max(120), category: z.enum(["tuition", "registration", "examination", "boarding", "transport", "sports", "uniform", "levy", "other"]), quantity: z.number().int().min(1).max(100), unitAmount: money })).min(1).max(20),
});
const recordPayment = z.object({
  action: z.literal("record_payment"), studentId: z.string().min(1).max(64), currency, paymentDate: z.string().date(), amount: money,
  method: z.enum(["cash", "ecocash", "onemoney", "bank_transfer", "pos", "paynow", "card", "other"]),
  reference: z.string().trim().max(100).optional(), payerName: z.string().trim().min(2).max(120), allocations: z.array(allocationInput).max(30).default([]),
  // Payment-currency units per 1 invoice-currency unit (e.g. 27 = ZiG 27 pays USD 1).
  exchangeRate: z.string().trim().regex(/^\d+(\.\d{1,6})?$/).optional(),
});
const allocatePayment = z.object({ action: z.literal("allocate_payment"), paymentId: z.string().min(1).max(64), invoiceId: z.string().min(1).max(64), amount: money });
const reverseFinance = z.object({ action: z.literal("reverse_finance"), targetType: z.enum(["invoice", "payment", "allocation"]), targetId: z.string().min(1).max(64), reason: z.string().trim().min(5).max(240) });
const reviewProof = z.object({ action: z.literal("review_proof"), proofId: z.string().min(1).max(64), decision: z.enum(["verified", "rejected"]), note: z.string().trim().max(240).optional(), paymentId: z.string().min(1).max(64).optional() });
const remindDebtors = z.object({ action: z.literal("remind_debtors"), message: z.string().trim().max(240).optional() });
const feeLine = z.object({ description: z.string().trim().min(2).max(120), category: z.enum(["tuition", "registration", "examination", "boarding", "transport", "sports", "uniform", "levy", "other"]), quantity: z.number().int().min(1).max(100), unitAmount: money });
const saveFeeTemplate = z.object({
  action: z.literal("save_fee_template"),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(200).optional(),
  gradeLevelId: z.string().min(1).max(64).optional(),
  currency,
  items: z.array(feeLine).min(1).max(20),
});
const issueClassInvoices = z.object({
  action: z.literal("issue_class_invoices"),
  classroomId: z.string().min(1).max(64),
  termId: z.string().min(1).max(64).optional(),
  templateId: z.string().min(1).max(64).optional(),
  items: z.array(feeLine).min(1).max(20).optional(),
  issueDate: z.string().date(),
  dueDate: z.string().date(),
  currency,
  notes: z.string().trim().max(500).optional(),
});
const createProject = z.object({ action: z.literal("create_project"), name: z.string().trim().min(2).max(80), description: z.string().trim().max(200).optional() });
const recordLedger = z.object({
  action: z.literal("record_ledger"),
  kind: z.enum(["income", "expense", "donation_in", "donation_out"]),
  projectId: z.string().min(1).max(64).optional(),
  counterpart: z.string().trim().max(120).optional(),
  description: z.string().trim().min(2).max(200),
  amount: z.string().trim().min(1).max(16),
  currency: z.enum(["USD", "ZWG"]),
  occurredOn: z.string().date(),
  reference: z.string().trim().max(80).optional(),
});
const reverseLedger = z.object({ action: z.literal("reverse_ledger"), ledgerId: z.string().min(1).max(64), reason: z.string().trim().min(5).max(240) });
const createStockItem = z.object({
  action: z.literal("create_stock_item"),
  projectId: z.string().min(1).max(64),
  name: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(1).max(20).default("units"),
  openingQty: z.number().min(0).max(1_000_000).optional(),
});
const recordStockMovement = z.object({
  action: z.literal("record_stock_movement"),
  itemId: z.string().min(1).max(64),
  kind: z.enum(["purchase", "usage", "sale", "adjustment"]),
  direction: z.enum(["in", "out"]).optional(),
  quantity: z.number().positive().max(1_000_000),
  amount: z.string().trim().max(16).optional(),
  supplierId: z.string().min(1).max(64).optional(),
  invoiceRef: z.string().trim().max(60).optional(),
  currency: z.enum(["USD", "ZWG"]).optional(),
  occurredOn: z.string().date(),
  note: z.string().trim().max(200).optional(),
});
const createSupplier = z.object({
  action: z.literal("create_supplier"),
  name: z.string().trim().min(2).max(80),
  contact: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  notes: z.string().trim().max(300).optional(),
});
const setProjectBudget = z.object({
  action: z.literal("set_project_budget"),
  projectId: z.string().min(1).max(64),
  label: z.string().trim().min(2).max(80),
  amount: z.string().trim().min(1).max(16),
  currency: z.enum(["USD", "ZWG"]),
});
const financeCommand = z.discriminatedUnion("action", [createInvoice, recordPayment, allocatePayment, reverseFinance, reviewProof, remindDebtors, saveFeeTemplate, issueClassInvoices, createProject, recordLedger, reverseLedger, createStockItem, recordStockMovement, createSupplier, setProjectBudget]);

function toMinor(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result <= 0) throw new Response("Amounts must be greater than zero.", { status: 400 });
  return result;
}

function dateOnly(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function timestampLabel(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 19).replace("T", " ") : null;
}

function documentNumber(prefix: string, schoolCode: string) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `${prefix}-${schoolCode}-${date}-${suffix}`;
}

async function hashRequest(operation: string, input: unknown) {
  const payload = new TextEncoder().encode(`${operation}:${JSON.stringify(input)}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function idempotencyKey(request: Request) {
  const parsed = z.string().min(1).max(64).safeParse(request.headers.get("idempotency-key"));
  if (!parsed.success) throw new Response("A valid Idempotency-Key header is required for finance changes.", { status: 400 });
  return parsed.data;
}

async function replayResponse(db: ReturnType<typeof getDb>, context: SchoolContext, operation: string, key: string, requestHash: string) {
  const row = await db.financeIdempotencyKey.findUnique({
    where: { schoolId_operation_idempotencyKey: { schoolId: context.schoolId, operation, idempotencyKey: key } },
    select: { requestHash: true, responseStatus: true, responseJson: true },
  });
  if (!row) return null;
  if (row.requestHash !== requestHash) return Response.json({ error: "This request key was already used for different finance details." }, { status: 409 });
  return Response.json(JSON.parse(row.responseJson), { status: row.responseStatus, headers: { "Idempotent-Replay": "true" } });
}

async function commitIdempotent(db: ReturnType<typeof getDb>, context: SchoolContext, operation: string, key: string, requestHash: string, work: (tx: Prisma.TransactionClient) => Promise<unknown>, status: number, body: object) {
  try {
    await db.$transaction(async (tx) => {
      await work(tx);
      await tx.financeIdempotencyKey.create({
        data: {
          schoolId: context.schoolId,
          operation,
          idempotencyKey: key,
          requestHash,
          actorMembershipId: context.membershipId,
          responseStatus: status,
          responseJson: JSON.stringify(body),
        },
      });
    });
  } catch (error) {
    const replay = await replayResponse(db, context, operation, key, requestHash);
    if (replay) return replay;
    throw error;
  }
  return Response.json(body, { status });
}

function routeError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please check the finance details." }, { status: 400 });
  const message = error instanceof Error ? error.message : "";
  const uniqueViolation = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  if (uniqueViolation || /UNIQUE constraint|allocation_|reversed|immutable|cannot be reversed/i.test(message)) return Response.json({ error: "That finance change conflicts with the current account balance. Refresh and try again." }, { status: 409 });
  return Response.json({ error: "The finance request could not be completed." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "finance.view");
    const db = getDb();
    const url = new URL(request.url);
    const receiptId = url.searchParams.get("receiptId");
    const invoiceId = url.searchParams.get("invoiceId");
    const today = dateOnly(new Date())!;

    // Download an uploaded proof of payment — finance staff only.
    const proofId = url.searchParams.get("proof");
    if (proofId) {
      const proof = await db.paymentProof.findFirst({
        where: { id: proofId, schoolId: context.schoolId },
        select: { id: true, filename: true, storageKey: true },
      });
      if (!proof) return Response.json({ error: "Proof not found." }, { status: 404 });
      try {
        const data = await readFile(path.join(uploadsRoot, proof.storageKey));
        return new Response(new Uint8Array(data), {
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": `inline; filename="${proof.filename}"`,
          },
        });
      } catch {
        return Response.json({ error: "The stored file is missing." }, { status: 404 });
      }
    }

    const [invoiceRows, paymentRows, studentRows, termRows, templateRows, classRows] = await Promise.all([
      db.feeInvoice.findMany({
        where: { schoolId: context.schoolId, state: "issued" },
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true, invoiceNumber: true, studentId: true,
          admissionNumberSnapshot: true, studentNameSnapshot: true,
          issueDate: true, dueDate: true, currency: true, totalMinor: true, notes: true,
          financeReversals: { select: { id: true } },
          paymentAllocations: {
            where: { financeReversals: { none: {} }, payment: { financeReversals: { none: {} } } },
            select: { amountMinor: true },
          },
        },
      }),
      db.payment.findMany({
        where: { schoolId: context.schoolId },
        orderBy: [{ paymentDate: "desc" }, { recordedAt: "desc" }],
        select: {
          id: true, receiptNumber: true, studentId: true,
          admissionNumberSnapshot: true, studentNameSnapshot: true,
          paymentDate: true, method: true, currency: true, amountMinor: true,
          reference: true, payerNameSnapshot: true,
          financeReversals: { select: { reversalNumber: true, reason: true, reversalDate: true } },
          paymentAllocations: {
            where: { financeReversals: { none: {} } },
            orderBy: { allocatedAt: "asc" },
            select: { amountMinor: true, invoice: { select: { invoiceNumber: true } } },
          },
        },
      }),
      db.student.findMany({
        where: { schoolId: context.schoolId, status: "active", archivedAt: null },
        select: { id: true, admissionNumber: true, firstName: true, lastName: true, studentGuardians: { where: { isPrimaryContact: true }, take: 1, select: { guardian: { select: { firstName: true, lastName: true } } } } },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      db.term.findMany({
        where: { schoolId: context.schoolId },
        select: { id: true, name: true, academicYear: { select: { name: true } } },
        orderBy: [{ academicYear: { startDate: "desc" } }, { termNumber: "desc" }],
      }),
      db.feeTemplate.findMany({
        where: { schoolId: context.schoolId, active: true },
        select: { id: true, name: true, description: true, currency: true, items: true, gradeLevel: { select: { name: true } } },
        orderBy: { name: "asc" },
      }),
      db.classroom.findMany({
        where: { schoolId: context.schoolId, active: true },
        select: {
          id: true, name: true,
          year: { select: { name: true } },
          gradeLevel: { select: { name: true } },
          _count: { select: { students: { where: { schoolId: context.schoolId, status: "active", archivedAt: null } } } },
        },
        orderBy: [{ yearNumber: "desc" }, { gradeLevel: { gradeOrder: "asc" } }, { name: "asc" }],
      }),
    ]);

    const summary: Record<string, unknown> = {};
    for (const code of ["USD", "ZWG"]) {
      let invoicedMinor = 0, paidMinor = 0, outstandingMinor = 0, unappliedMinor = 0, overdueMinor = 0;
      for (const row of invoiceRows) {
        if (row.currency !== code || row.financeReversals.length > 0) continue;
        const paid = row.paymentAllocations.reduce((sum, item) => sum + item.amountMinor, 0);
        const outstanding = Math.max(0, row.totalMinor - paid);
        invoicedMinor += row.totalMinor;
        outstandingMinor += outstanding;
        if (dateOnly(row.dueDate)! < today) overdueMinor += outstanding;
      }
      for (const row of paymentRows) {
        if (row.currency !== code || row.financeReversals.length > 0) continue;
        const allocated = row.paymentAllocations.reduce((sum, item) => sum + item.amountMinor, 0);
        paidMinor += row.amountMinor;
        unappliedMinor += Math.max(0, row.amountMinor - allocated);
      }
      summary[code] = { currency: code, invoicedMinor, paidMinor, outstandingMinor, unappliedMinor, overdueMinor };
    }

    const invoices = invoiceRows.slice(0, 200).map((row) => {
      const reversed = row.financeReversals.length > 0;
      const paid = row.paymentAllocations.reduce((sum, item) => sum + item.amountMinor, 0);
      const paidMinor = reversed ? 0 : paid;
      const outstandingMinor = reversed ? 0 : Math.max(0, row.totalMinor - paid);
      const status = reversed ? "reversed" : row.totalMinor - paid <= 0 ? "paid" : paid > 0 ? "partial" : dateOnly(row.dueDate)! < today ? "overdue" : "open";
      return {
        id: row.id, invoiceNumber: row.invoiceNumber, studentId: row.studentId,
        admissionNumber: row.admissionNumberSnapshot, studentName: row.studentNameSnapshot,
        issueDate: dateOnly(row.issueDate), dueDate: dateOnly(row.dueDate), currency: row.currency,
        totalMinor: row.totalMinor, paidMinor, outstandingMinor, notes: row.notes, status,
      };
    });

    const payments = paymentRows.slice(0, 150).map((row) => {
      const reversal = row.financeReversals[0] ?? null;
      const allocatedMinor = row.paymentAllocations.reduce((sum, item) => sum + item.amountMinor, 0);
      return {
        id: row.id, receiptNumber: row.receiptNumber, studentId: row.studentId,
        admissionNumber: row.admissionNumberSnapshot, studentName: row.studentNameSnapshot,
        paymentDate: dateOnly(row.paymentDate), method: row.method, currency: row.currency,
        amountMinor: row.amountMinor, allocatedMinor,
        unappliedMinor: Math.max(0, row.amountMinor - allocatedMinor),
        reference: row.reference, payerName: row.payerNameSnapshot,
        status: reversal ? "reversed" : "posted",
        reversalReason: reversal?.reason ?? null,
        reversalNumber: reversal?.reversalNumber ?? null,
        invoiceNumbers: row.paymentAllocations.length ? row.paymentAllocations.map((item) => item.invoice.invoiceNumber).join(", ") : null,
      };
    });

    const students = studentRows.map((row) => ({
      id: row.id, admissionNumber: row.admissionNumber, firstName: row.firstName, lastName: row.lastName,
      guardianName: row.studentGuardians[0] ? `${row.studentGuardians[0].guardian.firstName} ${row.studentGuardians[0].guardian.lastName}` : null,
    }));
    const terms = termRows.map((row) => ({ id: row.id, name: row.name, academicYear: row.academicYear.name }));
    const templates = templateRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      currency: row.currency,
      gradeName: row.gradeLevel?.name ?? null,
      items: (JSON.parse(row.items) as { description: string; category: string; quantity: number; unitAmountMinor: number }[]).map((item) => ({
        ...item,
        unitAmount: (item.unitAmountMinor / 100).toFixed(2),
      })),
      totalMinor: (JSON.parse(row.items) as { quantity: number; unitAmountMinor: number }[]).reduce((sum, item) => sum + item.quantity * item.unitAmountMinor, 0),
    }));
    const classes = classRows.map((row) => ({
      id: row.id,
      name: row.name,
      academicYear: row.year?.name ?? null,
      gradeName: row.gradeLevel?.name ?? null,
      enrolled: row._count.students,
    }));

    let receipt: unknown = null;
    if (receiptId) {
      const row = await db.payment.findFirst({
        where: { id: receiptId, schoolId: context.schoolId },
        select: {
          id: true, receiptNumber: true, paymentDate: true, currency: true, amountMinor: true, exchangeRate: true,
          method: true, reference: true, payerNameSnapshot: true, studentNameSnapshot: true,
          admissionNumberSnapshot: true, issuerNameSnapshot: true, recordedAt: true,
          financeReversals: { select: { reversalNumber: true, reason: true, reversalDate: true } },
        },
      });
      if (!row) return Response.json({ error: "Receipt not found." }, { status: 404 });
      const reversal = row.financeReversals[0] ?? null;
      receipt = {
        id: row.id, receiptNumber: row.receiptNumber, paymentDate: dateOnly(row.paymentDate),
        currency: row.currency, amountMinor: row.amountMinor, exchangeRate: row.exchangeRate, method: row.method, reference: row.reference,
        payerName: row.payerNameSnapshot, studentName: row.studentNameSnapshot,
        admissionNumber: row.admissionNumberSnapshot, issuerName: row.issuerNameSnapshot,
        recordedAt: timestampLabel(row.recordedAt),
        reversalNumber: reversal?.reversalNumber ?? null,
        reversalReason: reversal?.reason ?? null,
        reversalDate: reversal ? dateOnly(reversal.reversalDate) : null,
      };
    }

    let invoiceItems: unknown[] = [];
    if (invoiceId) {
      const owned = await db.feeInvoice.findFirst({
        where: { id: invoiceId, schoolId: context.schoolId },
        select: { id: true },
      });
      if (!owned) return Response.json({ error: "Invoice not found." }, { status: 404 });
      const items = await db.feeInvoiceItem.findMany({
        where: { schoolId: context.schoolId, invoiceId },
        orderBy: { position: "asc" },
        select: { id: true, position: true, description: true, category: true, quantity: true, unitAmountMinor: true },
      });
      invoiceItems = items.map((item) => ({ ...item, lineTotalMinor: item.quantity * item.unitAmountMinor }));
    }

    const [projects, ledger, movements, suppliers, proofRows] = await Promise.all([
      db.incomeProject.findMany({
        where: { schoolId: context.schoolId },
        select: {
          id: true, name: true, description: true, active: true,
          entries: { where: { reversedAt: null }, select: { kind: true, amountMinor: true, currency: true } },
          stockItems: { where: { active: true }, select: { id: true, name: true, unit: true, onHand: true }, orderBy: { name: "asc" } },
          budgets: { select: { id: true, label: true, amountMinor: true, currency: true } },
        },
        orderBy: { name: "asc" },
      }),
      db.schoolLedgerEntry.findMany({
        where: { schoolId: context.schoolId },
        select: {
          id: true, kind: true, counterpart: true, description: true, amountMinor: true,
          currency: true, occurredOn: true, reference: true, reversedAt: true,
          project: { select: { name: true } },
        },
        orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        take: 100,
      }),
      db.stockMovement.findMany({
        where: { schoolId: context.schoolId },
        select: {
          id: true, kind: true, quantity: true, note: true, occurredOn: true, ledgerEntryId: true, invoiceRef: true,
          supplier: { select: { name: true } },
          item: { select: { name: true, unit: true, project: { select: { name: true } } } },
        },
        orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        take: 50,
      }),
      db.supplier.findMany({ where: { schoolId: context.schoolId, active: true }, select: { id: true, name: true, contact: true, phone: true, email: true }, orderBy: { name: "asc" } }),
      db.paymentProof.findMany({
        where: { schoolId: context.schoolId, status: { in: ["pending", "verified", "rejected"] } },
        select: {
          id: true, studentId: true, amountMinor: true, currency: true, method: true, reference: true, note: true,
          filename: true, status: true, reviewNote: true, createdAt: true,
          student: { select: { firstName: true, lastName: true, admissionNumber: true } },
          guardian: { select: { firstName: true, lastName: true } },
          payment: { select: { receiptNumber: true } },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 100,
      }),
    ]);
    const ledgerTotals = ledger.filter((e) => !e.reversedAt).reduce<Record<string, number>>((acc, e) => {
      const key = `${e.kind}:${e.currency}`;
      acc[key] = (acc[key] ?? 0) + e.amountMinor;
      return acc;
    }, {});

    return Response.json({
      summary, invoices, payments, students, terms, templates, classes, receipt, invoiceItems,
      proofs: proofRows.map((row) => ({
        id: row.id, studentId: row.studentId, amountMinor: row.amountMinor, currency: row.currency,
        method: row.method, reference: row.reference, note: row.note, filename: row.filename,
        status: row.status, reviewNote: row.reviewNote, createdAt: row.createdAt,
        studentName: `${row.student.firstName} ${row.student.lastName}`,
        admissionNumber: row.student.admissionNumber,
        guardianName: `${row.guardian.firstName} ${row.guardian.lastName}`,
        receiptNumber: row.payment?.receiptNumber ?? null,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        active: p.active,
        totals: p.entries.reduce<Record<string, number>>((acc, e) => {
          const key = `${e.kind}:${e.currency}`;
          acc[key] = (acc[key] ?? 0) + e.amountMinor;
          return acc;
        }, {}),
        stockItems: p.stockItems,
        budgets: p.budgets,
      })),
      ledger: ledger.map((e) => ({
        id: e.id,
        kind: e.kind,
        counterpart: e.counterpart,
        description: e.description,
        amountMinor: e.amountMinor,
        currency: e.currency,
        occurredOn: dateOnly(e.occurredOn),
        reference: e.reference,
        reversed: Boolean(e.reversedAt),
        projectName: e.project?.name ?? null,
      })),
      ledgerTotals,
      stockMovements: movements.map((m) => ({
        id: m.id,
        kind: m.kind,
        quantity: m.quantity,
        note: m.note,
        occurredOn: dateOnly(m.occurredOn),
        ledgerEntryId: m.ledgerEntryId,
        itemName: m.item.name,
        unit: m.item.unit,
        projectName: m.item.project.name,
        supplierName: m.supplier?.name ?? null,
        invoiceRef: m.invoiceRef,
      })),
      suppliers,
      school: { name: context.schoolName, code: context.schoolCode, exchangeRateZwgPerUsd: context.exchangeRateZwgPerUsd },
      permissions: { createInvoice: hasPermission(context.role, "finance.invoice"), recordPayment: hasPermission(context.role, "finance.payment"), allocatePayment: hasPermission(context.role, "finance.allocate"), reverseFinance: hasPermission(context.role, "finance.reverse"), reports: hasPermission(context.role, "finance.report"), ledger: hasPermission(context.role, "finance.payment") },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    await guardMutation(request, "finance");
    const context = await getSchoolContext(request);
    const input = financeCommand.parse(await request.json());
    const db = getDb();
    const key = idempotencyKey(request);
    const requestHash = await hashRequest(input.action, input);

    if (input.action === "create_project") {
      requirePermission(context, "finance.invoice");
      const replay = await replayResponse(db, context, input.action, key, requestHash);
      if (replay) return replay;
      const id = crypto.randomUUID();
      return commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
        await tx.incomeProject.create({
          data: { id, schoolId: context.schoolId, name: input.name, description: input.description || null },
        });
        await tx.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: "finance.project_created",
            entityType: "income_project",
            entityId: id,
            details: JSON.stringify({ name: input.name }),
          },
        });
      }, 201, { id });
    }

    if (input.action === "record_ledger") {
      requirePermission(context, "finance.payment");
      const replay = await replayResponse(db, context, input.action, key, requestHash);
      if (replay) return replay;
      const amountMinor = toMinor(input.amount);
      if (input.projectId) {
        const project = await db.incomeProject.findFirst({
          where: { id: input.projectId, schoolId: context.schoolId, active: true },
          select: { id: true },
        });
        if (!project) return Response.json({ error: "Income project not found." }, { status: 404 });
      }
      if (input.kind.startsWith("donation") && !input.counterpart) {
        return Response.json({ error: input.kind === "donation_in" ? "Name the donor." : "Name the recipient." }, { status: 400 });
      }
      const id = crypto.randomUUID();
      return commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
        await tx.schoolLedgerEntry.create({
          data: {
            id, schoolId: context.schoolId, projectId: input.projectId || null,
            kind: input.kind, counterpart: input.counterpart || null,
            description: input.description, amountMinor, currency: input.currency,
            occurredOn: new Date(input.occurredOn), reference: input.reference || null,
          },
        });
        await tx.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: `finance.${input.kind}`,
            entityType: "school_ledger_entry",
            entityId: id,
            details: JSON.stringify({ description: input.description, amountMinor, currency: input.currency, projectId: input.projectId ?? null, counterpart: input.counterpart ?? null }),
          },
        });
      }, 201, { id });
    }

    if (input.action === "reverse_ledger") {


    requirePermission(context, "finance.reverse");
      const entry = await db.schoolLedgerEntry.findFirst({
        where: { id: input.ledgerId, schoolId: context.schoolId, reversedAt: null },
        select: { id: true },
      });
      if (!entry) return Response.json({ error: "Active ledger entry not found." }, { status: 404 });
      await db.$transaction([
        db.schoolLedgerEntry.update({ where: { id: entry.id }, data: { reversedAt: new Date() } }),
        db.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: "finance.ledger_reversed",
            entityType: "school_ledger_entry",
            entityId: entry.id,
            details: JSON.stringify({ reason: input.reason }),
          },
        }),
      ]);
      return Response.json({ updated: true });
    }

    if (input.action === "create_supplier") {
      requirePermission(context, "finance.payment");
      const replay = await replayResponse(db, context, input.action, key, requestHash);
      if (replay) return replay;
      const id = crypto.randomUUID();
      return commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
        await tx.supplier.create({
          data: { id, schoolId: context.schoolId, name: input.name, contact: input.contact || null, phone: input.phone || null, email: input.email || null, notes: input.notes || null },
        });
        await tx.auditLog.create({
          data: { schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "finance.supplier_created", entityType: "supplier", entityId: id, details: JSON.stringify({ name: input.name }) },
        });
      }, 201, { id });
    }

    if (input.action === "set_project_budget") {
      requirePermission(context, "finance.invoice");
      const replay = await replayResponse(db, context, input.action, key, requestHash);
      if (replay) return replay;
      const project = await db.incomeProject.findFirst({
        where: { id: input.projectId, schoolId: context.schoolId },
        select: { id: true, name: true },
      });
      if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
      const amountMinor = toMinor(input.amount);
      return commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
        await tx.projectBudget.upsert({
          where: { projectId_currency: { projectId: project.id, currency: input.currency } },
          create: { id: crypto.randomUUID(), schoolId: context.schoolId, projectId: project.id, label: input.label, amountMinor, currency: input.currency },
          update: { label: input.label, amountMinor },
        });
        await tx.auditLog.create({
          data: { schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "finance.budget_set", entityType: "project_budget", entityId: project.id, details: JSON.stringify({ project: project.name, label: input.label, amountMinor, currency: input.currency }) },
        });
      }, 201, { projectId: project.id });
    }

    if (input.action === "create_stock_item") {
      requirePermission(context, "finance.payment");
      const replay = await replayResponse(db, context, input.action, key, requestHash);
      if (replay) return replay;
      const project = await db.incomeProject.findFirst({
        where: { id: input.projectId, schoolId: context.schoolId, active: true },
        select: { id: true },
      });
      if (!project) return Response.json({ error: "Income project not found." }, { status: 404 });
      const id = crypto.randomUUID();
      return commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
        await tx.projectStockItem.create({
          data: { id, schoolId: context.schoolId, projectId: input.projectId, name: input.name, unit: input.unit, onHand: input.openingQty ?? 0 },
        });
        if (input.openingQty && input.openingQty > 0) {
          await tx.stockMovement.create({
            data: { id: crypto.randomUUID(), schoolId: context.schoolId, itemId: id, kind: "adjustment", quantity: input.openingQty, note: "Opening stock", occurredOn: new Date() },
          });
        }
        await tx.auditLog.create({
          data: { schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "finance.stock_item_created", entityType: "project_stock_item", entityId: id, details: JSON.stringify({ name: input.name, unit: input.unit, openingQty: input.openingQty ?? 0 }) },
        });
      }, 201, { id });
    }

    if (input.action === "record_stock_movement") {
      requirePermission(context, "finance.payment");
      const replay = await replayResponse(db, context, input.action, key, requestHash);
      if (replay) return replay;
      const item = await db.projectStockItem.findFirst({
        where: { id: input.itemId, schoolId: context.schoolId, active: true },
        select: { id: true, name: true, unit: true, onHand: true, projectId: true },
      });
      if (!item) return Response.json({ error: "Stock item not found." }, { status: 404 });
      const sign = input.kind === "purchase" ? 1 : input.kind === "adjustment" ? (input.direction === "in" ? 1 : -1) : -1;
      const nextOnHand = item.onHand + sign * input.quantity;
      if (nextOnHand < 0) {
        return Response.json({ error: `Only ${item.onHand} ${item.unit} of "${item.name}" on hand.` }, { status: 400 });
      }
      const amountMinor = input.amount ? toMinor(input.amount) : null;
      if ((input.supplierId || input.invoiceRef) && input.kind !== "purchase") {
        return Response.json({ error: "Suppliers and invoice references only apply to purchases." }, { status: 400 });
      }
      if (input.supplierId) {
        const supplier = await db.supplier.findFirst({ where: { id: input.supplierId, schoolId: context.schoolId, active: true }, select: { id: true } });
        if (!supplier) return Response.json({ error: "Supplier not found." }, { status: 404 });
      }
      if (amountMinor && (input.kind === "usage" || input.kind === "adjustment")) {
        return Response.json({ error: "Only purchases and sales can carry a money amount." }, { status: 400 });
      }
      const id = crypto.randomUUID();
      return commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
        let ledgerEntryId: string | null = null;
        if (amountMinor) {
          ledgerEntryId = crypto.randomUUID();
          await tx.schoolLedgerEntry.create({
            data: {
              id: ledgerEntryId, schoolId: context.schoolId, projectId: item.projectId,
              kind: input.kind === "sale" ? "income" : "expense",
              description: input.note || `${input.kind === "sale" ? "Sale" : "Purchase"} — ${input.quantity} ${item.unit} ${item.name}`,
              amountMinor, currency: input.currency ?? "USD",
              occurredOn: new Date(input.occurredOn),
            },
          });
        }
        await tx.projectStockItem.update({ where: { id: item.id }, data: { onHand: nextOnHand } });
        await tx.stockMovement.create({
          data: { id, schoolId: context.schoolId, itemId: item.id, kind: input.kind, quantity: sign * input.quantity, note: input.note || null, supplierId: input.supplierId || null, invoiceRef: input.invoiceRef || null, ledgerEntryId, occurredOn: new Date(input.occurredOn) },
        });
        await tx.auditLog.create({
          data: { schoolId: context.schoolId, actorMembershipId: context.membershipId, action: `finance.stock_${input.kind}`, entityType: "stock_movement", entityId: id, details: JSON.stringify({ item: item.name, quantity: input.quantity, sign, amountMinor }) },
        });
      }, 201, { id });
    }

    if (input.action === "create_invoice") {
      requirePermission(context, "finance.invoice");
      const replay = await replayResponse(db, context, input.action, key, requestHash);
      if (replay) return replay;
      if (input.issueDate > input.dueDate) return Response.json({ error: "The due date must be on or after the issue date." }, { status: 400 });
      const studentRow = await db.student.findFirst({
        where: { id: input.studentId, schoolId: context.schoolId, status: "active", archivedAt: null },
        select: { id: true, admissionNumber: true, firstName: true, lastName: true },
      });
      if (!studentRow) return Response.json({ error: "Select an active student in this school." }, { status: 400 });
      const student = { id: studentRow.id, admissionNumber: studentRow.admissionNumber, studentName: `${studentRow.firstName} ${studentRow.lastName}` };
      if (input.termId) {
        const term = await db.term.findFirst({
          where: { id: input.termId, schoolId: context.schoolId },
          select: { id: true },
        });
        if (!term) return Response.json({ error: "The selected term is not in this school." }, { status: 400 });
      }
      const invoiceId = crypto.randomUUID();
      const invoiceNumber = documentNumber("INV", context.schoolCode);
      const lines = input.items.map((item, index) => ({ ...item, id: crypto.randomUUID(), position: index + 1, unitAmountMinor: toMinor(item.unitAmount) }));
      const totalMinor = lines.reduce((total, item) => total + item.unitAmountMinor * item.quantity, 0);
      if (!Number.isSafeInteger(totalMinor)) return Response.json({ error: "The invoice total is too large." }, { status: 400 });
      const body = { invoice: { id: invoiceId, invoiceNumber, totalMinor, currency: input.currency } };
      return commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
        await tx.feeInvoice.create({
          data: {
            id: invoiceId, schoolId: context.schoolId, studentId: input.studentId, termId: input.termId || null,
            invoiceNumber, issueDate: new Date(input.issueDate), dueDate: new Date(input.dueDate),
            currency: input.currency, state: "building", totalMinor, notes: input.notes || null,
            studentNameSnapshot: student.studentName, admissionNumberSnapshot: student.admissionNumber,
            issuerNameSnapshot: context.displayName, createdById: context.membershipId,
          },
        });
        await tx.feeInvoiceItem.createMany({
          data: lines.map((item) => ({
            id: item.id, schoolId: context.schoolId, invoiceId, position: item.position,
            description: item.description, category: item.category, quantity: item.quantity, unitAmountMinor: item.unitAmountMinor,
          })),
        });
        await tx.feeInvoice.updateMany({
          where: { id: invoiceId, schoolId: context.schoolId, state: "building" },
          data: { state: "issued", issuedAt: new Date() },
        });
      }, 201, body);
    }

    if (input.action === "save_fee_template") {
      requirePermission(context, "finance.invoice");
      const replay = await replayResponse(db, context, input.action, key, requestHash);
      if (replay) return replay;
      if (input.gradeLevelId) {
        const grade = await db.gradeLevel.findFirst({
          where: { id: input.gradeLevelId, schoolId: context.schoolId, active: true },
          select: { id: true },
        });
        if (!grade) return Response.json({ error: "The selected grade level is not in this school." }, { status: 400 });
      }
      const lines = input.items.map((item, index) => ({
        position: index + 1, description: item.description, category: item.category,
        quantity: item.quantity, unitAmountMinor: toMinor(item.unitAmount),
      }));
      const existing = await db.feeTemplate.findFirst({
        where: { schoolId: context.schoolId, name: input.name },
        select: { id: true },
      });
      const body = { template: { name: input.name }, updated: Boolean(existing) };
      return commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
        if (existing) {
          await tx.feeTemplate.update({
            where: { id: existing.id },
            data: { description: input.description || null, gradeLevelId: input.gradeLevelId || null, currency: input.currency, items: JSON.stringify(lines), active: true },
          });
        } else {
          await tx.feeTemplate.create({
            data: {
              schoolId: context.schoolId, name: input.name, description: input.description || null,
              gradeLevelId: input.gradeLevelId || null, currency: input.currency, items: JSON.stringify(lines),
            },
          });
        }
        await tx.auditLog.create({
          data: {
            schoolId: context.schoolId, actorMembershipId: context.membershipId,
            action: "finance.fee_template.saved", entityType: "fee_template", entityId: existing?.id ?? input.name,
            details: JSON.stringify({ name: input.name, itemCount: lines.length, currency: input.currency }),
          },
        });
      }, 201, body);
    }

    if (input.action === "issue_class_invoices") {
      requirePermission(context, "finance.invoice");
      const replay = await replayResponse(db, context, input.action, key, requestHash);
      if (replay) return replay;
      if (input.issueDate > input.dueDate) return Response.json({ error: "The due date must be on or after the issue date." }, { status: 400 });
      const classroom = await db.classroom.findFirst({
        where: { id: input.classroomId, schoolId: context.schoolId, active: true },
        select: { id: true, name: true },
      });
      if (!classroom) return Response.json({ error: "Select an active class in this school." }, { status: 400 });
      if (input.termId) {
        const term = await db.term.findFirst({
          where: { id: input.termId, schoolId: context.schoolId },
          select: { id: true },
        });
        if (!term) return Response.json({ error: "The selected term is not in this school." }, { status: 400 });
      }

      let lines: { position: number; description: string; category: string; quantity: number; unitAmountMinor: number }[];
      if (!input.items?.length && !input.templateId) return Response.json({ error: "Choose a fee template or enter invoice items." }, { status: 400 });
      if (input.items?.length) {
        lines = input.items.map((item, index) => ({
          position: index + 1, description: item.description, category: item.category,
          quantity: item.quantity, unitAmountMinor: toMinor(item.unitAmount),
        }));
      } else {
        const template = await db.feeTemplate.findFirst({
          where: { id: input.templateId, schoolId: context.schoolId, active: true },
          select: { items: true },
        });
        if (!template) return Response.json({ error: "The selected fee template was not found." }, { status: 400 });
        lines = JSON.parse(template.items);
      }
      const totalMinor = lines.reduce((total, item) => total + item.unitAmountMinor * item.quantity, 0);
      if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) return Response.json({ error: "The invoice total is too large." }, { status: 400 });

      const classStudents = await db.student.findMany({
        where: { schoolId: context.schoolId, classroomId: classroom.id, status: "active", archivedAt: null },
        select: { id: true, admissionNumber: true, firstName: true, lastName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });
      if (!classStudents.length) return Response.json({ error: "The selected class has no active learners." }, { status: 400 });

      let skipIds = new Set<string>();
      if (input.termId) {
        const existing = await db.feeInvoice.findMany({
          where: {
            schoolId: context.schoolId, termId: input.termId, state: "issued",
            financeReversals: { none: {} },
            studentId: { in: classStudents.map((student) => student.id) },
          },
          select: { studentId: true },
        });
        skipIds = new Set(existing.map((invoice) => invoice.studentId));
      }
      const targets = classStudents.filter((student) => !skipIds.has(student.id));
      if (!targets.length) return Response.json({ error: "Every learner in this class already has an invoice for that term." }, { status: 409 });

      const body = { issued: targets.length, skipped: skipIds.size, totalMinor, currency: input.currency };
      return commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
        for (const student of targets) {
          const invoiceId = crypto.randomUUID();
          await tx.feeInvoice.create({
            data: {
              id: invoiceId, schoolId: context.schoolId, studentId: student.id, termId: input.termId || null,
              invoiceNumber: documentNumber("INV", context.schoolCode), issueDate: new Date(input.issueDate), dueDate: new Date(input.dueDate),
              currency: input.currency, state: "issued", totalMinor, notes: input.notes || null,
              studentNameSnapshot: `${student.firstName} ${student.lastName}`, admissionNumberSnapshot: student.admissionNumber,
              issuerNameSnapshot: context.displayName, createdById: context.membershipId, issuedAt: new Date(),
            },
          });
          await tx.feeInvoiceItem.createMany({
            data: lines.map((item) => ({
              schoolId: context.schoolId, invoiceId, position: item.position,
              description: item.description, category: item.category, quantity: item.quantity, unitAmountMinor: item.unitAmountMinor,
            })),
          });
        }
        await tx.auditLog.create({
          data: {
            schoolId: context.schoolId, actorMembershipId: context.membershipId,
            action: "finance.class_invoices.issued", entityType: "classroom", entityId: classroom.id,
            details: JSON.stringify({ classroom: classroom.name, issued: targets.length, skipped: skipIds.size, termId: input.termId || null, totalMinor, currency: input.currency }),
          },
        });
      }, 201, body);
    }

    if (input.action === "record_payment") {
      requirePermission(context, "finance.payment");
      const replay = await replayResponse(db, context, input.action, key, requestHash);
      if (replay) return replay;
      const studentRow = await db.student.findFirst({
        where: { id: input.studentId, schoolId: context.schoolId, status: "active", archivedAt: null },
        select: { id: true, admissionNumber: true, firstName: true, lastName: true },
      });
      if (!studentRow) return Response.json({ error: "Select an active student in this school." }, { status: 400 });
      const student = { id: studentRow.id, admissionNumber: studentRow.admissionNumber, studentName: `${studentRow.firstName} ${studentRow.lastName}` };
      const amountMinor = toMinor(input.amount);
      // Explicit rate wins; the school's prevailing rate fills in only when the
      // payment and invoice currencies actually differ (checked below).
      let exchangeRate = input.exchangeRate ? Number(input.exchangeRate) : null;
      const paymentCurrency = input.currency;
      const paymentStudentId = input.studentId;
      const paymentPayerName = input.payerName;
      const allocations = input.allocations.map((item) => ({ ...item, amountMinor: toMinor(item.amount) }));
      if (new Set(allocations.map((item) => item.invoiceId)).size !== allocations.length) return Response.json({ error: "Each invoice can appear only once in this payment." }, { status: 400 });
      // Same-currency fast path; cross-currency is checked after conversion below.
      if (!exchangeRate && allocations.reduce((sum, item) => sum + item.amountMinor, 0) > amountMinor) return Response.json({ error: "Allocations cannot exceed the payment amount." }, { status: 400 });
      let invoiceRows: Array<{ id: string; totalMinor: number }> = [];
      if (allocations.length) {
        const rows = await db.feeInvoice.findMany({
          where: { id: { in: allocations.map((item) => item.invoiceId) }, schoolId: context.schoolId },
          select: {
            id: true, studentId: true, currency: true, state: true, totalMinor: true,
            financeReversals: { select: { id: true } },
          },
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const crossCurrency = rows.some((row) => row.currency !== input.currency);
        if (crossCurrency && !exchangeRate) {
          // Prevailing rate: ZiG per USD. ZiG paying a USD bill uses it
          // directly; USD paying a ZiG bill inverts it.
          const prevailing = context.exchangeRateZwgPerUsd ? Number(context.exchangeRateZwgPerUsd) : null;
          if (prevailing) {
            exchangeRate = input.currency === "ZWG" ? prevailing : Math.round((1 / prevailing) * 1e6) / 1e6;
          }
        }
        if (crossCurrency && !exchangeRate) {
          return Response.json({ error: "An exchange rate is required when the payment and invoice currencies differ — set the prevailing rate in school settings or enter one here." }, { status: 400 });
        }
        if (!crossCurrency && exchangeRate) {
          return Response.json({ error: "An exchange rate only applies when the payment and invoice currencies differ." }, { status: 400 });
        }
        if (allocations.some((item) => {
          const row = byId.get(item.invoiceId);
          return !row || row.studentId !== input.studentId || row.state !== "issued" || row.financeReversals.length > 0;
        })) return Response.json({ error: "Every allocation must use an open invoice for the same learner." }, { status: 400 });
        if (crossCurrency && exchangeRate) {
          // Allocations are denominated in each invoice's currency; converted cost must fit the payment.
          const rate = exchangeRate;
          const requiredMinor = allocations.reduce((sum, item) => {
            const row = byId.get(item.invoiceId)!;
            return sum + (row.currency === input.currency ? item.amountMinor : Math.ceil(item.amountMinor * rate));
          }, 0);
          if (requiredMinor > amountMinor + 1) return Response.json({ error: "Allocations exceed the payment amount at the given exchange rate." }, { status: 400 });
        }
        invoiceRows = rows.map((row) => ({ id: row.id, totalMinor: row.totalMinor }));
      }
      const paymentId = crypto.randomUUID();
      const receiptNumber = documentNumber("RCT", context.schoolCode);
      const body = { payment: { id: paymentId, receiptNumber, amountMinor, currency: input.currency } };
      await commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
        if (allocations.length) {
          const invoiceIds = allocations.map((item) => item.invoiceId);
          const reversedTargets = await tx.financeReversal.count({
            where: { schoolId: context.schoolId, invoiceId: { in: invoiceIds } },
          });
          if (reversedTargets > 0) throw new Error("allocation_target_reversed");
          const totals = new Map(invoiceRows.map((row) => [row.id, row.totalMinor]));
          const allocated = await tx.paymentAllocation.groupBy({
            by: ["invoiceId"],
            where: {
              schoolId: context.schoolId, invoiceId: { in: invoiceIds },
              financeReversals: { none: {} },
              payment: { financeReversals: { none: {} } },
            },
            _sum: { amountMinor: true },
          });
          const allocatedByInvoice = new Map(allocated.map((row) => [row.invoiceId, row._sum.amountMinor ?? 0]));
          for (const item of allocations) {
            if (item.amountMinor + (allocatedByInvoice.get(item.invoiceId) ?? 0) > (totals.get(item.invoiceId) ?? 0)) throw new Error("allocation_invoice_exceeded");
          }
        }
        await tx.payment.create({
          data: {
            id: paymentId, schoolId: context.schoolId, studentId: input.studentId, receiptNumber,
            paymentDate: new Date(input.paymentDate), method: input.method, currency: input.currency, amountMinor,
            exchangeRate, reference: input.reference || null, payerNameSnapshot: input.payerName,
            studentNameSnapshot: student.studentName, admissionNumberSnapshot: student.admissionNumber,
            issuerNameSnapshot: context.displayName, recordedById: context.membershipId,
          },
        });
        if (allocations.length) {
          await tx.paymentAllocation.createMany({
            data: allocations.map((item) => ({
              id: crypto.randomUUID(), schoolId: context.schoolId, studentId: input.studentId, currency: input.currency,
              paymentId, invoiceId: item.invoiceId, amountMinor: item.amountMinor, allocatedById: context.membershipId,
            })),
          });
        }
      }, 201, body);
      // Best-effort receipt notice to the guardian — never blocks the payment.
      const payerLabel = paymentCurrency === "ZWG" ? "ZiG" : paymentCurrency;
      const paidAmountLabel = (amountMinor / 100).toFixed(2);
      const rateNote = exchangeRate ? ` Settled at an exchange rate of ${exchangeRate}.` : "";
      try {
        await notifyStudentGuardians(
          db, context, paymentStudentId,
          `Payment received — ${receiptNumber}`,
          `Receipt ${receiptNumber}: ${payerLabel} ${paidAmountLabel} received from ${paymentPayerName} for ${student.studentName} (${student.admissionNumber}).${rateNote} Thank you.`
        );
      } catch {
        // Delivery failures are recorded in the outbox; the payment stands.
      }
      return Response.json(body, { status: 201 });
    }

    if (input.action === "remind_debtors") {
      requirePermission(context, "finance.invoice");
      // Outstanding per learner per currency — issued, non-reversed invoices
      // minus their non-reversed allocations.
      const open = await db.feeInvoice.findMany({
        where: { schoolId: context.schoolId, state: "issued", financeReversals: { none: {} } },
        select: {
          studentId: true, currency: true, totalMinor: true,
          student: { select: { firstName: true, lastName: true } },
          paymentAllocations: { where: { financeReversals: { none: {} } }, select: { amountMinor: true } },
        },
      });
      const owed = new Map<string, { name: string; lines: Map<string, number> }>();
      for (const row of open) {
        const paid = row.paymentAllocations.reduce((sum, a) => sum + a.amountMinor, 0);
        const outstanding = row.totalMinor - paid;
        if (outstanding <= 0) continue;
        const entry = owed.get(row.studentId) ?? { name: `${row.student.firstName} ${row.student.lastName}`, lines: new Map<string, number>() };
        entry.lines.set(row.currency, (entry.lines.get(row.currency) ?? 0) + outstanding);
        owed.set(row.studentId, entry);
      }
      const extra = input.message ? ` ${input.message}` : "";
      for (const [studentId, entry] of owed) {
        const parts = [...entry.lines.entries()].map(([code, minor]) => `${code === "ZWG" ? "ZiG" : code} ${(minor / 100).toFixed(2)}`);
        await notifyStudentGuardians(db, context, studentId, "Fee balance reminder", `${entry.name} has an outstanding balance of ${parts.join(" and ")}. Please settle with the bursar's office to keep the report card accessible.${extra}`);
      }
      await db.auditLog.create({ data: { schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "finance.debtors_reminded", entityType: "school", entityId: context.schoolId, details: JSON.stringify({ count: owed.size }) } });
      return Response.json({ reminded: owed.size });
    }

    if (input.action === "allocate_payment") {
      requirePermission(context, "finance.allocate");
      const replay = await replayResponse(db, context, input.action, key, requestHash);
      if (replay) return replay;
      const payment = await db.payment.findFirst({
        where: { id: input.paymentId, schoolId: context.schoolId, financeReversals: { none: {} } },
        select: { id: true, studentId: true, currency: true, amountMinor: true },
      });
      const invoice = await db.feeInvoice.findFirst({
        where: { id: input.invoiceId, schoolId: context.schoolId, state: "issued", financeReversals: { none: {} } },
        select: { id: true, studentId: true, currency: true, totalMinor: true },
      });
      if (!payment || !invoice || payment.studentId !== invoice.studentId || payment.currency !== invoice.currency) return Response.json({ error: "Payment and invoice must belong to the same learner and currency." }, { status: 400 });
      const allocationId = crypto.randomUUID();
      const amountMinor = toMinor(input.amount);
      const body = { allocation: { id: allocationId, paymentId: payment.id, invoiceId: invoice.id, amountMinor } };
      return commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
        const reversedTargets = await tx.financeReversal.count({
          where: { schoolId: context.schoolId, OR: [{ paymentId: payment.id }, { invoiceId: invoice.id }] },
        });
        if (reversedTargets > 0) throw new Error("allocation_target_reversed");
        const allocatedToPayment = await tx.paymentAllocation.aggregate({
          where: { schoolId: context.schoolId, paymentId: payment.id, financeReversals: { none: {} } },
          _sum: { amountMinor: true },
        });
        if (amountMinor + (allocatedToPayment._sum.amountMinor ?? 0) > payment.amountMinor) throw new Error("allocation_payment_exceeded");
        const allocatedToInvoice = await tx.paymentAllocation.aggregate({
          where: {
            schoolId: context.schoolId, invoiceId: invoice.id,
            financeReversals: { none: {} },
            payment: { financeReversals: { none: {} } },
          },
          _sum: { amountMinor: true },
        });
        if (amountMinor + (allocatedToInvoice._sum.amountMinor ?? 0) > invoice.totalMinor) throw new Error("allocation_invoice_exceeded");
        await tx.paymentAllocation.create({
          data: {
            id: allocationId, schoolId: context.schoolId, studentId: payment.studentId, currency: payment.currency,
            paymentId: payment.id, invoiceId: invoice.id, amountMinor, allocatedById: context.membershipId,
          },
        });
      }, 201, body);
    }

    if (input.action === "review_proof") {
    requirePermission(context, "finance.payment");
    const proof = await db.paymentProof.findFirst({
      where: { id: input.proofId, schoolId: context.schoolId },
      select: {
        id: true, studentId: true, amountMinor: true, currency: true, reference: true, status: true,
        student: { select: { firstName: true, lastName: true } },
      },
    });
    if (!proof) return Response.json({ error: "Proof not found." }, { status: 404 });
    if (proof.status !== "pending") return Response.json({ error: "That proof has already been reviewed." }, { status: 409 });

    if (input.decision === "rejected") {
      await db.$transaction([
        db.paymentProof.update({
          where: { id: proof.id },
          data: { status: "rejected", reviewedById: context.membershipId, reviewedAt: new Date(), reviewNote: input.note || null },
        }),
        db.auditLog.create({
          data: { schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "payment.proof_rejected", entityType: "payment_proof", entityId: proof.id, details: JSON.stringify({ note: input.note ?? null }) },
        }),
      ]);
      const ref = proof.reference ? ` (ref ${proof.reference})` : "";
      await notifyStudentGuardians(db, context, proof.studentId, "Proof of payment not verified", `Your submitted proof of payment${ref} could not be verified${input.note ? `: ${input.note}` : ""}. Please contact the bursar's office.`);
      return Response.json({ reviewed: "rejected" });
    }

    // Verified — optionally link the payment the bursar just recorded.
    let receiptLabel = "";
    if (input.paymentId) {
      const payment = await db.payment.findFirst({
        where: { id: input.paymentId, schoolId: context.schoolId, studentId: proof.studentId },
        select: { id: true, receiptNumber: true },
      });
      if (!payment) return Response.json({ error: "That payment does not belong to this learner." }, { status: 400 });
      receiptLabel = ` Receipt ${payment.receiptNumber}.`;
    }
    await db.$transaction([
      db.paymentProof.update({
        where: { id: proof.id },
        data: { status: "verified", reviewedById: context.membershipId, reviewedAt: new Date(), reviewNote: input.note || null, paymentId: input.paymentId || null },
      }),
      db.auditLog.create({
        data: { schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "payment.proof_verified", entityType: "payment_proof", entityId: proof.id, details: JSON.stringify({ paymentId: input.paymentId ?? null }) },
      }),
    ]);
    const ref = proof.reference ? ` (ref ${proof.reference})` : "";
    const label = proof.currency === "ZWG" ? "ZiG" : proof.currency;
    await notifyStudentGuardians(db, context, proof.studentId, "Proof of payment verified", `Your proof of payment${ref} for ${proof.student.firstName} ${proof.student.lastName} has been verified — ${label} ${(proof.amountMinor / 100).toFixed(2)} has been recorded against the account.${receiptLabel}`);
    return Response.json({ reviewed: "verified" });
    }

    requirePermission(context, "finance.reverse");
    const replay = await replayResponse(db, context, input.action, key, requestHash);
    if (replay) return replay;
    let target: { id: string; currency: string; amountMinor: number; paymentId: string | null } | null = null;
    if (input.targetType === "invoice") {
      const row = await db.feeInvoice.findFirst({
        where: { id: input.targetId, schoolId: context.schoolId, state: "issued" },
        select: { id: true, currency: true, totalMinor: true },
      });
      if (row) target = { id: row.id, currency: row.currency, amountMinor: row.totalMinor, paymentId: null };
    } else if (input.targetType === "payment") {
      const row = await db.payment.findFirst({
        where: { id: input.targetId, schoolId: context.schoolId },
        select: { id: true, currency: true, amountMinor: true },
      });
      if (row) target = { id: row.id, currency: row.currency, amountMinor: row.amountMinor, paymentId: null };
    } else {
      const row = await db.paymentAllocation.findFirst({
        where: { id: input.targetId, schoolId: context.schoolId },
        select: { id: true, currency: true, amountMinor: true, paymentId: true },
      });
      if (row) target = { id: row.id, currency: row.currency, amountMinor: row.amountMinor, paymentId: row.paymentId };
    }
    if (!target) return Response.json({ error: "The finance record was not found." }, { status: 404 });
    const reversalId = crypto.randomUUID();
    const reversalNumber = documentNumber("REV", context.schoolCode);
    const reversalDate = new Date().toISOString().slice(0, 10);
    const body = { reversal: { id: reversalId, reversalNumber, targetType: input.targetType, targetId: target.id } };
    const reversalTarget = target;
    return commitIdempotent(db, context, input.action, key, requestHash, async (tx) => {
      const alreadyReversed = await tx.financeReversal.count({
        where: {
          schoolId: context.schoolId,
          OR: [{ invoiceId: reversalTarget.id }, { paymentId: reversalTarget.id }, { allocationId: reversalTarget.id }],
        },
      });
      if (alreadyReversed > 0) throw new Error("finance_target_already_reversed");
      if (input.targetType === "invoice") {
        const activeAllocations = await tx.paymentAllocation.count({
          where: {
            schoolId: context.schoolId, invoiceId: reversalTarget.id,
            financeReversals: { none: {} },
            payment: { financeReversals: { none: {} } },
          },
        });
        if (activeAllocations > 0) throw new Error("finance_invoice_cannot_be_reversed_with_allocations");
      }
      if (input.targetType === "allocation") {
        const paymentReversed = await tx.financeReversal.count({
          where: { schoolId: context.schoolId, paymentId: reversalTarget.paymentId ?? "" },
        });
        if (paymentReversed > 0) throw new Error("finance_allocation_payment_reversed");
      }
      await tx.financeReversal.create({
        data: {
          id: reversalId, schoolId: context.schoolId, reversalNumber,
          invoiceId: input.targetType === "invoice" ? reversalTarget.id : null,
          paymentId: input.targetType === "payment" ? reversalTarget.id : null,
          allocationId: input.targetType === "allocation" ? reversalTarget.id : null,
          currency: reversalTarget.currency, amountMinor: reversalTarget.amountMinor,
          reason: input.reason, reversalDate: new Date(reversalDate), reversedById: context.membershipId,
        },
      });
    }, 201, body);
  } catch (error) {
    return routeError(error);
  }
}
