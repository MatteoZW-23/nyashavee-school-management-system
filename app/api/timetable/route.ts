import { z } from "zod";
import { getDb } from "@/db";
import { getSchoolContext, guardMutation, requirePermission } from "@/lib/request-context";
import { hasPermission } from "@/lib/permissions";

const INSTRUCTIONAL_ROLES = ["school_admin", "headmaster", "deputy_head", "teacher", "class_teacher", "hod"];

const addEntry = z.object({ action: z.literal("add_entry"), academicYearId: z.string().min(1).max(64), termId: z.string().min(1).max(64).optional(), classroomId: z.string().min(1).max(64), classSubjectId: z.string().min(1).max(64).optional(), teacherId: z.string().min(1).max(64).optional(), weekday: z.number().int().min(1).max(7), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), entryType: z.enum(["lesson", "break", "assembly", "practical", "exam", "activity"]), title: z.string().trim().max(120).optional(), room: z.string().trim().max(60).optional() });
const cancelEntry = z.object({ action: z.literal("cancel_entry"), entryId: z.string().min(1).max(64) });
const command = z.discriminatedUnion("action", [addEntry, cancelEntry]);

function respondError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please check the timetable details." }, { status: 400 });
  return Response.json({ error: "The timetable request could not be completed." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "timetable.view");
    const db = getDb();
    const teacherScoped = ["teacher", "class_teacher"].includes(context.role);

    const [entries, years, terms, classrooms, offerings, instructors] = await Promise.all([
      db.timetableEntry.findMany({
        where: {
          schoolId: context.schoolId,
          status: "active",
          ...(teacherScoped
            ? { OR: [{ teacherId: context.membershipId }, { classroom: { classTeacherId: context.membershipId } }] }
            : {}),
        },
        select: {
          id: true,
          academicYearId: true,
          termId: true,
          classroomId: true,
          classroom: { select: { name: true } },
          classSubjectId: true,
          classSubject: { select: { subject: { select: { name: true, code: true } } } },
          teacherId: true,
          teacher: { select: { displayName: true } },
          weekday: true,
          startTime: true,
          endTime: true,
          entryType: true,
          title: true,
          room: true,
          status: true,
        },
        orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
      }),
      db.academicYear.findMany({
        where: { schoolId: context.schoolId },
        select: { id: true, name: true, status: true },
        orderBy: { startDate: "desc" },
      }),
      db.term.findMany({
        where: { schoolId: context.schoolId },
        select: { id: true, academicYearId: true, name: true, status: true },
        orderBy: { startDate: "desc" },
      }),
      db.classroom.findMany({
        where: { schoolId: context.schoolId, active: true },
        select: { id: true, academicYearId: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.classSubject.findMany({
        where: { schoolId: context.schoolId, active: true },
        select: { id: true, classroomId: true, teacherId: true, subject: { select: { code: true, name: true } } },
        orderBy: { subject: { name: "asc" } },
      }),
      db.schoolMembership.findMany({
        where: { schoolId: context.schoolId, active: true, role: { in: INSTRUCTIONAL_ROLES } },
        select: { id: true, displayName: true, role: true },
        orderBy: { displayName: "asc" },
      }),
    ]);

    return Response.json({
      entries: entries.map((entry) => ({
        id: entry.id,
        academicYearId: entry.academicYearId,
        termId: entry.termId,
        classroomId: entry.classroomId,
        classroomName: entry.classroom.name,
        classSubjectId: entry.classSubjectId,
        subjectName: entry.classSubject?.subject.name ?? null,
        subjectCode: entry.classSubject?.subject.code ?? null,
        teacherId: entry.teacherId,
        teacherName: entry.teacher?.displayName ?? null,
        weekday: entry.weekday,
        startTime: entry.startTime,
        endTime: entry.endTime,
        entryType: entry.entryType,
        title: entry.title,
        room: entry.room,
        status: entry.status,
      })),
      years,
      terms,
      classrooms,
      offerings: offerings.map((offering) => ({
        id: offering.id,
        classroomId: offering.classroomId,
        teacherId: offering.teacherId,
        code: offering.subject.code,
        name: offering.subject.name,
      })),
      instructors,
      permissions: { manage: hasPermission(context.role, "timetable.manage") },
    });
  } catch (error) {
    return respondError(error);
  }
}

export async function POST(request: Request) {
  try {
    await guardMutation(request, "timetable");
    const context = await getSchoolContext(request);
    requirePermission(context, "timetable.manage");
    const input = command.parse(await request.json());
    const db = getDb();

    if (input.action === "cancel_entry") {
      const existing = await db.timetableEntry.findFirst({
        where: { id: input.entryId, schoolId: context.schoolId, status: "active" },
        select: { id: true },
      });
      if (!existing) return Response.json({ error: "Active timetable entry not found." }, { status: 404 });
      await db.$transaction([
        db.timetableEntry.updateMany({
          where: { id: input.entryId, schoolId: context.schoolId },
          data: { status: "cancelled" },
        }),
        db.auditLog.create({
          data: {
            id: crypto.randomUUID(),
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: "timetable.entry.cancelled",
            entityType: "timetable_entry",
            entityId: input.entryId,
            details: "{}",
          },
        }),
      ]);
      return Response.json({ updated: true });
    }

    if (input.endTime <= input.startTime) return Response.json({ error: "End time must be after start time." }, { status: 400 });

    const classroom = await db.classroom.findFirst({
      where: { id: input.classroomId, schoolId: context.schoolId, active: true },
      select: { id: true, academicYearId: true },
    });
    if (!classroom || classroom.academicYearId !== input.academicYearId) return Response.json({ error: "Class and academic year do not match." }, { status: 400 });

    if (input.termId) {
      const term = await db.term.findFirst({
        where: { id: input.termId, schoolId: context.schoolId, academicYearId: input.academicYearId },
        select: { id: true },
      });
      if (!term) return Response.json({ error: "Term and academic year do not match." }, { status: 400 });
    }

    if (input.classSubjectId) {
      const offering = await db.classSubject.findFirst({
        where: { id: input.classSubjectId, schoolId: context.schoolId, classroomId: input.classroomId, active: true },
        select: { id: true, teacherId: true },
      });
      if (!offering) return Response.json({ error: "Subject is not offered to this class." }, { status: 400 });
      if (input.teacherId && offering.teacherId && input.teacherId !== offering.teacherId) return Response.json({ error: "The selected teacher does not match the subject assignment." }, { status: 400 });
    }

    if (input.teacherId) {
      const teacher = await db.schoolMembership.findFirst({
        where: { id: input.teacherId, schoolId: context.schoolId, active: true, role: { in: INSTRUCTIONAL_ROLES } },
        select: { id: true },
      });
      if (!teacher) return Response.json({ error: "Active instructional staff member not found." }, { status: 404 });
    }

    const conflict = await db.timetableEntry.findFirst({
      where: {
        schoolId: context.schoolId,
        academicYearId: input.academicYearId,
        termId: input.termId || null,
        weekday: input.weekday,
        status: "active",
        startTime: { lt: input.endTime },
        endTime: { gt: input.startTime },
        OR: [
          { classroomId: input.classroomId },
          ...(input.teacherId ? [{ teacherId: input.teacherId }] : []),
          ...(input.room ? [{ room: input.room }] : []),
        ],
      },
      select: { id: true, classroomId: true, teacherId: true, room: true },
    });
    if (conflict) {
      const kind =
        conflict.classroomId === input.classroomId
          ? "class"
          : input.teacherId && conflict.teacherId === input.teacherId
            ? "teacher"
            : input.room && conflict.room === input.room
              ? "room"
              : "entry";
      return Response.json({ error: `Timetable conflict: the ${kind} is already booked during this time.` }, { status: 409 });
    }

    const id = crypto.randomUUID();
    await db.$transaction([
      db.timetableEntry.create({
        data: {
          id,
          schoolId: context.schoolId,
          academicYearId: input.academicYearId,
          termId: input.termId || null,
          classroomId: input.classroomId,
          classSubjectId: input.classSubjectId || null,
          teacherId: input.teacherId || null,
          weekday: input.weekday,
          startTime: input.startTime,
          endTime: input.endTime,
          entryType: input.entryType,
          title: input.title || null,
          room: input.room || null,
        },
      }),
      db.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          schoolId: context.schoolId,
          actorMembershipId: context.membershipId,
          action: "timetable.entry.created",
          entityType: "timetable_entry",
          entityId: id,
          details: JSON.stringify({ classroomId: input.classroomId, weekday: input.weekday, startTime: input.startTime }),
        },
      }),
    ]);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return respondError(error);
  }
}
