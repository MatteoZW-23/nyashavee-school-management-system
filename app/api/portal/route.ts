import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getDb } from "@/db";
import { getSchoolContext, guardMutation, requirePermission } from "@/lib/request-context";
import { clearedStudentIds } from "@/lib/fee-gate";
import { checkPaymentStatus, initiatePayment, isPaynowConfigured } from "@/lib/paynow";
import { notifyOnlinePayment, settleOnlinePayment } from "@/lib/online-payment";

type LinkedStudent = {
  id: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  classroomId: string | null;
  classroomName: string | null;
};

const studentSelect = {
  id: true,
  admissionNumber: true,
  firstName: true,
  lastName: true,
  classroomId: true,
  classroom: { select: { name: true } },
} as const;

function toLinkedStudent(row: {
  id: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  classroomId: string | null;
  classroom: { name: string } | null;
}): LinkedStudent {
  return {
    id: row.id,
    admissionNumber: row.admissionNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    classroomId: row.classroomId,
    classroomName: row.classroom?.name ?? null,
  };
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    const db = getDb();

    let students: LinkedStudent[] = [];
    if (context.role === "parent") {
      requirePermission(context, "portal.parent");
      const rows = await db.student.findMany({
        where: {
          schoolId: context.schoolId,
          archivedAt: null,
          studentGuardians: { some: { guardian: { schoolId: context.schoolId, portalUserId: context.userId } } },
        },
        select: studentSelect,
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      });
      students = rows.map(toLinkedStudent);
    } else {
      return new Response("This portal is available to linked parent accounts.", { status: 403 });
    }

    if (!students.length) {
      return Response.json({
        linked: false,
        role: context.role,
        school: { name: context.schoolName },
        students: [],
        balances: [],
        attendance: [],
        reports: [],
        timetable: [],
        announcements: [],
        events: [],
      });
    }

    const ids = students.map((item) => item.id);
    const classroomIds = [...new Set(students.map((item) => item.classroomId).filter((id): id is string => Boolean(id)))];
    const audience = context.role === "parent" ? "parents" : "students";

    const [invoiceRows, allocationRows, attendanceRows, reportRows, timetableRows, announcementRows, eventRows, assignmentRows, proofRows] = await Promise.all([
      db.feeInvoice.findMany({
        where: { schoolId: context.schoolId, studentId: { in: ids }, state: "issued", financeReversals: { none: {} } },
        select: { studentId: true, currency: true, totalMinor: true },
      }),
      db.paymentAllocation.findMany({
        where: {
          schoolId: context.schoolId,
          studentId: { in: ids },
          financeReversals: { none: {} },
          invoice: { financeReversals: { none: {} } },
          payment: { financeReversals: { none: {} } },
        },
        select: { studentId: true, currency: true, amountMinor: true },
      }),
      db.attendanceEntry.findMany({
        where: { studentId: { in: ids }, register: { schoolId: context.schoolId, status: "submitted" } },
        select: { studentId: true, status: true, register: { select: { registerDate: true, session: true } } },
        orderBy: { register: { registerDate: "desc" } },
        take: 120,
      }),
      db.reportCard.findMany({
        where: { schoolId: context.schoolId, status: "published", studentId: { in: ids } },
        select: {
          id: true,
          studentId: true,
          studentNameSnapshot: true,
          termId: true,
          averagePercent: true,
          descriptorOnly: true,
          promotionStatus: true,
          verificationCode: true,
          publishedAt: true,
          term: { select: { name: true, academicYear: { select: { name: true } } } },
          results: {
            select: { subjectCodeSnapshot: true, subjectNameSnapshot: true, scorePercent: true, caPercent: true, examPercent: true, previousPercent: true, changePercent: true, trend: true, grade: true, remark: true, teacherComment: true },
            orderBy: { subjectCodeSnapshot: "asc" },
          },
        },
        orderBy: { publishedAt: "desc" },
      }),
      classroomIds.length
        ? db.timetableEntry.findMany({
            where: { schoolId: context.schoolId, status: "active", classroomId: { in: classroomIds } },
            select: {
              classroomId: true,
              weekday: true,
              startTime: true,
              endTime: true,
              entryType: true,
              title: true,
              room: true,
              classSubject: { select: { subject: { select: { name: true } } } },
              teacher: { select: { displayName: true } },
            },
            orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
          })
        : Promise.resolve([]),
      db.announcement.findMany({
        where: { schoolId: context.schoolId, status: "published", audience: { in: ["all", audience] } },
        select: { id: true, title: true, body: true, audience: true, channel: true, publishAt: true },
        orderBy: { publishAt: "desc" },
        take: 30,
      }),
      db.schoolEvent.findMany({
        where: { schoolId: context.schoolId, status: "scheduled", audience: { in: ["all", audience] }, endAt: { gte: new Date() } },
        select: { id: true, title: true, category: true, startAt: true, endAt: true, location: true, details: true },
        orderBy: { startAt: "asc" },
        take: 30,
      }),
      // Homework for the learner's classes — published only, dated recently.
      classroomIds.length
        ? db.assignment.findMany({
            where: {
              schoolId: context.schoolId, status: "published",
              classSubject: { classroomId: { in: classroomIds } },
              OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }],
              dueDate: { gte: new Date(Date.now() - 30 * 86400000) },
            },
            select: {
              id: true, title: true, instructions: true, dueDate: true,
              classSubject: { select: { classroomId: true, subject: { select: { name: true } }, teacher: { select: { displayName: true } } } },
            },
            orderBy: { dueDate: "asc" },
            take: 40,
          })
        : Promise.resolve([]),
      // Submitted proofs of payment with their review status.
      db.paymentProof.findMany({
        where: { schoolId: context.schoolId, studentId: { in: ids } },
        select: {
          id: true, studentId: true, amountMinor: true, currency: true, method: true,
          reference: true, status: true, reviewNote: true, createdAt: true,
          payment: { select: { receiptNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    const balances = students.flatMap((student) =>
      ["USD", "ZWG"].map((code) => ({
        studentId: student.id,
        currency: code,
        outstandingMinor:
          invoiceRows.filter((row) => row.studentId === student.id && row.currency === code).reduce((sum, row) => sum + row.totalMinor, 0) -
          allocationRows.filter((row) => row.studentId === student.id && row.currency === code).reduce((sum, row) => sum + row.amountMinor, 0),
      })),
    );

    const clearedIds = clearedStudentIds(ids, balances);

    // Per-term attendance summary — registers carry dates, so entries are
    // bucketed into the term whose range contains the register date.
    const terms = await db.term.findMany({
      where: { schoolId: context.schoolId },
      select: { id: true, name: true, startDate: true, endDate: true, academicYear: { select: { name: true } } },
      orderBy: { startDate: "desc" },
    });
    const attendanceSummary = students.flatMap((student) =>
      terms.map((term) => {
        const rows = attendanceRows.filter(
          (row) => row.studentId === student.id && row.register.registerDate >= term.startDate && row.register.registerDate <= term.endDate,
        );
        const attended = rows.filter((row) => ["present", "late"].includes(row.status)).length;
        return {
          studentId: student.id,
          termId: term.id,
          termName: term.name,
          academicYear: term.academicYear.name,
          sessions: rows.length,
          attended,
          absent: rows.filter((row) => row.status === "absent").length,
          percent: rows.length ? Math.round((attended / rows.length) * 100) : null,
        };
      }).filter((summary) => summary.sessions > 0),
    );

    return Response.json({
      linked: true,
      role: context.role,
      school: { name: context.schoolName, timezone: context.timezone },
      students: students.map((student) => ({ ...student, feesCleared: clearedIds.has(student.id) })),
      balances,
      attendance: attendanceRows.map((row) => ({
        studentId: row.studentId,
        registerDate: row.register.registerDate,
        session: row.register.session,
        status: row.status,
      })),
      reports: reportRows.map((row) => {
        const cleared = clearedIds.has(row.studentId);
        return {
          id: row.id,
          studentId: row.studentId,
          studentName: row.studentNameSnapshot,
          termId: row.termId,
          termName: row.term.name,
          academicYear: row.term.academicYear.name,
          locked: !cleared,
          // Result detail is only exposed when fees are fully cleared — locked
          // reports deliberately omit scores, promotion and verification data.
          descriptorOnly: row.descriptorOnly,
          averagePercent: cleared ? row.averagePercent : null,
          promotionStatus: cleared ? row.promotionStatus : null,
          verificationCode: cleared ? row.verificationCode : null,
          publishedAt: cleared ? row.publishedAt : null,
          subjects: cleared
            ? row.results.map((result) => ({
                subjectCode: result.subjectCodeSnapshot,
                subjectName: result.subjectNameSnapshot,
                scorePercent: result.scorePercent,
                caPercent: result.caPercent,
                examPercent: result.examPercent,
                previousPercent: result.previousPercent,
                changePercent: result.changePercent,
                trend: result.trend,
                grade: result.grade,
                remark: result.remark,
                teacherComment: result.teacherComment,
              }))
            : [],
        };
      }),
      attendanceSummary,
      timetable: timetableRows.map((row) => ({
        classroomId: row.classroomId,
        weekday: row.weekday,
        startTime: row.startTime,
        endTime: row.endTime,
        title: row.classSubject?.subject.name ?? row.title ?? row.entryType,
        room: row.room,
        teacherName: row.teacher?.displayName ?? null,
      })),
      announcements: announcementRows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        audience: row.audience,
        channel: row.channel,
        publishedAt: row.publishAt,
      })),
      events: eventRows,
      assignments: assignmentRows.map((row) => ({
        id: row.id,
        classroomId: row.classSubject.classroomId,
        subject: row.classSubject.subject.name,
        teacherName: row.classSubject.teacher?.displayName ?? null,
        title: row.title,
        instructions: row.instructions,
        dueDate: row.dueDate,
      })),
      proofs: proofRows.map((row) => ({
        id: row.id,
        studentId: row.studentId,
        amountMinor: row.amountMinor,
        currency: row.currency,
        method: row.method,
        reference: row.reference,
        status: row.status,
        reviewNote: row.reviewNote,
        receiptNumber: row.payment?.receiptNumber ?? null,
        createdAt: row.createdAt,
      })),
      onlinePaymentsEnabled: isPaynowConfigured(),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "Your school portal could not be loaded." }, { status: 500 });
  }
}

const money = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/);

