// Volume seed — rebuilds a realistic school at scale: 100 teachers,
// 4 000 learners, guardians (with siblings), classes, subjects, terms.
// Demo logins match the smoke suite; teacherNNN accounts share "password123".
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const cuid = () => crypto.randomUUID();

const FIRST = ["Takudzwa","Rutendo","Tinashe","Chipo","Tapiwa","Nyasha","Rudo","Farai","Paidamoyo","Kudakwashe","Tafadzwa","Anesu","Munashe","Tanaka","Ropafadzo","Vimbai","Tawanda","Shamiso","Nokuthula","Thandiwe","Sipho","Lindiwe","Blessing","Tatenda","Rumbidzai","Danai","Chiedza","Makanaka","Tinotenda","Wadzanai"];
const LAST = ["Moyo","Ncube","Dube","Sibanda","Mugabe","Chikafu","Mukono","Zhou","Nyathi","Mlambo","Tshuma","Dlodlo","Ndlovu","Khosa","Moyo","Chirwa","Banda","Phiri","Tembo","Zulu","Gumbo","Mafu","Sithole","Mhlanga","Charamba","Marowa","Zvobgo","Mutasa","Goreraza","Samkange"];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const dob = (age: number) => { const d = new Date(2026 - age, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28)); return d; };

async function main() {
  console.log("Seeding volume data…");
  // Idempotent: wipe everything first so reruns start clean.
  await prisma.$executeRawUnsafe(`TRUNCATE tenants, schools, "User", accounts, sessions, verification_tokens, school_memberships, academic_years, terms, grade_levels, classrooms, subjects, class_subjects, guardians, students, student_guardians, student_enrollments, student_documents, staff_profiles, grading_bands, attendance_settings, attendance_registers, attendance_entries, attendance_notifications, assessments, assessment_marks, report_cards, report_card_results, report_approvals, report_weightings, timetable_entries, fee_invoices, fee_invoice_items, fee_templates, payments, payment_allocations, finance_reversals, finance_idempotency_keys, admission_applications, leave_requests, payroll_runs, payroll_entries, announcements, communication_outbox, discipline_incidents, clinic_visits, library_books, library_copies, library_loans, boarding_dormitories, boarding_allocations, transport_vehicles, transport_routes, transport_assignments, inventory_assets, asset_maintenance, school_events, audit_logs, departments, student_leaderships, income_projects, school_ledger_entries, project_stock_items, stock_movements, suppliers, project_budgets, exam_sessions, exam_seats, lesson_plans, student_notes, notifications, health_records, safeguarding_cases, special_needs, assignments, curriculum_topics, pickup_authorizations, clubs, club_memberships, school_trips, trip_participants, staff_attendance, online_payments, payment_proofs CASCADE`);
  const tenant = await prisma.tenant.create({ data: { name: "Nyashavee" } });
  const school = await prisma.school.create({
    data: { tenantId: tenant.id, name: "Nyashavee Primary School", code: "NPS", motto: "Excellence through learning", email: "admin@nyashavee.local", phone: "+263 77 000 0000", address: "1 School Road, Harare", exchangeRateZwgPerUsd: "27.50" },
  });

  // --- Users + memberships (demo creds kept for the smoke suite) ---
  const core = [
    { email: "admin@nyashavee.local", name: "School Administrator", role: "school_admin", pass: "admin123" },
    { email: "head@nyashavee.local", name: "Head Teacher", role: "headmaster", pass: "head123" },
    { email: "bursar@nyashavee.local", name: "Bursar", role: "bursar", pass: "bursar123" },
    { email: "teacher@nyashavee.local", name: "Teacher One", role: "class_teacher", pass: "teacher123" },
  ];
  const sharedHash = await bcrypt.hash("password123", 10);
  const memberships = new Map<string, string>();
  for (const c of core) {
    const u = await prisma.user.create({ data: { email: c.email, name: c.name, passwordHash: await bcrypt.hash(c.pass, 10) } });
    const m = await prisma.schoolMembership.create({ data: { schoolId: school.id, userId: u.id, displayName: c.name, role: c.role } });
    memberships.set(c.role === "class_teacher" ? "teacher001" : c.role, m.id);
  }
  const teacherUsers: { id: string; membershipId: string }[] = [];
  for (let i = 2; i <= 100; i++) {
    const u = await prisma.user.create({ data: { email: `teacher${String(i).padStart(3, "0")}@nyashavee.local`, name: `${pick(FIRST)} ${pick(LAST)}`, passwordHash: sharedHash } });
    const m = await prisma.schoolMembership.create({ data: { schoolId: school.id, userId: u.id, displayName: u.name!, role: "teacher" } });
    teacherUsers.push({ id: u.id, membershipId: m.id });
  }
  // parent demo account (linked to guardian 1 below)
  const parentUser = await prisma.user.create({ data: { email: "parent@nyashavee.local", name: "Tendai Moyo", passwordHash: await bcrypt.hash("parent123", 10) } });
  await prisma.schoolMembership.create({ data: { schoolId: school.id, userId: parentUser.id, displayName: "Tendai Moyo", role: "parent" } });

  // --- Staff profiles for all 100 teachers ---
  const allTeacherMemberships = [memberships.get("teacher001")!, ...teacherUsers.map((t) => t.membershipId)];
  await prisma.staffProfile.createMany({
    data: allTeacherMemberships.map((mid, i) => ({
      id: cuid(), schoolId: school.id, membershipId: mid, employeeNumber: `EMP-${String(i + 1).padStart(3, "0")}`,
      firstName: `Teacher${i + 1}`, lastName: pick(LAST), position: i < 10 ? "Senior Teacher" : "Teacher",
      employmentType: "permanent", paidBy: i % 4 === 0 ? "government" : "school",
      startDate: new Date(2020, i % 12, 10), status: "active",
    })),
  });

  // --- Academic structure ---
  const year = await prisma.academicYear.create({ data: { schoolId: school.id, name: "2026", startDate: new Date("2026-01-13"), endDate: new Date("2026-12-04"), status: "active" } });
  const terms = await Promise.all([
    prisma.term.create({ data: { schoolId: school.id, academicYearId: year.id, name: "Term 1", termNumber: 1, startDate: new Date("2026-01-13"), endDate: new Date("2026-04-03"), status: "completed" } }),
    prisma.term.create({ data: { schoolId: school.id, academicYearId: year.id, name: "Term 2", termNumber: 2, startDate: new Date("2026-05-05"), endDate: new Date("2026-08-07"), status: "completed" } }),
    prisma.term.create({ data: { schoolId: school.id, academicYearId: year.id, name: "Term 3", termNumber: 3, startDate: new Date("2026-09-01"), endDate: new Date("2026-12-04"), status: "active" } }),
  ]);
  const term3 = terms[2];

  const gradeDefs = [
    { name: "ECD A", order: 1, desc: true }, { name: "ECD B", order: 2, desc: true },
    ...Array.from({ length: 7 }, (_, i) => ({ name: `Grade ${i + 1}`, order: i + 3, desc: false })),
  ];
  const grades = new Map<string, string>();
  for (const g of gradeDefs) {
    const row = await prisma.gradeLevel.create({ data: { schoolId: school.id, name: g.name, gradeOrder: g.order, descriptorOnly: g.desc } });
    grades.set(g.name, row.id);
  }

  // 78 classrooms ≈ 51 learners each
  const classCounts: Record<string, number> = { "ECD A": 4, "ECD B": 4, "Grade 1": 10, "Grade 2": 10, "Grade 3": 10, "Grade 4": 10, "Grade 5": 10, "Grade 6": 10, "Grade 7": 10 };
  const classrooms: { id: string; gradeName: string }[] = [];
  let teacherIdx = 0;
  for (const [gradeName, count] of Object.entries(classCounts)) {
    for (let s = 0; s < count; s++) {
      const name = count > 1 ? `${gradeName}${"ABCDEFGHIJKLMNOP"[s]}` : gradeName;
      const c = await prisma.classroom.create({
        data: { schoolId: school.id, name, yearNumber: 2026, academicYearId: year.id, gradeLevelId: grades.get(gradeName)!, classTeacherId: allTeacherMemberships[teacherIdx % allTeacherMemberships.length], capacity: 55 },
      });
      classrooms.push({ id: c.id, gradeName });
      teacherIdx++;
    }
  }

  const subjectDefs = [
    { code: "ENG", name: "English" }, { code: "MATH", name: "Mathematics" }, { code: "SHO", name: "Shona" },
    { code: "SCI", name: "Science" }, { code: "SS", name: "Social Studies" }, { code: "AGR", name: "Agriculture" },
    { code: "ICT", name: "ICT" }, { code: "PE", name: "Physical Education" }, { code: "VPA", name: "Visual & Performing Arts" },
  ];
  const subjects = new Map<string, string>();
  for (const sd of subjectDefs) {
    const s = await prisma.subject.create({ data: { schoolId: school.id, code: sd.code, name: sd.name } });
    subjects.set(sd.code, s.id);
  }
  const subjectCodes = subjectDefs.map((s) => s.code);
  await prisma.classSubject.createMany({
    data: classrooms.flatMap((c) =>
      (c.gradeName.startsWith("ECD") ? subjectCodes.slice(0, 4) : subjectCodes).map((code, i) => ({
        id: cuid(), schoolId: school.id, classroomId: c.id, subjectId: subjects.get(code)!, teacherId: allTeacherMemberships[(teacherIdx + i) % allTeacherMemberships.length],
      })),
    ),
  });

  // --- Grading bands + attendance settings ---
  const bands = [
    { name: "Distinction", min: 80, max: 100, grade: "A", remark: "Excellent" },
    { name: "Merit", min: 70, max: 79, grade: "B", remark: "Very good" },
    { name: "Competent", min: 50, max: 69, grade: "C", remark: "Good" },
    { name: "Developing", min: 35, max: 49, grade: "D", remark: "Improving" },
    { name: "Emerging", min: 0, max: 34, grade: "E", remark: "Needs support" },
  ];
  await prisma.gradingBand.createMany({ data: bands.map((b, i) => ({ id: cuid(), schoolId: school.id, name: b.name, minPercent: b.min, maxPercent: b.max, grade: b.grade, remark: b.remark, sortOrder: i })) });
  await prisma.attendanceSettings.create({ data: { schoolId: school.id } });

  // --- Guardians (siblings share) + Students + Enrollments ---
  console.log("Creating 2 000 guardians…");
  const guardians = Array.from({ length: 2000 }, (_, i) => ({
    id: cuid(), schoolId: school.id, firstName: pick(FIRST), lastName: pick(LAST),
    phone: `+2637${String(10000000 + i).slice(0, 8)}`, relationship: i % 5 === 0 ? "grandmother" : i % 3 === 0 ? "father" : "mother",
    email: i === 0 ? "parent@nyashavee.local" : null, portalUserId: i === 0 ? parentUser.id : null,
    isFinancialContact: true,
  }));
  for (let i = 0; i < guardians.length; i += 500) {
    await prisma.guardian.createMany({ data: guardians.slice(i, i + 500) });
  }
  console.log("Creating 4 000 learners…");
  const ages: Record<string, [number, number]> = { "ECD A": [4, 5], "ECD B": [5, 6], "Grade 1": [6, 7], "Grade 2": [7, 8], "Grade 3": [8, 9], "Grade 4": [9, 10], "Grade 5": [10, 11], "Grade 6": [11, 12], "Grade 7": [12, 13] };
  const students: { id: string; classroomId: string; gradeName: string }[] = [];
  let n = 0;
  const batch: object[] = [];
  for (let i = 0; i < 4000; i++) {
    const cls = classrooms[i % classrooms.length];
    const [minA, maxA] = ages[cls.gradeName];
    const id = cuid();
    students.push({ id, classroomId: cls.id, gradeName: cls.gradeName });
    batch.push({
      id, schoolId: school.id, admissionNumber: `NYS-${String(++n).padStart(4, "0")}`,
      firstName: pick(FIRST), lastName: pick(LAST), gender: i % 2 === 0 ? "female" : "male",
      dateOfBirth: dob(minA + Math.floor(Math.random() * (maxA - minA + 1))),
      admissionDate: new Date("2026-01-13"), classroomId: cls.id, status: "active", boardingStatus: "day_scholar",
    });
    if (batch.length === 500) { await prisma.student.createMany({ data: batch as never[] }); batch.length = 0; }
  }
  if (batch.length) await prisma.student.createMany({ data: batch as never[] });

  // guardian links — every 3rd student shares the previous guardian (siblings)
  const links: object[] = [];
  for (let i = 0; i < students.length; i++) {
    const g = i % 3 === 0 && i > 0 ? guardians[(i - 1) % guardians.length] : guardians[i % guardians.length];
    links.push({ studentId: students[i].id, guardianId: g.id, relationshipType: g.relationship, isPrimaryContact: true, authorizedPickup: true });
  }
  for (let i = 0; i < links.length; i += 500) await prisma.studentGuardian.createMany({ data: links.slice(i, i + 500) as never[] });

  const enrollments = students.map((s) => ({
    id: cuid(), schoolId: school.id, studentId: s.id, academicYearId: year.id,
    gradeLevelId: grades.get(s.gradeName)!, classroomId: s.classroomId, enrollmentDate: new Date("2026-01-13"), status: "active",
  }));
  for (let i = 0; i < enrollments.length; i += 500) await prisma.studentEnrollment.createMany({ data: enrollments.slice(i, i + 500) as never[] });

  // --- Parent demo: link to two Grade 5A learners (index 48 = Grade 5A after 8 ECD + 40 G1-G4 classes) ---
  const g5aClass = classrooms.find((c) => c.gradeName === "Grade 5")!;
  const g5aStudents = students.filter((s) => s.classroomId === g5aClass.id).slice(0, 2);
  for (const s of g5aStudents) {
    await prisma.studentGuardian.create({ data: { studentId: s.id, guardianId: guardians[0].id, relationshipType: "mother", isPrimaryContact: true, authorizedPickup: true } });
  }
  // Published reports for both — one learner owes fees (locked), one is clear.
  for (const [i, s] of g5aStudents.entries()) {
    const st = await prisma.student.findUnique({ where: { id: s.id }, select: { firstName: true, lastName: true, admissionNumber: true } });
    const reportId = cuid();
    await prisma.reportCard.create({
      data: {
        id: reportId, schoolId: school.id, studentId: s.id, termId: term3.id,
        status: "published", promotionStatus: "promoted", version: 1,
        studentNameSnapshot: `${st!.firstName} ${st!.lastName}`,
        admissionNumberSnapshot: st!.admissionNumber, classroomSnapshot: "Grade 5A",
        averagePercent: 68, presentSessions: 40, absentSessions: 3,
        classTeacherComment: "Consistent effort across subjects.", headComment: "Well done.",
        verificationCode: `SEED${i + 1}${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        generatedById: memberships.get("school_admin")!, publishedAt: new Date(), publishedById: memberships.get("headmaster")!,
      },
    });
    await prisma.reportCardResult.createMany({
      data: ["English", "Mathematics", "Shona"].map((name, j) => ({
        id: cuid(), schoolId: school.id, reportCardId: reportId,
        subjectCodeSnapshot: ["ENG", "MATH", "SHO"][j], subjectNameSnapshot: name,
        scorePercent: 65 + j * 5, caPercent: 60 + j * 5, examPercent: 70 + j * 5,
        grade: "B", remark: "Very good", assessmentCount: 2, teacherComment: "Good progress.",
      })),
    });
    await prisma.reportApproval.createMany({
      data: [
        { step: "class_teacher", action: "submitted" }, { step: "hod", action: "approved" },
        { step: "head", action: "approved" }, { step: "publish", action: "published" },
      ].map((a) => ({ id: cuid(), schoolId: school.id, reportCardId: reportId, ...a, actorId: memberships.get("school_admin")!, actorName: "Seed", role: a.step })),
    });
  }
  // Unpaid invoice on the first linked learner → their report is fee-locked.
  await prisma.feeInvoice.create({
    data: {
      id: cuid(), schoolId: school.id, studentId: g5aStudents[0].id, termId: term3.id,
      invoiceNumber: "INV-SEED-0001", issueDate: new Date("2026-09-01"), dueDate: new Date("2026-09-30"),
      currency: "USD", state: "issued", totalMinor: 12000,
      studentNameSnapshot: "Seed Learner", admissionNumberSnapshot: "NYS-SEED",
      issuerNameSnapshot: "Seed", createdById: memberships.get("bursar")!,
    },
  });

  console.log(`Done — ${await prisma.student.count()} learners, ${await prisma.schoolMembership.count()} memberships, ${await prisma.classroom.count()} classes.`);
}

main().finally(() => prisma.$disconnect());
