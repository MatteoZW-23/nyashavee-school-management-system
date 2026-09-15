import { getDb } from "@/db";
import { getSchoolContext, requirePermission } from "@/lib/request-context";

export const dynamic = "force-dynamic";

// Full JSON export of this school's operational data — for backups and
// migration. Admin-only; every table is filtered by schoolId.
export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "exports.manage");
    const db = getDb();
    const schoolId = context.schoolId;

    const [
      school, memberships, years, gradeLevels, terms, classrooms, subjects, classSubjects,
      gradingBands, students, enrollments, guardians, links, documents, registers, entries,
      assessments, marks, reportCards, reportResults, invoices, invoiceItems, payments,
      allocations, reversals, feeTemplates, applications, staff, leave, payrollRuns,
      payrollEntries, incidents, clinicVisits, books, copies, loans, dormitories,
      boarding, vehicles, routes, transport, assets, maintenance, announcements, outbox,
      events, timetable, auditLogs, departments, studentLeaderships, incomeProjects, ledgerEntries, stockItems, stockMovements, suppliers, projectBudgets, examSessions, examSeats,
      reportApprovals, reportWeightings, lessonPlans, studentNotes, notifications,
      healthRecords, safeguardingCases, specialNeeds, assignments, curriculumTopics,
      pickupAuthorizations, clubs, clubMemberships, schoolTrips, tripParticipants, staffAttendance, onlinePayments, paymentProofs,
    ] = await Promise.all([
      db.school.findUnique({ where: { id: schoolId } }),
      db.schoolMembership.findMany({ where: { schoolId } }),
      db.academicYear.findMany({ where: { schoolId } }),
      db.gradeLevel.findMany({ where: { schoolId } }),
      db.term.findMany({ where: { schoolId } }),
      db.classroom.findMany({ where: { schoolId } }),
      db.subject.findMany({ where: { schoolId } }),
      db.classSubject.findMany({ where: { schoolId } }),
      db.gradingBand.findMany({ where: { schoolId } }),
      db.student.findMany({ where: { schoolId } }),
      db.studentEnrollment.findMany({ where: { schoolId } }),
      db.guardian.findMany({ where: { schoolId } }),
      db.studentGuardian.findMany({ where: { student: { schoolId } } }),
      db.studentDocument.findMany({ where: { schoolId } }),
      db.attendanceRegister.findMany({ where: { schoolId } }),
      db.attendanceEntry.findMany({ where: { register: { schoolId } } }),
      db.assessment.findMany({ where: { schoolId } }),
      db.assessmentMark.findMany({ where: { assessment: { schoolId } } }),
      db.reportCard.findMany({ where: { schoolId } }),
      db.reportCardResult.findMany({ where: { reportCard: { schoolId } } }),
      db.feeInvoice.findMany({ where: { schoolId } }),
      db.feeInvoiceItem.findMany({ where: { invoice: { schoolId } } }),
      db.payment.findMany({ where: { schoolId } }),
      db.paymentAllocation.findMany({ where: { schoolId } }),
      db.financeReversal.findMany({ where: { schoolId } }),
      db.feeTemplate.findMany({ where: { schoolId } }),
      db.admissionApplication.findMany({ where: { schoolId } }),
      db.staffProfile.findMany({ where: { schoolId } }),
      db.leaveRequest.findMany({ where: { schoolId } }),
      db.payrollRun.findMany({ where: { schoolId } }),
      db.payrollEntry.findMany({ where: { schoolId } }),
      db.disciplineIncident.findMany({ where: { schoolId } }),
      db.clinicVisit.findMany({ where: { schoolId } }),
      db.libraryBook.findMany({ where: { schoolId } }),
      db.libraryCopy.findMany({ where: { book: { schoolId } } }),
      db.libraryLoan.findMany({ where: { schoolId } }),
      db.boardingDormitory.findMany({ where: { schoolId } }),
      db.boardingAllocation.findMany({ where: { schoolId } }),
      db.transportVehicle.findMany({ where: { schoolId } }),
      db.transportRoute.findMany({ where: { schoolId } }),
      db.transportAssignment.findMany({ where: { schoolId } }),
      db.inventoryAsset.findMany({ where: { schoolId } }),
      db.assetMaintenance.findMany({ where: { asset: { schoolId } } }),
      db.announcement.findMany({ where: { schoolId } }),
      db.communicationOutbox.findMany({ where: { schoolId } }),
      db.schoolEvent.findMany({ where: { schoolId } }),
      db.timetableEntry.findMany({ where: { schoolId } }),
      db.auditLog.findMany({ where: { schoolId } }),
      db.department.findMany({ where: { schoolId } }),
      db.studentLeadership.findMany({ where: { schoolId } }),
      db.incomeProject.findMany({ where: { schoolId } }),
      db.schoolLedgerEntry.findMany({ where: { schoolId } }),
      db.projectStockItem.findMany({ where: { schoolId } }),
      db.stockMovement.findMany({ where: { schoolId } }),
      db.supplier.findMany({ where: { schoolId } }),
      db.projectBudget.findMany({ where: { schoolId } }),
      db.examSession.findMany({ where: { schoolId } }),
      db.examSeat.findMany({ where: { schoolId } }),
      db.reportApproval.findMany({ where: { schoolId } }),
      db.reportWeighting.findMany({ where: { schoolId } }),
      db.lessonPlan.findMany({ where: { schoolId } }),
      db.studentNote.findMany({ where: { schoolId } }),
      db.notification.findMany({ where: { schoolId } }),
      db.healthRecord.findMany({ where: { schoolId } }),
      db.safeguardingCase.findMany({ where: { schoolId } }),
      db.specialNeed.findMany({ where: { schoolId } }),
      db.assignment.findMany({ where: { schoolId } }),
      db.curriculumTopic.findMany({ where: { schoolId } }),
      db.pickupAuthorization.findMany({ where: { schoolId } }),
      db.club.findMany({ where: { schoolId } }),
      db.clubMembership.findMany({ where: { schoolId } }),
      db.schoolTrip.findMany({ where: { schoolId } }),
      db.tripParticipant.findMany({ where: { schoolId } }),
      db.staffAttendance.findMany({ where: { schoolId } }),
      db.onlinePayment.findMany({ where: { schoolId } }),
      db.paymentProof.findMany({ where: { schoolId } }),
    ]);

    await db.auditLog.create({
      data: {
        schoolId,
        actorMembershipId: context.membershipId,
        action: "school.data_exported",
        entityType: "school",
        entityId: schoolId,
        details: JSON.stringify({ tables: 76 }),
      },
    });

    const payload = {
      exportedAt: new Date().toISOString(),
      schoolId,
      data: {
        school, memberships, years, gradeLevels, terms, classrooms, subjects, classSubjects,
        gradingBands, students, enrollments, guardians, links, documents, registers, entries,
        assessments, marks, reportCards, reportResults, invoices, invoiceItems, payments,
        allocations, reversals, feeTemplates, applications, staff, leave, payrollRuns,
        payrollEntries, incidents, clinicVisits, books, copies, loans, dormitories,
        boarding, vehicles, routes, transport, assets, maintenance, announcements, outbox,
        events, timetable, auditLogs, departments, studentLeaderships, incomeProjects, ledgerEntries, stockItems, stockMovements, suppliers, projectBudgets, examSessions, examSeats,
        reportApprovals, reportWeightings, lessonPlans, studentNotes, notifications,
        healthRecords, safeguardingCases, specialNeeds, assignments, curriculumTopics,
        pickupAuthorizations, clubs, clubMemberships, schoolTrips, tripParticipants, staffAttendance, onlinePayments, paymentProofs,
      },
    };
    const name = `${context.schoolCode}-export-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "The export could not be completed." }, { status: 500 });
  }
}
