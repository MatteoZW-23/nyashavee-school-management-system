import { getDb } from "@/db";
import { getSchoolContext, requirePermission } from "@/lib/request-context";

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "reports.view");
    const db = getDb();
    const schoolId = context.schoolId;

    const activeStudentWhere = { schoolId, status: "active", archivedAt: null };
    const currencies = ["USD", "ZWG"] as const;
    // Equivalent to register_date >= date('now', '-30 day') in UTC.
    const attendanceSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    attendanceSince.setUTCHours(0, 0, 0, 0);

    const [populationCounts, classroomRows, registerRows, finance, gradeGroups, operationCounts] =
      await Promise.all([
        Promise.all([
          db.student.count({ where: activeStudentWhere }),
          db.student.count({ where: { ...activeStudentWhere, gender: "female" } }),
          db.student.count({ where: { ...activeStudentWhere, gender: "male" } }),
          db.student.count({ where: { ...activeStudentWhere, boardingStatus: "boarder" } }),
        ]),
        db.classroom.findMany({
          where: { schoolId, active: true },
          select: {
            name: true,
            capacity: true,
            gradeLevel: { select: { name: true } },
            _count: { select: { students: { where: activeStudentWhere } } },
          },
          orderBy: [{ gradeLevel: { gradeOrder: "asc" } }, { name: "asc" }],
        }),
        db.attendanceRegister.findMany({
          where: { schoolId, status: "submitted", registerDate: { gte: attendanceSince } },
          select: {
            registerDate: true,
            entries: { select: { status: true, studentId: true } },
          },
          orderBy: { registerDate: "asc" },
        }),
        Promise.all(
          currencies.map(async (currency) => {
            const [invoiced, collected, allocated] = await Promise.all([
              // Issued invoices that have not been reversed.
              db.feeInvoice.aggregate({
                where: { schoolId, currency, state: "issued", financeReversals: { none: {} } },
                _sum: { totalMinor: true },
              }),
              // Payments that have not been reversed.
              db.payment.aggregate({
                where: { schoolId, currency, financeReversals: { none: {} } },
                _sum: { amountMinor: true },
              }),
              // Allocations where neither the allocation, its invoice, nor its payment was reversed.
              db.paymentAllocation.aggregate({
                where: {
                  schoolId,
                  currency,
                  financeReversals: { none: {} },
                  invoice: { financeReversals: { none: {} } },
                  payment: { financeReversals: { none: {} } },
                },
                _sum: { amountMinor: true },
              }),
            ]);
            const invoicedMinor = invoiced._sum.totalMinor ?? 0;
            const collectedMinor = collected._sum.amountMinor ?? 0;
            return {
              currency,
              invoicedMinor,
              collectedMinor,
              outstandingMinor: invoicedMinor - (allocated._sum.amountMinor ?? 0),
            };
          }),
        ),
        db.reportCardResult.groupBy({
          by: ["grade"],
          where: { schoolId, reportCard: { schoolId, status: "published" } },
          _count: { _all: true },
          _avg: { scorePercent: true },
        }),
        Promise.all([
          db.admissionApplication.count({ where: { schoolId, status: { notIn: ["admitted", "rejected"] } } }),
          db.disciplineIncident.count({ where: { schoolId, status: "open" } }),
          db.libraryLoan.count({ where: { schoolId, status: "issued" } }),
          db.clinicVisit.count({ where: { schoolId, status: "open" } }),
          db.staffProfile.count({ where: { schoolId, status: "active" } }),
        ]),
      ]);

    const [total, female, male, boarders] = populationCounts;
    const population = { total, female, male, boarders };

    const classes = classroomRows.map((row) => ({
      name: row.name,
      gradeName: row.gradeLevel?.name ?? "Unassigned",
      capacity: row.capacity,
      enrolled: row._count.students,
    }));

    // GROUP BY register_date over the register/entry INNER JOIN: registers with
    // no entries are excluded, and multiple registers on one date share a row.
    const attendanceByDate = new Map<string, { reportDate: string; marked: number; present: number; absent: number }>();
    for (const register of registerRows) {
      if (register.entries.length === 0) continue;
      const reportDate = register.registerDate.toISOString().slice(0, 10);
      const bucket = attendanceByDate.get(reportDate) ?? { reportDate, marked: 0, present: 0, absent: 0 };
      for (const entry of register.entries) {
        bucket.marked += 1;
        if (entry.status === "present" || entry.status === "late") bucket.present += 1;
        if (entry.status === "absent" || entry.status === "sick" || entry.status === "excused") bucket.absent += 1;
      }
      attendanceByDate.set(reportDate, bucket);
    }
    const attendance = [...attendanceByDate.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate));

    // Chronic absence — learners away (absent/sick/excused) on 5+ marked
    // register entries in the last 30 days. A safeguarding flag, not a stat.
    const absenceCounts = new Map<string, { count: number; lastAbsent: string }>();
    for (const register of registerRows) {
      const day = register.registerDate.toISOString().slice(0, 10);
      for (const entry of register.entries) {
        if (entry.status !== "absent" && entry.status !== "sick" && entry.status !== "excused") continue;
        const bucket = absenceCounts.get(entry.studentId) ?? { count: 0, lastAbsent: day };
        bucket.count += 1;
        if (day > bucket.lastAbsent) bucket.lastAbsent = day;
        absenceCounts.set(entry.studentId, bucket);
      }
    }
    const flaggedIds = [...absenceCounts.entries()].filter(([, bucket]) => bucket.count >= 5).map(([id]) => id);
    const flaggedStudents = flaggedIds.length
      ? await db.student.findMany({
          where: { id: { in: flaggedIds }, schoolId },
          select: { id: true, firstName: true, lastName: true, admissionNumber: true, classroom: { select: { name: true } } },
        })
      : [];
    const chronicAbsentees = flaggedStudents
      .map((student) => ({
        studentId: student.id,
        name: `${student.firstName} ${student.lastName}`,
        admissionNumber: student.admissionNumber,
        classroomName: student.classroom?.name ?? "Unassigned",
        absentDays: absenceCounts.get(student.id)!.count,
        lastAbsent: absenceCounts.get(student.id)!.lastAbsent,
      }))
      .sort((a, b) => b.absentDays - a.absentDays)
      .slice(0, 20);

    // ROUND(AVG(score_percent), 1) ORDER BY averagePercent DESC
    const grades = gradeGroups
      .map((row) => ({
        grade: row.grade,
        resultCount: row._count._all,
        averagePercent: row._avg.scorePercent === null ? null : Math.round(row._avg.scorePercent * 10) / 10,
      }))
      .sort((a, b) => (b.averagePercent ?? 0) - (a.averagePercent ?? 0));

    const [openApplications, openIncidents, openLoans, openClinicVisits, activeStaff] = operationCounts;
    const operations = { openApplications, openIncidents, openLoans, openClinicVisits, activeStaff };

    return Response.json({
      school: { name: context.schoolName, timezone: context.timezone },
      generatedAt: new Date().toISOString(),
      population,
      classes,
      attendance,
      chronicAbsentees,
      finance,
      grades,
      operations,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "Management reports could not be generated." }, { status: 500 });
  }
}
