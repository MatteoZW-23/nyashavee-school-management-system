import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getDb } from "@/db";
import { getSchoolContext, guardMutation, requirePermission, type SchoolContext } from "@/lib/request-context";
import { idempotencyKey, replayIdempotent, requestHash, storeIdempotent } from "@/lib/idempotency";
import { hasPermission } from "@/lib/permissions";
import { isEmailProviderConfigured, notifyStudentGuardians } from "@/lib/messaging";
import { onboardStudent } from "@/lib/onboarding";
import { handleCommunicationAction, isCommunicationAction } from "@/lib/communication-service";

const moduleName = z.enum(["admissions", "staff", "communication", "discipline", "clinic", "health", "safeguarding", "sen", "pickups", "activities", "library", "boarding", "transport", "inventory", "events"]);
const uuid = z.string().min(1).max(64);
const date = z.string().date();
const dateTime = z.string().trim().min(10).max(35);

function fail(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please check the required details." }, { status: 400 });
  const message = error instanceof Error ? error.message : "";
  if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") || /UNIQUE constraint/i.test(message)) return Response.json({ error: "That record already exists or is already active." }, { status: 409 });
  if (message === "negative_net") return Response.json({ error: "Deductions cannot exceed an employee's gross pay." }, { status: 400 });
  return Response.json({ error: "The school record could not be completed." }, { status: 500 });
}

function audit(db: ReturnType<typeof getDb>, context: SchoolContext, action: string, entityType: string, entityId: string, details: object = {}) {
  return db.auditLog.create({
    data: {
      schoolId: context.schoolId,
      actorMembershipId: context.membershipId,
      action,
      entityType,
      entityId,
      details: JSON.stringify(details),
    },
  });
}

