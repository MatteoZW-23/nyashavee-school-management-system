import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getDb } from "@/db";
import { getSchoolContext, requirePermission } from "@/lib/request-context";

const INSTRUCTIONAL_ROLES = ["school_admin", "headmaster", "deputy_head", "teacher", "class_teacher", "hod"];

const createClass = z.object({
  action: z.literal("create_class"),
  academicYearId: z.string().min(1).max(64),
  gradeLevelId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  capacity: z.number().int().min(1).max(200),
  room: z.string().trim().max(60).optional(),
  classTeacherId: z.string().min(1).max(64).optional(),
});
const updateClass = z.object({
  action: z.literal("update_class"),
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80).optional(),
  academicYearId: z.string().min(1).max(64).optional(),
  gradeLevelId: z.string().min(1).max(64).optional(),
  capacity: z.number().int().min(1).max(200).optional(),
  room: z.string().trim().max(60).nullable().optional(),
  classTeacherId: z.string().min(1).max(64).nullable().optional(),
  active: z.boolean().optional(),
});
const command = z.discriminatedUnion("action", [createClass, updateClass]);

function routeError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please check the class details." }, { status: 400 });
  const message = error instanceof Error ? error.message : "";
  const uniqueViolation =
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
    message.includes("UNIQUE constraint failed");
  if (uniqueViolation) return Response.json({ error: "A class with that name already exists for this academic year." }, { status: 409 });
  return Response.json({ error: "The class request could not be completed." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "classes.view");
    const db = getDb();
    const classrooms = await db.classroom.findMany({
      where: { schoolId: context.schoolId, active: true },
      select: {
        id: true,
        name: true,
        yearNumber: true,
        academicYearId: true,
        gradeLevelId: true,
        capacity: true,
        year: { select: { name: true, status: true } },
        gradeLevel: { select: { name: true } },
        _count: {
          select: {
            students: { where: { schoolId: context.schoolId, status: "active", archivedAt: null } },
          },
        },
      },
      // Matches: ORDER BY c.academic_year DESC, g.grade_order ASC, c.name ASC
      orderBy: [{ yearNumber: "desc" }, { gradeLevel: { gradeOrder: "asc" } }, { name: "asc" }],
    });
    return Response.json({
      classrooms: classrooms.map((classroom) => ({
        id: classroom.id,
        name: classroom.name,
        // Matches: COALESCE(y.name, CAST(c.academic_year AS TEXT))
        academicYear: classroom.year?.name ?? String(classroom.yearNumber),
        academicYearId: classroom.academicYearId,
        yearStatus: classroom.year?.status ?? null,
        gradeLevelId: classroom.gradeLevelId,
        capacity: classroom.capacity,
        gradeName: classroom.gradeLevel?.name ?? null,
        enrolled: classroom._count.students,
      })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "Classes could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "classes.manage");
    const input = command.parse(await request.json());
    const db = getDb();

    if (input.action === "create_class") {
      const [year, grade] = await Promise.all([
        db.academicYear.findFirst({
          where: { id: input.academicYearId, schoolId: context.schoolId },
          select: { id: true, startDate: true },
        }),
        db.gradeLevel.findFirst({
          where: { id: input.gradeLevelId, schoolId: context.schoolId, active: true },
          select: { id: true },
        }),
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

    const classroom = await db.classroom.findFirst({
      where: { id: input.id, schoolId: context.schoolId },
      select: { id: true },
    });
    if (!classroom) return Response.json({ error: "Class not found." }, { status: 404 });
    const [year, grade] = await Promise.all([
      input.academicYearId
        ? db.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: context.schoolId }, select: { id: true, startDate: true } })
        : null,
      input.gradeLevelId
        ? db.gradeLevel.findFirst({ where: { id: input.gradeLevelId, schoolId: context.schoolId, active: true }, select: { id: true } })
        : null,
    ]);
    if (input.academicYearId && !year) return Response.json({ error: "Select an academic year in this school." }, { status: 400 });
    if (input.gradeLevelId && !grade) return Response.json({ error: "Select a grade in this school." }, { status: 400 });
    if (input.classTeacherId) {
      const teacher = await db.schoolMembership.findFirst({
        where: { id: input.classTeacherId, schoolId: context.schoolId, active: true, role: { in: INSTRUCTIONAL_ROLES } },
        select: { id: true },
      });
      if (!teacher) return Response.json({ error: "Select an active instructional staff member." }, { status: 400 });
    }
    await db.classroom.update({
      where: { id: classroom.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(year ? { academicYearId: year.id, yearNumber: year.startDate.getUTCFullYear() } : {}),
        ...(input.gradeLevelId !== undefined ? { gradeLevelId: input.gradeLevelId } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.room !== undefined ? { room: input.room || null } : {}),
        ...(input.classTeacherId !== undefined ? { classTeacherId: input.classTeacherId } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    return Response.json({ updated: true });
  } catch (error) {
    return routeError(error);
  }
}
