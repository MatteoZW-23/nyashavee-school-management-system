import { z } from "zod";
import { getDb } from "@/db";
import { getSchoolContext, guardMutation, requirePermission } from "@/lib/request-context";
import { hasPermission } from "@/lib/permissions";
import { notifyStudentGuardians } from "@/lib/messaging";

const attendanceStatus = z.enum(["present", "absent", "late", "excused", "sick"]);
const saveRegister = z.object({
  classroomId: z.string().min(1).max(64),
  date: z.string().date(),
  session: z.enum(["morning", "afternoon"]).default("morning"),
  submit: z.boolean().default(false),
  entries: z.array(z.object({
    studentId: z.string().min(1).max(64),
    status: attendanceStatus,
    reason: z.string().trim().max(240).optional(),
  })).max(120),
});

async function requireClassAccess(
  schoolId: string,
  membershipId: string,
  role: string,
  classroomId: string,
) {
  const classroom = await getDb().classroom.findFirst({
    where: { id: classroomId, schoolId, active: true },
    select: { id: true, classTeacherId: true },
  });
  if (!classroom) throw new Response("The selected class was not found in this school.", { status: 404 });
  if (role === "teacher" && classroom.classTeacherId !== membershipId) {
    throw new Response("Teachers may only manage attendance for an assigned class.", { status: 403 });
  }
  return classroom;
}