function referenceNumber(prefix: string, schoolCode: string) {
  return `${prefix}-${schoolCode}-${new Date().getUTCFullYear()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

async function commonReferences(context: SchoolContext) {
  const db = getDb();
  const [students, classrooms] = await Promise.all([
    db.student.findMany({
      where: { schoolId: context.schoolId, status: "active", archivedAt: null },
      select: { id: true, admissionNumber: true, firstName: true, lastName: true, gender: true, boardingStatus: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    db.classroom.findMany({
      where: { schoolId: context.schoolId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { students, classrooms };
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    const selected = moduleName.parse(new URL(request.url).searchParams.get("module"));
    requirePermission(context, `${selected}.view`);
    const db = getDb();
    const references = await commonReferences(context);
    let records: unknown[] = [];
    let secondary: Record<string, unknown[]> = {};

    if (selected === "admissions") {
      records = await db.admissionApplication.findMany({
        where: { schoolId: context.schoolId },
        select: {
          id: true,
          applicationNumber: true,
          firstName: true,
          lastName: true,
          gender: true,
          dateOfBirth: true,
          guardianName: true,
          guardianPhone: true,
          requestedGrade: true,
          previousSchool: true,
          status: true,
          decisionNote: true,
          admittedStudentId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
    } else if (selected === "staff") {
      const [staff, leave, payroll, departments] = await Promise.all([
        db.staffProfile.findMany({
          where: { schoolId: context.schoolId },
          select: {
            id: true,
            employeeNumber: true,
            membershipId: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            position: true,
            department: true,
            departmentId: true,
            isSenior: true,
            paidBy: true,
            payeNumber: true,
            nssaNumber: true,
            pscNumber: true,
            departmentRef: { select: { name: true } },
            employmentType: true,
            startDate: true,
            endDate: true,
            statusDetail: true,
            qualification: true,
            status: true,
          },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        }),
        db.leaveRequest.findMany({
          where: { schoolId: context.schoolId, staffProfile: { schoolId: context.schoolId } },
          select: {
            id: true,
            staffProfileId: true,
            leaveType: true,
            startDate: true,
            endDate: true,
            reason: true,
            status: true,
            staffProfile: { select: { firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        db.payrollRun.findMany({
          where: { schoolId: context.schoolId },
          select: {
            id: true,
            period: true,
            currency: true,
            status: true,
            totalGrossMinor: true,
            totalDeductionsMinor: true,
            totalNetMinor: true,
            createdById: true,
            entries: { select: { id: true, netMinor: true, staffProfile: { select: { firstName: true, lastName: true, employeeNumber: true } } } },
            _count: { select: { entries: true } },
          },
          orderBy: { period: "desc" },
          take: 36,
        }),
        db.department.findMany({
          where: { schoolId: context.schoolId, active: true },
          select: { id: true, name: true, head: { select: { firstName: true, lastName: true } } },
          orderBy: { name: "asc" },
        }),
      ]);
      records = staff.map((member) => ({ ...member, departmentName: member.departmentRef?.name ?? member.department }));
      secondary = {
        leave: leave.map((entry) => ({
          id: entry.id,
          staffProfileId: entry.staffProfileId,
          staffName: `${entry.staffProfile.firstName} ${entry.staffProfile.lastName}`,
          leaveType: entry.leaveType,
          startDate: entry.startDate,
          endDate: entry.endDate,
          reason: entry.reason,
          status: entry.status,
        })),
        payroll: payroll.map((run) => ({
          id: run.id,
          period: run.period,
          currency: run.currency,
          status: run.status,
          totalGrossMinor: run.totalGrossMinor,
          totalDeductionsMinor: run.totalDeductionsMinor,
          totalNetMinor: run.totalNetMinor,
          createdById: run.createdById,
          entries: run._count.entries,
          payslips: run.entries.map((entry) => ({ id: entry.id, netMinor: entry.netMinor, staffName: entry.staffProfile.firstName + " " + entry.staffProfile.lastName, employeeNumber: entry.staffProfile.employeeNumber })),
        })),
        departments: departments.map((department) => ({
          id: department.id,
          name: department.name,
          headName: department.head ? `${department.head.firstName} ${department.head.lastName}` : null,
        })),
      };
    } else if (selected === "communication") {
      const announcements = await db.announcement.findMany({
        where: { schoolId: context.schoolId },
        select: {
          id: true,
          title: true,
          body: true,
          audience: true,
          channel: true,
          status: true,
          publishAt: true,
          createdAt: true,
          outbox: {
            where: { schoolId: context.schoolId },
            select: { status: true, attemptCount: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      records = announcements.map((announcement) => ({
        id: announcement.id,
        title: announcement.title,
        body: announcement.body,
        audience: announcement.audience,
        channel: announcement.channel,
        status: announcement.status,
        publishAt: announcement.publishAt,
        createdAt: announcement.createdAt,
        deliveryStatus: announcement.outbox[0]?.status ?? null,
        attemptCount: announcement.outbox[0]?.attemptCount ?? null,
      }));
      const outboxRows = await db.communicationOutbox.findMany({
        where: { schoolId: context.schoolId, status: { in: ["queued", "failed", "sent", "unavailable"] } },
        select: {
          id: true, channel: true, recipientGroup: true, status: true, attemptCount: true, failureReason: true, sentAt: true, createdAt: true,
          announcement: { select: { title: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      secondary = {
        outbox: outboxRows.map((entry) => ({
          id: entry.id,
          announcementTitle: entry.announcement.title,
          channel: entry.channel,
          recipientGroup: entry.recipientGroup,
          status: entry.status,
          attemptCount: entry.attemptCount,
          failureReason: entry.failureReason,
          sentAt: entry.sentAt,
        })),
        delivery: [{ email: isEmailProviderConfigured(), sms: Boolean(process.env.SMS_WEBHOOK_URL?.trim()) }],
      };
    } else if (selected === "discipline") {
      const incidents = await db.disciplineIncident.findMany({
        where: { schoolId: context.schoolId, student: { schoolId: context.schoolId } },
        select: {
          id: true,
          studentId: true,
          incidentDate: true,
          category: true,
          severity: true,
          summary: true,
          actionTaken: true,
          status: true,
          guardianNotified: true,
          student: { select: { firstName: true, lastName: true, admissionNumber: true } },
        },
        orderBy: [{ incidentDate: "desc" }, { createdAt: "desc" }],
        take: 200,
      });
      records = incidents.map((incident) => ({
        id: incident.id,
        studentId: incident.studentId,
        studentName: `${incident.student.firstName} ${incident.student.lastName}`,
        admissionNumber: incident.student.admissionNumber,
        incidentDate: incident.incidentDate,
        category: incident.category,
        severity: incident.severity,
        summary: incident.summary,
        actionTaken: incident.actionTaken,
        status: incident.status,
        guardianNotified: incident.guardianNotified ? 1 : 0,
      }));
    } else if (selected === "clinic") {
      const visits = await db.clinicVisit.findMany({
        where: { schoolId: context.schoolId, student: { schoolId: context.schoolId } },
        select: {
          id: true,
          studentId: true,
          visitAt: true,
          complaint: true,
          observations: true,
          treatment: true,
          disposition: true,
          guardianNotified: true,
          status: true,
          closedAt: true,
          student: { select: { firstName: true, lastName: true, admissionNumber: true } },
        },
        orderBy: { visitAt: "desc" },
        take: 200,
      });
      records = visits.map((visit) => ({
        id: visit.id,
        studentId: visit.studentId,
        studentName: `${visit.student.firstName} ${visit.student.lastName}`,
        admissionNumber: visit.student.admissionNumber,
        visitAt: visit.visitAt,
        complaint: visit.complaint,
        observations: visit.observations,
        treatment: visit.treatment,
        disposition: visit.disposition,
        guardianNotified: visit.guardianNotified ? 1 : 0,
        status: visit.status,
        closedAt: visit.closedAt,
      }));
    } else if (selected === "library") {
      const [books, copies, loans] = await Promise.all([
        db.libraryBook.findMany({
          where: { schoolId: context.schoolId },
          select: {
            id: true,
            isbn: true,
            title: true,
            author: true,
            publisher: true,
            category: true,
            copies: { where: { schoolId: context.schoolId }, select: { status: true } },
          },
          orderBy: { title: "asc" },
        }),
        db.libraryCopy.findMany({
          where: { schoolId: context.schoolId, book: { schoolId: context.schoolId } },
          select: {
            id: true,
            bookId: true,
            accessionNumber: true,
            status: true,
            book: { select: { title: true } },
          },
          orderBy: [{ book: { title: "asc" } }, { accessionNumber: "asc" }],
        }),
        db.libraryLoan.findMany({
          where: {
            schoolId: context.schoolId,
            copy: { schoolId: context.schoolId, book: { schoolId: context.schoolId } },
            student: { schoolId: context.schoolId },
          },
          select: {
            id: true,
            copyId: true,
            studentId: true,
            issuedAt: true,
            dueAt: true,
            returnedAt: true,
            status: true,
            copy: { select: { accessionNumber: true, book: { select: { title: true } } } },
            student: { select: { firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
      ]);
      records = books.map((book) => ({
        id: book.id,
        isbn: book.isbn,
        title: book.title,
        author: book.author,
        publisher: book.publisher,
        category: book.category,
        copyCount: book.copies.length,
        availableCount: book.copies.filter((copy) => copy.status === "available").length,
      }));
      secondary = {
        copies: copies.map((copy) => ({
          id: copy.id,
          bookId: copy.bookId,
          accessionNumber: copy.accessionNumber,
          status: copy.status,
          title: copy.book.title,
        })),
        loans: loans.map((loan) => ({
          id: loan.id,
          copyId: loan.copyId,
          accessionNumber: loan.copy.accessionNumber,
          title: loan.copy.book.title,
          studentId: loan.studentId,
          studentName: `${loan.student.firstName} ${loan.student.lastName}`,
          issuedAt: loan.issuedAt,
          dueAt: loan.dueAt,
          returnedAt: loan.returnedAt,
          status: loan.status,
        })),
      };
    } else if (selected === "boarding") {
      const [dormitories, allocations] = await Promise.all([
        db.boardingDormitory.findMany({
          where: { schoolId: context.schoolId },
          select: {
            id: true,
            name: true,
            gender: true,
            capacity: true,
            active: true,
            allocations: { where: { schoolId: context.schoolId, status: "active" }, select: { id: true } },
          },
          orderBy: { name: "asc" },
        }),
        db.boardingAllocation.findMany({
          where: {
            schoolId: context.schoolId,
            dormitory: { schoolId: context.schoolId },
            student: { schoolId: context.schoolId },
          },
          select: {
            id: true,
            dormitoryId: true,
            studentId: true,
            bedLabel: true,
            startDate: true,
            endDate: true,
            status: true,
            dormitory: { select: { name: true } },
            student: { select: { firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      records = dormitories.map((dormitory) => ({
        id: dormitory.id,
        name: dormitory.name,
        gender: dormitory.gender,
        capacity: dormitory.capacity,
        active: dormitory.active ? 1 : 0,
        occupied: dormitory.allocations.length,
      }));
      secondary = {
        allocations: allocations.map((allocation) => ({
          id: allocation.id,
          dormitoryId: allocation.dormitoryId,
          dormitoryName: allocation.dormitory.name,
          studentId: allocation.studentId,
          studentName: `${allocation.student.firstName} ${allocation.student.lastName}`,
          bedLabel: allocation.bedLabel,
          startDate: allocation.startDate,
          endDate: allocation.endDate,
          status: allocation.status,
        })),
      };
    } else if (selected === "transport") {
      const [vehicles, routes, assignments] = await Promise.all([
        db.transportVehicle.findMany({
          where: { schoolId: context.schoolId },
          select: { id: true, registrationNumber: true, makeModel: true, capacity: true, status: true },
          orderBy: { registrationNumber: "asc" },
        }),
        db.transportRoute.findMany({
          where: { schoolId: context.schoolId },
          select: {
            id: true,
            name: true,
            vehicleId: true,
            driverName: true,
            description: true,
            status: true,
            vehicle: { select: { registrationNumber: true, schoolId: true } },
          },
          orderBy: { name: "asc" },
        }),
        db.transportAssignment.findMany({
          where: {
            schoolId: context.schoolId,
            route: { schoolId: context.schoolId },
            student: { schoolId: context.schoolId },
          },
          select: {
            id: true,
            routeId: true,
            studentId: true,
            pickupPoint: true,
            status: true,
            route: { select: { name: true } },
            student: { select: { firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      records = vehicles;
      secondary = {
        routes: routes.map((route) => ({
          id: route.id,
          name: route.name,
          vehicleId: route.vehicleId,
          vehicleRegistration: route.vehicle && route.vehicle.schoolId === context.schoolId ? route.vehicle.registrationNumber : null,
          driverName: route.driverName,
          description: route.description,
          status: route.status,
        })),
        assignments: assignments.map((assignment) => ({
          id: assignment.id,
          routeId: assignment.routeId,
          routeName: assignment.route.name,
          studentId: assignment.studentId,
          studentName: `${assignment.student.firstName} ${assignment.student.lastName}`,
          pickupPoint: assignment.pickupPoint,
          status: assignment.status,
        })),
      };
    } else if (selected === "inventory") {
      const [assets, maintenance] = await Promise.all([
        db.inventoryAsset.findMany({
          where: { schoolId: context.schoolId },
          select: {
            id: true,
            assetTag: true,
            name: true,
            category: true,
            serialNumber: true,
            purchaseDate: true,
            purchaseCostMinor: true,
            currency: true,
            condition: true,
            status: true,
            location: true,
            assignedTo: true,
          },
          orderBy: { name: "asc" },
        }),
        db.assetMaintenance.findMany({
          where: { schoolId: context.schoolId, asset: { schoolId: context.schoolId } },
          select: {
            id: true,
            assetId: true,
            maintenanceDate: true,
            description: true,
            provider: true,
            costMinor: true,
            currency: true,
            status: true,
            asset: { select: { assetTag: true, name: true } },
          },
          orderBy: { maintenanceDate: "desc" },
          take: 100,
        }),
      ]);
      records = assets;
      secondary = {
        maintenance: maintenance.map((entry) => ({
          id: entry.id,
          assetId: entry.assetId,
          assetTag: entry.asset.assetTag,
          assetName: entry.asset.name,
          maintenanceDate: entry.maintenanceDate,
          description: entry.description,
          provider: entry.provider,
          costMinor: entry.costMinor,
          currency: entry.currency,
          status: entry.status,
        })),
      };
    } else if (selected === "events") {
      records = await db.schoolEvent.findMany({
        where: { schoolId: context.schoolId },
        select: {
          id: true,
          title: true,
          category: true,
          startAt: true,
          endAt: true,
          location: true,
          audience: true,
          details: true,
          status: true,
        },
        orderBy: { startAt: "desc" },
        take: 200,
      });
    }
    else if (selected === "health") {
      records = (await db.healthRecord.findMany({
        where: { schoolId: context.schoolId },
        include: { student: { select: { firstName: true, lastName: true, admissionNumber: true, medicalAlert: true } } },
        orderBy: { updatedAt: "desc" },
        take: 300,
      })).map((h) => ({
        id: h.id, studentId: h.studentId,
        studentName: `${h.student.firstName} ${h.student.lastName}`,
        admissionNumber: h.student.admissionNumber,
        bloodGroup: h.bloodGroup, allergies: h.allergies, chronicConditions: h.chronicConditions,
        medications: h.medications, disabilities: h.disabilities,
        doctorName: h.doctorName, doctorPhone: h.doctorPhone, medicalAid: h.medicalAid,
        emergencyNotes: h.emergencyNotes, updatedAt: h.updatedAt,
      }));
    } else if (selected === "safeguarding") {
      records = (await db.safeguardingCase.findMany({
        where: { schoolId: context.schoolId },
        include: {
          student: { select: { firstName: true, lastName: true, admissionNumber: true } },
          reporter: { select: { displayName: true } },
          officer: { select: { displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      })).map((c) => ({
        id: c.id, studentId: c.studentId,
        studentName: `${c.student.firstName} ${c.student.lastName}`,
        admissionNumber: c.student.admissionNumber,
        concernType: c.concernType, details: c.details, status: c.status,
        reporter: c.reporter.displayName, officer: c.officer?.displayName ?? "",
        actions: c.actions ?? "", followUpAt: c.followUpAt, closedAt: c.closedAt, createdAt: c.createdAt,
      }));
      secondary = {
        officers: (await db.schoolMembership.findMany({
          where: { schoolId: context.schoolId, active: true, role: { in: ["headmaster", "deputy_head", "school_admin"] } },
          select: { id: true, displayName: true },
        })).map((o) => ({ id: o.id, name: o.displayName })),
      };
    } else if (selected === "sen") {
      records = (await db.specialNeed.findMany({
        where: { schoolId: context.schoolId },
        include: {
          student: { select: { firstName: true, lastName: true, admissionNumber: true } },
          responsible: { select: { displayName: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 200,
      })).map((n) => ({
        id: n.id, studentId: n.studentId,
        studentName: `${n.student.firstName} ${n.student.lastName}`,
        admissionNumber: n.student.admissionNumber,
        category: n.category, assessmentSummary: n.assessmentSummary ?? "",
        interventionPlan: n.interventionPlan ?? "", accommodations: n.accommodations ?? "",
        responsible: n.responsible?.displayName ?? "", targets: n.targets ?? "",
        reviewDate: n.reviewDate, status: n.status,
      }));
    } else if (selected === "pickups") {
      records = (await db.pickupAuthorization.findMany({
        where: { schoolId: context.schoolId },
        include: {
          student: { select: { firstName: true, lastName: true, admissionNumber: true } },
          authorizedBy: { select: { displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 300,
      })).map((p) => ({
        id: p.id, studentId: p.studentId,
        studentName: `${p.student.firstName} ${p.student.lastName}`,
        admissionNumber: p.student.admissionNumber,
        name: p.name, relationship: p.relationship, phone: p.phone, idNumber: p.idNumber ?? "",
        validFrom: p.validFrom, validTo: p.validTo, status: p.status, authorizedBy: p.authorizedBy.displayName,
      }));
    } else if (selected === "activities") {
      const [clubs, clubMembers, trips, participants] = await Promise.all([
        db.club.findMany({
          where: { schoolId: context.schoolId },
          include: { coordinator: { select: { displayName: true } }, _count: { select: { members: { where: { status: "active" } } } } },
          orderBy: { name: "asc" },
        }),
        db.clubMembership.findMany({
          where: { schoolId: context.schoolId, status: "active" },
          include: { student: { select: { firstName: true, lastName: true, admissionNumber: true } }, club: { select: { name: true } } },
          orderBy: { joinedAt: "desc" },
          take: 300,
        }),
        db.schoolTrip.findMany({
          where: { schoolId: context.schoolId },
          include: { coordinator: { select: { displayName: true } }, _count: { select: { participants: true } } },
          orderBy: { startDate: "desc" },
          take: 100,
        }),
        db.tripParticipant.findMany({
          where: { schoolId: context.schoolId },
          include: { student: { select: { firstName: true, lastName: true, admissionNumber: true } }, trip: { select: { title: true } } },
          orderBy: { status: "asc" },
          take: 400,
        }),
      ]);
      records = clubs.map((c) => ({
        id: c.id, name: c.name, category: c.category ?? "", schedule: c.schedule ?? "",
        coordinator: c.coordinator?.displayName ?? "", members: c._count.members, status: c.status,
      }));
      secondary = {
        clubMembers: clubMembers.map((m) => ({ id: m.id, club: m.club.name, clubId: m.clubId, studentId: m.studentId, studentName: `${m.student.firstName} ${m.student.lastName}`, role: m.role ?? "", joinedAt: m.joinedAt })),
        trips: trips.map((t) => ({ id: t.id, title: t.title, destination: t.destination, startDate: t.startDate, endDate: t.endDate, costMinor: t.costMinor, currency: t.currency, coordinator: t.coordinator?.displayName ?? "", participants: t._count.participants, status: t.status })),
        tripParticipants: participants.map((p) => ({ id: p.id, trip: p.trip.title, tripId: p.tripId, studentId: p.studentId, studentName: `${p.student.firstName} ${p.student.lastName}`, consentStatus: p.consentStatus, paidMinor: p.paidMinor, status: p.status })),
      };
    }

    return Response.json({ module: selected, records, secondary, references, permissions: { manage: hasPermission(context.role, `${selected}.manage`), payroll: hasPermission(context.role, "payroll.manage") } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    await guardMutation(request, "operations");
    const context = await getSchoolContext(request);
    const raw = await request.json();
    const action = z.object({ action: z.string() }).parse(raw).action;
    const db = getDb();

    if (action === "create_application") {
      requirePermission(context, "admissions.manage");
      const input = z.object({ action: z.literal("create_application"), firstName: z.string().trim().min(2).max(80), lastName: z.string().trim().min(2).max(80), gender: z.enum(["female", "male", "other"]), dateOfBirth: date, guardianName: z.string().trim().min(2).max(120), guardianPhone: z.string().trim().min(7).max(30), requestedGrade: z.string().trim().min(1).max(60), previousSchool: z.string().trim().max(120).optional() }).parse(raw);
      const id = crypto.randomUUID(); const applicationNumber = referenceNumber("APP", context.schoolCode);
      await db.admissionApplication.create({
        data: {
          id,
          schoolId: context.schoolId,
          applicationNumber,
          firstName: input.firstName,
          lastName: input.lastName,
          gender: input.gender,
          dateOfBirth: new Date(input.dateOfBirth),
          guardianName: input.guardianName,
          guardianPhone: input.guardianPhone,
          requestedGrade: input.requestedGrade,
          previousSchool: input.previousSchool || null,
          createdById: context.membershipId,
        },
      });
      return Response.json({ id, applicationNumber }, { status: 201 });
    }

    if (action === "set_application_status") {
      requirePermission(context, "admissions.manage");
      const input = z.object({ action: z.literal("set_application_status"), applicationId: uuid, status: z.enum(["reviewing", "approved", "waitlisted", "rejected"]), note: z.string().trim().min(3).max(300) }).parse(raw);
      const existing = await db.admissionApplication.findFirst({
        where: { id: input.applicationId, schoolId: context.schoolId, status: { notIn: ["admitted", "rejected"] } },
        select: { id: true, status: true },
      });
      if (!existing) return Response.json({ error: "This application cannot move to that status." }, { status: 409 });
      await db.admissionApplication.update({
        where: { id: input.applicationId, schoolId: context.schoolId },
        data: { status: input.status, decisionNote: input.note },
      });
      return Response.json({ updated: true });
    }

    if (action === "admit_application") {
      requirePermission(context, "admissions.admit");
      const input = z.object({ action: z.literal("admit_application"), applicationId: uuid, classroomId: uuid }).parse(raw);
      const application = await db.admissionApplication.findFirst({
        where: { id: input.applicationId, schoolId: context.schoolId, status: "approved", admittedStudentId: null },
      });
      if (!application) return Response.json({ error: "Only an approved, unregistered application can be admitted." }, { status: 409 });
      const classroom = await db.classroom.findFirst({
        where: { id: input.classroomId, schoolId: context.schoolId, active: true },
        select: {
          id: true,
          academicYearId: true,
          gradeLevelId: true,
          capacity: true,
          _count: { select: { students: { where: { schoolId: context.schoolId, status: "active" } } } },
        },
      });
      if (!classroom?.academicYearId || !classroom.gradeLevelId || classroom._count.students >= classroom.capacity) return Response.json({ error: "Select an active class with capacity and a configured academic year." }, { status: 400 });
      const guardianExisting = await db.guardian.findFirst({
        where: { schoolId: context.schoolId, phone: application.guardianPhone },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      const guardianId = guardianExisting?.id ?? crypto.randomUUID();
      const studentId = crypto.randomUUID();
      const guardianParts = application.guardianName.trim().split(/\s+/); const guardianFirst = guardianParts.shift() || "Guardian"; const guardianLast = guardianParts.join(" ") || application.lastName;
      const admissionNumber = referenceNumber("STU", context.schoolCode);
      const today = new Date().toISOString().slice(0, 10);
      await db.$transaction([
        ...(!guardianExisting ? [db.guardian.create({
          data: {
            id: guardianId,
            schoolId: context.schoolId,
            firstName: guardianFirst,
            lastName: guardianLast,
            phone: application.guardianPhone,
            relationship: "guardian",
          },
        })] : []),
        db.student.create({
          data: {
            id: studentId,
            schoolId: context.schoolId,
            admissionNumber,
            firstName: application.firstName,
            lastName: application.lastName,
            gender: application.gender,
            dateOfBirth: application.dateOfBirth,
            admissionDate: new Date(today),
            status: "active",
            classroomId: classroom.id,
            applicationId: application.id,
          },
        }),
        db.studentGuardian.create({
          data: {
            studentId,
            guardianId,
            relationshipType: "guardian",
            isPrimaryContact: true,
            authorizedPickup: true,
          },
        }),
        db.studentEnrollment.create({
          data: {
            id: crypto.randomUUID(),
            studentId,
            schoolId: context.schoolId,
            academicYearId: classroom.academicYearId,
            gradeLevelId: classroom.gradeLevelId,
            classroomId: classroom.id,
            enrollmentDate: new Date(today),
            status: "active",
          },
        }),
        db.admissionApplication.updateMany({
          where: { id: application.id, schoolId: context.schoolId, admittedStudentId: null },
          data: { status: "admitted", admittedStudentId: studentId },
        }),
      ]);
      let onboarding: unknown = null;
      try {
        onboarding = await onboardStudent(db, context, studentId);
      } catch (onboardingError) {
        console.error("student onboarding failed", onboardingError);
      }
      return Response.json({ studentId, admissionNumber, onboarding }, { status: 201 });
    }

    if (action === "create_staff") {
      requirePermission(context, "staff.manage");
      const input = z.object({ action: z.literal("create_staff"), firstName: z.string().trim().min(2).max(80), lastName: z.string().trim().min(2).max(80), email: z.string().email().optional().or(z.literal("")), phone: z.string().trim().max(30).optional(), position: z.string().trim().min(2).max(100), department: z.string().trim().max(80).optional(), departmentId: uuid.optional().or(z.literal("")), isSenior: z.boolean().optional(), employmentType: z.enum(["permanent", "contract", "temporary", "volunteer", "student_teacher"]), paidBy: z.enum(["school", "government"]).optional(), payeNumber: z.string().trim().max(30).optional(), nssaNumber: z.string().trim().max(30).optional(), pscNumber: z.string().trim().max(30).optional(), startDate: date, qualification: z.string().trim().max(200).optional() }).parse(raw);
      if (input.departmentId) {
        const department = await db.department.findFirst({ where: { id: input.departmentId, schoolId: context.schoolId, active: true }, select: { id: true, name: true } });
        if (!department) return Response.json({ error: "Department not found." }, { status: 404 });
      }
      const id = crypto.randomUUID(); const employeeNumber = referenceNumber("EMP", context.schoolCode);
      await db.staffProfile.create({
        data: {
          id,
          schoolId: context.schoolId,
          employeeNumber,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email || null,
          phone: input.phone || null,
          position: input.position,
          department: input.department || null,
          departmentId: input.departmentId || null,
          isSenior: input.isSenior ?? false,
          paidBy: input.paidBy ?? (input.employmentType === "student_teacher" ? "school" : "government"),
          payeNumber: input.payeNumber || null,
          nssaNumber: input.nssaNumber || null,
          pscNumber: input.pscNumber || null,
          employmentType: input.employmentType,
          startDate: new Date(input.startDate),
          qualification: input.qualification || null,
        },
      });
      return Response.json({ id, employeeNumber }, { status: 201 });
    }

    if (action === "update_staff") {
      requirePermission(context, "staff.manage");
      const input = z.object({
        action: z.literal("update_staff"),
        staffId: uuid,
        departmentId: uuid.optional().or(z.literal("")),
        isSenior: z.boolean().optional(),
        paidBy: z.enum(["school", "government"]).optional(),
        payeNumber: z.string().trim().max(30).optional(),
        nssaNumber: z.string().trim().max(30).optional(),
        pscNumber: z.string().trim().max(30).optional(),
        position: z.string().trim().min(2).max(100).optional(),
      }).parse(raw);
      const existing = await db.staffProfile.findFirst({
        where: { id: input.staffId, schoolId: context.schoolId },
        select: { id: true },
      });
      if (!existing) return Response.json({ error: "Staff member not found." }, { status: 404 });
      if (input.departmentId) {
        const department = await db.department.findFirst({ where: { id: input.departmentId, schoolId: context.schoolId, active: true }, select: { id: true } });
        if (!department) return Response.json({ error: "Department not found." }, { status: 404 });
      }
      await db.staffProfile.update({
        where: { id: input.staffId },
        data: {
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId || null } : {}),
          ...(input.isSenior !== undefined ? { isSenior: input.isSenior } : {}),
          ...(input.paidBy !== undefined ? { paidBy: input.paidBy } : {}),
          ...(input.payeNumber !== undefined ? { payeNumber: input.payeNumber || null } : {}),
          ...(input.nssaNumber !== undefined ? { nssaNumber: input.nssaNumber || null } : {}),
          ...(input.pscNumber !== undefined ? { pscNumber: input.pscNumber || null } : {}),
          ...(input.position ? { position: input.position } : {}),
        },
      });
      return Response.json({ updated: true });
    }

    if (action === "deactivate_staff") {
      requirePermission(context, "staff.manage");
      const input = z.object({ action: z.literal("deactivate_staff"), staffId: uuid }).parse(raw);
      const existing = await db.staffProfile.findFirst({
        where: { id: input.staffId, schoolId: context.schoolId, status: "active" },
        select: { id: true },
      });
      if (!existing) return Response.json({ error: "Active staff record not found." }, { status: 404 });
      await db.staffProfile.update({
        where: { id: input.staffId, schoolId: context.schoolId },
        data: { status: "inactive" },
      });
      return Response.json({ updated: true });
    }

    if (action === "end_staff_employment") {
      requirePermission(context, "staff.manage");
      const input = z.object({
        action: z.literal("end_staff_employment"),
        staffId: uuid,
        outcome: z.enum(["transferred", "retired", "resigned", "dismissed", "end_of_attachment"]),
        endDate: date,
        detail: z.string().trim().max(200).optional(),
        replacementMembershipId: uuid.optional().or(z.literal("")),
      }).parse(raw);
      const staff = await db.staffProfile.findFirst({
        where: { id: input.staffId, schoolId: context.schoolId, status: { in: ["active", "inactive"] } },
        select: { id: true, firstName: true, lastName: true, membershipId: true, employmentType: true },
      });
      if (!staff) return Response.json({ error: "Staff record not found or already ended." }, { status: 404 });
      if (staff.employmentType === "student_teacher" && input.outcome !== "end_of_attachment") {
        return Response.json({ error: "Student teachers end their placement via 'End of attachment'." }, { status: 400 });
      }
      const replacementId = input.replacementMembershipId || null;
      if (replacementId) {
        if (replacementId === staff.membershipId) {
          return Response.json({ error: "The replacement cannot be the departing member." }, { status: 400 });
        }
        const replacement = await db.schoolMembership.findFirst({
          where: { id: replacementId, schoolId: context.schoolId, active: true },
          select: { id: true },
        });
        if (!replacement) return Response.json({ error: "Replacement member not found." }, { status: 404 });
      }
      const reassigned = { subjects: 0, classes: 0, timetable: 0 };
      await db.$transaction(async (tx) => {
        await tx.staffProfile.update({
          where: { id: staff.id },
          data: { status: input.outcome, endDate: new Date(input.endDate), statusDetail: input.detail || null },
        });
        // Leaving staff must not keep portal access.
        if (staff.membershipId) {
          await tx.schoolMembership.updateMany({ where: { id: staff.membershipId, schoolId: context.schoolId }, data: { active: false } });
        }
        // Department head duties revert to unassigned — a different officer should
        // confirm the successor rather than silently moving them.
        await tx.department.updateMany({ where: { schoolId: context.schoolId, headStaffProfileId: staff.id }, data: { headStaffProfileId: null } });
        // Teaching load moves to the replacement, or goes unassigned.
        if (staff.membershipId) {
          const subjects = await tx.classSubject.updateMany({ where: { schoolId: context.schoolId, teacherId: staff.membershipId }, data: { teacherId: replacementId } });
          const classes = await tx.classroom.updateMany({ where: { schoolId: context.schoolId, classTeacherId: staff.membershipId }, data: { classTeacherId: replacementId } });
          const timetable = await tx.timetableEntry.updateMany({ where: { schoolId: context.schoolId, teacherId: staff.membershipId }, data: { teacherId: replacementId } });
          reassigned.subjects = subjects.count;
          reassigned.classes = classes.count;
          reassigned.timetable = timetable.count;
        }
        await tx.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: `staff.${input.outcome}`,
            entityType: "staff_profile",
            entityId: staff.id,
            details: JSON.stringify({ name: `${staff.firstName} ${staff.lastName}`, detail: input.detail ?? null, replacementMembershipId: replacementId, reassigned }),
          },
        });
      });
      return Response.json({ updated: true, reassigned });
    }

    if (action === "create_leave") {
      requirePermission(context, "staff.manage");
      const input = z.object({ action: z.literal("create_leave"), staffId: uuid, leaveType: z.string().trim().min(2).max(60), startDate: date, endDate: date, reason: z.string().trim().max(300).optional() }).parse(raw);
      const idemKey = idempotencyKey(request);
      const idemHash = requestHash(input);
      const replay = await replayIdempotent(db, context, input.action, idemKey, idemHash);
      if (replay) return replay;
      if (input.endDate < input.startDate) return Response.json({ error: "Leave end date cannot be before the start date." }, { status: 400 });
      const staff = await db.staffProfile.findFirst({
        where: { id: input.staffId, schoolId: context.schoolId, status: "active" },
        select: { id: true },
      });
      if (!staff) return Response.json({ error: "Staff member not found." }, { status: 404 });
      const id = crypto.randomUUID();
      await db.leaveRequest.create({
        data: {
          id,
          schoolId: context.schoolId,
          staffProfileId: input.staffId,
          leaveType: input.leaveType,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          reason: input.reason || null,
          requestedById: context.membershipId,
        },
      });
      await storeIdempotent(db, context, input.action, idemKey, idemHash, 201, { id });
      return Response.json({ id }, { status: 201 });
    }

    if (action === "convert_trainee") {
      requirePermission(context, "staff.manage");
      const input = z.object({
        action: z.literal("convert_trainee"),
        staffId: uuid,
        employmentType: z.enum(["permanent", "contract"]),
        position: z.string().trim().min(2).max(100).optional(),
        departmentId: uuid.optional().or(z.literal("")),
      }).parse(raw);
      const staff = await db.staffProfile.findFirst({
        where: { id: input.staffId, schoolId: context.schoolId, status: "active", employmentType: "student_teacher" },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!staff) return Response.json({ error: "Active student-teacher profile not found." }, { status: 404 });
      if (input.departmentId) {
        const department = await db.department.findFirst({ where: { id: input.departmentId, schoolId: context.schoolId, active: true }, select: { id: true } });
        if (!department) return Response.json({ error: "Department not found." }, { status: 404 });
      }
      await db.$transaction([
        db.staffProfile.update({
          where: { id: staff.id },
          data: {
            employmentType: input.employmentType,
            paidBy: input.employmentType === "permanent" ? "government" : undefined,
            ...(input.position ? { position: input.position } : {}),
            ...(input.departmentId !== undefined ? { departmentId: input.departmentId || null } : {}),
            statusDetail: null,
          },
        }),
        db.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: "staff.trainee_converted",
            entityType: "staff_profile",
            entityId: staff.id,
            details: JSON.stringify({ name: `${staff.firstName} ${staff.lastName}`, employmentType: input.employmentType }),
          },
        }),
      ]);
      return Response.json({ converted: true });
    }

    if (action === "decide_leave") {
      requirePermission(context, "staff.manage");
      const input = z.object({ action: z.literal("decide_leave"), leaveId: uuid, decision: z.enum(["approved", "rejected"]) }).parse(raw);
      const existing = await db.leaveRequest.findFirst({
        where: { id: input.leaveId, schoolId: context.schoolId, status: "pending" },
        select: { id: true },
      });
      if (!existing) return Response.json({ error: "Pending leave request not found." }, { status: 404 });
      await db.leaveRequest.update({
        where: { id: input.leaveId, schoolId: context.schoolId },
        data: { status: input.decision, decidedById: context.membershipId, decidedAt: new Date() },
      });
      return Response.json({ updated: true });
    }

    if (action === "create_payroll_run") {
      requirePermission(context, "payroll.manage");
      const input = z.object({
        action: z.literal("create_payroll_run"),
        period: z.string().regex(/^\d{4}-\d{2}$/),
        currency: z.enum(["USD", "ZWG"]),
        entries: z.array(z.object({
          staffProfileId: uuid,
          basic: z.number().min(0).max(1_000_000),
          allowances: z.number().min(0).max(1_000_000).default(0),
          deductions: z.number().min(0).max(1_000_000).default(0),
          note: z.string().trim().max(200).optional(),
        })).min(1).max(300),
      }).parse(raw);

      const staffIds = input.entries.map((entry) => entry.staffProfileId);
      if (new Set(staffIds).size !== staffIds.length) {
        return Response.json({ error: "Each employee can only appear once in a run." }, { status: 400 });
      }
      const staff = await db.staffProfile.findMany({
        where: { id: { in: staffIds }, schoolId: context.schoolId, status: "active" },
        select: { id: true, paidBy: true, firstName: true, lastName: true },
      });
      if (staff.length !== staffIds.length) {
        return Response.json({ error: "Every entry must belong to an active staff member of this school." }, { status: 400 });
      }
      const governmentPaid = staff.filter((member) => member.paidBy === "government");
      if (governmentPaid.length) {
        const names = governmentPaid.map((m) => `${m.firstName} ${m.lastName}`).join(", ");
        return Response.json({ error: `Government-paid staff are on the PSC payroll — remove: ${names}.` }, { status: 400 });
      }
      const duplicate = await db.payrollRun.findFirst({
        where: { schoolId: context.schoolId, period: input.period, currency: input.currency },
        select: { id: true },
      });
      if (duplicate) return Response.json({ error: `A ${input.currency} payroll run already exists for ${input.period}.` }, { status: 409 });

      const runId = crypto.randomUUID();
      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      await db.$transaction(async (tx) => {
        await tx.payrollRun.create({
          data: { id: runId, schoolId: context.schoolId, period: input.period, currency: input.currency, status: "draft", createdById: context.membershipId },
        });
        for (const entry of input.entries) {
          const basic = Math.round(entry.basic * 100);
          const allowances = Math.round(entry.allowances * 100);
          const deductions = Math.round(entry.deductions * 100);
          const net = basic + allowances - deductions;
          if (net < 0) throw new Error("negative_net");
          totalGross += basic + allowances;
          totalDeductions += deductions;
          totalNet += net;
          await tx.payrollEntry.create({
            data: { schoolId: context.schoolId, payrollRunId: runId, staffProfileId: entry.staffProfileId, basicMinor: basic, allowancesMinor: allowances, deductionsMinor: deductions, netMinor: net, note: entry.note || null },
          });
        }
        await tx.payrollRun.update({ where: { id: runId }, data: { totalGrossMinor: totalGross, totalDeductionsMinor: totalDeductions, totalNetMinor: totalNet } });
        await tx.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: "payroll.run_created",
            entityType: "payroll_run",
            entityId: runId,
            details: JSON.stringify({ period: input.period, currency: input.currency, staff: staffIds.length, totalNetMinor: totalNet }),
          },
        });
      });
      return Response.json({ id: runId, totalNetMinor: totalNet }, { status: 201 });
    }

    if (action === "approve_payroll_run") {
      requirePermission(context, "payroll.manage");
      const input = z.object({ action: z.literal("approve_payroll_run"), payrollRunId: uuid }).parse(raw);
      const run = await db.payrollRun.findFirst({
        where: { id: input.payrollRunId, schoolId: context.schoolId, status: "draft" },
        select: { id: true, period: true, createdById: true },
      });
      if (!run) return Response.json({ error: "Draft payroll run not found." }, { status: 404 });
      // Separation of duties: the person who prepared the run cannot approve it.
      if (run.createdById === context.membershipId) {
        return Response.json({ error: "A payroll run must be approved by a different officer than its creator." }, { status: 409 });
      }
      await db.$transaction([
        db.payrollRun.update({ where: { id: run.id }, data: { status: "approved", approvedById: context.membershipId, approvedAt: new Date() } }),
        db.auditLog.create({
          data: {
            schoolId: context.schoolId,
            actorMembershipId: context.membershipId,
            action: "payroll.run_approved",
            entityType: "payroll_run",
            entityId: run.id,
            details: JSON.stringify({ period: run.period }),
          },
        }),
      ]);
      return Response.json({ updated: true });
    }

    return await handleOperationalAction(context, raw, action);
  } catch (error) {
    return fail(error);
  }
}

async function handleOperationalAction(context: SchoolContext, raw: unknown, action: string) {
  const db = getDb();

  if (isCommunicationAction(action)) return handleCommunicationAction(db, context, raw, action);
  if (action === "create_discipline") {
    requirePermission(context, "discipline.manage");
    const input = z.object({ action: z.literal("create_discipline"), studentId: uuid, incidentDate: date, category: z.string().trim().min(2).max(80), severity: z.enum(["low", "medium", "high", "critical", "positive"]), summary: z.string().trim().min(5).max(1000), actionTaken: z.string().trim().max(500).optional(), guardianNotified: z.boolean().default(false) }).parse(raw);
    const student = await requireStudent(db, context, input.studentId); const id = crypto.randomUUID();
    await db.disciplineIncident.create({
      data: {
        id,
        schoolId: context.schoolId,
        studentId: input.studentId,
        incidentDate: new Date(input.incidentDate),
        category: input.category,
        severity: input.severity,
        summary: input.summary,
        actionTaken: input.actionTaken || null,
        guardianNotified: input.guardianNotified,
        reportedById: context.membershipId,
      },
    });
    let notification = null;
    if (input.guardianNotified) {
      notification = await notifyStudentGuardians(
        db, context, input.studentId,
        `Discipline notice — ${student.firstName} ${student.lastName}`,
        `A ${input.severity} disciplinary incident (${input.category}) was recorded for ${student.firstName} ${student.lastName} on ${input.incidentDate}. Please contact the school office for details.`,
      );
    }
    return Response.json({ id, notification }, { status: 201 });
  }
  if (action === "resolve_discipline") {
    requirePermission(context, "discipline.manage");
    const input = z.object({ action: z.literal("resolve_discipline"), incidentId: uuid, actionTaken: z.string().trim().min(3).max(500) }).parse(raw);
    const existing = await db.disciplineIncident.findFirst({
      where: { id: input.incidentId, schoolId: context.schoolId, status: "open" },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Open incident not found." }, { status: 404 });
    await db.disciplineIncident.update({
      where: { id: input.incidentId, schoolId: context.schoolId },
      data: { status: "resolved", actionTaken: input.actionTaken },
    });
    return Response.json({ updated: true });
  }
  if (action === "create_clinic_visit") {
    requirePermission(context, "clinic.manage");
    const input = z.object({ action: z.literal("create_clinic_visit"), studentId: uuid, visitAt: dateTime, complaint: z.string().trim().min(3).max(500), observations: z.string().trim().max(1000).optional(), treatment: z.string().trim().max(1000).optional(), disposition: z.enum(["returned_to_class", "sent_home", "referred", "observation"]), guardianNotified: z.boolean().default(false) }).parse(raw);
    const clinicStudent = await requireStudent(db, context, input.studentId); const id = crypto.randomUUID();
    await db.clinicVisit.create({
      data: {
        id,
        schoolId: context.schoolId,
        studentId: input.studentId,
        visitAt: new Date(input.visitAt),
        complaint: input.complaint,
        observations: input.observations || null,
        treatment: input.treatment || null,
        disposition: input.disposition,
        guardianNotified: input.guardianNotified,
        clinicianId: context.membershipId,
      },
    });
    let notification = null;
    if (input.guardianNotified) {
      notification = await notifyStudentGuardians(
        db, context, input.studentId,
        `Clinic notice — ${clinicStudent.firstName} ${clinicStudent.lastName}`,
        `${clinicStudent.firstName} ${clinicStudent.lastName} visited the school clinic on ${input.visitAt.slice(0, 10)} (disposition: ${input.disposition.replaceAll("_", " ")}). Please contact the school office for details.`,
      );
    }
    return Response.json({ id, notification }, { status: 201 });
  }
  if (action === "close_clinic_visit") {
    requirePermission(context, "clinic.manage");
    const input = z.object({ action: z.literal("close_clinic_visit"), visitId: uuid }).parse(raw);
    const existing = await db.clinicVisit.findFirst({
      where: { id: input.visitId, schoolId: context.schoolId, status: "open" },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Open clinic visit not found." }, { status: 404 });
    await db.clinicVisit.update({
      where: { id: input.visitId, schoolId: context.schoolId },
      data: { status: "closed", closedAt: new Date() },
    });
    return Response.json({ updated: true });
  }
  return await handleResourceAction(context, raw, action);
}

async function requireStudent(db: ReturnType<typeof getDb>, context: SchoolContext, studentId: string) {
  const student = await db.student.findFirst({
    where: { id: studentId, schoolId: context.schoolId, status: "active", archivedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!student) throw new Response("Active student not found.", { status: 404 });
  return student;
}

async function handleResourceAction(context: SchoolContext, raw: unknown, action: string) {
  const db = getDb();
  if (action === "add_library_book") {
    requirePermission(context, "library.manage");
    const input = z.object({ action: z.literal("add_library_book"), isbn: z.string().trim().max(30).optional(), title: z.string().trim().min(2).max(180), author: z.string().trim().min(2).max(140), publisher: z.string().trim().max(140).optional(), category: z.string().trim().max(80).optional(), accessionNumber: z.string().trim().min(2).max(60) }).parse(raw);
    const bookId = crypto.randomUUID(); const copyId = crypto.randomUUID();
    await db.$transaction([
      db.libraryBook.create({
        data: {
          id: bookId,
          schoolId: context.schoolId,
          isbn: input.isbn || null,
          title: input.title,
          author: input.author,
          publisher: input.publisher || null,
          category: input.category || null,
        },
      }),
      db.libraryCopy.create({
        data: {
          id: copyId,
          schoolId: context.schoolId,
          bookId,
          accessionNumber: input.accessionNumber.toUpperCase(),
        },
      }),
    ]);
    return Response.json({ bookId, copyId }, { status: 201 });
  }
  if (action === "add_library_copy") {
    requirePermission(context, "library.manage");
    const input = z.object({ action: z.literal("add_library_copy"), bookId: uuid, accessionNumber: z.string().trim().min(2).max(60) }).parse(raw);
    const book = await db.libraryBook.findFirst({
      where: { id: input.bookId, schoolId: context.schoolId },
      select: { id: true },
    });
    if (!book) return Response.json({ error: "Library title not found." }, { status: 404 });
    const copyId = crypto.randomUUID();
    await db.libraryCopy.create({
      data: {
        id: copyId,
        schoolId: context.schoolId,
        bookId: input.bookId,
        accessionNumber: input.accessionNumber.toUpperCase(),
      },
    });
    return Response.json({ copyId }, { status: 201 });
  }
  if (action === "checkout_library_book") {
    requirePermission(context, "library.manage");
    const input = z.object({ action: z.literal("checkout_library_book"), copyId: uuid, studentId: uuid, issuedAt: date, dueAt: date }).parse(raw);
    if (input.dueAt < input.issuedAt) return Response.json({ error: "The due date must be after the issue date." }, { status: 400 });
    await requireStudent(db, context, input.studentId);
    const copy = await db.libraryCopy.findFirst({
      where: { id: input.copyId, schoolId: context.schoolId, status: "available" },
      select: { id: true },
    });
    if (!copy) return Response.json({ error: "This copy is not available." }, { status: 409 });
    const id = crypto.randomUUID();
    await db.$transaction([
      db.libraryCopy.updateMany({
        where: { id: input.copyId, schoolId: context.schoolId, status: "available" },
        data: { status: "borrowed" },
      }),
      db.libraryLoan.create({
        data: {
          id,
          schoolId: context.schoolId,
          copyId: input.copyId,
          studentId: input.studentId,
          issuedAt: new Date(input.issuedAt),
          dueAt: new Date(input.dueAt),
          issuedById: context.membershipId,
        },
      }),
    ]);
    return Response.json({ id }, { status: 201 });
  }
  if (action === "return_library_loan") {
    requirePermission(context, "library.manage");
    const input = z.object({ action: z.literal("return_library_loan"), loanId: uuid, returnedAt: date }).parse(raw);
    const loan = await db.libraryLoan.findFirst({
      where: { id: input.loanId, schoolId: context.schoolId, status: "issued" },
      select: { id: true, copyId: true },
    });
    if (!loan) return Response.json({ error: "Open library loan not found." }, { status: 404 });
    await db.$transaction([
      db.libraryLoan.update({
        where: { id: loan.id, schoolId: context.schoolId },
        data: { status: "returned", returnedAt: new Date(input.returnedAt) },
      }),
      db.libraryCopy.update({
        where: { id: loan.copyId, schoolId: context.schoolId },
        data: { status: "available" },
      }),
    ]);
    return Response.json({ updated: true });
  }

  if (action === "add_dormitory") {
    requirePermission(context, "boarding.manage");
    const input = z.object({ action: z.literal("add_dormitory"), name: z.string().trim().min(2).max(100), gender: z.enum(["female", "male", "mixed"]), capacity: z.number().int().min(1).max(1000) }).parse(raw);
    const id = crypto.randomUUID();
    await db.boardingDormitory.create({
      data: {
        id,
        schoolId: context.schoolId,
        name: input.name,
        gender: input.gender,
        capacity: input.capacity,
      },
    });
    return Response.json({ id }, { status: 201 });
  }
  if (action === "assign_boarder") {
    requirePermission(context, "boarding.manage");
    const input = z.object({ action: z.literal("assign_boarder"), dormitoryId: uuid, studentId: uuid, bedLabel: z.string().trim().min(1).max(30), startDate: date }).parse(raw);
    const [student, dormitory] = await Promise.all([
      db.student.findFirst({
        where: { id: input.studentId, schoolId: context.schoolId, status: "active", archivedAt: null },
        select: { id: true, gender: true },
      }),
      db.boardingDormitory.findFirst({
        where: { id: input.dormitoryId, schoolId: context.schoolId, active: true },
        select: {
          id: true,
          gender: true,
          capacity: true,
          _count: { select: { allocations: { where: { schoolId: context.schoolId, status: "active" } } } },
        },
      }),
    ]);
    if (!student || !dormitory) return Response.json({ error: "Active learner or dormitory not found." }, { status: 404 });
    if (dormitory.gender !== "mixed" && dormitory.gender !== student.gender) return Response.json({ error: "The learner does not match this dormitory allocation." }, { status: 400 });
    if (dormitory._count.allocations >= dormitory.capacity) return Response.json({ error: "This dormitory is at capacity." }, { status: 409 });
    const id = crypto.randomUUID();
    await db.$transaction([
      db.boardingAllocation.create({
        data: {
          id,
          schoolId: context.schoolId,
          dormitoryId: dormitory.id,
          studentId: student.id,
          bedLabel: input.bedLabel,
          startDate: new Date(input.startDate),
          assignedById: context.membershipId,
        },
      }),
      db.student.update({
        where: { id: student.id, schoolId: context.schoolId },
        data: { boardingStatus: "boarder" },
      }),
    ]);
    return Response.json({ id }, { status: 201 });
  }
  if (action === "release_boarder") {
    requirePermission(context, "boarding.manage");
    const input = z.object({ action: z.literal("release_boarder"), allocationId: uuid, endDate: date }).parse(raw);
    const allocation = await db.boardingAllocation.findFirst({
      where: { id: input.allocationId, schoolId: context.schoolId, status: "active" },
      select: { id: true, studentId: true },
    });
    if (!allocation) return Response.json({ error: "Active boarding allocation not found." }, { status: 404 });
    await db.$transaction([
      db.boardingAllocation.update({
        where: { id: allocation.id, schoolId: context.schoolId },
        data: { status: "released", endDate: new Date(input.endDate) },
      }),
      db.student.update({
        where: { id: allocation.studentId, schoolId: context.schoolId },
        data: { boardingStatus: "day_scholar" },
      }),
    ]);
    return Response.json({ updated: true });
  }

  if (action === "add_vehicle") {
    requirePermission(context, "transport.manage");
    const input = z.object({ action: z.literal("add_vehicle"), registrationNumber: z.string().trim().min(2).max(30), makeModel: z.string().trim().min(2).max(120), capacity: z.number().int().min(1).max(150) }).parse(raw);
    const id = crypto.randomUUID();
    await db.transportVehicle.create({
      data: {
        id,
        schoolId: context.schoolId,
        registrationNumber: input.registrationNumber.toUpperCase(),
        makeModel: input.makeModel,
        capacity: input.capacity,
      },
    });
    return Response.json({ id }, { status: 201 });
  }
  if (action === "add_route") {
    requirePermission(context, "transport.manage");
    const input = z.object({ action: z.literal("add_route"), name: z.string().trim().min(2).max(100), vehicleId: uuid.optional(), driverName: z.string().trim().max(120).optional(), description: z.string().trim().max(500).optional() }).parse(raw);
    if (input.vehicleId) {
      const vehicle = await db.transportVehicle.findFirst({
        where: { id: input.vehicleId, schoolId: context.schoolId, status: "active" },
        select: { id: true },
      });
      if (!vehicle) return Response.json({ error: "Active vehicle not found." }, { status: 404 });
    }
    const id = crypto.randomUUID();
    await db.transportRoute.create({
      data: {
        id,
        schoolId: context.schoolId,
        name: input.name,
        vehicleId: input.vehicleId || null,
        driverName: input.driverName || null,
        description: input.description || null,
      },
    });
    return Response.json({ id }, { status: 201 });
  }
  if (action === "assign_transport") {
    requirePermission(context, "transport.manage");
    const input = z.object({ action: z.literal("assign_transport"), routeId: uuid, studentId: uuid, pickupPoint: z.string().trim().min(2).max(140) }).parse(raw);
    await requireStudent(db, context, input.studentId);
    const route = await db.transportRoute.findFirst({
      where: { id: input.routeId, schoolId: context.schoolId, status: "active" },
      select: { id: true },
    });
    if (!route) return Response.json({ error: "Active route not found." }, { status: 404 });
    const id = crypto.randomUUID();
    await db.transportAssignment.create({
      data: {
        id,
        schoolId: context.schoolId,
        routeId: input.routeId,
        studentId: input.studentId,
        pickupPoint: input.pickupPoint,
        assignedById: context.membershipId,
      },
    });
    return Response.json({ id }, { status: 201 });
  }
  if (action === "end_transport") {
    requirePermission(context, "transport.manage");
    const input = z.object({ action: z.literal("end_transport"), assignmentId: uuid }).parse(raw);
    const existing = await db.transportAssignment.findFirst({
      where: { id: input.assignmentId, schoolId: context.schoolId, status: "active" },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Active transport assignment not found." }, { status: 404 });
    await db.transportAssignment.update({
      where: { id: input.assignmentId, schoolId: context.schoolId },
      data: { status: "ended" },
    });
    return Response.json({ updated: true });
  }

  if (action === "add_asset") {
    requirePermission(context, "inventory.manage");
    const input = z.object({ action: z.literal("add_asset"), assetTag: z.string().trim().min(2).max(60), name: z.string().trim().min(2).max(140), category: z.string().trim().min(2).max(80), serialNumber: z.string().trim().max(100).optional(), purchaseDate: date.optional(), purchaseCost: moneyString.optional(), currency: z.enum(["USD", "ZWG"]).optional(), condition: z.enum(["new", "good", "fair", "poor"]), location: z.string().trim().max(120).optional(), assignedTo: z.string().trim().max(120).optional() }).parse(raw);
    const id = crypto.randomUUID(); const costMinor = input.purchaseCost ? parseMoney(input.purchaseCost) : null;
    if ((costMinor === null) !== !input.currency) return Response.json({ error: "Purchase cost and currency must be supplied together." }, { status: 400 });
    await db.inventoryAsset.create({
      data: {
        id,
        schoolId: context.schoolId,
        assetTag: input.assetTag.toUpperCase(),
        name: input.name,
        category: input.category,
        serialNumber: input.serialNumber || null,
        purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
        purchaseCostMinor: costMinor,
        currency: input.currency || null,
        condition: input.condition,
        location: input.location || null,
        assignedTo: input.assignedTo || null,
      },
    });
    return Response.json({ id }, { status: 201 });
  }
  if (action === "retire_asset") {
    requirePermission(context, "inventory.manage");
    const input = z.object({ action: z.literal("retire_asset"), assetId: uuid }).parse(raw);
    const existing = await db.inventoryAsset.findFirst({
      where: { id: input.assetId, schoolId: context.schoolId, status: "in_service" },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "In-service asset not found." }, { status: 404 });
    await db.inventoryAsset.update({
      where: { id: input.assetId, schoolId: context.schoolId },
      data: { status: "retired" },
    });
    return Response.json({ updated: true });
  }
  if (action === "add_asset_maintenance") {
    requirePermission(context, "inventory.manage");
    const input = z.object({ action: z.literal("add_asset_maintenance"), assetId: uuid, maintenanceDate: date, description: z.string().trim().min(3).max(500), provider: z.string().trim().max(120).optional(), cost: moneyString.optional(), currency: z.enum(["USD", "ZWG"]).optional() }).parse(raw);
    const asset = await db.inventoryAsset.findFirst({
      where: { id: input.assetId, schoolId: context.schoolId },
      select: { id: true },
    });
    if (!asset) return Response.json({ error: "Asset not found." }, { status: 404 });
    const id = crypto.randomUUID(); const costMinor = input.cost ? parseMoney(input.cost) : null;
    await db.assetMaintenance.create({
      data: {
        id,
        schoolId: context.schoolId,
        assetId: input.assetId,
        maintenanceDate: new Date(input.maintenanceDate),
        description: input.description,
        provider: input.provider || null,
        costMinor,
        currency: input.currency || null,
        recordedById: context.membershipId,
      },
    });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "create_event") {
    requirePermission(context, "events.manage");
    const input = z.object({ action: z.literal("create_event"), title: z.string().trim().min(3).max(160), category: z.enum(["academic", "sport", "meeting", "holiday", "trip", "ceremony", "other"]), startAt: dateTime, endAt: dateTime, location: z.string().trim().max(160).optional(), audience: z.enum(["all", "staff", "parents", "students"]), details: z.string().trim().max(1000).optional() }).parse(raw);
    if (input.endAt < input.startAt) return Response.json({ error: "The event end must be after its start." }, { status: 400 });
    const id = crypto.randomUUID();
    await db.schoolEvent.create({
      data: {
        id,
        schoolId: context.schoolId,
        title: input.title,
        category: input.category,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        location: input.location || null,
        audience: input.audience,
        details: input.details || null,
        createdById: context.membershipId,
      },
    });
    return Response.json({ id }, { status: 201 });
  }
  if (action === "cancel_event") {
    requirePermission(context, "events.manage");
    const input = z.object({ action: z.literal("cancel_event"), eventId: uuid }).parse(raw);
    const existing = await db.schoolEvent.findFirst({
      where: { id: input.eventId, schoolId: context.schoolId, status: "scheduled" },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Scheduled event not found." }, { status: 404 });
    await db.schoolEvent.update({
      where: { id: input.eventId, schoolId: context.schoolId },
      data: { status: "cancelled" },
    });
    return Response.json({ updated: true });
  }


  if (action === "save_health_record") {
    requirePermission(context, "health.manage");
    const input = z.object({
      action: z.literal("save_health_record"), studentId: uuid,
      bloodGroup: z.string().trim().max(10).optional(), allergies: z.string().trim().max(500).optional(),
      chronicConditions: z.string().trim().max(500).optional(), medications: z.string().trim().max(500).optional(),
      disabilities: z.string().trim().max(500).optional(), doctorName: z.string().trim().max(120).optional(),
      doctorPhone: z.string().trim().max(30).optional(), medicalAid: z.string().trim().max(120).optional(),
      emergencyNotes: z.string().trim().max(1000).optional(),
    }).parse(raw);
    const student = await db.student.findFirst({ where: { id: input.studentId, schoolId: context.schoolId }, select: { id: true } });
    if (!student) return Response.json({ error: "Learner not found." }, { status: 404 });
    const record = await db.healthRecord.upsert({
      where: { studentId: input.studentId },
      update: {
        bloodGroup: input.bloodGroup || null, allergies: input.allergies || null, chronicConditions: input.chronicConditions || null,
        medications: input.medications || null, disabilities: input.disabilities || null,
        doctorName: input.doctorName || null, doctorPhone: input.doctorPhone || null,
        medicalAid: input.medicalAid || null, emergencyNotes: input.emergencyNotes || null,
        updatedById: context.membershipId,
      },
      create: {
        schoolId: context.schoolId, studentId: input.studentId,
        bloodGroup: input.bloodGroup || null, allergies: input.allergies || null, chronicConditions: input.chronicConditions || null,
        medications: input.medications || null, disabilities: input.disabilities || null,
        doctorName: input.doctorName || null, doctorPhone: input.doctorPhone || null,
        medicalAid: input.medicalAid || null, emergencyNotes: input.emergencyNotes || null,
        updatedById: context.membershipId,
      },
    });
    // Keep the alert badge on the student profile in sync for authorized staff.
    if (input.allergies !== undefined) {
      await db.student.update({ where: { id: input.studentId }, data: { medicalAlert: input.allergies || null } });
    }
    await audit(db, context, "health.record_saved", "health_record", record.id, { studentId: input.studentId });
    return Response.json({ id: record.id }, { status: 201 });
  }

  if (action === "create_safeguarding_case") {
    requirePermission(context, "safeguarding.manage");
    const input = z.object({
      action: z.literal("create_safeguarding_case"), studentId: uuid,
      concernType: z.string().trim().min(3).max(80), details: z.string().trim().min(10).max(3000),
      officerId: uuid.optional(), followUpAt: date.optional(),
    }).parse(raw);
    const student = await db.student.findFirst({ where: { id: input.studentId, schoolId: context.schoolId }, select: { id: true } });
    if (!student) return Response.json({ error: "Learner not found." }, { status: 404 });
    const id = crypto.randomUUID();
    await db.safeguardingCase.create({
      data: {
        id, schoolId: context.schoolId, studentId: input.studentId, reporterId: context.membershipId,
        concernType: input.concernType, details: input.details, officerId: input.officerId ?? null,
        followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
      },
    });
    await audit(db, context, "safeguarding.case_opened", "safeguarding_case", id, { studentId: input.studentId, concernType: input.concernType });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "update_safeguarding_case") {
    requirePermission(context, "safeguarding.manage");
    const input = z.object({
      action: z.literal("update_safeguarding_case"), caseId: uuid,
      status: z.enum(["open", "escalated", "referred", "closed"]).optional(),
      actions: z.string().trim().max(2000).optional(), officerId: uuid.optional(),
      followUpAt: date.optional(),
    }).parse(raw);
    const existing = await db.safeguardingCase.findFirst({ where: { id: input.caseId, schoolId: context.schoolId }, select: { id: true, status: true } });
    if (!existing) return Response.json({ error: "Safeguarding case not found." }, { status: 404 });
    await db.safeguardingCase.update({
      where: { id: existing.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.actions !== undefined ? { actions: input.actions } : {}),
        ...(input.officerId !== undefined ? { officerId: input.officerId } : {}),
        ...(input.followUpAt ? { followUpAt: new Date(input.followUpAt) } : {}),
        ...(input.status === "closed" ? { closedAt: new Date() } : {}),
      },
    });
    await audit(db, context, "safeguarding.case_updated", "safeguarding_case", existing.id, { status: input.status ?? existing.status });
    return Response.json({ updated: true });
  }

  if (action === "save_special_need") {
    requirePermission(context, "sen.manage");
    const input = z.object({
      action: z.literal("save_special_need"), needId: uuid.optional(), studentId: uuid.optional(),
      category: z.string().trim().min(2).max(80), assessmentSummary: z.string().trim().max(1500).optional(),
      interventionPlan: z.string().trim().max(2000).optional(), accommodations: z.string().trim().max(1500).optional(),
      responsibleId: uuid.optional(), targets: z.string().trim().max(1500).optional(),
      reviewDate: date.optional(), status: z.enum(["active", "review", "closed"]).optional(),
    }).parse(raw);
    if (input.needId) {
      const existing = await db.specialNeed.findFirst({ where: { id: input.needId, schoolId: context.schoolId }, select: { id: true } });
      if (!existing) return Response.json({ error: "Support record not found." }, { status: 404 });
      await db.specialNeed.update({
        where: { id: existing.id },
        data: {
          category: input.category,
          ...(input.assessmentSummary !== undefined ? { assessmentSummary: input.assessmentSummary } : {}),
          ...(input.interventionPlan !== undefined ? { interventionPlan: input.interventionPlan } : {}),
          ...(input.accommodations !== undefined ? { accommodations: input.accommodations } : {}),
          ...(input.responsibleId !== undefined ? { responsibleId: input.responsibleId } : {}),
          ...(input.targets !== undefined ? { targets: input.targets } : {}),
          ...(input.reviewDate ? { reviewDate: new Date(input.reviewDate) } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
      });
      await audit(db, context, "sen.record_updated", "special_need", existing.id, {});
      return Response.json({ id: existing.id });
    }
    if (!input.studentId) return Response.json({ error: "Choose a learner." }, { status: 400 });
    const student = await db.student.findFirst({ where: { id: input.studentId, schoolId: context.schoolId }, select: { id: true } });
    if (!student) return Response.json({ error: "Learner not found." }, { status: 404 });
    const id = crypto.randomUUID();
    await db.specialNeed.create({
      data: {
        id, schoolId: context.schoolId, studentId: input.studentId, category: input.category,
        assessmentSummary: input.assessmentSummary || null, interventionPlan: input.interventionPlan || null,
        accommodations: input.accommodations || null, responsibleId: input.responsibleId ?? null,
        targets: input.targets || null, reviewDate: input.reviewDate ? new Date(input.reviewDate) : null,
      },
    });
    await audit(db, context, "sen.record_created", "special_need", id, { studentId: input.studentId, category: input.category });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "save_pickup") {
    requirePermission(context, "pickups.manage");
    const input = z.object({
      action: z.literal("save_pickup"), studentId: uuid, name: z.string().trim().min(2).max(120),
      relationship: z.string().trim().min(2).max(60), phone: z.string().trim().min(7).max(30),
      idNumber: z.string().trim().max(40).optional(), validTo: date.optional(),
    }).parse(raw);
    const student = await db.student.findFirst({ where: { id: input.studentId, schoolId: context.schoolId }, select: { id: true } });
    if (!student) return Response.json({ error: "Learner not found." }, { status: 404 });
    const id = crypto.randomUUID();
    await db.pickupAuthorization.create({
      data: {
        id, schoolId: context.schoolId, studentId: input.studentId, name: input.name,
        relationship: input.relationship, phone: input.phone, idNumber: input.idNumber || null,
        validTo: input.validTo ? new Date(input.validTo) : null, authorizedById: context.membershipId,
      },
    });
    await audit(db, context, "pickup.authorized", "pickup_authorization", id, { studentId: input.studentId, name: input.name });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "revoke_pickup") {
    requirePermission(context, "pickups.manage");
    const input = z.object({ action: z.literal("revoke_pickup"), pickupId: uuid }).parse(raw);
    const existing = await db.pickupAuthorization.findFirst({ where: { id: input.pickupId, schoolId: context.schoolId, status: "active" }, select: { id: true } });
    if (!existing) return Response.json({ error: "Active authorization not found." }, { status: 404 });
    await db.pickupAuthorization.update({ where: { id: existing.id }, data: { status: "revoked" } });
    await audit(db, context, "pickup.revoked", "pickup_authorization", existing.id, {});
    return Response.json({ updated: true });
  }

  if (action === "save_club") {
    requirePermission(context, "activities.manage");
    const input = z.object({
      action: z.literal("save_club"), clubId: uuid.optional(), name: z.string().trim().min(2).max(80),
      category: z.string().trim().max(60).optional(), coordinatorId: uuid.optional(),
      schedule: z.string().trim().max(120).optional(), status: z.enum(["active", "inactive"]).optional(),
    }).parse(raw);
    if (input.clubId) {
      const existing = await db.club.findFirst({ where: { id: input.clubId, schoolId: context.schoolId }, select: { id: true } });
      if (!existing) return Response.json({ error: "Club not found." }, { status: 404 });
      await db.club.update({ where: { id: existing.id }, data: { name: input.name, category: input.category || null, coordinatorId: input.coordinatorId ?? null, schedule: input.schedule || null, ...(input.status ? { status: input.status } : {}) } });
      return Response.json({ id: existing.id });
    }
    const id = crypto.randomUUID();
    await db.club.create({ data: { id, schoolId: context.schoolId, name: input.name, category: input.category || null, coordinatorId: input.coordinatorId ?? null, schedule: input.schedule || null } });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "join_club") {
    requirePermission(context, "activities.manage");
    const input = z.object({ action: z.literal("join_club"), clubId: uuid, studentId: uuid, role: z.string().trim().max(60).optional() }).parse(raw);
    const [club, student] = await Promise.all([
      db.club.findFirst({ where: { id: input.clubId, schoolId: context.schoolId, status: "active" }, select: { id: true } }),
      db.student.findFirst({ where: { id: input.studentId, schoolId: context.schoolId }, select: { id: true } }),
    ]);
    if (!club || !student) return Response.json({ error: "Club or learner not found." }, { status: 404 });
    const id = crypto.randomUUID();
    await db.clubMembership.upsert({
      where: { clubId_studentId: { clubId: input.clubId, studentId: input.studentId } },
      update: { status: "active", role: input.role || null },
      create: { id, schoolId: context.schoolId, clubId: input.clubId, studentId: input.studentId, role: input.role || null },
    });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "leave_club") {
    requirePermission(context, "activities.manage");
    const input = z.object({ action: z.literal("leave_club"), membershipId: uuid }).parse(raw);
    const existing = await db.clubMembership.findFirst({ where: { id: input.membershipId, schoolId: context.schoolId, status: "active" }, select: { id: true } });
    if (!existing) return Response.json({ error: "Membership not found." }, { status: 404 });
    await db.clubMembership.update({ where: { id: existing.id }, data: { status: "left" } });
    return Response.json({ updated: true });
  }

  if (action === "save_trip") {
    requirePermission(context, "activities.manage");
    const input = z.object({
      action: z.literal("save_trip"), tripId: uuid.optional(), title: z.string().trim().min(3).max(120),
      destination: z.string().trim().min(2).max(160), startDate: date, endDate: date,
      cost: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/).optional(), currency: z.enum(["USD", "ZWG"]).optional(),
      coordinatorId: uuid.optional(), status: z.enum(["planned", "open", "travelled", "completed", "cancelled"]).optional(),
    }).parse(raw);
    if (input.endDate < input.startDate) return Response.json({ error: "End date must be after the start date." }, { status: 400 });
    const data = {
      title: input.title, destination: input.destination,
      startDate: new Date(input.startDate), endDate: new Date(input.endDate),
      costMinor: input.cost ? parseMoney(input.cost) : 0, currency: input.currency ?? "USD",
      coordinatorId: input.coordinatorId ?? null, ...(input.status ? { status: input.status } : {}),
    };
    if (input.tripId) {
      const existing = await db.schoolTrip.findFirst({ where: { id: input.tripId, schoolId: context.schoolId }, select: { id: true } });
      if (!existing) return Response.json({ error: "Trip not found." }, { status: 404 });
      await db.schoolTrip.update({ where: { id: existing.id }, data });
      return Response.json({ id: existing.id });
    }
    const id = crypto.randomUUID();
    await db.schoolTrip.create({ data: { id, schoolId: context.schoolId, ...data } });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "add_trip_participant") {
    requirePermission(context, "activities.manage");
    const input = z.object({ action: z.literal("add_trip_participant"), tripId: uuid, studentId: uuid }).parse(raw);
    const [trip, student] = await Promise.all([
      db.schoolTrip.findFirst({ where: { id: input.tripId, schoolId: context.schoolId }, select: { id: true } }),
      db.student.findFirst({ where: { id: input.studentId, schoolId: context.schoolId }, select: { id: true } }),
    ]);
    if (!trip || !student) return Response.json({ error: "Trip or learner not found." }, { status: 404 });
    const id = crypto.randomUUID();
    await db.tripParticipant.upsert({
      where: { tripId_studentId: { tripId: input.tripId, studentId: input.studentId } },
      update: {},
      create: { id, schoolId: context.schoolId, tripId: input.tripId, studentId: input.studentId },
    });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "set_trip_consent") {
    requirePermission(context, "activities.manage");
    const input = z.object({
      action: z.literal("set_trip_consent"), participantId: uuid,
      consentStatus: z.enum(["pending", "given", "declined"]),
      paid: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/).optional(),
    }).parse(raw);
    const existing = await db.tripParticipant.findFirst({ where: { id: input.participantId, schoolId: context.schoolId }, select: { id: true } });
    if (!existing) return Response.json({ error: "Participant not found." }, { status: 404 });
    await db.tripParticipant.update({
      where: { id: existing.id },
      data: {
        consentStatus: input.consentStatus,
        consentBy: input.consentStatus === "pending" ? null : context.membershipId,
        consentAt: input.consentStatus === "pending" ? null : new Date(),
        ...(input.paid !== undefined ? { paidMinor: parseMoney(input.paid) } : {}),
      },
    });
    return Response.json({ updated: true });
  }

  throw new Response("Unsupported school operation.", { status: 400 });
}

const moneyString = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/);
function parseMoney(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
