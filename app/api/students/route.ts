import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getDb } from "@/db";
import { getSchoolContext, guardMutation, requirePermission } from "@/lib/request-context";
import { idempotencyKey, replayIdempotent, requestHash, storeIdempotent } from "@/lib/idempotency";
import { hasPermission } from "@/lib/permissions";
import { onboardStudent, type OnboardingResult } from "@/lib/onboarding";

const newGuardian = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(6).max(30),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  relationship: z.string().trim().min(1).max(40),
});

const createStudent = z.object({
  firstName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  gender: z.enum(["female", "male", "other", "prefer_not_to_say"]),
  dateOfBirth: z.string().date(),
  admissionDate: z.string().date().optional(),
  classroomId: z.string().min(1).max(64),
  medicalAlert: z.string().trim().max(500).optional(),
  zimsecCandidateNumber: z.string().trim().max(40).optional(),
  guardianId: z.string().min(1).max(64).optional(),
  guardian: newGuardian.optional(),
}).superRefine((input, context) => {
  if (Boolean(input.guardianId) === Boolean(input.guardian)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["guardian"],
      message: "Choose an existing guardian or enter one new guardian.",
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const admissionDate = input.admissionDate ?? today;
  if (input.dateOfBirth >= admissionDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dateOfBirth"],
      message: "Date of birth must be before the admission date.",
    });
  }
});

function routeError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please correct the highlighted student details.", fields: error.flatten().fieldErrors }, { status: 400 });
  const message = error instanceof Error ? error.message : "Unable to complete the request.";
  const uniqueViolation =
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
    message.includes("UNIQUE constraint failed");
  const status = uniqueViolation ? 409 : 500;
  return Response.json({ error: status === 409 ? "That admission number already exists for this school." : "The student record could not be saved." }, { status });
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "students.view");
    const db = getDb();
    const canViewClinic = hasPermission(context.role, "clinic.view");
    const url = new URL(request.url);

    // Serve a learner photo — staff only, school-scoped, never cached cross-user.
    const photoFor = url.searchParams.get("photo");
    if (photoFor) {
      const row = await db.student.findFirst({
        where: { id: photoFor, schoolId: context.schoolId },
        select: { photoPath: true },
      });
      if (!row?.photoPath) return Response.json({ error: "No photo on file." }, { status: 404 });
      const { getStudentDocument } = await import("@/lib/document-storage");
      const bytes = await getStudentDocument(row.photoPath).catch(() => null);
      if (!bytes) return Response.json({ error: "Photo file is missing." }, { status: 404 });
      const ext = row.photoPath.split(".").pop()?.toLowerCase() ?? "";
      const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[ext] ?? "application/octet-stream";
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "Cache-Control": "private, max-age=300" } });
    }

    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize")) || 25));
    const [rows, total] = await Promise.all([
      db.student.findMany({
        where: { schoolId: context.schoolId, archivedAt: null },
        select: {
        id: true,
        admissionNumber: true,
        firstName: true,
        email: true,
        middleName: true,
        lastName: true,
        gender: true,
        dateOfBirth: true,
        status: true,
        medicalAlert: true,
        photoPath: true,
        zimsecCandidateNumber: true,
        admissionDate: true,
        createdAt: true,
        transferDestination: true,
        transferDate: true,
        transferReason: true,
        classroom: { select: { id: true, name: true } },
      },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.student.count({ where: { schoolId: context.schoolId, archivedAt: null } }),
    ]);
    const enrollmentRows = await db.studentEnrollment.findMany({
      where: { schoolId: context.schoolId, studentId: { in: rows.map((row) => row.id) } },
      select: {
        studentId: true,
        status: true,
        enrollmentDate: true,
        exitDate: true,
        exitReason: true,
        academicYear: { select: { name: true } },
        gradeLevel: { select: { name: true } },
        classroom: { select: { name: true } },
      },
      orderBy: [{ enrollmentDate: "desc" }],
    });
    const enrollmentsByStudent = new Map<string, typeof enrollmentRows>();
    for (const enrollment of enrollmentRows) {
      const list = enrollmentsByStudent.get(enrollment.studentId) ?? [];
      list.push(enrollment);
      enrollmentsByStudent.set(enrollment.studentId, list);
    }
    const leadershipRows = await db.studentLeadership.findMany({
      where: { schoolId: context.schoolId, studentId: { in: rows.map((row) => row.id) } },
      select: {
        id: true,
        studentId: true,
        title: true,
        scope: true,
        active: true,
        startDate: true,
        endDate: true,
        classroom: { select: { name: true } },
      },
      orderBy: [{ active: "desc" }, { startDate: "desc" }],
    });
    const leadershipsByStudent = new Map<string, typeof leadershipRows>();
    for (const role of leadershipRows) {
      const list = leadershipsByStudent.get(role.studentId) ?? [];
      list.push(role);
      leadershipsByStudent.set(role.studentId, list);
    }
    const students = rows.map((student) => ({
      id: student.id,
      admissionNumber: student.admissionNumber,
      firstName: student.firstName,
      middleName: student.middleName,
      lastName: student.lastName,
      email: student.email,
      gender: student.gender,
      dateOfBirth: student.dateOfBirth,
      status: student.status,
      medicalAlert: canViewClinic ? student.medicalAlert : null,
      classroomId: student.classroom?.id ?? null,
      classroomName: student.classroom?.name ?? null,
      admissionDate: student.admissionDate,
      createdAt: student.createdAt,
      transferDestination: student.transferDestination,
      transferDate: student.transferDate,
      transferReason: student.transferReason,
      enrollments: (enrollmentsByStudent.get(student.id) ?? []).map((enrollment) => ({
        yearName: enrollment.academicYear.name,
        gradeName: enrollment.gradeLevel.name,
        classroomName: enrollment.classroom.name,
        status: enrollment.status,
        enrollmentDate: enrollment.enrollmentDate,
        exitDate: enrollment.exitDate,
        exitReason: enrollment.exitReason,
      })),
      leaderships: (leadershipsByStudent.get(student.id) ?? []).map((role) => ({
        id: role.id,
        title: role.title,
        scope: role.scope,
        classroomName: role.classroom?.name ?? null,
        active: role.active,
        startDate: role.startDate,
        endDate: role.endDate,
      })),
    }));
    return Response.json({
      students,
      total,
      page,
      pageSize,
      permissions: {
        create: hasPermission(context.role, "students.create"),
        update: hasPermission(context.role, "students.update"),
        promote: hasPermission(context.role, "students.promote"),
        transfer: hasPermission(context.role, "students.transfer"),
        withdraw: hasPermission(context.role, "students.archive"),
      },
    });
  } catch (error) { return routeError(error); }
}

