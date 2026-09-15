import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getDb } from "@/db";
import { getSchoolContext, guardMutation, requirePermission } from "@/lib/request-context";
import { computeTermResults, reportBlockers } from "@/lib/report-engine";
import { notifyMemberships, notifyRole } from "@/lib/notifications";
import { hasPermission } from "@/lib/permissions";

const generate = z.object({ action: z.literal("generate_report"), studentId: z.string().min(1).max(64), termId: z.string().min(1).max(64) });
const comments = z.object({ action: z.literal("save_comments"), reportId: z.string().min(1).max(64), classTeacherComment: z.string().trim().max(1000).optional(), headComment: z.string().trim().max(1000).optional(), promotionStatus: z.enum(["pending", "promoted", "progressed", "repeat", "not_applicable"]) });
const publish = z.object({ action: z.literal("publish_report"), reportId: z.string().min(1).max(64) });
const submitReport = z.object({ action: z.literal("submit_report"), reportId: z.string().min(1).max(64), note: z.string().trim().max(400).optional() });
const reviewReport = z.object({
  action: z.literal("review_report"), reportId: z.string().min(1).max(64),
  step: z.enum(["hod", "head"]), decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(400).optional(),
});
const subjectComment = z.object({ action: z.literal("save_subject_comment"), resultId: z.string().min(1).max(64), comment: z.string().trim().min(2).max(400) });
const command = z.discriminatedUnion("action", [generate, comments, publish, submitReport, reviewReport, subjectComment]);

function isTeacherRole(role: string) { return ["teacher", "class_teacher"].includes(role); }

// Performance-based comment suggestion — always teacher-editable, never auto-saved.
function suggestComment(scorePercent: number, trend: string | null): string {
  if (scorePercent >= 80) return trend === "improving" ? "Excellent and still improving — keep stretching with extension work." : "Consistently strong work — maintains a high standard.";
  if (scorePercent >= 70) return trend === "declining" ? "Good standard but marks are slipping — review recent topics together." : "Good, secure understanding — push for more detail in answers.";
  if (scorePercent >= 60) return trend === "improving" ? "Improving steadily — encourage continued practice." : "Fair effort — accuracy needs more attention.";
  if (scorePercent >= 50) return trend === "declining" ? "Has dropped below earlier performance — needs focused revision." : "Passing but inconsistent — more practice with core skills needed.";
  return "Below the pass mark — requires extra support and regular practice at home.";
}

const NEXT_STATUS: Record<string, string> = { hod: "head_review", head: "approved" };
const APPROVER_ROLE: Record<string, string[]> = {
  hod: ["hod", "deputy_head", "school_admin"],
  head: ["headmaster", "school_admin"],
};

// Record the sign-off event — approver, role, timestamp, version, optional note.
function signOff(db: ReturnType<typeof getDb>, schoolId: string, reportCardId: string, version: number, context: { membershipId: string; displayName: string; role: string }, step: string, action: string, note?: string) {
  return db.reportApproval.create({
    data: {
      id: crypto.randomUUID(), schoolId, reportCardId, step, action,
      actorId: context.membershipId, actorName: context.displayName, role: context.role,
      note: note || null, version,
    },
  });
}

function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please check the report-card details." }, { status: 400 });
  const message = error instanceof Error ? error.message : "";
  if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") || /UNIQUE constraint/i.test(message)) return Response.json({ error: "A report card already exists for this learner and term." }, { status: 409 });
  return Response.json({ error: "The report-card request could not be completed." }, { status: 500 });
}

