import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getDb } from "@/db";
import { getSchoolContext, guardMutation, requirePermission } from "@/lib/request-context";
import { idempotencyKey, replayIdempotent, requestHash, storeIdempotent } from "@/lib/idempotency";
import { notifyStudentGuardians } from "@/lib/messaging";
import { notifyMemberships } from "@/lib/notifications";
import { componentFor } from "@/lib/report-engine";
import { hasPermission } from "@/lib/permissions";

const createTerm = z.object({
  action: z.literal("create_term"),
  academicYearId: z.string().min(1).max(64),
  name: z.string().trim().min(2).max(40),
  termNumber: z.number().int().min(1).max(3),
  startDate: z.string().date(),
  endDate: z.string().date(),
});
const createYear = z.object({ action: z.literal("create_year"), name: z.string().trim().min(4).max(40), startDate: z.string().date(), endDate: z.string().date() });
const createGrade = z.object({ action: z.literal("create_grade"), name: z.string().trim().min(1).max(60), gradeOrder: z.number().int().min(0).max(30), description: z.string().trim().max(200).optional(), descriptorOnly: z.boolean().optional() });
const createClass = z.object({ action: z.literal("create_class"), academicYearId: z.string().min(1).max(64), gradeLevelId: z.string().min(1).max(64), name: z.string().trim().min(1).max(80), capacity: z.number().int().min(1).max(200), room: z.string().trim().max(60).optional(), classTeacherId: z.string().min(1).max(64).optional() });
const setTermStatus = z.object({ action: z.literal("set_term_status"), termId: z.string().min(1).max(64), status: z.enum(["active", "closed"]) });
const setYearStatus = z.object({ action: z.literal("set_year_status"), yearId: z.string().min(1).max(64), status: z.enum(["active", "planned", "completed"]) });
const createSubject = z.object({
  action: z.literal("create_subject"),
  code: z.string().trim().min(2).max(15).regex(/^[A-Za-z0-9-]+$/),
  name: z.string().trim().min(2).max(100),
  department: z.string().trim().max(80).optional(),
  level: z.enum(["primary", "secondary", "high_school", "all"]),
});
const assignSubject = z.object({
  action: z.literal("assign_subject"),
  classroomId: z.string().min(1).max(64),
  subjectId: z.string().min(1).max(64),
  teacherId: z.string().min(1).max(64).optional(),
});
const createAssessment = z.object({
  action: z.literal("create_assessment"),
  component: z.enum(["ca", "exam"]).optional(),
  termId: z.string().min(1).max(64),
  classSubjectId: z.string().min(1).max(64),
  title: z.string().trim().min(2).max(120),
  assessmentType: z.enum(["assignment", "test", "project", "practical", "midterm", "exam"]),
  maxMarks: z.number().int().min(1).max(1000),
  weightPercent: z.number().int().min(1).max(100),
  dueDate: z.string().date(),
});
const saveMarks = z.object({
  action: z.literal("save_marks"),
  assessmentId: z.string().min(1).max(64),
  marks: z.array(z.object({ studentId: z.string().min(1).max(64), score: z.number().int().min(0).nullable(), comment: z.string().trim().max(300).optional() })).max(150),
});
const publishAssessment = z.object({ action: z.literal("publish_assessment"), assessmentId: z.string().min(1).max(64) });
const createAssignment = z.object({
  action: z.literal("create_assignment"), classSubjectId: z.string().min(1).max(64),
  title: z.string().trim().min(3).max(140), instructions: z.string().trim().max(2000).optional(),
  dueDate: z.string().date(), publishAt: z.string().date().optional(),
});
const closeAssignment = z.object({ action: z.literal("close_assignment"), assignmentId: z.string().min(1).max(64) });
const saveTopic = z.object({
  action: z.literal("save_curriculum_topic"), topicId: z.string().min(1).max(64).optional(),
  classSubjectId: z.string().min(1).max(64), title: z.string().trim().min(3).max(140),
  objectives: z.string().trim().max(1000).optional(), orderIndex: z.number().int().min(0).max(999).optional(),
});
const setTopicStatus = z.object({
  action: z.literal("set_topic_status"), topicId: z.string().min(1).max(64),
  status: z.enum(["not_started", "in_progress", "completed"]),
});
const updateAssessment = z.object({
  action: z.literal("update_assessment"), assessmentId: z.string().min(1).max(64),
  title: z.string().trim().min(2).max(120).optional(),
  assessmentType: z.string().trim().min(2).max(40).optional(),
  component: z.enum(["ca", "exam"]).optional(),
  maxMarks: z.number().int().min(1).max(500).optional(),
  weightPercent: z.number().int().min(1).max(100).optional(),
  dueDate: z.string().date().optional(),
});
const lockTermResults = z.object({ action: z.literal("lock_term_results"), termId: z.string().min(1).max(64), locked: z.boolean() });
const createDepartment = z.object({ action: z.literal("create_department"), name: z.string().trim().min(2).max(80), description: z.string().trim().max(200).optional() });
const assignDepartmentHead = z.object({ action: z.literal("assign_department_head"), departmentId: z.string().min(1).max(64), staffProfileId: z.string().min(1).max(64).nullable() });
const createExamSession = z.object({
  action: z.literal("create_exam_session"),
  termId: z.string().min(1).max(64),
  classroomId: z.string().min(1).max(64),
  subjectId: z.string().min(1).max(64).optional().or(z.literal("")),
  title: z.string().trim().min(2).max(120),
  examDate: z.string().date(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  venue: z.string().trim().max(80).optional(),
  invigilatorId: z.string().min(1).max(64).optional().or(z.literal("")),
  withAssessment: z.boolean().optional(),
});
const generateSeating = z.object({ action: z.literal("generate_exam_seating"), examSessionId: z.string().min(1).max(64) });
const cancelExam = z.object({ action: z.literal("cancel_exam_session"), examSessionId: z.string().min(1).max(64) });
const reopenAssessment = z.object({ action: z.literal("reopen_assessment"), assessmentId: z.string().min(1).max(64), reason: z.string().trim().min(5).max(300) });
const upsertWeighting = z.object({ action: z.literal("upsert_weighting"), subjectId: z.string().min(1).max(64).optional().or(z.literal("")), caPercent: z.number().int().min(0).max(100), examPercent: z.number().int().min(0).max(100) });
const upsertGradingBand = z.object({ action: z.literal("upsert_grading_band"), bandId: z.string().min(1).max(64).optional(), name: z.string().trim().min(1).max(40), minPercent: z.number().int().min(0).max(100), maxPercent: z.number().int().min(0).max(100), grade: z.string().trim().min(1).max(10), remark: z.string().trim().max(120).optional(), isPass: z.boolean().default(true), sortOrder: z.number().int().min(0).max(100) });
const deleteGradingBand = z.object({ action: z.literal("delete_grading_band"), bandId: z.string().min(1).max(64) });
const saveLessonPlan = z.object({ action: z.literal("save_lesson_plan"), planId: z.string().min(1).max(64).optional(), classSubjectId: z.string().min(1).max(64), termId: z.string().min(1).max(64).optional().or(z.literal("")), lessonDate: z.string().date(), topic: z.string().trim().min(2).max(160), objectives: z.string().trim().max(600).optional(), activities: z.string().trim().max(600).optional(), resources: z.string().trim().max(600).optional(), homework: z.string().trim().max(300).optional() });
const completeLessonPlan = z.object({ action: z.literal("complete_lesson_plan"), planId: z.string().min(1).max(64) });
const createStudentNote = z.object({ action: z.literal("create_student_note"), studentId: z.string().min(1).max(64), subjectId: z.string().min(1).max(64).optional().or(z.literal("")), note: z.string().trim().min(2).max(600) });
const markNotificationsRead = z.object({ action: z.literal("mark_notifications_read"), ids: z.array(z.string().min(1).max(64)).max(50).optional() });
const command = z.discriminatedUnion("action", [createYear, createGrade, createClass, createTerm, setTermStatus, setYearStatus, lockTermResults, createSubject, assignSubject, createAssessment, saveMarks, publishAssessment, updateAssessment, createAssignment, closeAssignment, saveTopic, setTopicStatus, reopenAssessment, upsertWeighting, upsertGradingBand, deleteGradingBand, saveLessonPlan, completeLessonPlan, createStudentNote, markNotificationsRead, createDepartment, assignDepartmentHead, createExamSession, generateSeating, cancelExam]);

const INSTRUCTIONAL_ROLES = ["school_admin", "headmaster", "deputy_head", "teacher", "class_teacher", "hod"];

function isTeacherRole(role: string) {
  return ["teacher", "class_teacher"].includes(role);
}

function dateOnly(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function routeError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please check the academic record details." }, { status: 400 });
  const message = error instanceof Error ? error.message : "";
  const uniqueViolation =
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
    message.includes("UNIQUE constraint failed");
  if (uniqueViolation) return Response.json({ error: "That academic record already exists." }, { status: 409 });
  if (message.includes("academic_term_invalid") || message.includes("academic_mark_invalid")) return Response.json({ error: "The academic record conflicts with its dates, roster, or published status." }, { status: 409 });
  return Response.json({ error: "The academic request could not be completed." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "academics.view");
    const db = getDb();
    const assessmentId = new URL(request.url).searchParams.get("assessmentId");
    const teacherScoped = isTeacherRole(context.role);

    // Teachers only see class subjects assigned to them directly, or unassigned
    // class subjects in classrooms where they are the class teacher.
    const teacherScope = {
      OR: [
        { teacherId: context.membershipId },
        { teacherId: null, classroom: { classTeacherId: context.membershipId } },
      ],
    };

    const [years, gradeLevels, terms, subjects, classSubjects, assessments, gradingBands, instructors, departments, classrooms, examSessions, weightingRows, lessonPlans, notifications, unreadNotifications, pendingReports, staffPool] = await Promise.all([
      db.academicYear.findMany({
        where: { schoolId: context.schoolId },
        select: { id: true, name: true, startDate: true, endDate: true, status: true },
        orderBy: { startDate: "desc" },
      }),
      db.gradeLevel.findMany({
        where: { schoolId: context.schoolId, active: true },
        select: { id: true, name: true, gradeOrder: true, description: true, descriptorOnly: true },
        orderBy: { gradeOrder: "asc" },
      }),
      db.term.findMany({
        where: { schoolId: context.schoolId },
        select: {
          id: true,
          name: true,
          termNumber: true,
          startDate: true,
          endDate: true,
          status: true,
          resultsLockedAt: true,
          academicYear: { select: { id: true, name: true } },
        },
        orderBy: [{ academicYear: { startDate: "desc" } }, { termNumber: "asc" }],
      }),
      db.subject.findMany({
        where: { schoolId: context.schoolId, active: true },
        select: { id: true, code: true, name: true, department: true, level: true, active: true },
        orderBy: { name: "asc" },
      }),
      db.classSubject.findMany({
        where: {
          schoolId: context.schoolId,
          active: true,
          ...(teacherScoped ? teacherScope : {}),
        },
        select: {
          id: true,
          classroomId: true,
          subjectId: true,
          teacherId: true,
          classroom: { select: { name: true } },
          subject: { select: { code: true, name: true } },
          teacher: { select: { displayName: true } },
        },
        orderBy: [{ classroom: { name: "asc" } }, { subject: { name: "asc" } }],
      }),
      db.assessment.findMany({
        where: {
          schoolId: context.schoolId,
          ...(teacherScoped ? { classSubject: teacherScope } : {}),
        },
        select: {
          id: true,
          title: true,
          assessmentType: true,
          component: true,
          maxMarks: true,
          weightPercent: true,
          dueDate: true,
          status: true,
          publishedAt: true,
          termId: true,
          classSubjectId: true,
          term: { select: { name: true } },
          classSubject: {
            select: {
              classroom: { select: { name: true } },
              subject: { select: { name: true, code: true } },
            },
          },
          _count: { select: { marks: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.gradingBand.findMany({
        where: { schoolId: context.schoolId },
        select: { id: true, name: true, minPercent: true, maxPercent: true, grade: true, remark: true, isPass: true, sortOrder: true },
        orderBy: [{ name: "asc" }, { sortOrder: "asc" }],
      }),
      db.schoolMembership.findMany({
        where: { schoolId: context.schoolId, active: true, role: { in: INSTRUCTIONAL_ROLES } },
        select: { id: true, displayName: true, role: true },
        orderBy: { displayName: "asc" },
      }),
      db.department.findMany({
        where: { schoolId: context.schoolId, active: true },
        select: {
          id: true,
          name: true,
          description: true,
          head: { select: { id: true, firstName: true, lastName: true, position: true } },
          _count: { select: { staff: true } },
        },
        orderBy: { name: "asc" },
      }),
      db.classroom.findMany({
        where: { schoolId: context.schoolId, active: true },
        select: { id: true, name: true, classTeacherId: true, gradeLevel: { select: { name: true } }, _count: { select: { students: { where: { status: "active", archivedAt: null } } } } },
        orderBy: { name: "asc" },
      }),
      db.examSession.findMany({
        where: { schoolId: context.schoolId },
        select: {
          id: true, title: true, examDate: true, startTime: true, endTime: true, venue: true,
          term: { select: { name: true } },
          classroom: { select: { id: true, name: true } },
          subject: { select: { name: true } },
          invigilator: { select: { id: true, displayName: true } },
          invigilatorId: true,
          assessment: { select: { id: true, status: true } },
          _count: { select: { seats: true } },
        },
        orderBy: [{ examDate: "asc" }, { startTime: "asc" }],
        take: 100,
      }),
      db.reportWeighting.findMany({ where: { schoolId: context.schoolId }, select: { id: true, subjectId: true, caPercent: true, examPercent: true, subject: { select: { name: true } } } }),
      db.lessonPlan.findMany({
        where: { schoolId: context.schoolId, ...(isTeacherRole(context.role) ? { teacherId: context.membershipId } : {}) },
        select: { id: true, classSubjectId: true, lessonDate: true, topic: true, objectives: true, activities: true, resources: true, homework: true, status: true, classSubject: { select: { subject: { select: { name: true } }, classroom: { select: { name: true } } } } },
        orderBy: [{ lessonDate: "desc" }],
        take: 60,
      }),
      db.notification.findMany({
        where: { schoolId: context.schoolId, membershipId: context.membershipId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      db.notification.count({ where: { schoolId: context.schoolId, membershipId: context.membershipId, readAt: null } }),
      db.reportCard.findMany({
        where: { schoolId: context.schoolId, status: { in: ["draft", "returned_for_correction", "hod_review", "head_review", "approved"] } },
        select: {
          id: true, status: true, studentNameSnapshot: true, classroomSnapshot: true, version: true, returnedNote: true,
          student: { select: { classroom: { select: { classTeacherId: true } } } },
          term: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      db.staffProfile.findMany({
        where: { schoolId: context.schoolId, status: "active" },
        select: { id: true, firstName: true, lastName: true, position: true, isSenior: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
    ]);

    let markbook: unknown = null;
    if (assessmentId) {
      const row = await db.assessment.findFirst({
        where: { id: assessmentId, schoolId: context.schoolId },
        select: {
          id: true,
          maxMarks: true,
          status: true,
          dueDate: true,
          classSubject: {
            select: {
              teacherId: true,
              classroom: { select: { id: true, academicYearId: true, classTeacherId: true } },
            },
          },
        },
      });
      if (!row || (teacherScoped && row.classSubject.teacherId !== context.membershipId && !(row.classSubject.teacherId === null && row.classSubject.classroom.classTeacherId === context.membershipId))) {
        throw new Response("The selected assessment is unavailable.", { status: 404 });
      }
      const assessment = {
        id: row.id,
        maxMarks: row.maxMarks,
        status: row.status,
        dueDate: dateOnly(row.dueDate),
        classroomId: row.classSubject.classroom.id,
        academicYearId: row.classSubject.classroom.academicYearId,
        teacherId: row.classSubject.teacherId,
        classTeacherId: row.classSubject.classroom.classTeacherId,
      };
      const enrollments = row.dueDate && assessment.academicYearId
        ? await db.studentEnrollment.findMany({
            where: {
              schoolId: context.schoolId,
              classroomId: assessment.classroomId,
              academicYearId: assessment.academicYearId,
              enrollmentDate: { lte: row.dueDate },
              OR: [{ exitDate: null }, { exitDate: { gte: row.dueDate } }],
              status: { in: ["active", "completed"] },
              student: { archivedAt: null },
            },
            select: {
              student: {
                select: {
                  id: true,
                  admissionNumber: true,
                  firstName: true,
                  lastName: true,
                  assessmentMarks: {
                    where: { assessmentId },
                    select: { score: true, comment: true, status: true },
                    take: 1,
                  },
                },
              },
            },
            orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
          })
        : (await db.student.findMany({
            where: { schoolId: context.schoolId, classroomId: assessment.classroomId, status: "active", archivedAt: null },
            select: {
              id: true,
              admissionNumber: true,
              firstName: true,
              lastName: true,
              assessmentMarks: { where: { assessmentId }, select: { score: true, comment: true, status: true }, take: 1 },
            },
            orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          })).map((student) => ({ student }));
      const enteredScores = enrollments.map((e) => e.student.assessmentMarks[0]?.score).filter((v): v is number => v !== null && v !== undefined);
      markbook = {
        assessment,
        stats: enteredScores.length ? { count: enteredScores.length, average: Math.round(enteredScores.reduce((a,b)=>a+b,0)/enteredScores.length), highest: Math.max(...enteredScores), lowest: Math.min(...enteredScores), passRate: Math.round(enteredScores.filter((x)=>x*100>=50*assessment.maxMarks).length*100/enteredScores.length) } : null,
        students: enrollments.map((enrollment) => ({
          id: enrollment.student.id,
          admissionNumber: enrollment.student.admissionNumber,
          firstName: enrollment.student.firstName,
          lastName: enrollment.student.lastName,
          score: enrollment.student.assessmentMarks[0]?.score ?? null,
          comment: enrollment.student.assessmentMarks[0]?.comment ?? null,
          status: enrollment.student.assessmentMarks[0]?.status ?? null,
        })),
      };
    }

    // Teacher desk: per-subject workload + pipeline items awaiting this user.
    const myClasses = new Set(classrooms.filter((c) => c.classTeacherId === context.membershipId).map((c) => c.id));
    const mySubjects = classSubjects
      .filter((cs) => cs.teacherId === context.membershipId || myClasses.has(cs.classroomId))
      .map((cs) => {
        const rosterSize = classrooms.find((c) => c.id === cs.classroomId)?._count.students ?? 0;
        const subjectAssessments = assessments.filter((a) => a.classSubjectId === cs.id);
        return {
          id: cs.id,
          subjectName: cs.subject.name,
          classroomName: cs.classroom.name,
          studentCount: rosterSize,
          assessments: subjectAssessments.map((a) => ({
            id: a.id, title: a.title, status: a.status,
            marksEntered: a._count.marks, missing: Math.max(0, rosterSize - a._count.marks),
          })),
          missingMarks: subjectAssessments.reduce((sum, a) => sum + Math.max(0, rosterSize - a._count.marks), 0),
        };
      });
    const awaitingReports = pendingReports.filter((r) =>
      (["draft", "returned_for_correction"].includes(r.status) && r.student.classroom?.classTeacherId === context.membershipId) ||
      (r.status === "hod_review" && ["hod", "school_admin", "deputy_head"].includes(context.role)) ||
      (r.status === "head_review" && ["headmaster", "school_admin"].includes(context.role)) ||
      (r.status === "approved" && hasPermission(context.role, "reports.publish"))
    );
    // Per-subject analytics: average %, pass rate, improving/declining counts.
    const mySubjectIds = mySubjects.map((x) => x.id);
    const analyticsRows = mySubjectIds.length
      ? await db.assessmentMark.findMany({
          where: { assessment: { schoolId: context.schoolId, classSubjectId: { in: mySubjectIds }, status: "published" } },
          select: { score: true, studentId: true, student: { select: { firstName: true, lastName: true } }, assessment: { select: { classSubjectId: true, maxMarks: true } } },
          take: 4000,
        })
      : [];
    const analytics = mySubjects.map((sub) => {
      const rows = analyticsRows.filter((r) => r.assessment.classSubjectId === sub.id);
      const percents = rows.map((r) => (r.score * 100) / Math.max(1, r.assessment.maxMarks));
      const average = percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null;
      const passRate = percents.length ? Math.round((percents.filter((p) => p >= 50).length * 100) / percents.length) : null;
      return { subjectName: sub.subjectName, classroomName: sub.classroomName, average, passRate, marked: rows.length };
    });

    // Watch list: learners failing (avg <50) or frequently absent (≥3 absences).
    const watchByStudent = new Map<string, { name: string; scores: number[]; classSubjectId: string }>();
    for (const row of analyticsRows) {
      const entry = watchByStudent.get(row.studentId) ?? { name: `${row.student.firstName} ${row.student.lastName}`, scores: [], classSubjectId: row.assessment.classSubjectId };
      entry.scores.push((row.score * 100) / Math.max(1, row.assessment.maxMarks));
      watchByStudent.set(row.studentId, entry);
    }
    const watchList = [...watchByStudent.values()]
      .map((w) => ({ name: w.name, average: Math.round(w.scores.reduce((a, b) => a + b, 0) / w.scores.length), classSubjectId: w.classSubjectId }))
      .filter((w) => w.average < 50)
      .map((w) => {
        const sub = mySubjects.find((x) => x.id === w.classSubjectId);
        return { name: w.name, issue: "Failing", detail: `${sub?.subjectName ?? "Subject"} · ${sub?.classroomName ?? ""} · avg ${w.average}%` };
      });
    if (myClasses.size) {
      const absenteeRows = await db.attendanceEntry.findMany({
        where: { status: { in: ["absent", "excused", "sick"] }, student: { schoolId: context.schoolId, classroomId: { in: [...myClasses] } }, register: { schoolId: context.schoolId, status: "submitted" } },
        select: { studentId: true, student: { select: { firstName: true, lastName: true } } },
        take: 2000,
      });
      const absentCount = new Map<string, { name: string; count: number }>();
      for (const row of absenteeRows) {
        const entry = absentCount.get(row.studentId) ?? { name: `${row.student.firstName} ${row.student.lastName}`, count: 0 };
        entry.count += 1;
        absentCount.set(row.studentId, entry);
      }
      for (const a of absentCount.values()) {
        if (a.count >= 3) watchList.push({ name: a.name, issue: "Frequently absent", detail: `${a.count} absences recorded` });
      }
    }

    // School-wide analytics for HOD / head / admin / deputy.
    let schoolAnalytics: Array<{ subjectName: string; average: number | null; passRate: number | null; marked: number }> = [];
    if (["hod", "headmaster", "deputy_head", "school_admin"].includes(context.role)) {
      const allMarks = await db.assessmentMark.findMany({
        where: { assessment: { schoolId: context.schoolId, status: "published" } },
        select: { score: true, assessment: { select: { maxMarks: true, classSubject: { select: { subject: { select: { name: true } } } } } } },
        take: 8000,
      });
      const bySubject = new Map<string, number[]>();
      for (const row of allMarks) {
        const name = row.assessment.classSubject.subject.name;
        bySubject.set(name, [...(bySubject.get(name) ?? []), (row.score * 100) / Math.max(1, row.assessment.maxMarks)]);
      }
      schoolAnalytics = [...bySubject.entries()].map(([subjectName, percents]) => ({
        subjectName,
        average: Math.round(percents.reduce((a, b) => a + b, 0) / percents.length),
        passRate: Math.round((percents.filter((p) => p >= 50).length * 100) / percents.length),
        marked: percents.length,
      }));
    }

    // Assignments + curriculum coverage for the teacher's subjects.
    const assignments = mySubjectIds.length
      ? (await db.assignment.findMany({
          where: { schoolId: context.schoolId, classSubjectId: { in: mySubjectIds } },
          orderBy: { dueDate: "asc" },
          take: 100,
        })).map((a) => ({
          id: a.id, classSubjectId: a.classSubjectId, title: a.title,
          dueDate: a.dueDate, status: a.status, instructions: a.instructions ?? "",
        }))
      : [];
    const curriculumTopics = mySubjectIds.length
      ? (await db.curriculumTopic.findMany({
          where: { schoolId: context.schoolId, classSubjectId: { in: mySubjectIds } },
          orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
          take: 300,
        })).map((t) => ({
          id: t.id, classSubjectId: t.classSubjectId, title: t.title,
          objectives: t.objectives ?? "", orderIndex: t.orderIndex, status: t.status,
        }))
      : [];

    const teacherDesk = {
      subjects: mySubjects,
      assignments,
      curriculum: curriculumTopics,
      analytics,
      watchList: watchList.slice(0, 12),
      schoolAnalytics,
      missingMarks: mySubjects.reduce((sum, x) => sum + x.missingMarks, 0),
      upcomingExams: examSessions.filter((e) => myClasses.has(e.classroom.id) || e.invigilatorId === context.membershipId).slice(0, 8).map((e) => ({ id: e.id, title: e.title, examDate: dateOnly(e.examDate), startTime: e.startTime, venue: e.venue, classroomName: e.classroom.name })),
      awaitingReports: awaitingReports.map((r) => ({ id: r.id, studentName: r.studentNameSnapshot, classroomName: r.classroomSnapshot, status: r.status, returnedNote: r.returnedNote, termName: r.term.name })),
      draftLessons: lessonPlans.filter((p) => p.status === "planned").length,
    };

    return Response.json({
      years: years.map((year) => ({ id: year.id, name: year.name, startDate: dateOnly(year.startDate), endDate: dateOnly(year.endDate), status: year.status })),
      gradeLevels,
      terms: terms.map((term) => ({
        id: term.id,
        name: term.name,
        termNumber: term.termNumber,
        startDate: dateOnly(term.startDate),
        endDate: dateOnly(term.endDate),
        status: term.status,
        resultsLockedAt: term.resultsLockedAt?.toISOString() ?? null,
        academicYearId: term.academicYear.id,
        academicYear: term.academicYear.name,
      })),
      subjects: subjects.map((subject) => ({ ...subject, active: subject.active ? 1 : 0 })),
      classSubjects: classSubjects.map((classSubject) => ({
        id: classSubject.id,
        classroomId: classSubject.classroomId,
        classroomName: classSubject.classroom.name,
        subjectId: classSubject.subjectId,
        subjectCode: classSubject.subject.code,
        subjectName: classSubject.subject.name,
        teacherId: classSubject.teacherId,
        teacherName: classSubject.teacher?.displayName ?? null,
      })),
      assessments: assessments.map((assessment) => ({
        id: assessment.id,
        title: assessment.title,
        assessmentType: assessment.assessmentType,
        component: assessment.component,
        maxMarks: assessment.maxMarks,
        weightPercent: assessment.weightPercent,
        dueDate: dateOnly(assessment.dueDate),
        status: assessment.status,
        publishedAt: assessment.publishedAt,
        termId: assessment.termId,
        termName: assessment.term.name,
        classSubjectId: assessment.classSubjectId,
        classroomName: assessment.classSubject.classroom.name,
        subjectName: assessment.classSubject.subject.name,
        subjectCode: assessment.classSubject.subject.code,
        marksEntered: assessment._count.marks,
      })),
      gradingBands: gradingBands.map((band) => ({ ...band, isPass: band.isPass ? 1 : 0 })),
      instructors,
      departments: departments.map((department) => ({
        id: department.id,
        name: department.name,
        description: department.description,
        headStaffProfileId: department.head?.id ?? null,
        headName: department.head ? `${department.head.firstName} ${department.head.lastName}` : null,
        staffCount: department._count.staff,
      })),
      staffPool: staffPool.map((member) => ({
        id: member.id,
        name: `${member.firstName} ${member.lastName}`,
        position: member.position,
        isSenior: member.isSenior,
      })),
      classrooms,
      examSessions: examSessions.map((exam) => ({
        id: exam.id,
        title: exam.title,
        examDate: dateOnly(exam.examDate),
        startTime: exam.startTime,
        endTime: exam.endTime,
        venue: exam.venue,
        termName: exam.term.name,
        classroomName: exam.classroom.name,
        subjectName: exam.subject?.name ?? null,
        invigilatorName: exam.invigilator?.displayName ?? null,
        seated: exam._count.seats,
        assessmentId: exam.assessment?.id ?? null,
        assessmentStatus: exam.assessment?.status ?? null,
      })),
      markbook,
      weightings: weightingRows.map((w) => ({ id: w.id, subjectId: w.subjectId, subjectName: w.subject?.name ?? "All subjects (default)", caPercent: w.caPercent, examPercent: w.examPercent })),
      lessonPlans: lessonPlans.map((p) => ({ id: p.id, classSubjectId: p.classSubjectId, classSubjectName: p.classSubject.subject.name + " · " + p.classSubject.classroom.name, lessonDate: dateOnly(p.lessonDate), topic: p.topic, objectives: p.objectives, activities: p.activities, resources: p.resources, homework: p.homework, status: p.status })),
      notifications: notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, readAt: n.readAt ? n.readAt.toISOString() : null, createdAt: n.createdAt.toISOString() })),
      unreadNotifications,
      teacherDesk,
      permissions: {
        manageStructure: hasPermission(context.role, "academics.manage"),
        manageYears: hasPermission(context.role, "academic-years.manage"),
        manageAssessments: hasPermission(context.role, "assessments.manage"),
        enterMarks: hasPermission(context.role, "marks.enter"),
        publishMarks: hasPermission(context.role, "marks.moderate"),
      },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    await guardMutation(request, "academic");
    const context = await getSchoolContext(request);
    const input = command.parse(await request.json());
    const db = getDb();

    if (input.action === "create_year") {
      requirePermission(context, "academics.manage");
      if (input.startDate >= input.endDate) return Response.json({ error: "Academic year dates must be in order." }, { status: 400 });
      const count = await db.academicYear.count({ where: { schoolId: context.schoolId } });
      const id = crypto.randomUUID(); const status = count ? "planned" : "active";
      await db.academicYear.create({
        data: { id, schoolId: context.schoolId, name: input.name, startDate: new Date(input.startDate), endDate: new Date(input.endDate), status },
      });
      return Response.json({ id, status }, { status: 201 });
    }

    if (input.action === "create_grade") {
      requirePermission(context, "academics.manage");
      const id = crypto.randomUUID();
      await db.gradeLevel.create({
        data: { id, schoolId: context.schoolId, name: input.name, gradeOrder: input.gradeOrder, description: input.description || null, descriptorOnly: Boolean(input.descriptorOnly) },
      });
      return Response.json({ id }, { status: 201 });
    }

    if (input.action === "create_class") {
      requirePermission(context, "academics.manage");
      const [year, grade] = await Promise.all([
        db.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: context.schoolId }, select: { id: true, startDate: true } }),
        db.gradeLevel.findFirst({ where: { id: input.gradeLevelId, schoolId: context.schoolId, active: true }, select: { id: true } }),
      ]);
      if (!year || !grade) return Response.json({ error: "Select an academic year and grade in this school." }, { status: 400 });
      if (input.classTeacherId) {
        const teacher = await db.schoolMembership.findFirst({
          where: { id: input.classTeacherId, schoolId: context.schoolId, active: true, role: { in: INSTRUCTIONAL_ROLES } },
          select: { id: true },
        });
        if (!teacher) return Response.json({ error: "Select an active instructional staff member." }, { status: 400 });
      }
      const id = crypto.randomUUID();
      await db.classroom.create({
        data: {
          id,
          schoolId: context.schoolId,
          name: input.name,
          yearNumber: year.startDate.getUTCFullYear(),
          academicYearId: year.id,
          gradeLevelId: input.gradeLevelId,
          classTeacherId: input.classTeacherId || null,
          room: input.room || null,
          capacity: input.capacity,
        },
      });
      return Response.json({ id }, { status: 201 });
    }

    if (input.action === "create_term") {
      requirePermission(context, "academics.manage");
      const year = await db.academicYear.findFirst({
        where: { id: input.academicYearId, schoolId: context.schoolId },
        select: { id: true, startDate: true, endDate: true },
      });
      if (!year) return Response.json({ error: "Select an academic year in this school." }, { status: 400 });
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);
      if (startDate < year.startDate || endDate > year.endDate || startDate >= endDate) return Response.json({ error: "Term dates must be ordered within the academic year." }, { status: 400 });
      const overlap = await db.term.findFirst({
        where: { schoolId: context.schoolId, academicYearId: input.academicYearId, endDate: { gte: startDate }, startDate: { lte: endDate } },
        select: { id: true },
      });
      if (overlap) return Response.json({ error: "Term dates cannot overlap another term." }, { status: 409 });
      const id = crypto.randomUUID();
      await db.term.create({
        data: { id, schoolId: context.schoolId, academicYearId: input.academicYearId, name: input.name, termNumber: input.termNumber, startDate, endDate, status: "planned" },
      });
      return Response.json({ id }, { status: 201 });
    }

    if (input.action === "set_term_status") {
      requirePermission(context, "academics.manage");
      const term = await db.term.findFirst({
        where: { id: input.termId, schoolId: context.schoolId },
        select: { id: true, status: true },
      });
      if (!term || term.status === "closed") return Response.json({ error: "This term cannot change status." }, { status: 409 });
      if (input.status === "active") {
        const active = await db.term.findFirst({
          where: { schoolId: context.schoolId, status: "active", id: { not: term.id } },
          select: { id: true },
        });
        if (active) return Response.json({ error: "Close the current active term before activating another." }, { status: 409 });
      }
      await db.term.updateMany({
        where: { id: term.id, schoolId: context.schoolId },
        data: { status: input.status },
      });
      return Response.json({ updated: true });
    }

    if (input.action === "lock_term_results") {
      requirePermission(context, "academics.manage");
      const term = await db.term.findFirst({
        where: { id: input.termId, schoolId: context.schoolId },
        select: { id: true, name: true, status: true },
      });
      if (!term) return Response.json({ error: "Term not found." }, { status: 404 });
      if (term.status === "closed" && input.locked === false) {
        return Response.json({ error: "A closed term's results cannot be unlocked." }, { status: 409 });
      }
      await db.$transaction([
        db.term.update({
          where: { id: term.id },
          data: { resultsLockedAt: input.locked ? new Date() : null },
        }),
        db.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: input.locked ? "academic.term_results_locked" : "academic.term_results_unlocked",
            entityType: "term",
            entityId: term.id,
            details: JSON.stringify({ name: term.name }),
          },
        }),
      ]);
      return Response.json({ updated: true });
    }

    if (input.action === "create_department") {
      requirePermission(context, "academics.manage");
      const id = crypto.randomUUID();
      await db.$transaction([
        db.department.create({
          data: { id, schoolId: context.schoolId, name: input.name, description: input.description || null },
        }),
        db.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: "academic.department_created",
            entityType: "department",
            entityId: id,
            details: JSON.stringify({ name: input.name }),
          },
        }),
      ]);
      return Response.json({ id }, { status: 201 });
    }

    if (input.action === "assign_department_head") {
      requirePermission(context, "academics.manage");
      const department = await db.department.findFirst({
        where: { id: input.departmentId, schoolId: context.schoolId },
        select: { id: true, name: true },
      });
      if (!department) return Response.json({ error: "Department not found." }, { status: 404 });
      if (input.staffProfileId) {
        const staff = await db.staffProfile.findFirst({
          where: { id: input.staffProfileId, schoolId: context.schoolId, status: "active" },
          select: { id: true },
        });
        if (!staff) return Response.json({ error: "Active staff member not found." }, { status: 404 });
      }
      await db.$transaction([
        db.department.update({
          where: { id: department.id },
          data: { headStaffProfileId: input.staffProfileId },
        }),
        db.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: "academic.department_head_assigned",
            entityType: "department",
            entityId: department.id,
            details: JSON.stringify({ name: department.name, headStaffProfileId: input.staffProfileId }),
          },
        }),
      ]);
      return Response.json({ updated: true });
    }

    if (input.action === "set_year_status") {
      requirePermission(context, "academic-years.manage");
      const year = await db.academicYear.findFirst({
        where: { id: input.yearId, schoolId: context.schoolId },
        select: { id: true, name: true, status: true, startDate: true },
      });
      if (!year) return Response.json({ error: "Academic year not found." }, { status: 404 });
      if (year.status === "completed" && input.status !== "completed") {
        return Response.json({ error: "A completed academic year cannot be reopened." }, { status: 409 });
      }
      if (input.status !== "active") {
        await db.academicYear.updateMany({
          where: { id: year.id, schoolId: context.schoolId },
          data: { status: input.status },
        });
        return Response.json({ updated: true });
      }

      // Year activation = rollover: confirmed enrolments go live, last year's close, top-grade leavers graduate.
      const result = await db.$transaction(async (tx) => {
        const confirmed = await tx.studentEnrollment.findMany({
          where: { schoolId: context.schoolId, academicYearId: year.id, status: "confirmed" },
          select: { id: true, studentId: true, classroomId: true },
        });
        if (confirmed.length) {
          await tx.studentEnrollment.updateMany({
            where: { id: { in: confirmed.map((e) => e.id) } },
            data: { status: "active" },
          });
          for (const enrollment of confirmed) {
            await tx.student.update({ where: { id: enrollment.studentId }, data: { classroomId: enrollment.classroomId } });
          }
        }

        const priorActive = await tx.studentEnrollment.findMany({
          where: { schoolId: context.schoolId, status: "active", academicYearId: { not: year.id } },
          select: { id: true, studentId: true, gradeLevelId: true },
        });
        if (priorActive.length) {
          await tx.studentEnrollment.updateMany({
            where: { id: { in: priorActive.map((e) => e.id) } },
            data: { status: "completed", exitDate: year.startDate, exitReason: "year_end" },
          });
        }

        const maxGrade = await tx.gradeLevel.aggregate({
          where: { schoolId: context.schoolId, active: true },
          _max: { gradeOrder: true },
        });
        let graduated = 0;
        if (maxGrade._max.gradeOrder != null) {
          const topGradeIds = await tx.gradeLevel
            .findMany({ where: { schoolId: context.schoolId, gradeOrder: maxGrade._max.gradeOrder }, select: { id: true } })
            .then((rows) => rows.map((g) => g.id));
          const graduatingIds = priorActive.filter((e) => topGradeIds.includes(e.gradeLevelId)).map((e) => e.studentId);
          if (graduatingIds.length) {
            const update = await tx.student.updateMany({
              where: { id: { in: graduatingIds }, schoolId: context.schoolId, status: "active" },
              data: { status: "graduated", classroomId: null },
            });
            graduated = update.count;
          }
        }

        await tx.academicYear.updateMany({
          where: { schoolId: context.schoolId, status: "active", id: { not: year.id } },
          data: { status: "completed" },
        });
        await tx.academicYear.update({ where: { id: year.id }, data: { status: "active" } });
        await tx.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: "academic.year.activated",
            entityType: "academic_year",
            entityId: year.id,
            details: JSON.stringify({ year: year.name, enrolled: confirmed.length, completed: priorActive.length, graduated }),
          },
        });
        return { enrolled: confirmed.length, completed: priorActive.length, graduated };
      });
      return Response.json({ updated: true, rollover: result });
    }

    if (input.action === "create_subject") {
      requirePermission(context, "academics.manage");
      const id = crypto.randomUUID();
      await db.subject.create({
        data: { id, schoolId: context.schoolId, code: input.code.toUpperCase(), name: input.name, department: input.department || null, level: input.level },
      });
      return Response.json({ id }, { status: 201 });
    }

    if (input.action === "assign_subject") {
      requirePermission(context, "academics.manage");
      const [classroom, subject] = await Promise.all([
        db.classroom.findFirst({ where: { id: input.classroomId, schoolId: context.schoolId, active: true }, select: { id: true } }),
        db.subject.findFirst({ where: { id: input.subjectId, schoolId: context.schoolId, active: true }, select: { id: true } }),
      ]);
      if (!classroom || !subject) return Response.json({ error: "Select an active class and subject in this school." }, { status: 400 });
      if (input.teacherId) {
        const teacher = await db.schoolMembership.findFirst({
          where: { id: input.teacherId, schoolId: context.schoolId, active: true, role: { in: INSTRUCTIONAL_ROLES } },
          select: { id: true },
        });
        if (!teacher) return Response.json({ error: "The selected teacher is not an active instructional staff member." }, { status: 400 });
      }
      const id = crypto.randomUUID();
      await db.classSubject.create({
        data: { id, schoolId: context.schoolId, classroomId: input.classroomId, subjectId: input.subjectId, teacherId: input.teacherId || null },
      });
      return Response.json({ id }, { status: 201 });
    }

    if (input.action === "create_assessment") {
      requirePermission(context, "assessments.manage");
      const idemKey = idempotencyKey(request);
      const idemHash = requestHash(input);
      const replay = await replayIdempotent(db, context, input.action, idemKey, idemHash);
      if (replay) return replay;
      const access = await db.classSubject.findFirst({
        where: { id: input.classSubjectId, schoolId: context.schoolId, active: true },
        select: {
          id: true,
          teacherId: true,
          classroom: { select: { classTeacherId: true, academicYearId: true } },
        },
      });
      const term = access
        ? await db.term.findFirst({
            where: { id: input.termId, schoolId: context.schoolId },
            select: { academicYearId: true, startDate: true, endDate: true },
          })
        : null;
      if (!access || !term || (isTeacherRole(context.role) && access.teacherId !== context.membershipId && !(access.teacherId === null && access.classroom.classTeacherId === context.membershipId))) return Response.json({ error: "The selected class subject and term are unavailable." }, { status: 403 });
      const dueDate = new Date(input.dueDate);
      if (!access.classroom.academicYearId || access.classroom.academicYearId !== term.academicYearId || dueDate < term.startDate || dueDate > term.endDate) return Response.json({ error: "The assessment date, class and term must belong to the same academic year." }, { status: 400 });
      const weighting = await db.assessment.aggregate({
        where: { schoolId: context.schoolId, termId: input.termId, classSubjectId: input.classSubjectId, status: { not: "cancelled" } },
        _sum: { weightPercent: true },
      });
      if ((weighting._sum.weightPercent ?? 0) + input.weightPercent > 100) return Response.json({ error: "Assessment weights for this subject and term cannot exceed 100%." }, { status: 409 });
      const id = crypto.randomUUID();
      await db.assessment.create({
        data: {
          id,
          schoolId: context.schoolId,
          termId: input.termId,
          classSubjectId: input.classSubjectId,
          title: input.title,
          assessmentType: input.assessmentType,
          component: componentFor(input.assessmentType, input.component),
          maxMarks: input.maxMarks,
          weightPercent: input.weightPercent,
          dueDate,
          createdById: context.membershipId,
        },
      });
      await storeIdempotent(db, context, input.action, idemKey, idemHash, 201, { id });
      return Response.json({ id }, { status: 201 });
    }

    if (input.action === "save_marks") {
      requirePermission(context, "marks.enter");
      const row = await db.assessment.findFirst({
        where: { id: input.assessmentId, schoolId: context.schoolId },
        select: {
          id: true,
          maxMarks: true,
          status: true,
          dueDate: true,
          termId: true,
          term: { select: { resultsLockedAt: true, name: true } },
          classSubject: {
            select: {
              teacherId: true,
              classroom: { select: { id: true, academicYearId: true, classTeacherId: true } },
            },
          },
        },
      });
      if (!row || row.status === "published") return Response.json({ error: "Published assessments cannot be edited." }, { status: 409 });
      if (row.term?.resultsLockedAt) return Response.json({ error: `Results for ${row.term.name} are locked.`, code: "term_locked" }, { status: 409 });
      if (isTeacherRole(context.role) && row.classSubject.teacherId !== context.membershipId && !(row.classSubject.teacherId === null && row.classSubject.classroom.classTeacherId === context.membershipId)) return new Response("You are not assigned to this class subject.", { status: 403 });
      const roster = row.dueDate && row.classSubject.classroom.academicYearId
        ? await db.studentEnrollment.findMany({
            where: {
              schoolId: context.schoolId,
              classroomId: row.classSubject.classroom.id,
              academicYearId: row.classSubject.classroom.academicYearId,
              enrollmentDate: { lte: row.dueDate },
              OR: [{ exitDate: null }, { exitDate: { gte: row.dueDate } }],
              status: { in: ["active", "completed"] },
            },
            select: { studentId: true },
            distinct: ["studentId"],
          })
        : await db.student.findMany({
            where: { schoolId: context.schoolId, classroomId: row.classSubject.classroom.id, status: "active", archivedAt: null },
            select: { id: true },
          }).then((rows) => rows.map((r) => ({ studentId: r.id })));
      const ids = new Set(roster.map((student) => student.studentId));
      if (input.marks.some((mark) => !ids.has(mark.studentId) || (mark.score !== null && mark.score > row.maxMarks)) || new Set(input.marks.map((mark) => mark.studentId)).size !== input.marks.length) return Response.json({ error: "Every mark must belong to the assessment roster and fall within its maximum." }, { status: 400 });
      const beforeRows = await db.assessmentMark.findMany({
        where: { assessmentId: input.assessmentId },
        select: { studentId: true, score: true },
      });
      const before = new Map(beforeRows.map((mark) => [mark.studentId, mark.score]));
      const changes = input.marks.filter((mark) => (before.get(mark.studentId) ?? null) !== mark.score).map((mark) => ({ studentId: mark.studentId, before: before.get(mark.studentId) ?? null, after: mark.score }));
      await db.$transaction(
        input.marks.map((mark) => mark.score === null
          ? db.assessmentMark.deleteMany({ where: { assessmentId: input.assessmentId, studentId: mark.studentId } })
          : db.assessmentMark.upsert({
              where: { assessmentId_studentId: { assessmentId: input.assessmentId, studentId: mark.studentId } },
              create: { assessmentId: input.assessmentId, studentId: mark.studentId, score: mark.score, comment: mark.comment || null, enteredById: context.membershipId },
              update: { score: mark.score, comment: mark.comment || null, enteredById: context.membershipId },
            })),
      );
      // Mark-change audit: who changed what, before -> after.
      if (changes.length) {
        await db.auditLog.create({
          data: {
            id: crypto.randomUUID(), schoolId: context.schoolId, actorMembershipId: context.membershipId,
            action: "academic.marks_saved", entityType: "assessment", entityId: input.assessmentId,
            details: JSON.stringify({ changed: changes.length, marks: changes.slice(0, 50) }),
          },
        });
      }
      // If marks changed for learners whose reports are already in review,
      // invalidate those approvals: revert to draft, bump version, clear sign-offs.
      const affectedStudentIds = changes.map((c) => c.studentId);
      if (affectedStudentIds.length) {
        const termReports = await db.reportCard.findMany({
          where: {
            schoolId: context.schoolId,
            studentId: { in: affectedStudentIds },
            termId: row.termId ?? "",
            status: { in: ["submitted", "hod_review", "head_review", "approved"] },
          },
          select: { id: true, studentId: true },
        });
        if (termReports.length) {
          await db.$transaction([
            db.reportCard.updateMany({
              where: { id: { in: termReports.map((r) => r.id) } },
              data: { status: "draft", version: { increment: 1 }, returnedNote: "Marks were corrected after review — please re-check and resubmit." },
            }),
            db.reportApproval.deleteMany({ where: { reportCardId: { in: termReports.map((r) => r.id) }, schoolId: context.schoolId } }),
          ]);
          const teacherIds = await db.classroom.findMany({
            where: { students: { some: { id: { in: termReports.map((r) => r.studentId) } } } },
            select: { classTeacherId: true },
          });
          notifyMemberships(db, context.schoolId, teacherIds.map((c) => c.classTeacherId).filter(Boolean) as string[], "Reports reverted to draft", "Marks were corrected after review — affected reports need re-submission.").catch(() => undefined);
        }
      }
      return Response.json({ saved: changes.length });
    }

    if (input.action === "update_assessment") {
      requirePermission(context, "marks.enter");
      const target = await db.assessment.findFirst({
        where: { id: input.assessmentId, schoolId: context.schoolId },
        select: { id: true, status: true, title: true, classSubject: { select: { teacherId: true, classroom: { select: { classTeacherId: true } } } } },
      });
      if (!target || target.status !== "draft") return Response.json({ error: "Only draft assessments can be edited." }, { status: 409 });
      if (isTeacherRole(context.role) && target.classSubject.teacherId !== context.membershipId && target.classSubject.classroom.classTeacherId !== context.membershipId) {
        return new Response("You are not assigned to this class subject.", { status: 403 });
      }
      await db.assessment.update({
        where: { id: target.id },
        data: {
          ...(input.title ? { title: input.title } : {}),
          ...(input.assessmentType ? { assessmentType: input.assessmentType } : {}),
          ...(input.component ? { component: input.component } : {}),
          ...(input.maxMarks ? { maxMarks: input.maxMarks } : {}),
          ...(input.weightPercent ? { weightPercent: input.weightPercent } : {}),
          ...(input.dueDate ? { dueDate: new Date(input.dueDate) } : {}),
        },
      });
      await db.auditLog.create({ data: { id: crypto.randomUUID(), schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "academic.assessment_updated", entityType: "assessment", entityId: target.id, details: JSON.stringify({ title: input.title ?? target.title }) } });
      return Response.json({ updated: true });
    }

    if (input.action === "create_assignment" || input.action === "close_assignment" || input.action === "save_curriculum_topic" || input.action === "set_topic_status") {
      requirePermission(context, input.action.startsWith("set_topic") || input.action === "save_curriculum_topic" ? "curriculum.manage" : "assignments.manage");
      // Scope to the teacher's own class subjects.
      const targetClassSubjectId = input.action === "create_assignment" || input.action === "save_curriculum_topic" ? input.classSubjectId : undefined;
      const targetRowId = input.action === "close_assignment" ? input.assignmentId : (input.action === "set_topic_status" || input.action === "save_curriculum_topic") ? input.topicId : undefined;
      const scoped = await db.classSubject.findFirst({
        where: {
          schoolId: context.schoolId,
          ...(targetClassSubjectId ? { id: targetClassSubjectId } : {}),
          ...(input.action === "close_assignment" ? { assignments: { some: { id: targetRowId } } } : {}),
          ...(input.action === "set_topic_status" || (input.action === "save_curriculum_topic" && input.topicId) ? { curriculumTopics: { some: { id: targetRowId } } } : {}),
          ...(isTeacherRole(context.role) ? { OR: [{ teacherId: context.membershipId }, { classroom: { classTeacherId: context.membershipId } }] } : {}),
        },
        select: { id: true },
      });
      if (!scoped) return new Response("You are not assigned to this class subject.", { status: 403 });

      if (input.action === "create_assignment") {
        const id = crypto.randomUUID();
        await db.assignment.create({
          data: {
            id, schoolId: context.schoolId, classSubjectId: input.classSubjectId,
            title: input.title, instructions: input.instructions || null,
            dueDate: new Date(input.dueDate), publishAt: input.publishAt ? new Date(input.publishAt) : null,
            createdById: context.membershipId,
          },
        });
        await db.auditLog.create({ data: { id: crypto.randomUUID(), schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "academic.assignment_created", entityType: "assignment", entityId: id, details: JSON.stringify({ title: input.title }) } });
        return Response.json({ id }, { status: 201 });
      }
      if (input.action === "close_assignment") {
        await db.assignment.updateMany({ where: { id: input.assignmentId, schoolId: context.schoolId, status: "published" }, data: { status: "closed" } });
        return Response.json({ updated: true });
      }
      if (input.action === "save_curriculum_topic") {
        if (input.topicId) {
          await db.curriculumTopic.update({ where: { id: input.topicId }, data: { title: input.title, objectives: input.objectives || null, ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}) } });
          return Response.json({ id: input.topicId });
        }
        const id = crypto.randomUUID();
        await db.curriculumTopic.create({
          data: { id, schoolId: context.schoolId, classSubjectId: input.classSubjectId, title: input.title, objectives: input.objectives || null, orderIndex: input.orderIndex ?? 0 },
        });
        return Response.json({ id }, { status: 201 });
      }
      await db.curriculumTopic.update({
        where: { id: input.topicId },
        data: { status: input.status, completedAt: input.status === "completed" ? new Date() : null },
      });
      return Response.json({ updated: true });
    }

    if (input.action === "reopen_assessment") {
      requirePermission(context, "marks.moderate");
      const assessment = await db.assessment.findFirst({
        where: { id: input.assessmentId, schoolId: context.schoolId },
        select: { id: true, status: true, term: { select: { resultsLockedAt: true, name: true } } },
      });
      if (!assessment || assessment.status !== "published") return Response.json({ error: "Only a published assessment can be reopened." }, { status: 409 });
      if (assessment.term?.resultsLockedAt) return Response.json({ error: "Results for " + assessment.term.name + " are locked.", code: "term_locked" }, { status: 409 });
      await db.$transaction([
        db.assessment.update({ where: { id: assessment.id }, data: { status: "draft", publishedAt: null } }),
        db.auditLog.create({
          data: { id: crypto.randomUUID(), schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "academic.assessment_reopened", entityType: "assessment", entityId: assessment.id, details: JSON.stringify({ reason: input.reason }) },
        }),
      ]);
      return Response.json({ reopened: true });
    }

    if (input.action === "upsert_weighting") {
      requirePermission(context, "academics.manage");
      if (input.caPercent + input.examPercent !== 100) return Response.json({ error: "Continuous assessment and examination weights must total 100%." }, { status: 400 });
      const subjectId = input.subjectId || null;
      if (subjectId) {
        const subject = await db.subject.findFirst({ where: { id: subjectId, schoolId: context.schoolId }, select: { id: true } });
        if (!subject) return Response.json({ error: "Subject not found." }, { status: 404 });
      }
      const existing = await db.reportWeighting.findFirst({ where: { schoolId: context.schoolId, subjectId } });
      if (existing) {
        await db.reportWeighting.update({ where: { id: existing.id }, data: { caPercent: input.caPercent, examPercent: input.examPercent } });
      } else {
        await db.reportWeighting.create({ data: { id: crypto.randomUUID(), schoolId: context.schoolId, subjectId, caPercent: input.caPercent, examPercent: input.examPercent } });
      }
      await db.auditLog.create({ data: { id: crypto.randomUUID(), schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "academic.weighting_updated", entityType: "report_weighting", entityId: subjectId ?? "default", details: JSON.stringify({ caPercent: input.caPercent, examPercent: input.examPercent }) } });
      return Response.json({ saved: true });
    }

    if (input.action === "upsert_grading_band") {
      requirePermission(context, "academics.manage");
      if (input.minPercent > input.maxPercent) return Response.json({ error: "The minimum percent cannot exceed the maximum." }, { status: 400 });
      const data = { name: input.name, minPercent: input.minPercent, maxPercent: input.maxPercent, grade: input.grade, remark: input.remark || null, isPass: input.isPass, sortOrder: input.sortOrder };
      if (input.bandId) {
        const band = await db.gradingBand.findFirst({ where: { id: input.bandId, schoolId: context.schoolId }, select: { id: true } });
        if (!band) return Response.json({ error: "Grading band not found." }, { status: 404 });
        await db.gradingBand.update({ where: { id: band.id }, data });
      } else {
        await db.gradingBand.create({ data: { id: crypto.randomUUID(), schoolId: context.schoolId, ...data } });
      }
      await db.auditLog.create({ data: { id: crypto.randomUUID(), schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "academic.grading_updated", entityType: "grading_band", entityId: input.bandId ?? "new", details: JSON.stringify(data) } });
      return Response.json({ saved: true });
    }

    if (input.action === "delete_grading_band") {
      requirePermission(context, "academics.manage");
      const band = await db.gradingBand.findFirst({ where: { id: input.bandId, schoolId: context.schoolId }, select: { id: true } });
      if (!band) return Response.json({ error: "Grading band not found." }, { status: 404 });
      await db.gradingBand.delete({ where: { id: band.id } });
      return Response.json({ deleted: true });
    }

    if (input.action === "save_lesson_plan") {
      requirePermission(context, "academics.view");
      const offering = await db.classSubject.findFirst({
        where: { id: input.classSubjectId, schoolId: context.schoolId, active: true },
        select: { id: true, teacherId: true, classroom: { select: { classTeacherId: true } } },
      });
      if (!offering) return Response.json({ error: "Class subject not found." }, { status: 404 });
      if (isTeacherRole(context.role) && offering.teacherId !== context.membershipId && offering.classroom.classTeacherId !== context.membershipId) {
        return new Response("You are not assigned to this class subject.", { status: 403 });
      }
      const data = {
        classSubjectId: input.classSubjectId,
        termId: input.termId || null,
        lessonDate: new Date(input.lessonDate),
        topic: input.topic,
        objectives: input.objectives || null,
        activities: input.activities || null,
        resources: input.resources || null,
        homework: input.homework || null,
      };
      if (input.planId) {
        const plan = await db.lessonPlan.findFirst({ where: { id: input.planId, schoolId: context.schoolId, teacherId: context.membershipId }, select: { id: true } });
        if (!plan) return Response.json({ error: "Lesson plan not found." }, { status: 404 });
        await db.lessonPlan.update({ where: { id: plan.id }, data });
      } else {
        await db.lessonPlan.create({ data: { id: crypto.randomUUID(), schoolId: context.schoolId, teacherId: context.membershipId, ...data } });
      }
      return Response.json({ saved: true });
    }

    if (input.action === "complete_lesson_plan") {
      const plan = await db.lessonPlan.findFirst({ where: { id: input.planId, schoolId: context.schoolId }, select: { id: true, teacherId: true, status: true } });
      if (!plan) return Response.json({ error: "Lesson plan not found." }, { status: 404 });
      if (isTeacherRole(context.role) && plan.teacherId !== context.membershipId) return new Response("Only the plan's teacher can mark it delivered.", { status: 403 });
      await db.lessonPlan.update({ where: { id: plan.id }, data: { status: "delivered", completedAt: new Date() } });
      return Response.json({ completed: true });
    }

    if (input.action === "create_student_note") {
      requirePermission(context, "academics.view");
      const student = await db.student.findFirst({ where: { id: input.studentId, schoolId: context.schoolId, archivedAt: null }, select: { id: true } });
      if (!student) return Response.json({ error: "Student not found." }, { status: 404 });
      const id = crypto.randomUUID();
      await db.studentNote.create({
        data: { id, schoolId: context.schoolId, studentId: input.studentId, subjectId: input.subjectId || null, authorId: context.membershipId, note: input.note },
      });
      await db.auditLog.create({ data: { id: crypto.randomUUID(), schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "academic.student_note", entityType: "student_note", entityId: id, details: JSON.stringify({ studentId: input.studentId }) } });
      return Response.json({ id }, { status: 201 });
    }

    if (input.action === "mark_notifications_read") {
      await db.notification.updateMany({
        where: { schoolId: context.schoolId, membershipId: context.membershipId, readAt: null, ...(input.ids?.length ? { id: { in: input.ids } } : {}) },
        data: { readAt: new Date() },
      });
      return Response.json({ read: true });
    }

    if (input.action === "publish_assessment") {
    // Teachers submit their own assessments; HODs/admins can publish any.
    requirePermission(context, "marks.enter");
    const assessment = await db.assessment.findFirst({
      where: { id: input.assessmentId, schoolId: context.schoolId },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        term: { select: { resultsLockedAt: true, name: true } },
        classSubject: {
          select: {
            teacherId: true,
            classroom: { select: { id: true, academicYearId: true, classTeacherId: true } },
          },
        },
        _count: { select: { marks: true } },
      },
    });
    if (!hasPermission(context.role, "marks.moderate") && isTeacherRole(context.role) && assessment?.classSubject.teacherId !== context.membershipId && assessment?.classSubject.classroom.classTeacherId !== context.membershipId) {
      return new Response("You can only submit assessments you teach.", { status: 403 });
    }
    if (!assessment || assessment.status !== "draft") return Response.json({ error: "Only a draft assessment can be published." }, { status: 409 });
    if (assessment.term?.resultsLockedAt) return Response.json({ error: `Results for ${assessment.term.name} are locked.`, code: "term_locked" }, { status: 409 });
    const rosterCount = assessment.dueDate && assessment.classSubject.classroom.academicYearId
      ? (await db.studentEnrollment.findMany({
          where: {
            schoolId: context.schoolId,
            classroomId: assessment.classSubject.classroom.id,
            academicYearId: assessment.classSubject.classroom.academicYearId,
            enrollmentDate: { lte: assessment.dueDate },
            OR: [{ exitDate: null }, { exitDate: { gte: assessment.dueDate } }],
            status: { in: ["active", "completed"] },
          },
          select: { studentId: true },
          distinct: ["studentId"],
        })).length
      : await db.student.count({
          where: { schoolId: context.schoolId, classroomId: assessment.classSubject.classroom.id, status: "active", archivedAt: null },
        });
    const markCount = assessment._count.marks;
    if (rosterCount === 0 || markCount !== rosterCount) return Response.json({ error: `Enter a mark for every learner before publishing (${markCount}/${rosterCount}).` }, { status: 409 });
    await db.assessment.updateMany({
      where: { id: input.assessmentId, schoolId: context.schoolId, status: "draft" },
      data: { status: "published", publishedAt: new Date() },
    });
    // In-app notice: class teacher sees the marks are in; HODs see submission progress.
    try {
      const ctId = assessment.classSubject.classroom.classTeacherId;
      if (ctId && ctId !== context.membershipId) {
        await notifyMemberships(db, context.schoolId, [ctId], "Marks submitted", `Marks for "${assessment.title ?? "assessment"}" were submitted and are ready for report preparation.`).catch(() => undefined);
      }
    } catch { /* best-effort */ }
    // Best-effort guardian notice for every learner in the class.
    try {
      const roster = await db.student.findMany({
        where: { schoolId: context.schoolId, classroomId: assessment.classSubject.classroom.id, status: "active", archivedAt: null },
        select: { id: true },
      });
      for (const learner of roster) {
        await notifyStudentGuardians(
          db, context, learner.id,
          "Assessment results published",
          `Results for "${assessment.title ?? "assessment"}" have been published. Report cards and marks are now available in the portal for learners whose fees are up to date.`
        ).catch(() => undefined);
      }
    } catch {
      // Notification failures never block publishing.
    }
    return Response.json({ published: true });
    }

    if (input.action === "create_exam_session") {
      requirePermission(context, "academics.manage");
      const idemKey = idempotencyKey(request);
      const idemHash = requestHash(input);
      const replay = await replayIdempotent(db, context, input.action, idemKey, idemHash);
      if (replay) return replay;
      if (input.endTime <= input.startTime) return Response.json({ error: "End time must be after start time." }, { status: 400 });
      const [term, classroom] = await Promise.all([
        db.term.findFirst({ where: { id: input.termId, schoolId: context.schoolId }, select: { id: true, academicYearId: true } }),
        db.classroom.findFirst({ where: { id: input.classroomId, schoolId: context.schoolId, active: true }, select: { id: true } }),
      ]);
      if (!term) return Response.json({ error: "Term not found." }, { status: 404 });
      if (!classroom) return Response.json({ error: "Class not found." }, { status: 404 });
      if (input.subjectId) {
        const subject = await db.subject.findFirst({ where: { id: input.subjectId, schoolId: context.schoolId, active: true }, select: { id: true } });
        if (!subject) return Response.json({ error: "Subject not found." }, { status: 404 });
      }
      if (input.invigilatorId) {
        const invigilator = await db.schoolMembership.findFirst({
          where: { id: input.invigilatorId, schoolId: context.schoolId, active: true, role: { in: ["school_admin", "headmaster", "deputy_head", "teacher", "class_teacher", "hod"] } },
          select: { id: true },
        });
        if (!invigilator) return Response.json({ error: "Active instructional staff member not found." }, { status: 404 });
      }
      // Venue and invigilator cannot be double-booked on the same date/time.
      const clash = await db.examSession.findFirst({
        where: {
          schoolId: context.schoolId,
          examDate: new Date(input.examDate),
          startTime: { lt: input.endTime },
          endTime: { gt: input.startTime },
          OR: [
            ...(input.venue ? [{ venue: input.venue }] : []),
            ...(input.invigilatorId ? [{ invigilatorId: input.invigilatorId }] : []),
          ],
        },
        select: { title: true, venue: true, invigilatorId: true },
      });
      if (clash) {
        const kind = input.venue && clash.venue === input.venue ? "venue" : "invigilator";
        return Response.json({ error: `Exam clash: the ${kind} is already booked for "${clash.title}" at that time.` }, { status: 409 });
      }
      // Optionally create the linked markbook assessment in the same step —
      // requires a subject so the class-subject offering can be found.
      let assessmentId: string | null = null;
      let offeringId: string | null = null;
      if (input.withAssessment) {
        if (!input.subjectId) return Response.json({ error: "A subject is required to create the linked markbook assessment." }, { status: 400 });
        const offering = await db.classSubject.findFirst({
          where: { schoolId: context.schoolId, classroomId: input.classroomId, subjectId: input.subjectId, active: true },
          select: { id: true },
        });
        if (!offering) return Response.json({ error: "That subject is not offered to this class — assign it first." }, { status: 400 });
        offeringId = offering.id;
        assessmentId = crypto.randomUUID();
      }
      const id = crypto.randomUUID();
      await db.$transaction([
        ...(assessmentId && offeringId ? [db.assessment.create({
          data: {
            id: assessmentId,
            schoolId: context.schoolId,
            termId: input.termId,
            classSubjectId: offeringId,
            title: input.title,
            assessmentType: "exam",
            maxMarks: 100,
            weightPercent: 100,
            dueDate: new Date(input.examDate),
            createdById: context.membershipId,
          },
        })] : []),
        db.examSession.create({
          data: {
            id,
            schoolId: context.schoolId,
            termId: input.termId,
            classroomId: input.classroomId,
            subjectId: input.subjectId || null,
            title: input.title,
            examDate: new Date(input.examDate),
            startTime: input.startTime,
            endTime: input.endTime,
            venue: input.venue || null,
            invigilatorId: input.invigilatorId || null,
            assessmentId,
          },
        }),
        db.auditLog.create({
          data: { schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "academic.exam_session_created", entityType: "exam_session", entityId: id, details: JSON.stringify({ title: input.title, examDate: input.examDate }) },
        }),
      ]);
      await storeIdempotent(db, context, input.action, idemKey, idemHash, 201, { id });
      return Response.json({ id }, { status: 201 });
    }

    if (input.action === "generate_exam_seating") {
      requirePermission(context, "academics.manage");
      const session = await db.examSession.findFirst({
        where: { id: input.examSessionId, schoolId: context.schoolId },
        select: { id: true, classroomId: true, title: true, _count: { select: { seats: true } } },
      });
      if (!session) return Response.json({ error: "Exam session not found." }, { status: 404 });
      if (session._count.seats > 0) return Response.json({ error: "Seating already generated for this session — cancel it first to regenerate." }, { status: 409 });
      const students = await db.student.findMany({
        where: { schoolId: context.schoolId, classroomId: session.classroomId, status: "active", archivedAt: null },
        select: { id: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });
      if (!students.length) return Response.json({ error: "No active learners in that class." }, { status: 400 });
      await db.$transaction([
        db.examSeat.createMany({
          data: students.map((student, index) => ({
            schoolId: context.schoolId,
            examSessionId: session.id,
            studentId: student.id,
            seatNumber: `S${index + 1}`,
          })),
        }),
        db.auditLog.create({
          data: { schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "academic.exam_seating_generated", entityType: "exam_session", entityId: session.id, details: JSON.stringify({ title: session.title, seats: students.length }) },
        }),
      ]);
      return Response.json({ seated: students.length });
    }

    if (input.action === "cancel_exam_session") {
      requirePermission(context, "academics.manage");
      const session = await db.examSession.findFirst({
        where: { id: input.examSessionId, schoolId: context.schoolId },
        select: { id: true, title: true },
      });
      if (!session) return Response.json({ error: "Exam session not found." }, { status: 404 });
      await db.$transaction([
        db.examSeat.deleteMany({ where: { examSessionId: session.id, schoolId: context.schoolId } }),
        db.examSession.delete({ where: { id: session.id } }),
        db.auditLog.create({
          data: { schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "academic.exam_session_cancelled", entityType: "exam_session", entityId: session.id, details: JSON.stringify({ title: session.title }) },
        }),
      ]);
      return Response.json({ deleted: true });
    }
  } catch (error) {
    return routeError(error);
  }
}