const updateStudent = z.object({
  action: z.literal("update_student"),
  studentId: z.string().min(1).max(64),
  firstName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  gender: z.enum(["female", "male", "other", "prefer_not_to_say"]),
  dateOfBirth: z.string().date(),
  medicalAlert: z.string().trim().max(500).optional(),
  zimsecCandidateNumber: z.string().trim().max(40).optional(),
});

const bulkPromote = z.object({
  action: z.literal("promote_class"),
  sourceClassroomId: z.string().min(1).max(64),
  targetClassroomId: z.string().min(1).max(64),
  mode: z.enum(["promote", "repeat"]),
  effectiveDate: z.string().date().optional(),
  reason: z.string().trim().max(200).optional(),
});

const importRow = z.object({
  firstName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().min(1).max(80),
  gender: z.enum(["female", "male", "other", "prefer_not_to_say"]),
  dateOfBirth: z.string().date(),
  classroomId: z.string().min(1).max(64),
  admissionDate: z.string().date().optional(),
  medicalAlert: z.string().trim().max(500).optional(),
});

const importStudents = z.object({
  action: z.literal("import_students"),
  rows: z.array(z.record(z.unknown())).min(1).max(500),
});

const lifecycleAction = z.object({
  action: z.enum(["promote_student", "repeat_student", "transfer_student", "withdraw_student"]),
  studentId: z.string().min(1).max(64),
  targetClassroomId: z.string().min(1).max(64).optional(),
  effectiveDate: z.string().date().optional(),
  reason: z.string().trim().max(200).optional(),
  destination: z.string().trim().max(160).optional(),
});