function routeError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) {
    return Response.json({ error: "Please check the register details before saving." }, { status: 400 });
  }
  return Response.json({ error: "The attendance register could not be processed." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "attendance.view");
    const url = new URL(request.url);

    // Staff register — all active staff with their status for the day.
    if (url.searchParams.get("scope") === "staff") {
      const date = z.string().date().parse(url.searchParams.get("date"));
      const db = getDb();
      const [staff, marked] = await Promise.all([
        db.staffProfile.findMany({
          where: { schoolId: context.schoolId, status: { notIn: ["transferred", "retired"] } },
          select: { id: true, employeeNumber: true, firstName: true, lastName: true, position: true },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        }),
        db.staffAttendance.findMany({
          where: { schoolId: context.schoolId, registerDate: new Date(date) },
          select: { staffId: true, status: true, note: true },
        }),
      ]);
      const marks = new Map(marked.map((row) => [row.staffId, row]));
      return Response.json({
        date,
        markedCount: marked.length,
        canMark: hasPermission(context.role, "attendance.correct"),
        staff: staff.map((member) => ({
          id: member.id,
          employeeNumber: member.employeeNumber,
          name: `${member.firstName} ${member.lastName}`,
          position: member.position,
          status: marks.get(member.id)?.status ?? "present",
          note: marks.get(member.id)?.note ?? null,
          marked: marks.has(member.id),
        })),
      });
    }

    const classroomId = z.string().min(1).max(64).parse(url.searchParams.get("classroomId"));
    const date = z.string().date().parse(url.searchParams.get("date"));
    const session = z.enum(["morning", "afternoon"]).catch("morning").parse(url.searchParams.get("session"));
    await requireClassAccess(context.schoolId, context.membershipId, context.role, classroomId);

    const db = getDb();
    const registerDate = new Date(date);
    const [register, roster] = await Promise.all([
      db.attendanceRegister.findFirst({
        where: {
          schoolId: context.schoolId,
          classroomId,
          registerDate,
          session,
        },
        select: { id: true, status: true, submittedAt: true, lockedAt: true },
      }),
      db.student.findMany({
        where: {
          schoolId: context.schoolId,
          classroomId,
          status: "active",
          archivedAt: null,
        },
        select: {
          id: true,
          admissionNumber: true,
          firstName: true,
          lastName: true,
          attendanceEntries: {
            where: {
              register: {
                schoolId: context.schoolId,
                classroomId,
                registerDate,
                session,
              },
            },
            select: { status: true, reason: true },
            take: 1,
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
    ]);

    const students = roster.map((student) => ({
      id: student.id,
      admissionNumber: student.admissionNumber,
      firstName: student.firstName,
      lastName: student.lastName,
      status: student.attendanceEntries[0]?.status ?? "present",
      reason: student.attendanceEntries[0]?.reason ?? null,
    }));

    return Response.json({ register: register ?? null, students });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    await guardMutation(request, "attendance");
    const context = await getSchoolContext(request);
    const raw = await request.json();

    // Staff register — leadership marks each staff member once per day.
    if (raw?.action === "mark_staff") {
      requirePermission(context, "attendance.correct");
      const input = z.object({
        date: z.string().date(),
        entries: z.array(z.object({
          staffId: z.string().min(1).max(64),
          status: z.enum(["present", "absent", "late", "leave"]),
          note: z.string().trim().max(240).optional(),
        })).max(300),
      }).parse(raw);
      const db = getDb();
      const staffRows = await db.staffProfile.findMany({
        where: { schoolId: context.schoolId, status: { notIn: ["transferred", "retired"] } },
        select: { id: true },
      });
      const staffIds = new Set(staffRows.map((row) => row.id));
      if (input.entries.some((entry) => !staffIds.has(entry.staffId))) {
        return Response.json({ error: "Every entry must belong to an active staff member of this school." }, { status: 400 });
      }
      if (new Set(input.entries.map((entry) => entry.staffId)).size !== input.entries.length) {
        return Response.json({ error: "A staff member appears more than once in this register." }, { status: 400 });
      }
      const registerDate = new Date(input.date);
      await db.$transaction(async (tx) => {
        for (const entry of input.entries) {
          await tx.staffAttendance.upsert({
            where: { staffId_registerDate: { staffId: entry.staffId, registerDate } },
            create: { id: crypto.randomUUID(), schoolId: context.schoolId, staffId: entry.staffId, registerDate, status: entry.status, note: entry.note || null, recordedById: context.membershipId },
            update: { status: entry.status, note: entry.note || null, recordedById: context.membershipId },
          });
        }
        await tx.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: "attendance.staff_marked",
            entityType: "staff_attendance",
            entityId: context.schoolId,
            details: JSON.stringify({ date: input.date, marked: input.entries.length, absent: input.entries.filter((e) => e.status === "absent").length }),
          },
        });
      });
      return Response.json({ marked: input.entries.length }, { status: 201 });
    }

    requirePermission(context, "attendance.take");
    const input = saveRegister.parse(raw);
    if (input.submit) requirePermission(context, "attendance.submit");
    await requireClassAccess(context.schoolId, context.membershipId, context.role, input.classroomId);

    const db = getDb();
    const registerDate = new Date(input.date);
    const current = await db.attendanceRegister.findFirst({
      where: {
        schoolId: context.schoolId,
        classroomId: input.classroomId,
        registerDate,
        session: input.session,
      },
      select: { id: true, status: true, lockedAt: true },
    });
    if (current?.lockedAt) return Response.json({ error: "This attendance register is locked." }, { status: 409 });
    if (current?.status === "submitted") requirePermission(context, "attendance.correct");

    const roster = await db.student.findMany({
      where: {
        schoolId: context.schoolId,
        classroomId: input.classroomId,
        status: "active",
        archivedAt: null,
      },
      select: { id: true },
    });
    const rosterIds = new Set(roster.map((student) => student.id));
    if (input.entries.length !== rosterIds.size || input.entries.some((entry) => !rosterIds.has(entry.studentId))) {
      return Response.json({ error: "The register must include every active student in the selected class exactly once." }, { status: 400 });
    }
    if (new Set(input.entries.map((entry) => entry.studentId)).size !== input.entries.length) {
      return Response.json({ error: "A student appears more than once in this register." }, { status: 400 });
    }

    const registerId = current?.id ?? crypto.randomUUID();
    const now = new Date();
    const registerStatus = input.submit ? "submitted" : "draft";
    const auditAction = current?.status === "submitted"
      ? "attendance.corrected"
      : input.submit ? "attendance.submitted" : "attendance.saved";

    await db.$transaction([
      db.attendanceRegister.upsert({
        where: {
          schoolId_classroomId_registerDate_session: {
            schoolId: context.schoolId,
            classroomId: input.classroomId,
            registerDate,
            session: input.session,
          },
        },
        update: {
          status: registerStatus,
          submittedAt: input.submit ? now : null,
          submittedById: context.membershipId,
        },
        create: {
          id: registerId,
          schoolId: context.schoolId,
          classroomId: input.classroomId,
          registerDate,
          session: input.session,
          status: registerStatus,
          submittedById: context.membershipId,
          submittedAt: input.submit ? now : null,
        },
      }),
      ...input.entries.map((entry) => db.attendanceEntry.upsert({
        where: {
          registerId_studentId: { registerId, studentId: entry.studentId },
        },
        update: {
          status: entry.status,
          reason: entry.reason || null,
          markedById: context.membershipId,
        },
        create: {
          id: crypto.randomUUID(),
          registerId,
          studentId: entry.studentId,
          status: entry.status,
          reason: entry.reason || null,
          markedById: context.membershipId,
        },
      })),
      db.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          schoolId: context.schoolId,
          actorMembershipId: context.membershipId,
          action: auditAction,
          entityType: "attendance_register",
          entityId: registerId,
          details: JSON.stringify({ classroomId: input.classroomId, date: input.date, session: input.session, entries: input.entries.length }),
        },
      }),
    ]);

    // Best-effort absence alerts on first submission — corrections don't resend.
    if (input.submit && current?.status !== "submitted") {
      const absent = input.entries.filter((entry) => entry.status === "absent");
      for (const entry of absent) {
        try {
          await notifyStudentGuardians(
            db,
            context,
            entry.studentId,
            "Absence alert",
            `Your child was marked absent today (${input.date}, ${input.session} session). Please contact the school if this is unexpected.${entry.reason ? ` Reason noted: ${entry.reason}` : ""}`
          );
        } catch {
          // Notification failures never block the register.
        }
      }
    }

    return Response.json({ register: { id: registerId, status: registerStatus, submittedAt: input.submit ? now : null } });
  } catch (error) {
    return routeError(error);
  }
}