// Confirms the caller may act for this learner: parent must be a linked
// guardian, student must own the profile.
async function linkedStudentIds(db: ReturnType<typeof getDb>, context: Awaited<ReturnType<typeof getSchoolContext>>) {
  if (context.role === "parent") {
    requirePermission(context, "portal.parent");
    const rows = await db.student.findMany({
      where: { schoolId: context.schoolId, archivedAt: null, studentGuardians: { some: { guardian: { schoolId: context.schoolId, portalUserId: context.userId } } } },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }
  return new Set<string>();
}

const PROOF_MIMES: Record<string, string[]> = { ".pdf": ["application/pdf"], ".png": ["image/png"], ".jpg": ["image/jpeg"], ".jpeg": ["image/jpeg"], ".webp": ["image/webp"] };
const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const proofsRoot = path.join(process.cwd(), "data", "uploads");

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "proof";
}

export async function POST(request: Request) {
  try {
    await guardMutation(request, "portal");
    const context = await getSchoolContext(request);
    const db = getDb();

    // Parent submits proof of payment — file + claimed amount/reference.
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const input = z.object({
        studentId: z.string().min(1).max(64),
        amount: money,
        currency: z.enum(["USD", "ZWG"]),
        method: z.enum(["cash", "ecocash", "onemoney", "bank_transfer", "pos", "paynow", "card", "other"]).default("bank_transfer"),
        reference: z.string().trim().max(80).optional(),
        note: z.string().trim().max(240).optional(),
      }).parse({
        studentId: form.get("studentId"),
        amount: form.get("amount"),
        currency: form.get("currency"),
        method: form.get("method") || undefined,
        reference: form.get("reference") || undefined,
        note: form.get("note") || undefined,
      });

      const allowed = await linkedStudentIds(db, context);
      if (!allowed.has(input.studentId)) return Response.json({ error: "That learner is not linked to your account." }, { status: 403 });
      const amountMinor = Math.round(Number(input.amount) * 100);
      if (!amountMinor || amountMinor <= 0) return Response.json({ error: "Enter the amount paid." }, { status: 400 });
      if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Attach the proof of payment file." }, { status: 400 });
      const extension = "." + (file.name.split(".").pop() ?? "").toLowerCase();
      const mimes = PROOF_MIMES[extension];
      if (!mimes || !mimes.includes((file.type || "").toLowerCase())) return Response.json({ error: "Upload a PDF or image (PNG, JPG, WEBP)." }, { status: 400 });
      if (file.size > PROOF_MAX_BYTES) return Response.json({ error: "Files must be 5 MB or smaller." }, { status: 400 });

      const guardian = await db.guardian.findFirst({
        where: { schoolId: context.schoolId, portalUserId: context.userId, studentGuardians: { some: { studentId: input.studentId } } },
        select: { id: true },
      });
      if (!guardian) return Response.json({ error: "Your guardian profile was not found." }, { status: 403 });

      const proofId = crypto.randomUUID();
      const storageKey = path.join(context.schoolId, "proofs", `${proofId}-${safeName(file.name)}`);
      const filePath = path.join(proofsRoot, storageKey);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

      await db.$transaction([
        db.paymentProof.create({
          data: {
            id: proofId, schoolId: context.schoolId, studentId: input.studentId, guardianId: guardian.id,
            amountMinor, currency: input.currency, method: input.method,
            reference: input.reference || null, note: input.note || null,
            filename: safeName(file.name), storageKey, contentType: mimes[0], byteSize: file.size,
          },
        }),
        db.auditLog.create({
          data: {
            schoolId: context.schoolId, actorMembershipId: context.membershipId,
            action: "payment.proof_submitted", entityType: "payment_proof", entityId: proofId,
            details: JSON.stringify({ studentId: input.studentId, amountMinor, currency: input.currency, reference: input.reference ?? null }),
          },
        }),
      ]);
      return Response.json({ id: proofId, status: "pending" }, { status: 201 });
    }

    const raw = await request.json();

    if (raw?.action === "pay_online") {
      const input = z.object({
        action: z.literal("pay_online"),
        studentId: z.string().min(1).max(64),
        amount: money,
        currency: z.enum(["USD", "ZWG"]),
      }).parse(raw);
      if (!isPaynowConfigured()) return Response.json({ error: "Online payments are not enabled for this school yet — please pay at the office." }, { status: 503 });

      const allowed = await linkedStudentIds(db, context);
      if (!allowed.has(input.studentId)) return Response.json({ error: "That learner is not linked to your account." }, { status: 403 });

      const amountMinor = Math.round(Number(input.amount) * 100);
      if (!amountMinor || amountMinor <= 0) return Response.json({ error: "Enter the amount to pay." }, { status: 400 });

      // Cap at the learner's total outstanding in this currency.
      const invoices = await db.feeInvoice.findMany({
        where: { schoolId: context.schoolId, studentId: input.studentId, currency: input.currency, state: "issued", financeReversals: { none: {} } },
        select: { totalMinor: true, paymentAllocations: { where: { financeReversals: { none: {} } }, select: { amountMinor: true } } },
      });
      const outstanding = invoices.reduce((sum, invoice) => sum + Math.max(0, invoice.totalMinor - invoice.paymentAllocations.reduce((acc, row) => acc + row.amountMinor, 0)), 0);
      if (amountMinor > outstanding) return Response.json({ error: `The amount exceeds the outstanding balance (${(outstanding / 100).toFixed(2)} ${input.currency}).` }, { status: 400 });

      const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
      const reference = `ONL-${context.schoolCode}-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
      const onlinePayment = await db.onlinePayment.create({
        data: {
          id: crypto.randomUUID(), schoolId: context.schoolId, studentId: input.studentId,
          initiatedById: context.membershipId, reference, amountMinor, currency: input.currency,
        },
      });
      const payer = await db.user.findUnique({ where: { id: context.userId }, select: { email: true } });
      try {
        const init = await initiatePayment({
          reference,
          amount: amountMinor / 100,
          currency: input.currency,
          email: payer?.email ?? "",
          returnUrl: `${base}/?paid=${reference}`,
          resultUrl: `${base}/api/paynow/webhook`,
          info: `School fees — ${reference}`,
        });
        await db.onlinePayment.update({ where: { id: onlinePayment.id }, data: { pollUrl: init.pollUrl } });
        return Response.json({ reference, redirectUrl: init.redirectUrl }, { status: 201 });
      } catch {
        await db.onlinePayment.update({ where: { id: onlinePayment.id }, data: { status: "failed" } });
        return Response.json({ error: "The payment gateway could not start the checkout — try again shortly." }, { status: 502 });
      }
    }

    if (raw?.action === "check_online_payment") {
      const input = z.object({
        action: z.literal("check_online_payment"),
        reference: z.string().min(4).max(64),
      }).parse(raw);
      const record = await db.onlinePayment.findFirst({ where: { schoolId: context.schoolId, reference: input.reference } });
      if (!record) return Response.json({ error: "Payment reference not found." }, { status: 404 });
      const allowed = await linkedStudentIds(db, context);
      if (!allowed.has(record.studentId)) return Response.json({ error: "That payment is not linked to your account." }, { status: 403 });
      if (record.status === "settled") return Response.json({ status: "settled" });
      if (!record.pollUrl) return Response.json({ status: record.status });

      const result = await checkPaymentStatus(record.pollUrl);
      if (result.status.toLowerCase() === "paid") {
        const settled = await settleOnlinePayment(db, record.id, result.paynowReference || null);
        if (!settled.alreadySettled) {
          try { await notifyOnlinePayment(db, context, record.id); } catch { /* notice is best-effort */ }
        }
        return Response.json({ status: "settled" });
      }
      if (["cancelled", "failed", "disputed"].includes(result.status.toLowerCase())) {
        await db.onlinePayment.update({ where: { id: record.id }, data: { status: "failed" } });
        return Response.json({ status: "failed" });
      }
      return Response.json({ status: "pending" });
    }

    return Response.json({ error: "Unknown portal action." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof z.ZodError) return Response.json({ error: "Please check the payment details." }, { status: 400 });
    return Response.json({ error: "The portal action could not be completed." }, { status: 500 });
  }
}