export async function POST(request: Request) {
  try {
    await guardMutation(request, "students");
    const context = await getSchoolContext(request);
    const db = getDb();

    // Learner photo upload — multipart, staff with students.update only.
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      requirePermission(context, "students.update");
      const form = await request.formData();
      const studentId = z.string().min(1).max(64).parse(form.get("studentId"));
      const file = form.get("photo");
      if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Attach a photo file." }, { status: 400 });
      const extension = "." + (file.name.split(".").pop() ?? "").toLowerCase();
      const mimes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" } as Record<string, string>;
      const mime = mimes[extension];
      if (!mime || file.type !== mime) return Response.json({ error: "Photos must be JPG, PNG or WEBP." }, { status: 400 });
      if (file.size > 3 * 1024 * 1024) return Response.json({ error: "Photos must be 3 MB or smaller." }, { status: 400 });
      const student = await db.student.findFirst({ where: { id: studentId, schoolId: context.schoolId, archivedAt: null }, select: { id: true } });
      if (!student) return Response.json({ error: "Student record not found." }, { status: 404 });
      const key = `${context.schoolId}/photos/${crypto.randomUUID()}${extension}`;
      const { putStudentDocument } = await import("@/lib/document-storage");
      await putStudentDocument(key, new Uint8Array(await file.arrayBuffer()), mime);
      await db.$transaction([
        db.student.update({ where: { id: studentId }, data: { photoPath: key } }),
        db.auditLog.create({ data: { schoolId: context.schoolId, actorMembershipId: context.membershipId, action: "student.photo_updated", entityType: "student", entityId: studentId, details: "{}" } }),
      ]);
      return Response.json({ photoPath: key }, { status: 201 });
    }

    const raw = await request.json();

    if (typeof raw?.action === "string" && raw.action !== "create_student") {
      if (raw.action === "update_student") {
        requirePermission(context, "students.update");
        const input = updateStudent.parse(raw);
        const existing = await db.student.findFirst({
          where: { id: input.studentId, schoolId: context.schoolId, archivedAt: null },
          select: { id: true, firstName: true, lastName: true, gender: true, dateOfBirth: true, medicalAlert: true, zimsecCandidateNumber: true },
        });
        if (!existing) return Response.json({ error: "Student record not found." }, { status: 404 });
        await db.$transaction([
          db.student.update({
            where: { id: input.studentId },
            data: {
              firstName: input.firstName,
              middleName: input.middleName || null,
              lastName: input.lastName,
              email: input.email || null,
              gender: input.gender,
              dateOfBirth: new Date(input.dateOfBirth),
              medicalAlert: input.medicalAlert || null,
              zimsecCandidateNumber: input.zimsecCandidateNumber || null,
            },
          }),
          db.auditLog.create({
            data: {
              schoolId: context.schoolId,
              actorMembershipId: context.membershipId,
              action: "student.updated",
              entityType: "student",
              entityId: input.studentId,
              details: JSON.stringify({ before: existing }),
            },
          }),
        ]);
        return Response.json({ updated: true });
      }

      if (raw.action === "assign_leadership") {
        requirePermission(context, "students.update");
        const input = z.object({
          action: z.literal("assign_leadership"),
          studentId: z.string().min(1).max(64),
          title: z.enum(["head_boy", "head_girl", "prefect", "senior_prefect", "class_monitor", "sports_captain", "hostel_prefect", "library_prefect", "dining_prefect", "chorister_lead", "debate_captain", "other"]),
          customTitle: z.string().trim().min(2).max(60).optional(),
          scope: z.enum(["school", "class", "dormitory", "house"]),
          classroomId: z.string().min(1).max(64).optional(),
          startDate: z.string().date(),
        }).parse(raw);
        const student = await db.student.findFirst({
          where: { id: input.studentId, schoolId: context.schoolId, archivedAt: null, status: "active" },
          select: { id: true, firstName: true, lastName: true },
        });
        if (!student) return Response.json({ error: "Active student record not found." }, { status: 404 });
        if (input.title === "other" && !input.customTitle) {
          return Response.json({ error: "Provide a title for this role." }, { status: 400 });
        }
        if (input.scope === "class" && !input.classroomId) {
          return Response.json({ error: "Class-scoped roles need a class." }, { status: 400 });
        }
        if (input.classroomId) {
          const classroom = await db.classroom.findFirst({
            where: { id: input.classroomId, schoolId: context.schoolId },
            select: { id: true },
          });
          if (!classroom) return Response.json({ error: "Class not found." }, { status: 404 });
        }
        const title = input.title === "other" ? input.customTitle! : input.title.replaceAll("_", " ");
        const activeYear = await db.academicYear.findFirst({
          where: { schoolId: context.schoolId, status: "active" },
          select: { id: true },
        });
        // Only one active holder per school-wide leadership title.
        if (input.scope === "school") {
          const clash = await db.studentLeadership.findFirst({
            where: { schoolId: context.schoolId, title, scope: "school", active: true },
            select: { studentId: true },
          });
          if (clash) return Response.json({ error: `Another learner already holds "${title}". End that role first.` }, { status: 409 });
        }
        const id = crypto.randomUUID();
        await db.$transaction([
          db.studentLeadership.create({
            data: {
              id,
              schoolId: context.schoolId,
              studentId: input.studentId,
              title,
              scope: input.scope,
              classroomId: input.classroomId || null,
              academicYearId: activeYear?.id ?? null,
              startDate: new Date(input.startDate),
            },
          }),
          db.auditLog.create({
            data: {
              schoolId: context.schoolId,
              actorMembershipId: context.membershipId,
              action: "student.leadership_assigned",
              entityType: "student_leadership",
              entityId: id,
              details: JSON.stringify({ studentId: input.studentId, title, scope: input.scope }),
            },
          }),
        ]);
        return Response.json({ id }, { status: 201 });
      }

      if (raw.action === "end_leadership") {
        requirePermission(context, "students.update");
        const input = z.object({
          action: z.literal("end_leadership"),
          leadershipId: z.string().min(1).max(64),
        }).parse(raw);
        const role = await db.studentLeadership.findFirst({
          where: { id: input.leadershipId, schoolId: context.schoolId, active: true },
          select: { id: true, title: true, studentId: true },
        });
        if (!role) return Response.json({ error: "Active leadership role not found." }, { status: 404 });
        await db.$transaction([
          db.studentLeadership.update({
            where: { id: role.id },
            data: { active: false, endDate: new Date() },
          }),
          db.auditLog.create({
            data: {
              schoolId: context.schoolId,
              actorMembershipId: context.membershipId,
              action: "student.leadership_ended",
              entityType: "student_leadership",
              entityId: role.id,
              details: JSON.stringify({ studentId: role.studentId, title: role.title }),
            },
          }),
        ]);
        return Response.json({ updated: true });
      }

      if (raw.action === "promote_class") {
        requirePermission(context, "students.promote");
        const input = bulkPromote.parse(raw);
        const [source, target] = await Promise.all([
          db.classroom.findFirst({
            where: { id: input.sourceClassroomId, schoolId: context.schoolId, active: true },
            select: { id: true, name: true, academicYearId: true, gradeLevelId: true },
          }),
          db.classroom.findFirst({
            where: { id: input.targetClassroomId, schoolId: context.schoolId, active: true },
            select: { id: true, name: true, academicYearId: true, gradeLevelId: true, capacity: true, year: { select: { name: true, status: true, startDate: true } } },
          }),
        ]);
        if (!source || !target?.academicYearId || !target.gradeLevelId) return Response.json({ error: "Select valid source and destination classes." }, { status: 400 });
        if (!["planned", "active"].includes(target.year?.status ?? "")) return Response.json({ error: "The destination class belongs to a closed academic year." }, { status: 400 });
        if (target.academicYearId === source.academicYearId) return Response.json({ error: "Bulk promotion moves learners to a different academic year — use transfer for same-year moves." }, { status: 400 });
        if (input.mode === "repeat" && target.gradeLevelId !== source.gradeLevelId) return Response.json({ error: "A bulk repeat requires a destination class at the same grade level." }, { status: 400 });

        const activeEnrollments = await db.studentEnrollment.findMany({
          where: {
            schoolId: context.schoolId,
            classroomId: source.id,
            status: "active",
            student: { status: "active", archivedAt: null },
          },
          select: { id: true, studentId: true },
        });
        if (!activeEnrollments.length) return Response.json({ error: "The source class has no active learners." }, { status: 400 });

        const alreadyPlaced = await db.studentEnrollment.findMany({
          where: { schoolId: context.schoolId, academicYearId: target.academicYearId, status: { in: ["active", "confirmed"] }, studentId: { in: activeEnrollments.map((e) => e.studentId) } },
          select: { studentId: true },
        });
        const placedIds = new Set(alreadyPlaced.map((e) => e.studentId));
        const movable = activeEnrollments.filter((e) => !placedIds.has(e.studentId));

        const enrollmentDate = input.effectiveDate ? new Date(input.effectiveDate) : (target.year?.startDate ?? new Date());
        const immediate = target.year?.status === "active";
        const targetYearId = target.academicYearId;
        const targetGradeId = target.gradeLevelId;

        await db.$transaction(async (tx) => {
          for (const enrollment of movable) {
            if (immediate) {
              await tx.studentEnrollment.update({
                where: { id: enrollment.id },
                data: { status: "completed", exitDate: enrollmentDate, exitReason: input.mode === "repeat" ? "repeated" : "promoted" },
              });
              await tx.student.update({ where: { id: enrollment.studentId }, data: { classroomId: target.id } });
            }
            await tx.studentEnrollment.create({
              data: {
                studentId: enrollment.studentId,
                schoolId: context.schoolId,
                academicYearId: targetYearId,
                gradeLevelId: targetGradeId,
                classroomId: target.id,
                enrollmentDate,
                status: immediate ? "active" : "confirmed",
              },
            });
          }
          await tx.auditLog.create({
            data: {
              schoolId: context.schoolId,
              actorMembershipId: context.membershipId,
              action: input.mode === "repeat" ? "students.bulk_repeated" : "students.bulk_promoted",
              entityType: "classroom",
              entityId: source.id,
              details: JSON.stringify({ source: source.name, target: target.name, academicYear: target.year?.name, mode: input.mode, moved: movable.length, skipped: placedIds.size, status: immediate ? "active" : "confirmed", reason: input.reason || null }),
            },
          });
        });
        return Response.json({ moved: movable.length, skipped: placedIds.size, status: immediate ? "active" : "confirmed" }, { status: 201 });
      }

      if (raw.action === "import_students") {
        requirePermission(context, "students.create");
        const parsed = importStudents.parse(raw);

        // Validate every row independently so the UI can list each failure.
        const errors: { row: number; error: string }[] = [];
        const valid: z.infer<typeof importRow>[] = [];
        parsed.rows.forEach((row, index) => {
          const result = importRow.safeParse(row);
          if (!result.success) {
            const issue = result.error.issues[0];
            errors.push({ row: index + 1, error: `${issue.path.join(".") || "row"}: ${issue.message}` });
          } else if (result.data.dateOfBirth >= (result.data.admissionDate ?? new Date().toISOString().slice(0, 10))) {
            errors.push({ row: index + 1, error: "dateOfBirth: must be before the admission date" });
          } else {
            valid.push(result.data);
          }
        });
        if (errors.length) return Response.json({ error: `${errors.length} row${errors.length === 1 ? "" : "s"} failed validation.`, errors }, { status: 400 });
        if (!valid.length) return Response.json({ error: "No valid rows to import." }, { status: 400 });

        // Every classroom must belong to this school, be open, and fit the batch.
        const classroomIds = [...new Set(valid.map((row) => row.classroomId))];
        const classrooms = await db.classroom.findMany({
          where: { id: { in: classroomIds }, schoolId: context.schoolId, active: true },
          select: {
            id: true, name: true, academicYearId: true, gradeLevelId: true, capacity: true,
            year: { select: { status: true } },
            gradeLevel: { select: { active: true } },
            _count: { select: { students: { where: { schoolId: context.schoolId, status: "active", archivedAt: null } } } },
          },
        });
        const classroomMap = new Map(classrooms.map((classroom) => [classroom.id, classroom]));
        const perClass = new Map<string, number>();
        for (const [index, row] of valid.entries()) {
          const classroom = classroomMap.get(row.classroomId);
          if (!classroom?.academicYearId || !classroom.gradeLevelId || !classroom.gradeLevel?.active || !["active", "planned"].includes(classroom.year?.status ?? "")) {
            errors.push({ row: index + 1, error: "classroomId: class is missing or not open for enrolment" });
            continue;
          }
          const projected = classroom._count.students + (perClass.get(row.classroomId) ?? 0) + 1;
          if (projected > classroom.capacity) {
            errors.push({ row: index + 1, error: `classroomId: ${classroom.name} is at capacity` });
            continue;
          }
          perClass.set(row.classroomId, (perClass.get(row.classroomId) ?? 0) + 1);
        }
        if (errors.length) return Response.json({ error: `${errors.length} row${errors.length === 1 ? "" : "s"} reference invalid or full classes.`, errors }, { status: 400 });

        const year = new Date().getFullYear();
        const created: string[] = [];
        await db.$transaction(async (tx) => {
          for (const row of valid) {
            const classroom = classroomMap.get(row.classroomId)!;
            const studentId = crypto.randomUUID();
            const admissionDate = row.admissionDate || new Date().toISOString().slice(0, 10);
            created.push(studentId);
            await tx.student.create({
              data: {
                id: studentId,
                schoolId: context.schoolId,
                admissionNumber: `${context.schoolCode}-${year}-${studentId.slice(0, 6).toUpperCase()}`,
                firstName: row.firstName,
                middleName: row.middleName || null,
                lastName: row.lastName,
                gender: row.gender,
                dateOfBirth: new Date(row.dateOfBirth),
                admissionDate: new Date(admissionDate),
                classroomId: row.classroomId,
                medicalAlert: row.medicalAlert || null,
              },
            });
            await tx.studentEnrollment.create({
              data: {
                id: crypto.randomUUID(),
                studentId,
                schoolId: context.schoolId,
                academicYearId: classroom.academicYearId!,
                gradeLevelId: classroom.gradeLevelId!,
                classroomId: row.classroomId,
                enrollmentDate: new Date(admissionDate),
                status: "active",
              },
            });
          }
          await tx.auditLog.create({
            data: {
              schoolId: context.schoolId,
              actorMembershipId: context.membershipId,
              action: "students.imported",
              entityType: "student",
              entityId: context.schoolId,
              details: JSON.stringify({ imported: created.length }),
            },
          });
        });
        return Response.json({ imported: created.length }, { status: 201 });
      }

      const input = lifecycleAction.parse(raw);
      const student = await db.student.findFirst({
        where: { id: input.studentId, schoolId: context.schoolId, archivedAt: null },
        select: { id: true, firstName: true, lastName: true, status: true, classroomId: true },
      });
      if (!student) return Response.json({ error: "Student record not found." }, { status: 404 });
      if (student.status !== "active") return Response.json({ error: `Only active learners can be processed — this student is ${student.status}.` }, { status: 409 });

      const currentEnrollment = await db.studentEnrollment.findFirst({
        where: { studentId: student.id, schoolId: context.schoolId, status: "active" },
        orderBy: { enrollmentDate: "desc" },
        select: { id: true, academicYearId: true, gradeLevelId: true, classroomId: true },
      });

      if (input.action === "withdraw_student") {
        requirePermission(context, "students.archive");
        const exitDate = new Date(input.effectiveDate ?? new Date().toISOString().slice(0, 10));
        const isExternalTransfer = Boolean(input.destination);
        await db.$transaction([
          db.studentEnrollment.updateMany({
            where: { studentId: student.id, schoolId: context.schoolId, status: { in: ["active", "confirmed"] } },
            data: { status: isExternalTransfer ? "transferred" : "withdrawn", exitDate, exitReason: input.reason || (isExternalTransfer ? "transferred out" : "withdrawn") },
          }),
          db.student.update({
            where: { id: student.id },
            data: {
              status: isExternalTransfer ? "transferred" : "withdrawn",
              classroomId: null,
              transferDestination: input.destination || null,
              transferDate: isExternalTransfer ? exitDate : null,
              transferReason: input.reason || null,
            },
          }),
          db.auditLog.create({
            data: {
              schoolId: context.schoolId,
              actorMembershipId: context.membershipId,
              action: "student.withdrawn",
              entityType: "student",
              entityId: student.id,
              details: JSON.stringify({ reason: input.reason || "withdrawn", exitDate }),
            },
          }),
        ]);
        return Response.json({ withdrawn: true });
      }

      if (!input.targetClassroomId) return Response.json({ error: "Select the destination class." }, { status: 400 });
      const target = await db.classroom.findFirst({
        where: { id: input.targetClassroomId, schoolId: context.schoolId, active: true },
        select: { id: true, name: true, academicYearId: true, gradeLevelId: true, capacity: true, year: { select: { name: true, status: true, startDate: true } } },
      });
      if (!target?.academicYearId || !target.gradeLevelId) return Response.json({ error: "Select an active, configured class within your school." }, { status: 400 });
      if (!["planned", "active"].includes(target.year?.status ?? "")) return Response.json({ error: "The destination class belongs to a closed academic year." }, { status: 400 });
      if (!currentEnrollment) return Response.json({ error: "This learner has no active enrolment to move from." }, { status: 409 });

      if (input.action === "transfer_student") {
        requirePermission(context, "students.transfer");
        if (target.academicYearId !== currentEnrollment.academicYearId) return Response.json({ error: "Transfers stay inside the current academic year — use promote or repeat for a new year." }, { status: 400 });
        if (target.id === currentEnrollment.classroomId) return Response.json({ error: "The learner is already in that class." }, { status: 409 });
        const exitDate = new Date(input.effectiveDate ?? new Date().toISOString().slice(0, 10));
        await db.$transaction([
          db.studentEnrollment.update({
            where: { id: currentEnrollment.id },
            data: { status: "transferred", exitDate, exitReason: input.reason || "transferred" },
          }),
          db.studentEnrollment.create({
            data: {
              studentId: student.id,
              schoolId: context.schoolId,
              academicYearId: target.academicYearId,
              gradeLevelId: target.gradeLevelId,
              classroomId: target.id,
              enrollmentDate: exitDate,
              status: "active",
            },
          }),
          db.student.update({ where: { id: student.id }, data: { classroomId: target.id } }),
          db.auditLog.create({
            data: {
              schoolId: context.schoolId,
              actorMembershipId: context.membershipId,
              action: "student.transferred",
              entityType: "student",
              entityId: student.id,
              details: JSON.stringify({ fromClassroomId: currentEnrollment.classroomId, toClassroomId: target.id, reason: input.reason || null }),
            },
          }),
        ]);
        return Response.json({ transferred: true });
      }

      // promote / repeat into another academic year
      requirePermission(context, "students.promote");
      if (target.academicYearId === currentEnrollment.academicYearId) return Response.json({ error: "That class is in the current year — use transfer instead." }, { status: 400 });
      if (input.action === "repeat_student" && target.gradeLevelId !== currentEnrollment.gradeLevelId) {
        return Response.json({ error: "A repeat must place the learner in a class at the same grade level." }, { status: 400 });
      }
      const duplicate = await db.studentEnrollment.findFirst({
        where: { studentId: student.id, schoolId: context.schoolId, academicYearId: target.academicYearId, status: { in: ["active", "confirmed"] } },
        select: { id: true },
      });
      if (duplicate) return Response.json({ error: "The learner already has an enrolment in that academic year." }, { status: 409 });

      const enrollmentDate = input.effectiveDate ? new Date(input.effectiveDate) : (target.year?.startDate ?? new Date());
      const immediate = target.year?.status === "active";
      const targetYearId = target.academicYearId;
      const targetGradeId = target.gradeLevelId;
      await db.$transaction(async (tx) => {
        if (immediate) {
          await tx.studentEnrollment.update({
            where: { id: currentEnrollment.id },
            data: { status: "completed", exitDate: enrollmentDate, exitReason: input.action === "repeat_student" ? "repeated" : "promoted" },
          });
          await tx.student.update({ where: { id: student.id }, data: { classroomId: target.id } });
        }
        await tx.studentEnrollment.create({
          data: {
            studentId: student.id,
            schoolId: context.schoolId,
            academicYearId: targetYearId,
            gradeLevelId: targetGradeId,
            classroomId: target.id,
            enrollmentDate,
            status: immediate ? "active" : "confirmed",
          },
        });
        await tx.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: input.action === "repeat_student" ? "student.repeated" : "student.promoted",
            entityType: "student",
            entityId: student.id,
            details: JSON.stringify({ fromClassroomId: currentEnrollment.classroomId, toClassroomId: target.id, academicYear: target.year?.name, status: immediate ? "active" : "confirmed", reason: input.reason || null }),
          },
        });
      });
      return Response.json({ [input.action === "repeat_student" ? "repeated" : "promoted"]: true, status: immediate ? "active" : "confirmed" }, { status: 201 });
    }

    requirePermission(context, "students.create");
    const input = createStudent.parse(raw);
    const idemKey = idempotencyKey(request);
    const idemHash = requestHash(input);
    const replay = await replayIdempotent(db, context, "create_student", idemKey, idemHash);
    if (replay) return replay;
    const classroom = await db.classroom.findFirst({
      where: { id: input.classroomId, schoolId: context.schoolId, active: true },
      select: {
        id: true,
        academicYearId: true,
        gradeLevelId: true,
        capacity: true,
        year: { select: { status: true } },
        gradeLevel: { select: { active: true } },
        _count: {
          select: {
            students: {
              where: { schoolId: context.schoolId, status: "active", archivedAt: null },
            },
          },
        },
      },
    });
    if (!classroom?.academicYearId || !classroom.gradeLevelId) return Response.json({ error: "Select an active, configured class within your school." }, { status: 400 });
    if (!classroom.gradeLevel?.active || !["active", "planned"].includes(classroom.year?.status ?? "")) return Response.json({ error: "The selected class is not open for enrolment." }, { status: 400 });
    if (classroom._count.students >= classroom.capacity) return Response.json({ error: "The selected class has reached its configured capacity." }, { status: 409 });

    if (input.guardianId) {
      const guardian = await db.guardian.findFirst({
        where: { id: input.guardianId, schoolId: context.schoolId },
        select: { id: true },
      });
      if (!guardian) return Response.json({ error: "The selected guardian does not belong to your school." }, { status: 400 });
    }

    const studentId = crypto.randomUUID();
    const guardianId = input.guardianId ?? crypto.randomUUID();
    const enrollmentId = crypto.randomUUID();
    const admissionNumber = `${context.schoolCode}-${new Date().getFullYear()}-${studentId.slice(0, 6).toUpperCase()}`;
    const admissionDate = input.admissionDate || new Date().toISOString().slice(0, 10);

    await db.$transaction([
      db.student.create({
        data: {
          id: studentId,
          schoolId: context.schoolId,
          admissionNumber,
          firstName: input.firstName,
          middleName: input.middleName || null,
          lastName: input.lastName,
          gender: input.gender,
          dateOfBirth: new Date(input.dateOfBirth),
          admissionDate: new Date(admissionDate),
          email: input.email || null,
          classroomId: input.classroomId,
          medicalAlert: input.medicalAlert || null,
          zimsecCandidateNumber: input.zimsecCandidateNumber || null,
        },
      }),
      ...(input.guardianId ? [] : [
        db.guardian.create({
          data: {
            id: guardianId,
            schoolId: context.schoolId,
            firstName: input.guardian!.firstName,
            lastName: input.guardian!.lastName,
            phone: input.guardian!.phone,
            email: input.guardian!.email || null,
            relationship: input.guardian!.relationship,
          },
        }),
      ]),
      db.studentGuardian.create({
        data: {
          studentId,
          guardianId,
          relationshipType: input.guardian?.relationship ?? "guardian",
          isPrimaryContact: true,
          authorizedPickup: true,
        },
      }),
      db.studentEnrollment.create({
        data: {
          id: enrollmentId,
          studentId,
          schoolId: context.schoolId,
          academicYearId: classroom.academicYearId,
          gradeLevelId: classroom.gradeLevelId,
          classroomId: classroom.id,
          enrollmentDate: new Date(admissionDate),
          status: "active",
        },
      }),
      db.auditLog.create({
        data: {
          schoolId: context.schoolId,
          actorMembershipId: context.membershipId,
          action: "student.created",
          entityType: "student",
          entityId: studentId,
          details: JSON.stringify({ admissionNumber, classroomId: input.classroomId, enrollmentId }),
        },
      }),
    ]);
    let onboarding: OnboardingResult | null = null;
    try {
      onboarding = await onboardStudent(db, context, studentId);
    } catch (onboardingError) {
      // Onboarding (portal logins + guardian notification) is best-effort —
      // a delivery failure must never roll back a completed registration.
      console.error("student onboarding failed", onboardingError);
    }
    const createdBody = { student: { id: studentId, admissionNumber, firstName: input.firstName, lastName: input.lastName, classroomId: input.classroomId }, onboarding };
    await storeIdempotent(db, context, "create_student", idemKey, idemHash, 201, createdBody);
    return Response.json(createdBody, { status: 201 });
  } catch (error) { return routeError(error); }
}
