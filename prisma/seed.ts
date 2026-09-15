import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SCHOOL_ID = "school-nyashavee-primary";
const TENANT_ID = "tenant-nyashavee";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_SEED_ACKNOWLEDGEMENT !== "I_UNDERSTAND_DEMO_DATA_WILL_BE_CREATED") {
    throw new Error("Demo seed is blocked in production. Use a disposable demo environment and set DEMO_SEED_ACKNOWLEDGEMENT only when intentional.");
  }
  console.log("Seeding Nyashavee Primary School...");

  // 1. Tenant
  const tenant = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: { id: TENANT_ID, name: "Nyashavee Demonstration Group" },
  });

  // 2. School
  const school = await prisma.school.upsert({
    where: { id: SCHOOL_ID },
    update: {},
    create: {
      id: SCHOOL_ID,
      tenantId: tenant.id,
      name: "Nyashavee Primary School",
      code: "NPS",
      currency: "USD",
      timezone: "Africa/Harare",
      motto: "Excellence through diligence",
      address: "12 Acacia Avenue, Harare",
      phone: "+263 242 700 100",
      email: "office@nyashavee.ac.zw",
      registrationNumber: "MEC/PRM/0412",
    },
  });

  // 3. Users (Auth.js)
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@nyashavee.local" },
    update: {},
    create: {
      email: "admin@nyashavee.local",
      name: "Tendai Moyo",
      passwordHash: await bcrypt.hash("admin123", 10),
    },
  });

  const headUser = await prisma.user.upsert({
    where: { email: "head@nyashavee.local" },
    update: {},
    create: {
      email: "head@nyashavee.local",
      name: "Mrs Rudo Chigumba",
      passwordHash: await bcrypt.hash("head123", 10),
    },
  });

  const teacherUser = await prisma.user.upsert({
    where: { email: "teacher@nyashavee.local" },
    update: {},
    create: {
      email: "teacher@nyashavee.local",
      name: "Mrs Ruvimbo Chidziva",
      passwordHash: await bcrypt.hash("teacher123", 10),
    },
  });

  const bursarUser = await prisma.user.upsert({
    where: { email: "bursar@nyashavee.local" },
    update: {},
    create: {
      email: "bursar@nyashavee.local",
      name: "Mrs Nyasha Dube",
      passwordHash: await bcrypt.hash("bursar123", 10),
    },
  });

  // 4. School memberships
  const memberships = [
    { userId: adminUser.id, displayName: "Tendai Moyo", role: "school_admin" },
    { userId: headUser.id, displayName: "Mrs Rudo Chigumba", role: "headmaster" },
    { userId: teacherUser.id, displayName: "Mrs Ruvimbo Chidziva", role: "teacher" },
    { userId: bursarUser.id, displayName: "Mrs Nyasha Dube", role: "bursar" },
  ];

  const membershipMap: Record<string, string> = {};
  for (const m of memberships) {
    const membership = await prisma.schoolMembership.upsert({
      where: { schoolId_userId: { schoolId: school.id, userId: m.userId } },
      update: { active: true },
      create: {
        schoolId: school.id,
        userId: m.userId,
        displayName: m.displayName,
        role: m.role,
      },
    });
    membershipMap[m.role] = membership.id;
    if (m.displayName.includes("Ruvimbo")) membershipMap["teacher_008"] = membership.id;
    if (m.displayName.includes("Rudo")) membershipMap["head"] = membership.id;
    if (m.displayName.includes("Nyasha")) membershipMap["bursar"] = membership.id;
  }

  // Additional staff users
  const teacherUsers = [
    { email: "t.chirwa@nyashavee.local", name: "Mr Tatenda Chirwa", role: "teacher" },
    { email: "c.maposa@nyashavee.local", name: "Mrs Chenai Maposa", role: "teacher" },
    { email: "k.banda@nyashavee.local", name: "Mr Knowledge Banda", role: "teacher" },
    { email: "g.moyo@nyashavee.local", name: "Mrs Grace Moyo", role: "teacher" },
    { email: "b.ncube@nyashavee.local", name: "Mr Blessing Ncube", role: "teacher" },
    { email: "t.makoni@nyashavee.local", name: "Mrs Tsitsi Makoni", role: "teacher" },
    { email: "s.hwata@nyashavee.local", name: "Mr Simbarashe Hwata", role: "teacher" },
    { email: "t.mhandu@nyashavee.local", name: "Mr Takudzwa Mhandu", role: "teacher" },
    { email: "p.gumbo@nyashavee.local", name: "Mrs Patience Gumbo", role: "librarian" },
    { email: "k.nyoni@nyashavee.local", name: "Mrs Kudzai Nyoni", role: "admissions_officer" },
  ];

  for (const t of teacherUsers) {
    const user = await prisma.user.upsert({
      where: { email: t.email },
      update: {},
      create: { email: t.email, name: t.name, passwordHash: await bcrypt.hash("password123", 10) },
    });
    const membership = await prisma.schoolMembership.upsert({
      where: { schoolId_userId: { schoolId: school.id, userId: user.id } },
      update: { active: true },
      create: { schoolId: school.id, userId: user.id, displayName: t.name, role: t.role },
    });
    if (t.name.includes("Tatenda")) membershipMap["teacher_001"] = membership.id;
    if (t.name.includes("Chenai")) membershipMap["teacher_002"] = membership.id;
    if (t.name.includes("Knowledge")) membershipMap["teacher_003"] = membership.id;
    if (t.name.includes("Grace")) membershipMap["teacher_004"] = membership.id;
    if (t.name.includes("Blessing")) membershipMap["teacher_005"] = membership.id;
    if (t.name.includes("Tsitsi")) membershipMap["teacher_006"] = membership.id;
    if (t.name.includes("Simbarashe")) membershipMap["teacher_007"] = membership.id;
    if (t.name.includes("Takudzwa")) membershipMap["teacher_009"] = membership.id;
    if (t.name.includes("Patience")) membershipMap["librarian"] = membership.id;
    if (t.name.includes("Kudzai")) membershipMap["admissions"] = membership.id;
  }

  // Portal user (parent login for the family portal)
  const parentUser = await prisma.user.upsert({
    where: { email: "parent@nyashavee.local" },
    update: {},
    create: { email: "parent@nyashavee.local", name: "Tendai Moyo", passwordHash: await bcrypt.hash("parent123", 10) },
  });
  await prisma.schoolMembership.upsert({
    where: { schoolId_userId: { schoolId: school.id, userId: parentUser.id } },
    // Keep the documented demo portal account usable when seed data is replayed.
    // This is intentionally limited to the known demo identity, never real users.
    update: { active: true, role: "parent", displayName: "Tendai Moyo" },
    create: { schoolId: school.id, userId: parentUser.id, displayName: "Tendai Moyo", role: "parent" },
  });

  // 5. Academic Year & Terms
  const year = await prisma.academicYear.upsert({
    where: { schoolId_name: { schoolId: school.id, name: "2026" } },
    update: {},
    create: {
      schoolId: school.id,
      name: "2026",
      startDate: new Date("2026-01-13"),
      endDate: new Date("2026-12-04"),
      status: "active",
    },
  });

  const terms = [
    { name: "Term 1", termNumber: 1, startDate: "2026-01-13", endDate: "2026-04-03", status: "completed" },
    { name: "Term 2", termNumber: 2, startDate: "2026-05-05", endDate: "2026-08-07", status: "completed" },
    { name: "Term 3", termNumber: 3, startDate: "2026-09-01", endDate: "2026-12-04", status: "active" },
  ];

  const termMap: Record<string, string> = {};
  for (const t of terms) {
    const term = await prisma.term.upsert({
      where: { academicYearId_termNumber: { academicYearId: year.id, termNumber: t.termNumber } },
      update: {},
      create: {
        schoolId: school.id,
        academicYearId: year.id,
        name: t.name,
        termNumber: t.termNumber,
        startDate: new Date(t.startDate),
        endDate: new Date(t.endDate),
        status: t.status,
      },
    });
    termMap[t.name] = term.id;
  }

  // 6. Grade Levels
  const gradeLevels = [
    { name: "ECD A", gradeOrder: 1 }, { name: "ECD B", gradeOrder: 2 },
    { name: "Grade 1", gradeOrder: 3 }, { name: "Grade 2", gradeOrder: 4 },
    { name: "Grade 3", gradeOrder: 5 }, { name: "Grade 4", gradeOrder: 6 },
    { name: "Grade 5", gradeOrder: 7 }, { name: "Grade 6", gradeOrder: 8 },
    { name: "Grade 7", gradeOrder: 9 },
  ];

  const gradeMap: Record<string, string> = {};
  for (const g of gradeLevels) {
    const gl = await prisma.gradeLevel.upsert({
      where: { schoolId_name: { schoolId: school.id, name: g.name } },
      update: {},
      create: { schoolId: school.id, name: g.name, gradeOrder: g.gradeOrder },
    });
    gradeMap[g.name] = gl.id;
  }

  // 7. Classrooms
  const classrooms = [
    { name: "ECD A", gradeLevelId: gradeMap["ECD A"], teacherRole: "teacher_001", capacity: 200 },
    { name: "ECD B", gradeLevelId: gradeMap["ECD B"], teacherRole: "teacher_002", capacity: 35 },
    { name: "Grade 1A", gradeLevelId: gradeMap["Grade 1"], teacherRole: "teacher_003", capacity: 40 },
    { name: "Grade 2A", gradeLevelId: gradeMap["Grade 2"], teacherRole: "teacher_004", capacity: 40 },
    { name: "Grade 3A", gradeLevelId: gradeMap["Grade 3"], teacherRole: "teacher_005", capacity: 40 },
    { name: "Grade 3B", gradeLevelId: gradeMap["Grade 3"], teacherRole: "teacher_006", capacity: 40 },
    { name: "Grade 4A", gradeLevelId: gradeMap["Grade 4"], teacherRole: "teacher_007", capacity: 40 },
    { name: "Grade 5A", gradeLevelId: gradeMap["Grade 5"], teacherRole: "teacher_008", capacity: 40 },
    { name: "Grade 6A", gradeLevelId: gradeMap["Grade 6"], teacherRole: "teacher_009", capacity: 40 },
    { name: "Grade 7A", gradeLevelId: gradeMap["Grade 7"], teacherRole: "head", capacity: 40 },
  ];

  const classMap: Record<string, string> = {};
  for (const c of classrooms) {
    const classroom = await prisma.classroom.upsert({
      where: { schoolId_yearNumber_name: { schoolId: school.id, yearNumber: 2026, name: c.name } },
      update: {},
      create: {
        schoolId: school.id,
        name: c.name,
        yearNumber: 2026,
        academicYearId: year.id,
        gradeLevelId: c.gradeLevelId,
        classTeacherId: membershipMap[c.teacherRole] || membershipMap["teacher_008"],
        capacity: c.capacity,
      },
    });
    classMap[c.name] = classroom.id;
  }

  // 8. Subjects
  const subjects = [
    { code: "ENG", name: "English", department: "Languages" },
    { code: "MATH", name: "Mathematics", department: "Sciences" },
    { code: "SHO", name: "Shona", department: "Languages" },
    { code: "SCI", name: "Science", department: "Sciences" },
    { code: "SS", name: "Social Studies", department: "Humanities" },
    { code: "AGR", name: "Agriculture", department: "Practical" },
    { code: "ICT", name: "ICT", department: "Technology" },
    { code: "PE", name: "Physical Education", department: "Practical" },
    { code: "VPA", name: "Visual & Performing Arts", department: "Arts" },
    { code: "NDE", name: "Ndebele", department: "Languages" },
  ];

  const subjectMap: Record<string, string> = {};
  for (const s of subjects) {
    const subject = await prisma.subject.upsert({
      where: { schoolId_code: { schoolId: school.id, code: s.code } },
      update: {},
      create: { schoolId: school.id, code: s.code, name: s.name, department: s.department },
    });
    subjectMap[s.code] = subject.id;
  }

  // 9. Class-Subject assignments for Grade 5A
  const g5aClassSubjects = [
    { subjectCode: "ENG", teacherRole: "teacher_008" },
    { subjectCode: "MATH", teacherRole: "teacher_008" },
    { subjectCode: "SHO", teacherRole: "teacher_006" },
    { subjectCode: "SCI", teacherRole: "teacher_005" },
    { subjectCode: "SS", teacherRole: "teacher_007" },
    { subjectCode: "AGR", teacherRole: "teacher_003" },
    { subjectCode: "ICT", teacherRole: "teacher_001" },
    { subjectCode: "PE", teacherRole: "teacher_004" },
    { subjectCode: "VPA", teacherRole: "teacher_002" },
  ];

  const g5aSubjectMap: Record<string, string> = {};
  for (const cs of g5aClassSubjects) {
    const csRecord = await prisma.classSubject.upsert({
      where: { classroomId_subjectId: { classroomId: classMap["Grade 5A"], subjectId: subjectMap[cs.subjectCode] } },
      update: {},
      create: {
        schoolId: school.id,
        classroomId: classMap["Grade 5A"],
        subjectId: subjectMap[cs.subjectCode],
        teacherId: membershipMap[cs.teacherRole] || membershipMap["teacher_008"],
      },
    });
    g5aSubjectMap[cs.subjectCode] = csRecord.id;
  }

  // Grade 3A class subjects
  const g3aClassSubjects = [
    { subjectCode: "ENG", teacherRole: "teacher_005" },
    { subjectCode: "MATH", teacherRole: "teacher_005" },
    { subjectCode: "SHO", teacherRole: "teacher_006" },
    { subjectCode: "SCI", teacherRole: "teacher_003" },
    { subjectCode: "SS", teacherRole: "teacher_007" },
  ];
  for (const cs of g3aClassSubjects) {
    await prisma.classSubject.upsert({
      where: { classroomId_subjectId: { classroomId: classMap["Grade 3A"], subjectId: subjectMap[cs.subjectCode] } },
      update: {},
      create: {
        schoolId: school.id,
        classroomId: classMap["Grade 3A"],
        subjectId: subjectMap[cs.subjectCode],
        teacherId: membershipMap[cs.teacherRole] || membershipMap["teacher_005"],
      },
    });
  }

  // Grade 7A class subjects
  const g7aClassSubjects = [
    { subjectCode: "ENG", teacherRole: "teacher_009" },
    { subjectCode: "MATH", teacherRole: "teacher_009" },
    { subjectCode: "SHO", teacherRole: "teacher_006" },
    { subjectCode: "SCI", teacherRole: "teacher_003" },
    { subjectCode: "SS", teacherRole: "teacher_007" },
    { subjectCode: "AGR", teacherRole: "teacher_004" },
  ];
  for (const cs of g7aClassSubjects) {
    await prisma.classSubject.upsert({
      where: { classroomId_subjectId: { classroomId: classMap["Grade 7A"], subjectId: subjectMap[cs.subjectCode] } },
      update: {},
      create: {
        schoolId: school.id,
        classroomId: classMap["Grade 7A"],
        subjectId: subjectMap[cs.subjectCode],
        teacherId: membershipMap[cs.teacherRole] || membershipMap["teacher_009"],
      },
    });
  }

  // 10. Grading Bands
  const gradingBands = [
    { name: "Primary Scale", minPercent: 80, maxPercent: 100, grade: "A", remark: "Excellent", isPass: true, sortOrder: 1 },
    { name: "Primary Scale", minPercent: 70, maxPercent: 79, grade: "B", remark: "Very Good", isPass: true, sortOrder: 2 },
    { name: "Primary Scale", minPercent: 60, maxPercent: 69, grade: "C", remark: "Good", isPass: true, sortOrder: 3 },
    { name: "Primary Scale", minPercent: 50, maxPercent: 59, grade: "D", remark: "Satisfactory", isPass: true, sortOrder: 4 },
    { name: "Primary Scale", minPercent: 0, maxPercent: 49, grade: "E", remark: "Needs Improvement", isPass: false, sortOrder: 5 },
  ];

  for (const gb of gradingBands) {
    await prisma.gradingBand.upsert({
      where: { schoolId_name_sortOrder: { schoolId: school.id, name: gb.name, sortOrder: gb.sortOrder } },
      update: {},
      create: { schoolId: school.id, ...gb },
    });
  }

  // School default report weighting: continuous assessment 40%, examination 60%.
  const defaultWeighting = await prisma.reportWeighting.findFirst({ where: { schoolId: school.id, subjectId: null } });
  if (!defaultWeighting) {
    await prisma.reportWeighting.create({ data: { schoolId: school.id, subjectId: null, caPercent: 40, examPercent: 60 } });
  }

  // 11. Guardians
  const guardiansData = [
    { id: "g-001", firstName: "Tendai", lastName: "Moyo", phone: "+263000000001", email: "tendai.moyo@guardian.nyashavee.local", relationship: "Father", occupation: "Accountant", employer: "Deloitte Zimbabwe" },
    { id: "g-002", firstName: "Rumbidzai", lastName: "Moyo", phone: "+263000000002", email: "rumbi.moyo@guardian.nyashavee.local", relationship: "Mother", occupation: "Nurse", employer: "Parirenyatwa Hospital" },
    { id: "g-003", firstName: "Farai", lastName: "Chikwanha", phone: "+263000000003", email: "farai.chikwanha@guardian.nyashavee.local", relationship: "Father", occupation: "Engineer", employer: "Econet Wireless" },
    { id: "g-004", firstName: "Nyasha", lastName: "Mapfumo", phone: "+263000000004", email: "nyasha.mapfumo@guardian.nyashavee.local", relationship: "Mother", occupation: "Teacher", employer: "Prince Edward School" },
    { id: "g-005", firstName: "Blessing", lastName: "Ncube", phone: "+263000000005", email: "blessing.ncube@guardian.nyashavee.local", relationship: "Father", occupation: "Lawyer", employer: "Gill Godlonton & Gerrans" },
    { id: "g-006", firstName: "Tariro", lastName: "Sibanda", phone: "+263000000006", relationship: "Mother", occupation: "Market Trader", employer: "Self-employed" },
    { id: "g-007", firstName: "Kudakwashe", lastName: "Zvobgo", phone: "+263000000007", email: "kuda.zvobgo@guardian.nyashavee.local", relationship: "Father", occupation: "Doctor", employer: "Avenues Clinic" },
    { id: "g-008", firstName: "Memory", lastName: "Chipunza", phone: "+263000000008", email: "memory.chipunza@guardian.nyashavee.local", relationship: "Mother", occupation: "Pharmacist", employer: "Greenwood Pharmacy" },
    { id: "g-009", firstName: "Wellington", lastName: "Mutambara", phone: "+263000000009", relationship: "Father", occupation: "Farmer", employer: "Self-employed" },
    { id: "g-010", firstName: "Patience", lastName: "Mangwende", phone: "+263000000010", email: "patience.mangwende@guardian.nyashavee.local", relationship: "Mother", occupation: "Bank Teller", employer: "CBZ Bank" },
    { id: "g-011", firstName: "Takudzwa", lastName: "Garikayi", phone: "+263000000011", email: "takudzwa.garikayi@guardian.nyashavee.local", relationship: "Father", occupation: "Pilot", employer: "Air Zimbabwe" },
    { id: "g-012", firstName: "Rudo", lastName: "Makoni", phone: "+263000000012", relationship: "Guardian", occupation: "Police Officer", employer: "ZRP" },
  ];

  // Earlier demo seeds used plausible real-world contact details. Replace only
  // those exact legacy values; contacts edited by a user are left untouched.
  const legacyGuardianEmails: Record<string, string> = {
    "g-001": "tendai.moyo@email.co.zw",
    "g-002": "rumbi.moyo@email.co.zw",
    "g-003": "farai.chikwanha@gmail.com",
    "g-004": "nyasha.mapfumo@yahoo.com",
    "g-005": "blessing.ncube@mail.co.zw",
    "g-007": "kuda.zvobgo@zol.co.zw",
    "g-008": "memory.chipunza@gmail.com",
    "g-010": "patience.m@outlook.com",
    "g-011": "taku.garikayi@mail.com",
  };
  const legacyGuardianPhones: Record<string, string> = Object.fromEntries(
    [
      "+263771234567", "+263772345678", "+263773456789", "+263774567890",
      "+263775678901", "+263776789012", "+263777890123", "+263778901234",
      "+263779012345", "+263770123456", "+263771111222", "+263772222333",
    ].map((phone, index) => [`g-${String(index + 1).padStart(3, "0")}`, phone]),
  );

  const guardianMap: Record<string, string> = {};
  for (const g of guardiansData) {
    const legacyEmail = legacyGuardianEmails[g.id];
    if (legacyEmail) {
      await prisma.guardian.updateMany({
        where: { id: g.id, schoolId: school.id, email: legacyEmail },
        data: { email: g.email, phone: g.phone },
      });
    }
    await prisma.guardian.updateMany({
      where: { id: g.id, schoolId: school.id, phone: legacyGuardianPhones[g.id] },
      data: { phone: g.phone },
    });
    const guardian = await prisma.guardian.upsert({
      where: { id: g.id },
      update: {},
      create: {
        id: g.id,
        schoolId: school.id,
        firstName: g.firstName,
        lastName: g.lastName,
        phone: g.phone,
        email: g.email,
        relationship: g.relationship,
        occupation: g.occupation,
        employer: g.employer,
        isFinancialContact: true,
      },
    });
    guardianMap[g.id] = guardian.id;
  }

  // 12. Students
  const studentsData = [
    // Grade 5A
    { id: "s-001", admissionNumber: "NPS/2026/0001", firstName: "Tariro", lastName: "Moyo", gender: "female", dob: "2015-03-14", guardianId: "g-001", className: "Grade 5A" },
    { id: "s-002", admissionNumber: "NPS/2026/0002", firstName: "Tafadzwa", lastName: "Moyo", gender: "male", dob: "2014-11-22", guardianId: "g-001", className: "Grade 5A" },
    { id: "s-003", admissionNumber: "NPS/2026/0003", firstName: "Anashe", lastName: "Chikwanha", gender: "female", dob: "2015-06-08", guardianId: "g-003", className: "Grade 5A" },
    { id: "s-004", admissionNumber: "NPS/2026/0004", firstName: "Tinotenda", lastName: "Mapfumo", gender: "male", dob: "2015-01-30", guardianId: "g-004", className: "Grade 5A" },
    { id: "s-005", admissionNumber: "NPS/2026/0005", firstName: "Makanaka", lastName: "Ncube", gender: "female", dob: "2015-08-17", guardianId: "g-005", className: "Grade 5A" },
    { id: "s-006", admissionNumber: "NPS/2026/0006", firstName: "Takudzwa", lastName: "Zvobgo", gender: "male", dob: "2015-04-25", guardianId: "g-007", className: "Grade 5A" },
    { id: "s-007", admissionNumber: "NPS/2026/0007", firstName: "Rufaro", lastName: "Chipunza", gender: "female", dob: "2015-02-11", guardianId: "g-008", className: "Grade 5A" },
    { id: "s-008", admissionNumber: "NPS/2026/0008", firstName: "Munyaradzi", lastName: "Mutambara", gender: "male", dob: "2014-12-05", guardianId: "g-009", className: "Grade 5A" },
    { id: "s-036", admissionNumber: "NPS/2026/0036", firstName: "Anesu", lastName: "Garikayi", gender: "male", dob: "2015-05-11", guardianId: "g-011", className: "Grade 5A" },
    { id: "s-037", admissionNumber: "NPS/2026/0037", firstName: "Tendai", lastName: "Makoni", gender: "female", dob: "2015-09-27", guardianId: "g-012", className: "Grade 5A" },
    { id: "s-038", admissionNumber: "NPS/2026/0038", firstName: "Blessing", lastName: "Sibanda", gender: "male", dob: "2015-07-19", guardianId: "g-006", className: "Grade 5A" },
    { id: "s-039", admissionNumber: "NPS/2026/0039", firstName: "Fungai", lastName: "Mutambara", gender: "female", dob: "2015-10-03", guardianId: "g-009", className: "Grade 5A" },
    { id: "s-040", admissionNumber: "NPS/2026/0040", firstName: "Gamuchirai", lastName: "Mangwende", gender: "male", dob: "2014-12-20", guardianId: "g-010", className: "Grade 5A" },
    // Grade 3A
    { id: "s-009", admissionNumber: "NPS/2026/0009", firstName: "Nyasha", lastName: "Mangwende", gender: "female", dob: "2017-05-20", guardianId: "g-010", className: "Grade 3A" },
    { id: "s-010", admissionNumber: "NPS/2026/0010", firstName: "Kudzai", lastName: "Garikayi", gender: "male", dob: "2017-09-12", guardianId: "g-011", className: "Grade 3A" },
    { id: "s-011", admissionNumber: "NPS/2026/0011", firstName: "Chenai", lastName: "Sibanda", gender: "female", dob: "2017-07-03", guardianId: "g-006", className: "Grade 3A" },
    { id: "s-012", admissionNumber: "NPS/2026/0012", firstName: "Simbarashe", lastName: "Makoni", gender: "male", dob: "2017-02-14", guardianId: "g-012", className: "Grade 3A" },
    { id: "s-013", admissionNumber: "NPS/2026/0013", firstName: "Ruvarashe", lastName: "Chikwanha", gender: "female", dob: "2017-11-28", guardianId: "g-003", className: "Grade 3A" },
    { id: "s-014", admissionNumber: "NPS/2026/0014", firstName: "Tadiwanashe", lastName: "Moyo", gender: "male", dob: "2017-04-09", guardianId: "g-001", className: "Grade 3A" },
    // Grade 7A
    { id: "s-015", admissionNumber: "NPS/2026/0015", firstName: "Panashe", lastName: "Zvobgo", gender: "male", dob: "2013-06-15", guardianId: "g-007", className: "Grade 7A" },
    { id: "s-016", admissionNumber: "NPS/2026/0016", firstName: "Ropafadzo", lastName: "Mapfumo", gender: "female", dob: "2013-03-22", guardianId: "g-004", className: "Grade 7A" },
    { id: "s-017", admissionNumber: "NPS/2026/0017", firstName: "Tinashe", lastName: "Mutambara", gender: "male", dob: "2013-10-04", guardianId: "g-009", className: "Grade 7A" },
    { id: "s-018", admissionNumber: "NPS/2026/0018", firstName: "Yeukai", lastName: "Mangwende", gender: "female", dob: "2013-08-19", guardianId: "g-010", className: "Grade 7A" },
    { id: "s-019", admissionNumber: "NPS/2026/0019", firstName: "Kudakwashe", lastName: "Ncube", gender: "male", dob: "2013-01-07", guardianId: "g-005", className: "Grade 7A" },
    { id: "s-020", admissionNumber: "NPS/2026/0020", firstName: "Chiedza", lastName: "Garikayi", gender: "female", dob: "2013-12-30", guardianId: "g-011", className: "Grade 7A" },
    // ECD A
    { id: "s-021", admissionNumber: "NPS/2026/0021", firstName: "Rutendo", lastName: "Chipunza", gender: "female", dob: "2020-04-12", guardianId: "g-008", className: "ECD A" },
    { id: "s-022", admissionNumber: "NPS/2026/0022", firstName: "Tawananyasha", lastName: "Sibanda", gender: "male", dob: "2020-07-08", guardianId: "g-006", className: "ECD A" },
    { id: "s-023", admissionNumber: "NPS/2026/0023", firstName: "Fadzai", lastName: "Makoni", gender: "female", dob: "2020-02-28", guardianId: "g-012", className: "ECD A" },
    // Grade 1A
    { id: "s-024", admissionNumber: "NPS/2026/0024", firstName: "Zvikomborero", lastName: "Moyo", gender: "male", dob: "2019-01-15", guardianId: "g-001", className: "Grade 1A" },
    { id: "s-025", admissionNumber: "NPS/2026/0025", firstName: "Anotida", lastName: "Zvobgo", gender: "female", dob: "2019-05-22", guardianId: "g-007", className: "Grade 1A" },
    // Grade 2A
    { id: "s-026", admissionNumber: "NPS/2026/0026", firstName: "Maita", lastName: "Chikwanha", gender: "male", dob: "2018-08-10", guardianId: "g-003", className: "Grade 2A" },
    { id: "s-027", admissionNumber: "NPS/2026/0027", firstName: "Nenyasha", lastName: "Mutambara", gender: "female", dob: "2018-03-17", guardianId: "g-009", className: "Grade 2A" },
    // Grade 4A
    { id: "s-028", admissionNumber: "NPS/2026/0028", firstName: "Tatenda", lastName: "Mangwende", gender: "male", dob: "2016-06-14", guardianId: "g-010", className: "Grade 4A" },
    { id: "s-029", admissionNumber: "NPS/2026/0029", firstName: "Danai", lastName: "Garikayi", gender: "female", dob: "2016-10-01", guardianId: "g-011", className: "Grade 4A" },
    // Grade 6A
    { id: "s-030", admissionNumber: "NPS/2026/0030", firstName: "Mufaro", lastName: "Chipunza", gender: "male", dob: "2014-04-18", guardianId: "g-008", className: "Grade 6A" },
    { id: "s-031", admissionNumber: "NPS/2026/0031", firstName: "Vongai", lastName: "Mapfumo", gender: "female", dob: "2014-09-26", guardianId: "g-004", className: "Grade 6A" },
    // Grade 3B
    { id: "s-032", admissionNumber: "NPS/2026/0032", firstName: "Munashe", lastName: "Ncube", gender: "male", dob: "2017-01-20", guardianId: "g-005", className: "Grade 3B" },
    { id: "s-033", admissionNumber: "NPS/2026/0033", firstName: "Tsitsi", lastName: "Zvobgo", gender: "female", dob: "2017-06-05", guardianId: "g-007", className: "Grade 3B" },
    // ECD B
    { id: "s-034", admissionNumber: "NPS/2026/0034", firstName: "Ruvimbo", lastName: "Moyo", gender: "female", dob: "2019-11-08", guardianId: "g-002", className: "ECD B" },
    { id: "s-035", admissionNumber: "NPS/2026/0035", firstName: "Tapiwa", lastName: "Chikwanha", gender: "male", dob: "2019-08-30", guardianId: "g-003", className: "ECD B" },
  ];

  const studentMap: Record<string, string> = {};
  const enrollmentMap: Record<string, string> = {};
  for (const s of studentsData) {
    const student = await prisma.student.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        schoolId: school.id,
        admissionNumber: s.admissionNumber,
        firstName: s.firstName,
        lastName: s.lastName,
        gender: s.gender,
        dateOfBirth: new Date(s.dob),
        classroomId: classMap[s.className],
        admissionDate: new Date("2026-01-13"),
        status: "active",
      },
    });
    studentMap[s.id] = student.id;

    // Link guardian
    await prisma.studentGuardian.upsert({
      where: { studentId_guardianId: { studentId: student.id, guardianId: guardianMap[s.guardianId] } },
      update: {},
      create: {
        studentId: student.id,
        guardianId: guardianMap[s.guardianId],
        relationshipType: s.guardianId === "g-002" ? "mother" : "father",
        isPrimaryContact: true,
        authorizedPickup: true,
      },
    });

    // Enrollment
    const enrollment = await prisma.studentEnrollment.upsert({
      where: { id: `se-${s.id}` },
      update: {},
      create: {
        id: `se-${s.id}`,
        studentId: student.id,
        schoolId: school.id,
        academicYearId: year.id,
        gradeLevelId: gradeMap[s.className.replace(/[AB]$/, "")] || gradeMap["Grade 5"],
        classroomId: classMap[s.className],
        enrollmentDate: new Date("2026-01-13"),
        status: "active",
      },
    });
    enrollmentMap[s.id] = enrollment.id;
  }

  // Link portal logins to their profiles
  await prisma.guardian.update({
    where: { id: guardianMap["g-001"] },
    data: { portalUserId: parentUser.id },
  });

  // 13. Attendance
  const g5aStudents = studentsData.filter(s => s.className === "Grade 5A");
  const today = new Date("2026-09-11");

  const register = await prisma.attendanceRegister.upsert({
    where: { schoolId_classroomId_registerDate_session: { schoolId: school.id, classroomId: classMap["Grade 5A"], registerDate: today, session: "morning" } },
    update: {},
    create: {
      schoolId: school.id,
      classroomId: classMap["Grade 5A"],
      academicYearId: year.id,
      registerDate: today,
      session: "morning",
      status: "submitted",
      submittedById: membershipMap["teacher_008"],
      submittedAt: new Date(),
    },
  });

  for (const s of g5aStudents) {
    const status = s.id === "s-005" ? "absent" : (s.id === "s-004" || s.id === "s-038") ? "late" : "present";
    await prisma.attendanceEntry.upsert({
      where: { registerId_studentId: { registerId: register.id, studentId: studentMap[s.id] } },
      update: {},
      create: {
        registerId: register.id,
        studentId: studentMap[s.id],
        status,
        reason: status === "absent" ? "Illness" : null,
        markedById: membershipMap["teacher_008"],
      },
    });
  }

  // 14. Attendance settings
  await prisma.attendanceSettings.upsert({
    where: { schoolId: school.id },
    update: {},
    create: { schoolId: school.id },
  });

  // 15. Fee Invoices
  const term3 = termMap["Term 3"];
  for (const s of g5aStudents) {
    const invoice = await prisma.feeInvoice.upsert({
      where: { schoolId_invoiceNumber: { schoolId: school.id, invoiceNumber: `INV/2026/${s.admissionNumber.split("/")[2]}` } },
      update: {},
      create: {
        schoolId: school.id,
        studentId: studentMap[s.id],
        termId: term3,
        invoiceNumber: `INV/2026/${s.admissionNumber.split("/")[2]}`,
        issueDate: new Date("2026-09-01"),
        dueDate: new Date("2026-09-30"),
        currency: "USD",
        state: "issued",
        totalMinor: 23000,
        studentNameSnapshot: `${s.firstName} ${s.lastName}`,
        admissionNumberSnapshot: s.admissionNumber,
        issuerNameSnapshot: "Mrs Nyasha Dube",
        createdById: membershipMap["bursar"],
        issuedAt: new Date("2026-09-01"),
      },
    });

    const items = [
      { position: 1, description: "Tuition - Term 3", category: "tuition", unitAmountMinor: 18000 },
      { position: 2, description: "ICT Levy", category: "ict", unitAmountMinor: 2000 },
      { position: 3, description: "Development Levy", category: "development", unitAmountMinor: 3000 },
    ];

    for (const item of items) {
      await prisma.feeInvoiceItem.upsert({
        where: { schoolId_invoiceId_position: { schoolId: school.id, invoiceId: invoice.id, position: item.position } },
        update: {},
        create: {
          schoolId: school.id,
          invoiceId: invoice.id,
          ...item,
        },
      });
    }
  }

  // 16. Payments for some students
  const paymentsData = [
    { studentId: "s-001", amount: 23000, method: "bank_transfer", reference: "TRF-88291", payer: "Tendai Moyo" },
    { studentId: "s-002", amount: 15000, method: "ecocash", reference: "EC-773456", payer: "Tendai Moyo" },
    { studentId: "s-003", amount: 23000, method: "cash", payer: "Farai Chikwanha" },
    { studentId: "s-006", amount: 25000, method: "bank_transfer", reference: "TRF-99102", payer: "Kudakwashe Zvobgo" },
    { studentId: "s-007", amount: 10000, method: "ecocash", reference: "EC-778901", payer: "Memory Chipunza" },
  ];

  for (const p of paymentsData) {
    const payment = await prisma.payment.upsert({
      where: { schoolId_receiptNumber: { schoolId: school.id, receiptNumber: `RCT/2026/${p.studentId.split("-")[1].padStart(4, "0")}` } },
      update: {},
      create: {
        schoolId: school.id,
        studentId: studentMap[p.studentId],
        receiptNumber: `RCT/2026/${p.studentId.split("-")[1].padStart(4, "0")}`,
        paymentDate: new Date("2026-09-03"),
        method: p.method,
        currency: "USD",
        amountMinor: p.amount,
        reference: p.reference,
        payerNameSnapshot: p.payer,
        studentNameSnapshot: g5aStudents.find(s => s.id === p.studentId) ? `${g5aStudents.find(s => s.id === p.studentId)!.firstName} ${g5aStudents.find(s => s.id === p.studentId)!.lastName}` : "",
        admissionNumberSnapshot: g5aStudents.find(s => s.id === p.studentId)?.admissionNumber || "",
        issuerNameSnapshot: "Mrs Nyasha Dube",
        recordedById: membershipMap["bursar"],
      },
    });

    // Allocate to invoice
    const invoice = await prisma.feeInvoice.findFirst({
      where: { schoolId: school.id, studentId: studentMap[p.studentId], state: "issued" },
    });
    if (invoice) {
      await prisma.paymentAllocation.upsert({
        where: { id: `pa-${p.studentId}` },
        update: {},
        create: {
          id: `pa-${p.studentId}`,
          schoolId: school.id,
          studentId: studentMap[p.studentId],
          currency: "USD",
          paymentId: payment.id,
          invoiceId: invoice.id,
          amountMinor: Math.min(p.amount, invoice.totalMinor),
          allocatedById: membershipMap["bursar"],
        },
      });
    }
  }

  // 17. Assessments & Marks
  const assessmentTypes = [
    { idSuffix: "math-t1", title: "Mathematics Test 1", type: "test", maxMarks: 100, weight: 30, subjectCode: "MATH" },
    { idSuffix: "math-hw", title: "Mathematics Homework", type: "homework", maxMarks: 50, weight: 20, subjectCode: "MATH" },
    { idSuffix: "math-ex", title: "Mathematics End-of-Term Exam", type: "exam", maxMarks: 100, weight: 50, subjectCode: "MATH" },
    { idSuffix: "eng-t1", title: "English Comprehension Test", type: "test", maxMarks: 100, weight: 30, subjectCode: "ENG" },
    { idSuffix: "eng-hw", title: "English Essay Assignment", type: "homework", maxMarks: 50, weight: 20, subjectCode: "ENG" },
    { idSuffix: "eng-ex", title: "English End-of-Term Exam", type: "exam", maxMarks: 100, weight: 50, subjectCode: "ENG" },
  ];

  const mathMarks: Record<string, number[]> = {
    "s-001": [85, 45, 82], "s-002": [72, 38, 68], "s-003": [91, 48, 95],
    "s-004": [65, 30, 58], "s-005": [78, 40, 75], "s-006": [55, 25, 48],
    "s-007": [88, 44, 90], "s-008": [42, 20, 35], "s-036": [76, 35, 73],
    "s-037": [83, 42, 80], "s-038": [61, 28, 56], "s-039": [94, 47, 92],
    "s-040": [70, 33, 62],
  };

  const engMarks: Record<string, number[]> = {
    "s-001": [90, 46, 87], "s-002": [65, 32, 60], "s-003": [88, 44, 92],
    "s-004": [70, 35, 62], "s-005": [82, 40, 78], "s-006": [58, 28, 50],
    "s-007": [92, 48, 95], "s-008": [45, 22, 40],
  };

  for (const at of assessmentTypes) {
    const assessment = await prisma.assessment.upsert({
      where: { id: `as-g5a-${at.idSuffix}` },
      update: {},
      create: {
        id: `as-g5a-${at.idSuffix}`,
        schoolId: school.id,
        termId: term3,
        classSubjectId: g5aSubjectMap[at.subjectCode],
        title: at.title,
        assessmentType: at.type,
        component: ["exam", "examination", "midterm", "midterm_exam", "end_of_term_exam", "final_exam"].includes(at.type) ? "exam" : "ca",
        maxMarks: at.maxMarks,
        weightPercent: at.weight,
        status: "published",
        createdById: membershipMap["teacher_008"],
        publishedAt: new Date("2026-09-08"),
      },
    });

    const marksSource = at.subjectCode === "MATH" ? mathMarks : engMarks;
    for (const [studentId, scores] of Object.entries(marksSource)) {
      const score = at.idSuffix.includes("t1") ? scores[0] : at.idSuffix.includes("hw") ? scores[1] : scores[2];
      await prisma.assessmentMark.upsert({
        where: { assessmentId_studentId: { assessmentId: assessment.id, studentId: studentMap[studentId] } },
        update: {},
        create: {
          assessmentId: assessment.id,
          studentId: studentMap[studentId],
          score,
          enteredById: membershipMap["teacher_008"],
        },
      });
    }
  }

  // 17b. Published report cards (Term 2) — s-001's fees are cleared, s-002 still owes
  const reportResults = [
    { code: "ENG", name: "English", score: 88, grade: "A", remark: "Excellent", count: 3 },
    { code: "MATH", name: "Mathematics", score: 84, grade: "A", remark: "Excellent", count: 3 },
    { code: "SHO", name: "Shona", score: 79, grade: "B", remark: "Very Good", count: 3 },
    { code: "SCI", name: "Science", score: 82, grade: "A", remark: "Excellent", count: 3 },
    { code: "SS", name: "Social Studies", score: 75, grade: "B", remark: "Very Good", count: 3 },
  ];

  const reportCardsData = [
    { studentId: "s-001", name: "Tariro Moyo", admNo: "NPS/2026/0001", average: 82, promotion: "promoted" },
    { studentId: "s-002", name: "Tafadzwa Moyo", admNo: "NPS/2026/0002", average: 68, promotion: "promoted" },
  ];

  for (const rc of reportCardsData) {
    const card = await prisma.reportCard.upsert({
      where: { studentId_termId: { studentId: studentMap[rc.studentId], termId: termMap["Term 2"] } },
      update: {},
      create: {
        schoolId: school.id,
        studentId: studentMap[rc.studentId],
        termId: termMap["Term 2"],
        status: "published",
        promotionStatus: rc.promotion,
        studentNameSnapshot: rc.name,
        admissionNumberSnapshot: rc.admNo,
        classroomSnapshot: "Grade 5A",
        averagePercent: rc.average,
        presentSessions: 58,
        absentSessions: 2,
        verificationCode: crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
        classTeacherComment: "A consistent and hardworking learner.",
        headComment: "Well done. Keep up the good work.",
        generatedById: membershipMap["teacher_008"],
        publishedAt: new Date("2026-08-07T09:00:00Z"),
        publishedById: membershipMap["head"],
      },
    });

    for (const r of reportResults) {
      await prisma.reportCardResult.upsert({
        where: { reportCardId_subjectCodeSnapshot: { reportCardId: card.id, subjectCodeSnapshot: r.code } },
        update: {},
        create: {
          schoolId: school.id,
          reportCardId: card.id,
          subjectCodeSnapshot: r.code,
          subjectNameSnapshot: r.name,
          scorePercent: r.score,
          grade: r.grade,
          remark: r.remark,
          assessmentCount: r.count,
        },
      });
    }
  }

  // 17c. Fee templates for bulk class invoicing
  const feeTemplates = [
    {
      name: "Grade 5 Term 1 Fees",
      gradeName: "Grade 5",
      currency: "USD",
      description: "Standard term fee package for Grade 5",
      items: [
        { position: 1, description: "Tuition fees", category: "tuition", quantity: 1, unitAmountMinor: 18000 },
        { position: 2, description: "ICT levy", category: "levy", quantity: 1, unitAmountMinor: 2000 },
        { position: 3, description: "Development levy", category: "levy", quantity: 1, unitAmountMinor: 3000 },
      ],
    },
    {
      name: "Grade 1 Term 1 Fees",
      gradeName: "Grade 1",
      currency: "USD",
      description: "Standard term fee package for Grade 1",
      items: [
        { position: 1, description: "Tuition fees", category: "tuition", quantity: 1, unitAmountMinor: 15000 },
        { position: 2, description: "Development levy", category: "levy", quantity: 1, unitAmountMinor: 3000 },
      ],
    },
  ];

  for (const ft of feeTemplates) {
    const grade = await prisma.gradeLevel.findFirst({ where: { schoolId: school.id, name: ft.gradeName }, select: { id: true } });
    await prisma.feeTemplate.upsert({
      where: { schoolId_name: { schoolId: school.id, name: ft.name } },
      update: {},
      create: {
        schoolId: school.id,
        name: ft.name,
        description: ft.description,
        gradeLevelId: grade?.id ?? null,
        currency: ft.currency,
        items: JSON.stringify(ft.items),
      },
    });
  }

  // 18. Staff profiles
  const staffProfiles = [
    { membershipId: "head", employeeNumber: "EMP-001", firstName: "Rudo", lastName: "Chigumba", position: "Head Teacher", department: "Administration", qualification: "MEd Educational Leadership", isSenior: true, paidBy: "government", pscNumber: "PSC-" + Math.floor(10000 + Math.random()*89999) },
    { membershipId: "bursar", employeeNumber: "EMP-003", firstName: "Nyasha", lastName: "Dube", position: "Bursar", department: "Finance", qualification: "BCom Accounting", paidBy: "school", payeNumber: "PAYE-00421", nssaNumber: "NSSA-88231" },
    { membershipId: "teacher_001", employeeNumber: "EMP-004", firstName: "Tatenda", lastName: "Chirwa", position: "Class Teacher - ECD A", department: "Infant", qualification: "Diploma in Early Childhood", paidBy: "government" },
    { membershipId: "teacher_002", employeeNumber: "EMP-005", firstName: "Chenai", lastName: "Maposa", position: "Class Teacher - ECD B", department: "Infant", qualification: "Diploma in Early Childhood", paidBy: "government" },
    { membershipId: "teacher_003", employeeNumber: "EMP-006", firstName: "Knowledge", lastName: "Banda", position: "Class Teacher - Grade 1A", department: "Junior", qualification: "Diploma in Education", paidBy: "government" },
    { membershipId: "teacher_004", employeeNumber: "EMP-007", firstName: "Grace", lastName: "Moyo", position: "Class Teacher - Grade 2A", department: "Junior", qualification: "Diploma in Education", isSenior: true, paidBy: "government" },
    { membershipId: "teacher_008", employeeNumber: "EMP-008", firstName: "Ruvimbo", lastName: "Chidziva", position: "Class Teacher - Grade 5A", department: "Senior", qualification: "Diploma in Education", isSenior: true, paidBy: "government" },
    { membershipId: "teacher_005", employeeNumber: "EMP-009", firstName: "Blessing", lastName: "Ncube", position: "Class Teacher - Grade 3A", department: "Junior", qualification: "Diploma in Education", paidBy: "government" },
    { membershipId: "teacher_006", employeeNumber: "EMP-010", firstName: "Tsitsi", lastName: "Makoni", position: "Class Teacher - Grade 3B", department: "Junior", qualification: "Diploma in Education", paidBy: "government" },
    { membershipId: "teacher_007", employeeNumber: "EMP-011", firstName: "Simbarashe", lastName: "Hwata", position: "Class Teacher - Grade 4A", department: "Middle", qualification: "Diploma in Education", paidBy: "government" },
    { membershipId: "teacher_009", employeeNumber: "EMP-012", firstName: "Takudzwa", lastName: "Mhandu", position: "Class Teacher - Grade 6A", department: "Senior", qualification: "BEd Primary Education", paidBy: "government" },
    { membershipId: "librarian", employeeNumber: "EMP-013", firstName: "Patience", lastName: "Gumbo", position: "Librarian", department: "Library", qualification: "Diploma in Library Science", paidBy: "school" },
    { membershipId: "admissions", employeeNumber: "EMP-014", firstName: "Kudzai", lastName: "Nyoni", position: "Admissions Officer", department: "Administration", qualification: "BSc Administration", paidBy: "school" },
    { membershipId: null, employeeNumber: "EMP-015", firstName: "Tariro", lastName: "Zimuto", position: "Student teacher (attachment)", department: "Senior", qualification: null, employmentType: "student_teacher", paidBy: "school" },
    { membershipId: null, employeeNumber: "EMP-016", firstName: "Mai", lastName: "Choto", position: "Cook", department: "Kitchen", qualification: null, paidBy: "school", nssaNumber: "NSSA-77120" },
    { membershipId: null, employeeNumber: "EMP-017", firstName: "Baba", lastName: "Dube", position: "Groundsman", department: "Grounds", qualification: null, paidBy: "school", nssaNumber: "NSSA-66554" },
  ];

  for (const sp of staffProfiles) {
    await prisma.staffProfile.upsert({
      where: { schoolId_employeeNumber: { schoolId: school.id, employeeNumber: sp.employeeNumber } },
      update: {
        status: "active",
        endDate: null,
        statusDetail: null,
        paidBy: "paidBy" in sp ? sp.paidBy : "school",
        isSenior: "isSenior" in sp ? Boolean(sp.isSenior) : false,
        department: sp.department,
        position: sp.position,
        payeNumber: "payeNumber" in sp ? sp.payeNumber : null,
        nssaNumber: "nssaNumber" in sp ? sp.nssaNumber : null,
        pscNumber: "pscNumber" in sp ? sp.pscNumber : null,
      },
      create: {
        schoolId: school.id,
        membershipId: sp.membershipId ? membershipMap[sp.membershipId] || null : null,
        employeeNumber: sp.employeeNumber,
        firstName: sp.firstName,
        lastName: sp.lastName,
        position: sp.position,
        department: sp.department,
        isSenior: "isSenior" in sp ? Boolean(sp.isSenior) : false,
        paidBy: "paidBy" in sp ? sp.paidBy : "school",
        employmentType: "employmentType" in sp ? sp.employmentType : "permanent",
        startDate: new Date("2020-01-10"),
        qualification: sp.qualification,
        payeNumber: "payeNumber" in sp ? sp.payeNumber : null,
        nssaNumber: "nssaNumber" in sp ? sp.nssaNumber : null,
        pscNumber: "pscNumber" in sp ? sp.pscNumber : null,
      },
    });
  }

  // 19. Library books
  const books = [
    { isbn: "978-0-7974-1234-5", title: "Shona for Primary Schools Grade 5", author: "T. Mashingaidze", publisher: "College Press", category: "Languages" },
    { isbn: "978-0-7974-2345-6", title: "Step Ahead Mathematics Grade 5", author: "M. Gondo", publisher: "Longman Zimbabwe", category: "Mathematics" },
    { isbn: "978-0-14-036698-0", title: "Charlotte's Web", author: "E.B. White", publisher: "Puffin Books", category: "Fiction" },
    { isbn: "978-0-7974-3456-7", title: "New Primary Science Grade 3", author: "R. Mawere", publisher: "Zimbabwe Publishing House", category: "Science" },
    { isbn: "978-0-19-571234-5", title: "Oxford English for Zimbabwe", author: "D. Mugabe", publisher: "Oxford University Press", category: "Languages" },
  ];

  for (const b of books) {
    const book = await prisma.libraryBook.upsert({
      where: { schoolId_isbn: { schoolId: school.id, isbn: b.isbn } },
      update: {},
      create: { schoolId: school.id, ...b },
    });
    for (let i = 1; i <= 2; i++) {
      await prisma.libraryCopy.upsert({
        where: { schoolId_accessionNumber: { schoolId: school.id, accessionNumber: `ACC-${b.isbn.slice(-4)}-${i}` } },
        update: {},
        create: {
          schoolId: school.id,
          bookId: book.id,
          accessionNumber: `ACC-${b.isbn.slice(-4)}-${i}`,
          status: i === 1 ? "available" : "issued",
        },
      });
    }
  }

  // 20. Announcements
  const announcements = [
    { title: "Term 3 Fee Payment Deadline", body: "Dear Parents, please note that all Term 3 fees must be settled by 30 September 2026. Payments can be made via EcoCash, bank transfer or at the school office.", audience: "parents", createdById: membershipMap["head"] },
    { title: "Inter-House Athletics Day", body: "The annual Inter-House Athletics Day will be held on Friday 26 September 2026. All learners are expected to participate.", audience: "all", createdById: membershipMap["teacher_008"] },
    { title: "Grade 7 Mock Examinations", body: "Grade 7 mock examinations will commence on Monday 15 September 2026. The timetable has been shared with learners.", audience: "teachers", createdById: membershipMap["head"] },
  ];

  for (const a of announcements) {
    await prisma.announcement.upsert({
      where: { id: `ann-${a.title.slice(0, 5).replace(/\s/g, "-").toLowerCase()}` },
      update: {},
      create: {
        id: `ann-${a.title.slice(0, 5).replace(/\s/g, "-").toLowerCase()}`,
        schoolId: school.id,
        title: a.title,
        body: a.body,
        audience: a.audience,
        channel: "in_app",
        status: "published",
        publishAt: new Date("2026-09-01"),
        createdById: a.createdById,
      },
    });
  }

  // 21. School events
  const events = [
    { title: "Inter-House Athletics Day", category: "sports", startAt: "2026-09-26T08:00:00", endAt: "2026-09-26T15:00:00", location: "School Sports Ground", createdById: membershipMap["teacher_008"] },
    { title: "Parents Consultation Day", category: "meeting", startAt: "2026-10-03T09:00:00", endAt: "2026-10-03T13:00:00", location: "School Hall", createdById: membershipMap["head"] },
    { title: "Grade 7 Farewell", category: "ceremony", startAt: "2026-11-28T10:00:00", endAt: "2026-11-28T14:00:00", location: "School Hall", createdById: membershipMap["head"] },
  ];

  for (const e of events) {
    await prisma.schoolEvent.upsert({
      where: { id: `ev-${e.title.slice(0, 10).replace(/\s/g, "-").toLowerCase()}` },
      update: {},
      create: {
        id: `ev-${e.title.slice(0, 10).replace(/\s/g, "-").toLowerCase()}`,
        schoolId: school.id,
        title: e.title,
        category: e.category,
        startAt: new Date(e.startAt),
        endAt: new Date(e.endAt),
        location: e.location,
        audience: "all",
        status: "scheduled",
        createdById: e.createdById,
      },
    });
  }

  // 22. Inventory assets
  await prisma.inventoryAsset.upsert({
    where: { schoolId_assetTag: { schoolId: school.id, assetTag: "NPS-COMP-001" } },
    update: {},
    create: {
      schoolId: school.id,
      assetTag: "NPS-COMP-001",
      name: "Desktop Computer",
      category: "ICT Equipment",
      serialNumber: "SN-2024-001",
      purchaseDate: new Date("2024-03-15"),
      purchaseCostMinor: 45000,
      currency: "USD",
      condition: "good",
      status: "in_service",
      location: "Computer Lab",
    },
  });

  await prisma.inventoryAsset.upsert({
    where: { schoolId_assetTag: { schoolId: school.id, assetTag: "NPS-PROJ-001" } },
    update: {},
    create: {
      schoolId: school.id,
      assetTag: "NPS-PROJ-001",
      name: "LCD Projector",
      category: "ICT Equipment",
      serialNumber: "SN-2023-015",
      purchaseDate: new Date("2023-08-20"),
      purchaseCostMinor: 35000,
      currency: "USD",
      condition: "good",
      status: "in_service",
      location: "School Hall",
    },
  });

  // 23. Income-generating projects, donations & ledger
  const garden = await prisma.incomeProject.upsert({
    where: { schoolId_name: { schoolId: school.id, name: "School garden" } },
    update: {},
    create: { schoolId: school.id, name: "School garden", description: "Vegetable produce sold at the Saturday market" },
  });
  const poultry = await prisma.incomeProject.upsert({
    where: { schoolId_name: { schoolId: school.id, name: "Poultry project" } },
    update: {},
    create: { schoolId: school.id, name: "Poultry project", description: "Broiler batches reared and sold each term" },
  });
  const ledgerSeed = [
    { projectId: garden.id, kind: "income", counterpart: "Mbare market buyers", description: "Tomato and onion sales", amountMinor: 14500, currency: "USD", occurredOn: "2026-08-29", reference: "MKT-014" },
    { projectId: garden.id, kind: "expense", counterpart: "Kweekwe Agro", description: "Seedlings and fertiliser", amountMinor: 3800, currency: "USD", occurredOn: "2026-08-20" },
    { projectId: poultry.id, kind: "income", counterpart: "Chitungwiza butchery", description: "Batch 4 broiler sales (60 birds)", amountMinor: 36000, currency: "USD", occurredOn: "2026-09-05", reference: "PO-221" },
    { projectId: poultry.id, kind: "expense", counterpart: "National Foods", description: "Feed — 12 bags grower mash", amountMinor: 11800, currency: "USD", occurredOn: "2026-08-15" },
    { projectId: null, kind: "donation_in", counterpart: "Churches Together Trust", description: "Donation towards library books", amountMinor: 50000, currency: "USD", occurredOn: "2026-07-30", reference: "CTT-2026-117" },
    { projectId: null, kind: "donation_in", counterpart: "Old students association", description: "ZiG donation for sports kit", amountMinor: 900000, currency: "ZWG", occurredOn: "2026-08-12" },
    { projectId: null, kind: "donation_out", counterpart: "Mbudzi Primary School", description: "Donated surplus desks after classroom upgrade", amountMinor: 15000, currency: "USD", occurredOn: "2026-08-22" },
  ];
  for (const [index, entry] of ledgerSeed.entries()) {
    await prisma.schoolLedgerEntry.upsert({
      where: { id: `ledger-seed-${index + 1}` },
      update: {},
      create: {
        id: `ledger-seed-${index + 1}`,
        schoolId: school.id,
        projectId: entry.projectId,
        kind: entry.kind,
        counterpart: entry.counterpart,
        description: entry.description,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        occurredOn: new Date(entry.occurredOn),
        reference: entry.reference ?? null,
      },
    });
  }

  const stockSeed = [
    { projectId: poultry.id, name: "Broiler birds", unit: "birds", onHand: 80 },
    { projectId: poultry.id, name: "Grower mash", unit: "bags", onHand: 6 },
    { projectId: garden.id, name: "Tomatoes", unit: "crates", onHand: 12 },
  ];
  for (const [index, item] of stockSeed.entries()) {
    await prisma.projectStockItem.upsert({
      where: { projectId_name: { projectId: item.projectId, name: item.name } },
      update: {},
      create: { id: `stock-seed-${index + 1}`, schoolId: school.id, projectId: item.projectId, name: item.name, unit: item.unit, onHand: item.onHand },
    });
  }

  // Suppliers + project budget
  await prisma.supplier.upsert({
    where: { id: "supplier-seed-1" },
    update: {},
    create: { id: "supplier-seed-1", schoolId: school.id, name: "National Foods", contact: "T. Mukono", phone: "+263242700100", email: "sales@nationalfoods.co.zw", notes: "Feed and grain supplier" },
  });
  await prisma.supplier.upsert({
    where: { id: "supplier-seed-2" },
    update: {},
    create: { id: "supplier-seed-2", schoolId: school.id, name: "Kweekwe Agro", contact: "P. Chivore", phone: "+263772900441" },
  });
  await prisma.projectBudget.upsert({
    where: { projectId_currency: { projectId: poultry.id, currency: "USD" } },
    update: {},
    create: { schoolId: school.id, projectId: poultry.id, label: "Term 3 batch budget", amountMinor: 50000, currency: "USD" },
  });

  // 24. Audit logs
  const auditEntries = [
    { action: "system.seed", entityType: "school", entityId: school.id, details: { message: "Demo data seeded for Nyashavee Primary School" }, actorMembershipId: membershipMap["school_admin"] },
    { action: "finance.invoice.issued", entityType: "fee_invoice", entityId: "inv-001", details: { invoiceNumber: "INV/2026/0001", student: "Tariro Moyo", amount: "USD 230.00" }, actorMembershipId: membershipMap["bursar"] },
    { action: "finance.payment.received", entityType: "payment", entityId: "pay-001", details: { receiptNumber: "RCT/2026/0001", student: "Tariro Moyo", amount: "USD 230.00", method: "bank_transfer" }, actorMembershipId: membershipMap["bursar"] },
    { action: "attendance.register.submitted", entityType: "attendance_register", entityId: register.id, details: { class: "Grade 5A", date: "2026-09-11", present: 11, absent: 1, late: 2 }, actorMembershipId: membershipMap["teacher_008"] },
  ];

  for (const [index, ae] of auditEntries.entries()) {
    const id = `seed-audit-${index + 1}`;
    const data = {
      schoolId: school.id,
      actorMembershipId: ae.actorMembershipId,
      action: ae.action,
      entityType: ae.entityType,
      entityId: ae.entityId,
      details: JSON.stringify(ae.details),
    };
    await prisma.auditLog.upsert({
      where: { id },
      update: data,
      create: {
        id,
        schoolId: school.id,
        actorMembershipId: ae.actorMembershipId,
        action: ae.action,
        entityType: ae.entityType,
        entityId: ae.entityId,
        details: JSON.stringify(ae.details),
      },
    });
  }

  console.log("✅ Seed complete!");
  console.log(`  School: ${school.name}`);
  console.log(`  Users: ${memberships.length + teacherUsers.length}`);
  console.log(`  Students: ${studentsData.length}`);
  console.log(`  Guardians: ${guardiansData.length}`);
  console.log(`  Classes: ${classrooms.length}`);
  console.log(`  Assessments: ${assessmentTypes.length}`);
  console.log(`  Marks: ${Object.keys(mathMarks).length * 3 + Object.keys(engMarks).length * 3}`);
  // Pastoral + extracurricular seed
  const chessClub = await prisma.club.upsert({
    where: { id: "club-chess" },
    update: {},
    create: { id: "club-chess", schoolId: school.id, name: "Chess Club", category: "Academic", schedule: "Tuesdays 14:00", coordinatorId: membershipMap["teacher_008"] },
  });
  await prisma.club.upsert({
    where: { id: "club-choir" },
    update: {},
    create: { id: "club-choir", schoolId: school.id, name: "Junior Choir", category: "Arts", schedule: "Thursdays 15:00", coordinatorId: membershipMap["teacher_008"] },
  });
  for (const sid of ["s-001", "s-002", "s-003"]) {
    await prisma.clubMembership.upsert({
      where: { clubId_studentId: { clubId: chessClub.id, studentId: studentMap[sid] } },
      update: {},
      create: { schoolId: school.id, clubId: chessClub.id, studentId: studentMap[sid] },
    });
  }
  await prisma.pickupAuthorization.upsert({
    where: { id: "pickup-s001-uncle" },
    update: {},
    create: {
      id: "pickup-s001-uncle", schoolId: school.id, studentId: studentMap["s-001"],
      name: "Farai Moyo", relationship: "Uncle", phone: "+263 77 555 0100",
      authorizedById: membershipMap["teacher_008"],
    },
  });
  console.log(`  Invoices: ${g5aStudents.length}`);
  console.log(`  Payments: ${paymentsData.length}`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