function audit(db: ReturnType<typeof getDb>, schoolId: string, membershipId: string, action: string, id: string, details: object = {}) {
  return db.auditLog.create({
    data: { id: crypto.randomUUID(), schoolId, actorMembershipId: membershipId, action, entityType: "report_card", entityId: id, details: JSON.stringify(details) },
  });
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "reports.view");
    const db = getDb();
    const url = new URL(request.url);
    const reportId = url.searchParams.get("reportId");
    const teacherScoped = ["teacher", "class_teacher"].includes(context.role);

    const [terms, classrooms, students, reports] = await Promise.all([
      db.term.findMany({
        where: { schoolId: context.schoolId },
        select: { id: true, name: true, academicYearId: true, status: true, academicYear: { select: { name: true } } },
        orderBy: [{ academicYear: { startDate: "desc" } }, { termNumber: "desc" }],
      }),
      db.classroom.findMany({
        where: { schoolId: context.schoolId, active: true, ...(teacherScoped ? { classTeacherId: context.membershipId } : {}) },
        select: { id: true, name: true, academicYearId: true },
        orderBy: { name: "asc" },
      }),
      db.student.findMany({
        where: {
          schoolId: context.schoolId,
          status: "active",
          archivedAt: null,
          classroom: teacherScoped ? { classTeacherId: context.membershipId } : { isNot: null },
        },
        select: { id: true, admissionNumber: true, firstName: true, lastName: true, classroomId: true, classroom: { select: { name: true } } },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      db.reportCard.findMany({
        where: { schoolId: context.schoolId, ...(teacherScoped ? { student: { classroom: { classTeacherId: context.membershipId } } } : {}) },
        select: {
          id: true,
          studentId: true,
          termId: true,
          studentNameSnapshot: true,
          admissionNumberSnapshot: true,
          classroomSnapshot: true,
          status: true,
          averagePercent: true,
          classTeacherComment: true,
          headComment: true,
          promotionStatus: true,
          verificationCode: true,
          publishedAt: true,
          version: true,
          classPosition: true,
          classSize: true,
          returnedNote: true,
          term: { select: { name: true, academicYear: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    const reportRows = reports.map((report) => ({
      id: report.id,
      studentId: report.studentId,
      termId: report.termId,
      studentName: report.studentNameSnapshot,
      admissionNumber: report.admissionNumberSnapshot,
      classroomName: report.classroomSnapshot,
      status: report.status,
      averagePercent: report.averagePercent,
      classTeacherComment: report.classTeacherComment,
      headComment: report.headComment,
      promotionStatus: report.promotionStatus,
      verificationCode: report.verificationCode,
      publishedAt: report.publishedAt,
      version: report.version,
      classPosition: report.classPosition,
      classSize: report.classSize,
      returnedNote: report.returnedNote,
      termName: report.term.name,
      academicYear: report.term.academicYear.name,
    }));

    let detail: unknown = null;
    if (reportId) {
      let report: Record<string, unknown> | null | undefined = reportRows.find((item) => item.id === reportId);
      if (!report) {
        const row = await db.reportCard.findFirst({
          where: { id: reportId, schoolId: context.schoolId, ...(teacherScoped ? { student: { classroom: { classTeacherId: context.membershipId } } } : {}) },
          select: {
            id: true,
            studentId: true,
            termId: true,
            studentNameSnapshot: true,
            admissionNumberSnapshot: true,
            classroomSnapshot: true,
            status: true,
            averagePercent: true,
            classTeacherComment: true,
            headComment: true,
            promotionStatus: true,
            verificationCode: true,
            publishedAt: true,
            version: true,
            classPosition: true,
            classSize: true,
            returnedNote: true,
          },
        });
        report = row
          ? {
              id: row.id,
              studentId: row.studentId,
              termId: row.termId,
              studentName: row.studentNameSnapshot,
              admissionNumber: row.admissionNumberSnapshot,
              classroomName: row.classroomSnapshot,
              status: row.status,
              averagePercent: row.averagePercent,
              classTeacherComment: row.classTeacherComment,
              headComment: row.headComment,
              promotionStatus: row.promotionStatus,
              verificationCode: row.verificationCode,
              publishedAt: row.publishedAt,
              version: row.version,
              classPosition: row.classPosition,
              classSize: row.classSize,
              returnedNote: row.returnedNote,
            }
          : null;
      }
      if (!report) return Response.json({ error: "Report card not found." }, { status: 404 });
      const rows = await db.reportCardResult.findMany({
        where: { reportCardId: reportId, schoolId: context.schoolId },
        select: { id: true, subjectCodeSnapshot: true, subjectNameSnapshot: true, scorePercent: true, caPercent: true, examPercent: true, previousPercent: true, changePercent: true, trend: true, grade: true, remark: true, assessmentCount: true, teacherComment: true },
        orderBy: { subjectNameSnapshot: "asc" },
      });
      const approvals = await db.reportApproval.findMany({
        where: { reportCardId: reportId, schoolId: context.schoolId },
        orderBy: { createdAt: "asc" },
        select: { step: true, action: true, actorName: true, role: true, note: true, version: true, createdAt: true },
      });
      detail = {
        report,
        approvals: approvals.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
        results: rows.map((row) => ({
          id: row.id,
          subjectCode: row.subjectCodeSnapshot,
          subjectName: row.subjectNameSnapshot,
          scorePercent: row.scorePercent,
          caPercent: row.caPercent,
          examPercent: row.examPercent,
          previousPercent: row.previousPercent,
          changePercent: row.changePercent,
          trend: row.trend,
          grade: row.grade,
          remark: row.remark,
          assessmentCount: row.assessmentCount,
          teacherComment: row.teacherComment,
          // Suggestion only — the teacher reviews and edits before saving.
          suggestedComment: suggestComment(row.scorePercent, row.trend),
        })),
      };
    }

    return Response.json({
      terms: terms.map((term) => ({ id: term.id, name: term.name, academicYearId: term.academicYearId, academicYear: term.academicYear.name, status: term.status })),
      classrooms,
      students: students.map((student) => ({
        id: student.id,
        admissionNumber: student.admissionNumber,
        firstName: student.firstName,
        lastName: student.lastName,
        classroomId: student.classroomId,
        classroomName: student.classroom?.name ?? null,
      })),
      reports: reportRows,
      detail,
      school: { name: context.schoolName, code: context.schoolCode },
      permissions: { generate: hasPermission(context.role, "reports.generate"), comment: hasPermission(context.role, "reports.comment"), publish: hasPermission(context.role, "reports.publish") },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await guardMutation(request, "report-cards");
    const context = await getSchoolContext(request);
    const input = command.parse(await request.json());
    const db = getDb();

    if (input.action === "generate_report") {
      requirePermission(context, "reports.generate");
      const [studentRow, term] = await Promise.all([
        db.student.findFirst({
          where: { id: input.studentId, schoolId: context.schoolId, status: "active", archivedAt: null, classroom: { isNot: null } },
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
            classroom: { select: { id: true, name: true, academicYearId: true, classTeacherId: true, gradeLevel: { select: { descriptorOnly: true } } } },
          },
        }),
        db.term.findFirst({
          where: { id: input.termId, schoolId: context.schoolId },
          select: { id: true, academicYearId: true, startDate: true, endDate: true },
        }),
      ]);
      const student = studentRow?.classroom
        ? {
            id: studentRow.id,
            admissionNumber: studentRow.admissionNumber,
            studentName: `${studentRow.firstName} ${studentRow.lastName}`,
            classroomId: studentRow.classroom.id,
            classroomName: studentRow.classroom.name,
            academicYearId: studentRow.classroom.academicYearId,
            classTeacherId: studentRow.classroom.classTeacherId,
            descriptorOnly: Boolean(studentRow.classroom.gradeLevel?.descriptorOnly),
          }
        : null;
      if (!student || !term || student.academicYearId !== term.academicYearId) return Response.json({ error: "Learner and term do not belong to the same academic year." }, { status: 400 });
      if (["teacher", "class_teacher"].includes(context.role) && student.classTeacherId !== context.membershipId) return new Response("Only the assigned class teacher can generate this report.", { status: 403 });
      const [assessmentTotal, assessmentPublished] = await Promise.all([
        db.assessment.count({ where: { schoolId: context.schoolId, termId: term.id, classSubject: { schoolId: context.schoolId, classroomId: student.classroomId } } }),
        db.assessment.count({ where: { schoolId: context.schoolId, termId: term.id, status: "published", classSubject: { schoolId: context.schoolId, classroomId: student.classroomId } } }),
      ]);
      if (!assessmentTotal || assessmentTotal !== assessmentPublished) return Response.json({ error: "Publish every assessment for this class and term before generating reports." }, { status: 409 });
      const computed = await computeTermResults(db, context.schoolId, student.id, student.classroomId, term.id);
      if (computed.missing.length) return Response.json({ error: "This learner is missing one or more published assessment marks.", missing: computed.missing }, { status: 409 });
      const results = computed.results;
      const averagePercent = computed.averagePercent ?? 0;
      const registerScope = { schoolId: context.schoolId, status: "submitted", registerDate: { gte: term.startDate, lte: term.endDate } };
      const [present, absent] = await Promise.all([
        db.attendanceEntry.count({ where: { studentId: student.id, status: { in: ["present", "late"] }, register: registerScope } }),
        db.attendanceEntry.count({ where: { studentId: student.id, status: { in: ["absent", "excused", "sick"] }, register: registerScope } }),
      ]);
      const existing = await db.reportCard.findFirst({
        where: { schoolId: context.schoolId, studentId: student.id, termId: term.id },
        select: { id: true, status: true },
      });
      if (existing?.status === "published") return Response.json({ error: "Published report cards cannot be regenerated." }, { status: 409 });
      const reportId = existing?.id ?? crypto.randomUUID();
      const verificationCode = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
      await db.$transaction(async (tx) => {
        if (existing) {
          await tx.reportCardResult.deleteMany({ where: { reportCardId: reportId, schoolId: context.schoolId } });
          await tx.reportCard.updateMany({
            where: { id: reportId, schoolId: context.schoolId, status: "draft" },
            data: {
              studentNameSnapshot: student.studentName,
              admissionNumberSnapshot: student.admissionNumber,
              classroomSnapshot: student.classroomName,
              averagePercent,
              presentSessions: present,
              absentSessions: absent,
              verificationCode,
              generatedById: context.membershipId,
              descriptorOnly: student.descriptorOnly,
              version: { increment: 1 },
              returnedNote: null,
            },
          });
          await tx.reportApproval.deleteMany({ where: { reportCardId: reportId, schoolId: context.schoolId } });
        } else {
          await tx.reportCard.create({
            data: {
              id: reportId,
              schoolId: context.schoolId,
              studentId: student.id,
              termId: term.id,
              status: "draft",
              promotionStatus: "pending",
              studentNameSnapshot: student.studentName,
              admissionNumberSnapshot: student.admissionNumber,
              classroomSnapshot: student.classroomName,
              averagePercent,
              presentSessions: present,
              absentSessions: absent,
              verificationCode,
              generatedById: context.membershipId,
              descriptorOnly: student.descriptorOnly,
            },
          });
        }
        await tx.reportCardResult.createMany({
          data: results.map((result) => ({
            id: crypto.randomUUID(),
            schoolId: context.schoolId,
            reportCardId: reportId,
            subjectCodeSnapshot: result.subjectCode,
            subjectNameSnapshot: result.subjectName,
            scorePercent: result.scorePercent,
            caPercent: result.caPercent,
            examPercent: result.examPercent,
            previousPercent: result.previousPercent,
            changePercent: result.changePercent,
            trend: result.trend,
            grade: result.grade,
            remark: result.remark ?? "",
            assessmentCount: result.assessmentCount,
          })),
        });
      });
      return Response.json({ reportId }, { status: 201 });
    }

    if (input.action === "save_comments") {
      requirePermission(context, "reports.comment");
      const report = await db.reportCard.findFirst({
        where: { id: input.reportId, schoolId: context.schoolId, student: { classroom: { isNot: null } } },
        select: { id: true, status: true, student: { select: { classroom: { select: { classTeacherId: true } } } } },
      });
      if (!report || !["draft", "returned_for_correction", "head_review", "approved"].includes(report.status)) return Response.json({ error: "This report is already in review and can no longer be edited." }, { status: 409 });
      if (["teacher", "class_teacher"].includes(context.role) && report.student.classroom?.classTeacherId !== context.membershipId) return new Response("Only the assigned class teacher can comment on this report.", { status: 403 });
      const editable = ["draft", "returned_for_correction"].includes(report.status);
      const headStage = ["head_review", "approved"].includes(report.status);
      if (!editable && !(headStage && hasPermission(context.role, "reports.publish"))) {
        return Response.json({ error: "This report is already in review and can no longer be edited." }, { status: 409 });
      }
      await db.reportCard.updateMany({
        where: { id: report.id, schoolId: context.schoolId },
        data: {
          ...(editable ? { classTeacherComment: input.classTeacherComment || null, promotionStatus: input.promotionStatus } : {}),
          ...(hasPermission(context.role, "reports.publish") ? { headComment: input.headComment || null } : {}),
        },
      });
      return Response.json({ updated: true });
    }

    if (input.action === "save_subject_comment") {
      requirePermission(context, "marks.enter");
      const result = await db.reportCardResult.findFirst({
        where: { id: input.resultId, schoolId: context.schoolId },
        select: { id: true, subjectCodeSnapshot: true, reportCard: { select: { id: true, status: true, student: { select: { classroom: { select: { id: true, classTeacherId: true } } } } } } },
      });
      if (!result) return Response.json({ error: "Result row not found." }, { status: 404 });
      if (!["draft", "returned_for_correction"].includes(result.reportCard.status)) {
        return Response.json({ error: "Subject comments can only be edited before the report enters review." }, { status: 409 });
      }
      // Subject teacher (teaches that subject to that class) or the class teacher may comment.
      if (isTeacherRole(context.role)) {
        const teaches = await db.classSubject.findFirst({
          where: {
            schoolId: context.schoolId,
            classroomId: result.reportCard.student.classroom?.id ?? "",
            subject: { code: result.subjectCodeSnapshot },
            OR: [{ teacherId: context.membershipId }, { classroom: { classTeacherId: context.membershipId } }],
          },
          select: { id: true },
        });
        if (!teaches) return new Response("Only the subject or class teacher can comment on this result.", { status: 403 });
      }
      await db.reportCardResult.update({ where: { id: result.id }, data: { teacherComment: input.comment } });
      await audit(db, context.schoolId, context.membershipId, "report.subject_comment", result.reportCard.id, { resultId: result.id });
      return Response.json({ updated: true });
    }

    if (input.action === "submit_report") {
      requirePermission(context, "reports.generate");
      const report = await db.reportCard.findFirst({
        where: { id: input.reportId, schoolId: context.schoolId },
        select: {
          id: true, status: true, version: true, termId: true, classTeacherComment: true,
          student: { select: { id: true, classroomId: true, classroom: { select: { classTeacherId: true } } } },
          results: { select: { subjectNameSnapshot: true, teacherComment: true } },
        },
      });
      if (!report || !["draft", "returned_for_correction"].includes(report.status)) {
        return Response.json({ error: "Only a draft or returned report can be submitted for review." }, { status: 409 });
      }
      if (isTeacherRole(context.role) && report.student.classroom?.classTeacherId !== context.membershipId) {
        return new Response("Only the assigned class teacher can submit this report.", { status: 403 });
      }
      const computed = await computeTermResults(db, context.schoolId, report.student.id, report.student.classroomId!, report.termId);
      const blockers = reportBlockers(computed.missing, report.results, report);
      if (blockers.length) {
        return Response.json({ error: "Report cannot be submitted — items are missing.", missing: blockers }, { status: 409 });
      }
      await db.$transaction([
        db.reportCard.update({ where: { id: report.id }, data: { status: "hod_review", returnedNote: null } }),
        signOff(db, context.schoolId, report.id, report.version, context, "class_teacher", "submitted", input.note),
        audit(db, context.schoolId, context.membershipId, "report.submitted", report.id, { version: report.version }),
      ]);
      notifyRole(db, context.schoolId, ["hod", "school_admin"], "Report awaiting HOD review", "A learner report was submitted by the class teacher and needs departmental review.").catch(() => undefined);
      return Response.json({ submitted: true, status: "hod_review" });
    }

    if (input.action === "review_report") {
      const allowed = APPROVER_ROLE[input.step];
      if (!allowed.includes(context.role)) return new Response("Only " + (input.step === "hod" ? "a head of department" : "the head") + " can review at this step.", { status: 403 });
      const report = await db.reportCard.findFirst({
        where: { id: input.reportId, schoolId: context.schoolId },
        select: {
          id: true, status: true, version: true, termId: true,
          student: { select: { id: true, firstName: true, lastName: true, classroom: { select: { classTeacherId: true } } } },
        },
      });
      const expected = input.step === "hod" ? "hod_review" : "head_review";
      if (!report || report.status !== expected) {
        return Response.json({ error: "This report is not awaiting " + (input.step === "hod" ? "HOD" : "head") + " review." }, { status: 409 });
      }
      const rejecting = input.decision === "reject";
      if (rejecting && !input.note) return Response.json({ error: "A correction note is required when returning a report." }, { status: 400 });
      const next = rejecting ? "returned_for_correction" : NEXT_STATUS[input.step];
      await db.$transaction([
        db.reportCard.update({ where: { id: report.id }, data: { status: next, returnedNote: rejecting ? input.note! : null } }),
        signOff(db, context.schoolId, report.id, report.version, context, input.step, rejecting ? "rejected" : "approved", input.note),
        audit(db, context.schoolId, context.membershipId, "report." + (rejecting ? "returned" : "approved") + "_" + input.step, report.id, { version: report.version, note: input.note }),
      ]);
      const learner = report.student.firstName + " " + report.student.lastName;
      const teacherId = report.student.classroom?.classTeacherId;
      if (rejecting) {
        if (teacherId) notifyMemberships(db, context.schoolId, [teacherId], "Report returned for correction", "The report for " + learner + " was returned: " + input.note).catch(() => undefined);
      } else if (input.step === "hod") {
        notifyRole(db, context.schoolId, ["headmaster", "school_admin"], "Report awaiting head approval", "The report for " + learner + " passed departmental review.").catch(() => undefined);
      }
      return Response.json({ reviewed: true, status: next });
    }

    // publish_report — approved only; sign-off + ranking + guardian notice
    requirePermission(context, "reports.publish");
    const report = await db.reportCard.findFirst({
      where: { id: input.reportId, schoolId: context.schoolId },
      select: {
        id: true, status: true, version: true, termId: true,
        student: { select: { id: true, firstName: true, lastName: true, classroomId: true } },
        _count: { select: { results: true } },
        school: { select: { enableRanking: true } },
      },
    });
    if (!report || report.status !== "approved" || report._count.results === 0) {
      return Response.json({ error: "Only a fully approved report can be published." }, { status: 409 });
    }
    await db.$transaction([
      db.reportCard.updateMany({
        where: { id: report.id, schoolId: context.schoolId, status: "approved" },
        data: { status: "published", publishedAt: new Date(), publishedById: context.membershipId },
      }),
      signOff(db, context.schoolId, report.id, report.version, context, "publish", "published"),
      audit(db, context.schoolId, context.membershipId, "report.published", report.id, { version: report.version }),
    ]);
    // Class position: rank published reports in the same class + term.
    if (report.school.enableRanking && report.student.classroomId) {
      const peers = await db.reportCard.findMany({
        where: {
          schoolId: context.schoolId, termId: report.termId, status: "published",
          student: { classroomId: report.student.classroomId },
        },
        select: { id: true, averagePercent: true },
        orderBy: [{ averagePercent: "desc" }],
      });
      await db.$transaction(peers.map((peer, index) =>
        db.reportCard.update({ where: { id: peer.id }, data: { classPosition: index + 1, classSize: peers.length } })
      ));
    }
    // Guardian notice — best-effort, outbox-tracked.
    try {
      const { notifyStudentGuardians } = await import("@/lib/messaging");
      await notifyStudentGuardians(db, context, report.student.id, "Report card published", "The term report for " + report.student.firstName + " " + report.student.lastName + " has been published and is available in the portal.");
    } catch { /* never block publication */ }
    return Response.json({ published: true });
  } catch (error) {
    return errorResponse(error);
  }
}
