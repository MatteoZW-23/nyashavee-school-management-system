import { getDb } from "@/db";
import { getSchoolContext, requirePermission } from "@/lib/request-context";

function dateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    if (context.role === "parent") {
      return Response.json({
        workspace: { tenantId: context.tenantId, schoolId: context.schoolId, schoolName: context.schoolName, schoolCode: context.schoolCode, currency: context.currency, timezone: context.timezone, enabledModules: context.enabledModules, membershipId: context.membershipId, displayName: context.displayName, role: context.role },
        today: dateInTimezone(context.timezone), summary: { activeStudents: 0, classes: 0, gradeLevels: 0, guardians: 0, activeMemberships: 0, admissionsThisMonth: 0, submittedRegistersToday: 0, totalRegistersToday: 0 }, academicYear: null, classes: [], recentActivity: [],
      });
    }
    requirePermission(context, "students.view");

    const db = getDb();
    const today = dateInTimezone(context.timezone);
    const todayStart = new Date(`${today}T00:00:00.000Z`);
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
    const schoolId = context.schoolId;

    const [
      activeStudents,
      classes,
      gradeLevels,
      guardians,
      activeMemberships,
      admissionsThisMonth,
      submittedRegistersToday,
      totalRegistersToday,
      academicYears,
      classroomRows,
      auditLogs,
      userMemberships,
      noticeRows,
    ] = await Promise.all([
      db.student.count({ where: { schoolId, status: "active", archivedAt: null } }),
      db.classroom.count({ where: { schoolId, active: true } }),
      db.gradeLevel.count({ where: { schoolId, active: true } }),
      db.guardian.count({ where: { schoolId } }),
      db.schoolMembership.count({ where: { schoolId, active: true } }),
      db.student.count({ where: { schoolId, archivedAt: null, admissionDate: { gte: monthStart, lt: tomorrowStart } } }),
      db.attendanceRegister.count({ where: { schoolId, status: "submitted", registerDate: { gte: todayStart, lt: tomorrowStart } } }),
      db.attendanceRegister.count({ where: { schoolId, registerDate: { gte: todayStart, lt: tomorrowStart } } }),
      db.academicYear.findMany({
        where: { schoolId },
        select: { id: true, name: true, startDate: true, endDate: true, status: true },
        orderBy: { startDate: "desc" },
      }),
      db.classroom.findMany({
        where: { schoolId, active: true },
        select: {
          id: true,
          name: true,
          capacity: true,
          gradeLevel: { select: { name: true } },
          _count: {
            select: {
              students: { where: { schoolId, status: "active", archivedAt: null } },
            },
          },
        },
        orderBy: [{ gradeLevel: { gradeOrder: "asc" } }, { name: "asc" }],
        take: 8,
      }),
      db.auditLog.findMany({
        where: { schoolId },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { actorMembership: { select: { displayName: true } } },
      }),
      db.schoolMembership.findMany({
        where: { userId: context.userId, active: true },
        select: { schoolId: true, role: true, displayName: true, school: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      // Published notices for staff — "all" and "staff" audiences.
      db.announcement.findMany({
        where: { schoolId, status: "published", audience: { in: ["all", "staff"] } },
        select: { id: true, title: true, body: true, publishAt: true },
        orderBy: { publishAt: "desc" },
        take: 5,
      }),
    ]);

    const summary = {
      activeStudents,
      classes,
      gradeLevels,
      guardians,
      activeMemberships,
      admissionsThisMonth,
      submittedRegistersToday,
      totalRegistersToday,
    };

    // Matches: ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, start_date DESC LIMIT 1
    const academicYear =
      academicYears.find((year) => year.status === "active") ??
      academicYears.find((year) => year.status === "planned") ??
      academicYears[0] ??
      null;

    const classesList = classroomRows.map((classroom) => ({
      id: classroom.id,
      name: classroom.name,
      capacity: classroom.capacity,
      gradeName: classroom.gradeLevel?.name ?? "Unassigned grade",
      enrolled: classroom._count.students,
    }));

    const recentActivity = auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      createdAt: log.createdAt,
      actor: log.actorMembership?.displayName ?? "System",
    }));

    return Response.json({
      workspace: {
        tenantId: context.tenantId,
        schoolId: context.schoolId,
        schoolName: context.schoolName,
        schoolCode: context.schoolCode,
        currency: context.currency,
        timezone: context.timezone, enabledModules: context.enabledModules,
        membershipId: context.membershipId,
        displayName: context.displayName,
        role: context.role,
      },
      schools: userMemberships.map((membership) => ({
        schoolId: membership.schoolId,
        schoolName: membership.school.name,
        role: membership.role,
        displayName: membership.displayName,
      })),
      today,
      summary,
      academicYear,
      classes: classesList,
      recentActivity,
      notices: noticeRows.map((row) => ({ id: row.id, title: row.title, body: row.body, publishedAt: row.publishAt })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "The school dashboard could not be loaded." }, { status: 500 });
  }
}
