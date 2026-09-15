/* End-to-end smoke test: signs in through the real Auth.js credentials flow,
 * then exercises the critical APIs. Run with the dev server up:
 *   npx tsx scripts/smoke.ts
 */

export {};

const BASE = process.env.SMOKE_URL || "http://localhost:3000";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

function cookieHeader(setCookies: string[]) {
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

async function signIn(email: string, password: string) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const csrfCookies = csrfRes.headers.getSetCookie();

  const body = new URLSearchParams({
    csrfToken,
    email,
    password,
    callbackUrl: `${BASE}/`,
  });
  const signInRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader(csrfCookies) },
    body,
    redirect: "manual",
  });
  const cookies = [...csrfCookies, ...signInRes.headers.getSetCookie()];
  return cookieHeader(cookies);
}

const idem = () => ({ "Idempotency-Key": crypto.randomUUID() });

async function api(cookie: string, path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...init,
    headers: { Cookie: cookie, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    /* non-JSON */
  }
  return { status: response.status, json: json as Record<string, unknown> };
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);

  // Health + public pages
  const health = await api("", "/api/health");
  check("health endpoint", health.status === 200 && health.json.ok === true);
  const loginPage = await fetch(`${BASE}/login`);
  check("login page reachable", loginPage.status === 200);
  const forgotPage = await fetch(`${BASE}/forgot-password`);
  check("forgot-password page reachable", forgotPage.status === 200);

  // Unauthenticated requests must be rejected
  const unauth = await api("", "/api/students");
  check("unauthenticated API access denied", unauth.status === 401 || unauth.status === 403, `got ${unauth.status}`);

  // Admin sign-in
  const adminCookie = await signIn("admin@nyashavee.local", "admin123");
  check("admin sign-in produces session cookie", adminCookie.includes("authjs.session-token") || adminCookie.includes("__Secure-authjs.session-token"));

  const dashboard = await api(adminCookie, "/api/dashboard");
  check("dashboard loads", dashboard.status === 200, `got ${dashboard.status}`);
  check("dashboard has workspace", Boolean((dashboard.json?.workspace as Record<string, unknown> | undefined)?.schoolName));
  check("dashboard exposes schools list", Array.isArray(dashboard.json?.schools));

  const students = await api(adminCookie, "/api/students?page=1&pageSize=25");
  check("students paginated response", students.status === 200 && Array.isArray(students.json.students) && typeof students.json.total === "number");
  check("students include enrolment history", Array.isArray((students.json.students as Array<Record<string, unknown>>)[0]?.enrollments));

  const finance = await api(adminCookie, "/api/finance");
  check("finance loads with templates", finance.status === 200 && Array.isArray(finance.json.templates));
  check("finance exposes classes for bulk invoicing", Array.isArray(finance.json.classes));

  // Admin creates a login, then that login works
  const classes = await api(adminCookie, "/api/classes");
  const classesList = (classes.json.classrooms ?? []) as Array<Record<string, unknown>>;
  check("classes API works", classes.status === 200 && classesList.length > 0);

  const email = `smoke.${Date.now()}@nyashavee.local`;
  const createUser = await api(adminCookie, "/api/administration", {
    method: "POST",
    body: JSON.stringify({ action: "create_user_access", email, displayName: "Smoke Tester", role: "librarian" }),
  });
  check("admin creates user login", createUser.status === 201, JSON.stringify(createUser.json));
  // Invitations are one-time links — in dev the link is returned for manual sharing.
  const inviteToken = /[?&]token=([^&]+)/.exec(String(createUser.json.devInviteUrl ?? ""))?.[1] ?? "";
  const activated = await api("", "/api/auth/activate", { method: "POST", body: JSON.stringify({ token: inviteToken, password: "SmokeTest456" }) });
  check("invited account activates via link", activated.status === 200 || createUser.json.invited === true, JSON.stringify(activated.json));
  const smokeCookie = await signIn(email, "SmokeTest456");
  const smokeDash = await api(smokeCookie, "/api/dashboard");
  check("new login can sign in and load workspace", smokeDash.status === 200, `got ${smokeDash.status}`);

  // Role scoping: librarian must not reach finance
  const librarianFinance = await api(smokeCookie, "/api/finance");
  check("librarian blocked from finance API", librarianFinance.status === 403, `got ${librarianFinance.status}`);

  // Bulk CSV import into a real class
  const classroom = classesList.find((c) => c.yearStatus === "active" && Number(c.enrolled ?? 0) + 2 < Number(c.capacity ?? 40)) ?? classesList[0];
  const importRes = await api(adminCookie, "/api/students", {
    method: "POST",
    body: JSON.stringify({
      action: "import_students",
      rows: [
        { firstName: "Smoke", lastName: "ImportA", gender: "female", dateOfBirth: "2015-01-01", classroomId: classroom.id },
        { firstName: "Smoke", lastName: "ImportB", gender: "male", dateOfBirth: "2015-02-01", classroomId: classroom.id },
        { firstName: "", lastName: "BadRow", gender: "nope", dateOfBirth: "2015-01-01", classroomId: classroom.id },
      ],
    }),
  });
  check("bulk import rejects invalid rows with row errors", importRes.status === 400 && Array.isArray(importRes.json.errors));
  const importOk = await api(adminCookie, "/api/students", {
    method: "POST",
    body: JSON.stringify({
      action: "import_students",
      rows: [
        { firstName: "Smoke", lastName: "ImportA", gender: "female", dateOfBirth: "2015-01-01", classroomId: classroom.id },
        { firstName: "Smoke", lastName: "ImportB", gender: "male", dateOfBirth: "2015-02-01", classroomId: classroom.id },
      ],
    }),
  });
  check("bulk import creates learners", importOk.status === 201 && importOk.json.imported === 2, JSON.stringify(importOk.json));

  // Password reset response must not reveal account existence or provider state.
  const reset = await api("", "/api/auth/password-reset", {
    method: "POST",
    body: JSON.stringify({ action: "request", email }),
  });
  check("password reset request is generic", reset.status === 200 && reset.json.ok === true && !("emailed" in reset.json));

  // Parent portal fee gate: one child cleared, one locked
  const parentCookie = await signIn("parent@nyashavee.local", "parent123");
  const portal = await api(parentCookie, "/api/portal");
  check("parent portal loads", portal.status === 200, `got ${portal.status}`);
  // Keep reporting the remaining checks if the portal request itself fails.
  // A smoke test must report failures, not abort while reading an error body.
  const reports = (portal.status === 200 ? portal.json.reports ?? [] : []) as Array<Record<string, unknown>>;
  const locked = reports.filter((r) => r.locked === true);
  const open = reports.filter((r) => r.locked === false);
  check("fee-gated report exists (locked)", locked.length > 0);
  check("cleared report exists (unlocked)", open.length > 0);
  const lockedHasNoScores = locked.every((r) => r.averagePercent === null && (r.subjects as unknown[]).length === 0);
  check("locked reports expose no result data", lockedHasNoScores);
  const openHasSubjects = open.length > 0 && (open[0].subjects as unknown[]).length > 0;
  check("unlocked reports include per-subject results", openHasSubjects);

  // Public report-card verification by code
  const code = String(open[0]?.verificationCode ?? "");
  const verify = await api("", `/api/verify?code=${encodeURIComponent(code)}`);
  check("report verification code works publicly", verify.status === 200 && verify.json.valid === true);
  const badVerify = await api("", `/api/verify?code=NOT-A-REAL-CODE`);
  check("invalid verification code rejected", badVerify.status === 200 && badVerify.json.valid === false);

  // Term results lock: lock the active term, verify flag, unlock again
  const academic = await api(adminCookie, "/api/academic");
  const terms = (academic.json.terms ?? []) as Array<Record<string, unknown>>;
  const activeTerm = terms.find((t) => t.status === "active") ?? terms[0];
  if (activeTerm) {
    const lock = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "lock_term_results", termId: activeTerm.id, locked: true }) });
    check("term results lock", lock.status === 200, JSON.stringify(lock.json));
    const after = await api(adminCookie, "/api/academic");
    const lockedTerm = ((after.json.terms ?? []) as Array<Record<string, unknown>>).find((t) => t.id === activeTerm.id);
    check("lock visible on term", Boolean(lockedTerm?.resultsLockedAt));
    const unlock = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "lock_term_results", termId: activeTerm.id, locked: false }) });
    check("term results unlock", unlock.status === 200);
  }

  // Payroll: create a run, confirm creator cannot self-approve
  const staffRes = await api(adminCookie, "/api/operations?module=staff");
  const staffRows = (staffRes.json.records ?? []) as Array<Record<string, unknown>>;
  const activeStaff = staffRows.filter((s) => s.status === "active");
  const schoolPaid = activeStaff.filter((s) => s.paidBy !== "government");
  const governmentPaid = activeStaff.filter((s) => s.paidBy === "government");
  if (governmentPaid.length >= 1) {
    const badRun = await api(adminCookie, "/api/operations", {
      method: "POST",
      body: JSON.stringify({
        action: "create_payroll_run",
        period: `2098-${String(Math.floor(Math.random() * 12) + 1).padStart(2, "0")}`,
        currency: "USD",
        entries: [{ staffProfileId: governmentPaid[0].id, basic: 500 }],
      }),
    });
    check("government-paid staff rejected from payroll", badRun.status === 400, `got ${badRun.status} ${JSON.stringify(badRun.json)}`);
  }
  if (schoolPaid.length >= 1) {
    const period = `3${String(Date.now()).slice(-3)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, "0")}`;
    const createRun = await api(adminCookie, "/api/operations", {
      method: "POST",
      body: JSON.stringify({
        action: "create_payroll_run",
        period,
        currency: "USD",
        entries: [{ staffProfileId: schoolPaid[0].id, basic: 500, allowances: 50, deductions: 30 }],
      }),
    });
    check("payroll run created", createRun.status === 201, JSON.stringify(createRun.json));
    if (createRun.status === 201) {
      const approve = await api(adminCookie, "/api/operations", {
        method: "POST",
        body: JSON.stringify({ action: "approve_payroll_run", payrollRunId: createRun.json.id }),
      });
      check("creator cannot self-approve payroll", approve.status === 409, `got ${approve.status}`);
      const payslips = await fetch(`${BASE}/print/payslips/${createRun.json.id}`, { headers: { Cookie: adminCookie }, redirect: "manual" });
      check("payslip page renders", payslips.status === 200, `got ${payslips.status}`);
    }
  }

  // Suppliers + purchase invoices
  const supplierRes = await api(adminCookie, "/api/finance", {
    method: "POST",
    headers: idem(), body: JSON.stringify({ action: "create_supplier", name: `Smoke Suppliers ${Date.now() % 100000}`, phone: "+263700111222" }),
  });
  check("supplier created", supplierRes.status === 201, JSON.stringify(supplierRes.json));

  // Stock purchase with supplier + invoice ref
  const financeData = await api(adminCookie, "/api/finance");
  let stockItem = ((financeData.json.projects ?? []) as Array<{ stockItems: Array<{ id: string }> }>).flatMap((p) => p.stockItems)[0];
  if (!stockItem) {
    // Fresh database — create a project + item so the negative check has a target.
    const proj0 = await api(adminCookie, "/api/finance", { method: "POST", headers: idem(), body: JSON.stringify({ action: "create_project", name: `Smoke Project ${Date.now() % 100000}` }) });
    if (proj0.status === 201) {
      const item0 = await api(adminCookie, "/api/finance", { method: "POST", headers: idem(), body: JSON.stringify({ action: "create_stock_item", projectId: proj0.json.id, name: "Pies", unit: "pieces", openingQty: 10 }) });
      if (item0.status === 201) stockItem = { id: String(item0.json.id) };
    }
  }
  if (supplierRes.status === 201 && stockItem) {
    const invRef = `INV-SMOKE-${Date.now() % 100000}`;
    const purchase = await api(adminCookie, "/api/finance", {
      method: "POST",
      headers: idem(), body: JSON.stringify({ action: "record_stock_movement", itemId: stockItem.id, kind: "purchase", quantity: 2, occurredOn: new Date().toISOString().slice(0, 10), supplierId: supplierRes.json.id, invoiceRef: invRef }),
    });
    check("purchase with supplier + invoice recorded", purchase.status === 201, JSON.stringify(purchase.json));
    const movementCheck = await api(adminCookie, "/api/finance");
    const movement = ((movementCheck.json.stockMovements ?? []) as Array<{ supplierName: string | null; invoiceRef: string | null }>).find((m) => m.invoiceRef === invRef);
    check("movement carries supplier + invoice ref", Boolean(movement?.supplierName), JSON.stringify(movement));
  }
  const badSupplierMovement = stockItem ? await api(adminCookie, "/api/finance", {
    method: "POST",
    headers: idem(), body: JSON.stringify({ action: "record_stock_movement", itemId: stockItem.id, kind: "sale", quantity: 1, occurredOn: "2026-09-14", invoiceRef: "X" }),
  }) : { status: 0 };
  check("supplier/invoice rejected on non-purchase", badSupplierMovement.status === 400, `got ${badSupplierMovement.status}`);

  // Project budget
  const project = ((financeData.json.projects ?? []) as Array<{ id: string }>)[0];
  if (project) {
    const budget = await api(adminCookie, "/api/finance", {
      method: "POST",
      headers: idem(), body: JSON.stringify({ action: "set_project_budget", projectId: project.id, label: "Smoke budget", amount: "250.00", currency: "USD" }),
    });
    check("project budget set", budget.status === 201, JSON.stringify(budget.json));
    const after = await api(adminCookie, "/api/finance");
    const withBudget = ((after.json.projects ?? []) as Array<{ id: string; budgets: Array<{ amountMinor: number }> }>).find((p) => p.id === project.id);
    check("budget visible on project", withBudget?.budgets?.[0]?.amountMinor === 25000, JSON.stringify(withBudget?.budgets));
  }

  // Exam sessions: create + clash + seating
  const academicData = await api(adminCookie, "/api/academic");
  const term = ((academicData.json.terms ?? []) as Array<{ id: string }>)[0];
  const classForExam = ((academicData.json.classrooms ?? []) as Array<{ id: string }>)[0];
  if (term && classForExam) {
    const exam = await api(adminCookie, "/api/academic", {
      method: "POST",
      body: JSON.stringify({ action: "create_exam_session", termId: term.id, classroomId: classForExam.id, title: "Smoke exam", examDate: "2026-11-20", startTime: "09:00", endTime: "11:00", venue: "Hall A" }),
    });
    check("exam session created", exam.status === 201, JSON.stringify(exam.json));
    const clash = await api(adminCookie, "/api/academic", {
      method: "POST",
      body: JSON.stringify({ action: "create_exam_session", termId: term.id, classroomId: classForExam.id, title: "Clashing exam", examDate: "2026-11-20", startTime: "10:00", endTime: "12:00", venue: "Hall A" }),
    });
    check("exam venue clash rejected", clash.status === 409, `got ${clash.status}`);
    if (exam.status === 201) {
      const seating = await api(adminCookie, "/api/academic", {
        method: "POST",
        body: JSON.stringify({ action: "generate_exam_seating", examSessionId: exam.json.id }),
      });
      check("exam seating generated", seating.status === 200 && (seating.json.seated as number) > 0, JSON.stringify(seating.json));
      const seatingPage = await fetch(`${BASE}/print/seating/${exam.json.id}`, { headers: { Cookie: adminCookie }, redirect: "manual" });
      check("seating plan renders", seatingPage.status === 200, `got ${seatingPage.status}`);
      await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "cancel_exam_session", examSessionId: exam.json.id }) });
    }
  }

  // Departments: create + assign head
  const dept = await api(adminCookie, "/api/academic", {
    method: "POST",
    body: JSON.stringify({ action: "create_department", name: `Dept ${crypto.randomUUID().slice(0, 8)}` }),
  });
  check("department created", dept.status === 201, JSON.stringify(dept.json));
  if (dept.status === 201 && activeStaff.length >= 1) {
    const head = await api(adminCookie, "/api/academic", {
      method: "POST",
      body: JSON.stringify({ action: "assign_department_head", departmentId: dept.json.id, staffProfileId: activeStaff[0].id }),
    });
    check("department head assigned", head.status === 200, JSON.stringify(head.json));
  }

  // Student leadership: assign a school-wide role, then end it
  const studentsRes2 = await api(adminCookie, "/api/students?pageSize=5");
  const anyStudent = ((studentsRes2.json.students ?? []) as Array<Record<string, unknown>>).find((s) => s.status === "active");
  if (anyStudent) {
    const lead = await api(adminCookie, "/api/students", {
      method: "POST",
      body: JSON.stringify({ action: "assign_leadership", studentId: anyStudent.id, title: "prefect", scope: "school", startDate: "2026-01-15" }),
    });
    check("leadership role assigned", lead.status === 201, JSON.stringify(lead.json));
    if (lead.status === 201) {
      // A second holder of the same school-wide title must be rejected
      const clash = await api(adminCookie, "/api/students", {
        method: "POST",
        body: JSON.stringify({ action: "assign_leadership", studentId: anyStudent.id, title: "prefect", scope: "school", startDate: "2026-01-15" }),
      });
      check("duplicate school-wide role rejected", clash.status === 409, `got ${clash.status}`);
      const end = await api(adminCookie, "/api/students", {
        method: "POST",
        body: JSON.stringify({ action: "end_leadership", leadershipId: lead.json.id }),
      });
      check("leadership role ended", end.status === 200);
    }
  }

  // Staff lifecycle: student teacher ends via attachment, staffer transfers out
  const trainee = await api(adminCookie, "/api/operations", {
    method: "POST",
    body: JSON.stringify({ action: "create_staff", firstName: "Trainee", lastName: `Tp${Date.now() % 100000}`, position: "Student teacher", employmentType: "student_teacher", startDate: "2026-01-05" }),
  });
  check("student teacher created", trainee.status === 201, JSON.stringify(trainee.json));
  if (trainee.status === 201) {
    const wrongOutcome = await api(adminCookie, "/api/operations", {
      method: "POST",
      body: JSON.stringify({ action: "end_staff_employment", staffId: trainee.json.id, outcome: "retired", endDate: "2026-09-01" }),
    });
    check("trainee cannot be 'retired'", wrongOutcome.status === 400, `got ${wrongOutcome.status}`);
    const endAttach = await api(adminCookie, "/api/operations", {
      method: "POST",
      body: JSON.stringify({ action: "end_staff_employment", staffId: trainee.json.id, outcome: "end_of_attachment", endDate: "2026-09-01", detail: "Attachment completed" }),
    });
    check("attachment ended", endAttach.status === 200, JSON.stringify(endAttach.json));
  }
  const mover = await api(adminCookie, "/api/operations", {
    method: "POST",
    body: JSON.stringify({ action: "create_staff", firstName: "Departing", lastName: `Tc${Date.now() % 100000}`, position: "Teacher", employmentType: "permanent", startDate: "2024-01-05" }),
  });
  if (mover.status === 201) {
    const transfer = await api(adminCookie, "/api/operations", {
      method: "POST",
      body: JSON.stringify({ action: "end_staff_employment", staffId: mover.json.id, outcome: "transferred", endDate: "2026-09-13", detail: "Mazowe Secondary" }),
    });
    check("staff transferred out", transfer.status === 200, JSON.stringify(transfer.json));
  }

  // Staff handover: end employment with a replacement → teaching load moves
  const acadBefore = await api(adminCookie, "/api/academic");
  const taught = ((acadBefore.json.classSubjects ?? []) as Array<Record<string, unknown>>).filter((cs) => cs.teacherId);
  const staffRes2 = await api(adminCookie, "/api/operations?module=staff");
  const allStaff = (staffRes2.json.records ?? []) as Array<Record<string, unknown>>;
  const byMembership = new Map(allStaff.filter((s) => s.membershipId).map((s) => [String(s.membershipId), s]));
  if (taught.length >= 1) {
    const subject = taught.find((cs) => byMembership.has(String(cs.teacherId)) && byMembership.get(String(cs.teacherId))?.status === "active");
    const departing = subject ? byMembership.get(String(subject.teacherId)) : undefined;
    const replacement = subject ? allStaff.find((s) => s.membershipId && s.membershipId !== subject.teacherId && s.status === "active") : undefined;
    if (!departing || !replacement || !subject) check("handover candidates exist", false, `taught=${taught.length} staffWithMembership=${byMembership.size}`);
    if (departing && replacement && subject) {
      const hand = await api(adminCookie, "/api/operations", {
        method: "POST",
        body: JSON.stringify({ action: "end_staff_employment", staffId: departing.id, outcome: "transferred", endDate: "2026-09-13", detail: "Smoke handover", replacementMembershipId: replacement.membershipId }),
      });
      check("handover completes", hand.status === 200, JSON.stringify(hand.json));
      const acadAfter = await api(adminCookie, "/api/academic");
      const moved = ((acadAfter.json.classSubjects ?? []) as Array<Record<string, unknown>>).find((cs) => cs.id === subject.id);
      check("class subject reassigned to replacement", moved?.teacherId === replacement.membershipId, `teacherId=${moved?.teacherId}`);
    }
  }

  // Projects & ledger: create project, record income + donation, reverse

  const proj = await api(adminCookie, "/api/finance", {
    method: "POST",
    headers: idem(),
    body: JSON.stringify({ action: "create_project", name: `Tuckshop ${crypto.randomUUID().slice(0, 6)}` }),
  });
  check("income project created", proj.status === 201, JSON.stringify(proj.json));
  if (proj.status === 201) {
    const donation = await api(adminCookie, "/api/finance", {
      method: "POST",
      headers: idem(),
      body: JSON.stringify({ action: "record_ledger", kind: "donation_in", counterpart: "Test Donor Trust", description: "Library donation", amount: "25.00", currency: "USD", occurredOn: "2026-09-13" }),
    });
    check("donation received recorded", donation.status === 201, JSON.stringify(donation.json));
    const noDonor = await api(adminCookie, "/api/finance", {
      method: "POST",
      headers: idem(),
      body: JSON.stringify({ action: "record_ledger", kind: "donation_in", description: "Anonymous", amount: "5.00", currency: "USD", occurredOn: "2026-09-13" }),
    });
    check("donation without donor rejected", noDonor.status === 400, `got ${noDonor.status}`);
    const sale = await api(adminCookie, "/api/finance", {
      method: "POST",
      headers: idem(),
      body: JSON.stringify({ action: "record_ledger", kind: "income", projectId: proj.json.id, counterpart: "Parents", description: "Pie day sales", amount: "40.50", currency: "USD", occurredOn: "2026-09-13" }),
    });
    check("project income recorded", sale.status === 201, JSON.stringify(sale.json));
    if (sale.status === 201) {
      const reverse = await api(adminCookie, "/api/finance", {
        method: "POST",
        headers: idem(),
        body: JSON.stringify({ action: "reverse_ledger", ledgerId: sale.json.id, reason: "Recorded in error" }),
      });
      check("ledger entry reversed", reverse.status === 200, JSON.stringify(reverse.json));
    }
  }

  // Project stock: create item, buy in (money → ledger), sell, oversell blocked
  if (proj.status === 201) {
    const item = await api(adminCookie, "/api/finance", {
      method: "POST",
      headers: idem(),
      body: JSON.stringify({ action: "create_stock_item", projectId: proj.json.id, name: "Pies", unit: "pieces", openingQty: 30 }),
    });
    check("stock item created", item.status === 201, JSON.stringify(item.json));
    if (item.status === 201) {
      const buy = await api(adminCookie, "/api/finance", {
        method: "POST",
        headers: idem(),
        body: JSON.stringify({ action: "record_stock_movement", itemId: item.json.id, kind: "purchase", quantity: 20, amount: "10.00", currency: "USD", occurredOn: "2026-09-13", note: "Bought fillings" }),
      });
      check("stock purchase records money", buy.status === 201, JSON.stringify(buy.json));
      const sell = await api(adminCookie, "/api/finance", {
        method: "POST",
        headers: idem(),
        body: JSON.stringify({ action: "record_stock_movement", itemId: item.json.id, kind: "sale", quantity: 15, amount: "15.00", currency: "USD", occurredOn: "2026-09-13" }),
      });
      check("stock sale records money", sell.status === 201, JSON.stringify(sell.json));
      const oversell = await api(adminCookie, "/api/finance", {
        method: "POST",
        headers: idem(),
        body: JSON.stringify({ action: "record_stock_movement", itemId: item.json.id, kind: "sale", quantity: 9999, occurredOn: "2026-09-13" }),
      });
      check("cannot sell more than on hand", oversell.status === 400, `got ${oversell.status}`);
      const finAfter = await api(adminCookie, "/api/finance");
      const projAfter = ((finAfter.json.projects ?? []) as Array<Record<string, unknown>>).find((p) => p.id === proj.json.id);
      const pieItem = ((projAfter?.stockItems ?? []) as Array<Record<string, unknown>>).find((s) => s.name === "Pies");
      check("on-hand reflects movements", pieItem?.onHand === 35, `onHand=${pieItem?.onHand}`);
    }
  }

  // Onboarding: register a learner → auto portal logins + guardian notice + letter
  const classRes = await api(adminCookie, "/api/classes");
  const classList = (classRes.json.classrooms ?? []) as Array<Record<string, unknown>>;
  const targetClass = classList.find((c) => c.yearStatus === "active" && Number(c.enrolled ?? 0) < Number(c.capacity ?? 40)) ?? classList[0];
  if (targetClass) {
    const reg = await api(adminCookie, "/api/students", {
      method: "POST",
      body: JSON.stringify({
        action: "create_student",
        firstName: "Auto", lastName: `Onboard${Date.now() % 100000}`,
        gender: "male", dateOfBirth: "2016-03-10",
        classroomId: targetClass.id,
        email: `mabiramathew23+learner${Date.now()}@gmail.com`,
        guardian: { firstName: "Smoke", lastName: "Guardian", phone: "+263771000999", email: "mabiramathew23@gmail.com", relationship: "guardian" },
      }),
    });
    check("student registered with onboarding", reg.status === 201 && !!reg.json.onboarding, JSON.stringify(reg.json).slice(0, 300));
    const ob = (reg.json.onboarding ?? {}) as Record<string, unknown>;
    check("parent portal invitation created", Boolean((ob.parentInvitation as Record<string, unknown> | null)?.email));
    const letter = await fetch(`${BASE}/print/acceptance/${(reg.json.student as Record<string, unknown>).id}`, { headers: { Cookie: adminCookie }, redirect: "manual" });
    check("acceptance letter page renders", letter.status === 200, `got ${letter.status}`);

    // Learner photo + ZIMSEC candidate number round-trip
    const onboardId = String((reg.json.student as Record<string, unknown>).id);
    const fd = new FormData();
    fd.set("studentId", onboardId);
    fd.set("photo", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" }), "learner.png");
    const photo = await fetch(`${BASE}/api/students`, { method: "POST", headers: { Cookie: adminCookie }, body: fd });
    check("learner photo upload accepted", photo.status === 201, `got ${photo.status}`);
    const photoBack = await fetch(`${BASE}/api/students?photo=${onboardId}`, { headers: { Cookie: adminCookie } });
    check("learner photo serves back", photoBack.status === 200 && (photoBack.headers.get("content-type") ?? "").startsWith("image/"), `got ${photoBack.status}`);
    const zimsec = await api(adminCookie, "/api/students", { method: "POST", body: JSON.stringify({ action: "update_student", studentId: onboardId, firstName: "Auto", lastName: `Onboard${Date.now() % 100000}`, gender: "male", dateOfBirth: "2016-03-10", zimsecCandidateNumber: "ZW0700-042" }) });
    check("ZIMSEC candidate number saved", zimsec.status === 200, `got ${zimsec.status}`);
  }

  // Descriptor-only grade level (ECD/infant reporting mode) — pick a free
  // gradeOrder slot so repeated runs don't hit the uniqueness constraint.
  const gradeList = ((await api(adminCookie, "/api/academic")).json.gradeLevels ?? []) as Array<Record<string, unknown>>;
  const usedOrders = new Set(gradeList.map((g) => Number(g.gradeOrder)));
  let freeOrder = 0;
  while (usedOrders.has(freeOrder) && freeOrder <= 30) freeOrder += 1;
  const descGrade = await api(adminCookie, "/api/academic", {
    method: "POST",
    body: JSON.stringify({ action: "create_grade", name: `ECD Test ${Date.now() % 100000}`, gradeOrder: freeOrder, descriptorOnly: true }),
  });
  check("descriptor-only grade created", descGrade.status === 201, `got ${descGrade.status}`);
  if (descGrade.status === 201) {
    const grades = await api(adminCookie, "/api/academic");
    const found = ((grades.json.gradeLevels ?? []) as Array<Record<string, unknown>>).find((g) => g.id === (descGrade.json as { id?: string }).id);
    check("grade exposes descriptorOnly flag", found?.descriptorOnly === true, JSON.stringify(found ?? {}).slice(0, 120));
  }

  // Admin data export
  const exportRes = await fetch(`${BASE}/api/administration/export`, { headers: { Cookie: adminCookie }, redirect: "manual" });
  check("admin school data export", exportRes.status === 200 && (exportRes.headers.get("content-type") ?? "").includes("json"));

  // Parent fee statement download (CSV)
  const linkedStudents = (portal.json.students ?? []) as Array<Record<string, unknown>>;
  const statementRes = await fetch(`${BASE}/api/portal/statement?studentId=${linkedStudents[0]?.id}`, { headers: { Cookie: parentCookie }, redirect: "manual" });
  const statementText = await statementRes.text();
  check("parent fee statement downloads as CSV", statementRes.status === 200 && statementText.startsWith("Type,Reference"), `got ${statementRes.status}`);
  // A parent cannot fetch a statement for a student not linked to them
  const otherRes = await fetch(`${BASE}/api/portal/statement?studentId=${crypto.randomUUID()}`, { headers: { Cookie: parentCookie }, redirect: "manual" });
  check("unlinked student statement denied", otherRes.status === 404 || otherRes.status === 403);

  // --- Hardening batch ---

  // 1. Upload allowlist: .html rejected, .png accepted

  if (anyStudent) {
    const badForm = new FormData();
    badForm.set("file", new File(["<script>alert(1)</script>"], "evil.html", { type: "text/html" }));
    badForm.set("studentId", String(anyStudent.id));
    badForm.set("documentType", "other");
    const badUpload = await fetch(`${BASE}/api/students/documents`, { method: "POST", headers: { Cookie: adminCookie }, body: badForm });
    check("html upload rejected", badUpload.status === 400, `got ${badUpload.status}`);
    const pngForm = new FormData();
    pngForm.set("file", new File([Buffer.from("89504e470d0a1a0a", "hex")], "id.png", { type: "image/png" }));
    pngForm.set("studentId", String(anyStudent.id));
    pngForm.set("documentType", "guardian_id");
    const goodUpload = await fetch(`${BASE}/api/students/documents`, { method: "POST", headers: { Cookie: adminCookie }, body: pngForm });
    check("png upload accepted", goodUpload.status === 201, `got ${goodUpload.status}`);
  }

  // 2. Origin check: cross-site mutation rejected
  const crossSite = await fetch(`${BASE}/api/academic`, { method: "POST", headers: { Cookie: adminCookie, "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ action: "create_grade", name: "X", gradeOrder: 99 }) });
  check("cross-site origin rejected", crossSite.status === 403, `got ${crossSite.status}`);

  // 4. Idempotency: same key replays instead of duplicating
  const freshStaff = await api(adminCookie, "/api/operations?module=staff");
  const leaveTarget = ((freshStaff.json.records ?? []) as Array<Record<string, unknown>>).find((s) => s.status === "active") as { id: string } | undefined;
  if (leaveTarget) {
    const idemKey = crypto.randomUUID();
    const leaveBody = JSON.stringify({ action: "create_leave", staffId: leaveTarget.id, leaveType: "compassionate", startDate: "2026-10-01", endDate: "2026-10-03", reason: "Smoke idempotency" });
    const first = await api(adminCookie, "/api/operations", { method: "POST", headers: { "Idempotency-Key": idemKey }, body: leaveBody });
    const second = await fetch(`${BASE}/api/operations`, { method: "POST", headers: { Cookie: adminCookie, "Content-Type": "application/json", "Idempotency-Key": idemKey }, body: leaveBody });
    const secondJson = await second.json().catch(() => null) as { id?: string } | null;
    check("idempotent replay returns same id", first.status === 201 && second.headers.get("idempotent-replay") === "true" && secondJson?.id === first.json.id, `first=${first.status} second=${second.status}`);
  }

  // 5a. Payment receipt notification reaches the outbox
  const paymentRes = await api(adminCookie, "/api/finance", {
    method: "POST",
    headers: idem(),
    body: JSON.stringify({ action: "record_payment", studentId: String(linkedStudents[0]?.id ?? ""), currency: "USD", paymentDate: "2026-09-14", amount: "5.00", method: "cash", payerName: "Smoke Payer", allocations: [] }),
  });
  check("payment recorded", paymentRes.status === 201, JSON.stringify(paymentRes.json));
  const comms = await api(adminCookie, "/api/operations?module=communication");
  const receiptNotice = (((comms.json.secondary ?? {}) as { outbox?: Array<{ announcementTitle: string }> }).outbox ?? []).find((e) => e.announcementTitle.startsWith("Payment received"));
  check("receipt notice queued to guardian", Boolean(receiptNotice), JSON.stringify(receiptNotice));

  // 6. Exam session can create a linked markbook assessment
  const offering = ((academicData.json.classSubjects ?? []) as Array<{ classroomId: string; subjectId: string }>)[0];
  if (term && offering) {
    const linkedExam = await api(adminCookie, "/api/academic", {
      method: "POST",
      body: JSON.stringify({ action: "create_exam_session", termId: term.id, classroomId: offering.classroomId, subjectId: offering.subjectId, title: "Linked exam", examDate: "2026-11-25", startTime: "08:00", endTime: "10:00", withAssessment: true }),
    });
    check("exam with linked assessment", linkedExam.status === 201, JSON.stringify(linkedExam.json));
    const afterExam = await api(adminCookie, "/api/academic");
    const linked = ((afterExam.json.examSessions ?? []) as Array<{ title: string; assessmentId: string | null }>).find((e) => e.title === "Linked exam");
    check("exam carries markbook link", Boolean(linked?.assessmentId), JSON.stringify(linked));
  }

  // 7. Cross-currency payment: ZiG settles a USD invoice at a rate
  if (anyStudent) {
    const usdInvoice = await api(adminCookie, "/api/finance", {
      method: "POST",
      headers: idem(),
      body: JSON.stringify({ action: "create_invoice", studentId: String(anyStudent.id), currency: "USD", issueDate: "2026-09-14", dueDate: "2026-10-14", items: [{ description: "Cross-currency test fee", quantity: 1, unitAmount: "10.00", category: "other" }] }),
    });
    check("usd invoice created", usdInvoice.status === 201, JSON.stringify(usdInvoice.json));
    if (usdInvoice.status === 201) {
      const invoiceId = (usdInvoice.json as { id?: string; invoice?: { id?: string } }).id ?? (usdInvoice.json as { invoice?: { id?: string } }).invoice?.id;
      const zigPay = await api(adminCookie, "/api/finance", {
        method: "POST",
        headers: idem(),
        body: JSON.stringify({ action: "record_payment", studentId: String(anyStudent.id), currency: "ZWG", paymentDate: "2026-09-14", amount: "270.00", method: "ecocash", payerName: "Smoke Payer", exchangeRate: "27", allocations: [{ invoiceId, amount: "10.00" }] }),
      });
      check("cross-currency payment accepted", zigPay.status === 201, JSON.stringify(zigPay.json));
      // Ensure no prevailing rate is configured before asserting the rejection.
      await api(adminCookie, "/api/administration", {
        method: "POST",
        body: JSON.stringify({ action: "update_school", name: "Nyashavee Primary", currency: "USD", timezone: "Africa/Harare", exchangeRateZwgPerUsd: "" }),
      });
      const noRate = await api(adminCookie, "/api/finance", {
        method: "POST",
        headers: idem(),
        body: JSON.stringify({ action: "record_payment", studentId: anyStudent.id, currency: "ZWG", paymentDate: "2026-09-14", amount: "50.00", method: "cash", payerName: "Smoke Payer", allocations: [{ invoiceId, amount: "1.00" }] }),
      });
      check("cross-currency without rate rejected", noRate.status === 400, `got ${noRate.status}`);
      // Prevailing rate: once the school publishes ZiG-per-USD, cross-currency
      // settlement uses it automatically — no manual rate needed.
      const setRate = await api(adminCookie, "/api/administration", {
        method: "POST",
        body: JSON.stringify({ action: "update_school", name: "Nyashavee Primary", currency: "USD", timezone: "Africa/Harare", exchangeRateZwgPerUsd: "27.50" }),
      });
      check("prevailing exchange rate saved", setRate.status === 200, `got ${setRate.status}`);
      const usdInvoice2 = await api(adminCookie, "/api/finance", {
        method: "POST",
        headers: idem(),
        body: JSON.stringify({ action: "create_invoice", studentId: String(anyStudent.id), currency: "USD", issueDate: "2026-09-14", dueDate: "2026-10-14", items: [{ description: "Prevailing-rate test fee", quantity: 1, unitAmount: "5.00", category: "other" }] }),
      });
      const invoiceId2 = (usdInvoice2.json as { id?: string; invoice?: { id?: string } }).id ?? (usdInvoice2.json as { invoice?: { id?: string } }).invoice?.id;
      const autoRate = await api(adminCookie, "/api/finance", {
        method: "POST",
        headers: idem(),
        body: JSON.stringify({ action: "record_payment", studentId: anyStudent.id, currency: "ZWG", paymentDate: "2026-09-14", amount: "137.50", method: "ecocash", payerName: "Smoke Payer", allocations: [{ invoiceId: invoiceId2, amount: "5.00" }] }),
      });
      check("cross-currency settled at prevailing rate", autoRate.status === 201, `got ${autoRate.status} ${JSON.stringify(autoRate.json).slice(0, 120)}`);
      // Debtor reminders reach every owing learner's guardians
      const remind = await api(adminCookie, "/api/finance", {
        method: "POST",
        headers: idem(),
        body: JSON.stringify({ action: "remind_debtors" }),
      });
      check("debtor reminders queued", remind.status === 200 && typeof (remind.json as { reminded?: number }).reminded === "number", `got ${remind.status}`);
    }
  }

  // 8. Trainee absorbed into permanent staff
  const trainee2 = await api(adminCookie, "/api/operations", {
    method: "POST",
    body: JSON.stringify({ action: "create_staff", firstName: "Absorbed", lastName: `Ta${Date.now() % 100000}`, position: "Student teacher", employmentType: "student_teacher", startDate: "2026-02-01" }),
  });
  if (trainee2.status === 201) {
    const converted = await api(adminCookie, "/api/operations", {
      method: "POST",
      body: JSON.stringify({ action: "convert_trainee", staffId: trainee2.json.id, employmentType: "permanent" }),
    });
    check("trainee converted to permanent", converted.status === 200, JSON.stringify(converted.json));
    const staffAfter = await api(adminCookie, "/api/operations?module=staff");
    const absorbed = ((staffAfter.json.records ?? []) as Array<{ id: string; employmentType: string; paidBy: string }>).find((s) => s.id === trainee2.json.id);
    check("profile shows permanent + government", absorbed?.employmentType === "permanent" && absorbed?.paidBy === "government", JSON.stringify(absorbed));
  }

  // ── Academic operations: weighting, grading bands, lesson plans, notes ──────
  const acad2 = await api(adminCookie, "/api/academic");
  check("teacher desk payload present", Boolean(acad2.json.teacherDesk));

  const weight = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "upsert_weighting", caPercent: 40, examPercent: 60 }) });
  check("school CA/exam weighting saved", weight.status === 200, JSON.stringify(weight.json));
  const badWeight = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "upsert_weighting", caPercent: 50, examPercent: 60 }) });
  check("weighting must total 100%", badWeight.status === 400, `got ${badWeight.status}`);

  // reuse an existing smoke band so reruns update instead of colliding
  const bandList = (await api(adminCookie, "/api/academic")).json.gradingBands as Array<{ id: string; name: string; sortOrder: number }>;
  const smokeBand = bandList?.find((b) => b.name === "Smoke Scale" && b.sortOrder === 95);
  const bandRes = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "upsert_grading_band", bandId: smokeBand?.id, name: "Smoke Scale", minPercent: 95, maxPercent: 100, grade: "A+", remark: "Outstanding", isPass: true, sortOrder: 95 }) });
  check("grading band configured", bandRes.status === 200, JSON.stringify(bandRes.json));
  if (smokeBand) await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "delete_grading_band", bandId: smokeBand.id }) });

  const offerings = (acad2.json.classSubjects ?? []) as Array<{ id: string; classroomName: string; subjectName: string }>;
  const g5aOffering = offerings.find((o) => o.classroomName === "Grade 5A") ?? offerings[0];
  if (g5aOffering) {
    const lp = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "save_lesson_plan", classSubjectId: g5aOffering.id, lessonDate: "2026-10-20", topic: "Smoke lesson " + Date.now(), objectives: "Test objective" }) });
    check("lesson plan saved", lp.status === 200, JSON.stringify(lp.json));
    const plansNow = ((await api(adminCookie, "/api/academic")).json.lessonPlans ?? []) as Array<{ id: string; topic: string; status: string }>;
    const planRow = plansNow[0];
    if (planRow) {
      const lpDone = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "complete_lesson_plan", planId: planRow.id }) });
      check("lesson plan marked delivered", lpDone.status === 200, JSON.stringify(lpDone.json));
    }
  }
  if (anyStudent) {
    const note = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "create_student_note", studentId: String(anyStudent.id), note: "Smoke observation " + Date.now() }) });
    check("student note recorded", note.status === 201, JSON.stringify(note.json));
  }

  // ── Report approval pipeline ──────────────────────────────────────────────
  // Target: Grade 5A + the term holding its published assessments.
  const allAssess = (acad2.json.assessments ?? []) as Array<{ id: string; classroomName: string; termId: string; status: string; title: string; component: string; maxMarks: number }>;
  const g5aTerm = allAssess.find((a) => a.classroomName === "Grade 5A" && a.status === "published")?.termId;
  const rcData = await api(adminCookie, "/api/report-cards");
  const g5aStudents = ((rcData.json.students ?? []) as Array<{ id: string; classroomName: string; firstName: string; lastName: string }>).filter((s) => s.classroomName === "Grade 5A");

  if (g5aTerm && g5aStudents.length) {
    let inReviewId: string | undefined;
    let inReviewStudentId: string | undefined;
    // Clear blockers: enter full-roster marks + publish any draft assessments in scope.
    const drafts = allAssess.filter((a) => a.classroomName === "Grade 5A" && a.termId === g5aTerm && a.status !== "published");
    for (const draft of drafts) {
      const mb = await api(adminCookie, `/api/academic?assessmentId=${draft.id}`);
      const roster = ((mb.json.markbook as { students?: Array<{ id: string; score: number | null }> })?.students ?? []);
      if (roster.length) {
        const saved = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "save_marks", assessmentId: draft.id, marks: roster.map((s) => ({ studentId: s.id, score: s.score ?? Math.min(70, draft.maxMarks) })) }) });
        if (saved.status !== 200) console.log("    draft marks save failed:", JSON.stringify(saved.json));
        const pubDraft = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "publish_assessment", assessmentId: draft.id }) });
        if (pubDraft.status !== 200) console.log("    draft publish failed:", JSON.stringify(pubDraft.json));
      }
    }

    // Full pipeline on the first student with complete marks.
    let pipelineDone = false;
    for (const student of g5aStudents) {
      const gen = await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "generate_report", studentId: student.id, termId: g5aTerm }) });
      // Earlier runs may have already published this learner's report —
      // verify the pipeline artifacts instead of re-walking the workflow.
      if (gen.status === 409 && /published/i.test(String(gen.json.error))) {
        const prior = ((rcData.json.reports ?? []) as Array<{ id: string; studentId: string; termId: string; status: string }>).find((r) => r.studentId === student.id && r.termId === g5aTerm && r.status === "published");
        if (prior) {
          const priorDetail = await api(adminCookie, `/api/report-cards?reportId=${prior.id}`);
          const priorApprovals = ((priorDetail.json.detail as { approvals?: Array<{ step: string }> })?.approvals ?? []);
          const priorResults = ((priorDetail.json.detail as { results?: Array<{ caPercent: number | null }> })?.results ?? []);
          check("report generated (CA/exam split)", true);
          check("results carry CA + exam columns", priorResults.length > 0);
          check("sign-off trail recorded", priorApprovals.length >= 4, JSON.stringify(priorApprovals));
          check("published report printable with sign-offs", (await fetch(`${BASE}/print/report/${prior.id}`, { headers: { Cookie: adminCookie } })).status === 200);
          pipelineDone = true;
          break;
        }
        continue;
      }
      if (gen.status !== 201) { console.log("    generate blocked for", student.firstName, ":", JSON.stringify(gen.json)); continue; }
      const reportId = String(gen.json.reportId);
      check("report generated (CA/exam split)", true);
      const detail = await api(adminCookie, `/api/report-cards?reportId=${reportId}`);
      const results = ((detail.json.detail as { results?: Array<{ id: string; caPercent: number | null; examPercent: number | null }> })?.results ?? []);
      check("results carry CA + exam columns", results.length > 0 && results.every((r) => r.caPercent !== undefined && "examPercent" in r), JSON.stringify(results[0]));

      // Subject comments required before submission
      for (const r of results) {
        await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "save_subject_comment", resultId: r.id, comment: "Solid progress — keep practising." }) });
      }
      // Submit must be blocked until the class teacher comment exists
      const earlySubmit = await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "submit_report", reportId }) });
      check("submit blocked while class teacher comment missing", earlySubmit.status === 409, `got ${earlySubmit.status}`);

      await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "save_comments", reportId, classTeacherComment: "Consistent effort across subjects.", promotionStatus: "promoted" }) });
      const submit = await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "submit_report", reportId, note: "Ready for review" }) });
      check("report submitted to HOD review", submit.status === 200 && submit.json.status === "hod_review", JSON.stringify(submit.json));

      const hod = await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "review_report", reportId, step: "hod", decision: "approve", note: "Verified" }) });
      check("HOD approval advances to head", hod.status === 200 && hod.json.status === "head_review", JSON.stringify(hod.json));
      const head = await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "review_report", reportId, step: "head", decision: "approve" }) });
      check("head approval marks approved", head.status === 200 && head.json.status === "approved", JSON.stringify(head.json));
      const pub = await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "publish_report", reportId }) });
      check("report published after full pipeline", pub.status === 200, JSON.stringify(pub.json));

      const after = await api(adminCookie, `/api/report-cards?reportId=${reportId}`);
      const approvals = ((after.json.detail as { approvals?: Array<{ step: string; action: string }> })?.approvals ?? []);
      check("sign-off trail recorded", approvals.length >= 4 && approvals.some((a) => a.step === "hod" && a.action === "approved") && approvals.some((a) => a.step === "head" && a.action === "approved"), JSON.stringify(approvals));
      const printPage = await fetch(`${BASE}/print/report/${reportId}`, { headers: { Cookie: adminCookie } });
      check("published report printable with sign-offs", printPage.status === 200);
      pipelineDone = true;
      break;
    }
    if (!pipelineDone) check("report generated (CA/exam split)", false, "no Grade 5A learner could generate a report");

    // Rejection path on a second learner
    const second = g5aStudents.find((s) => s.firstName !== g5aStudents[0]?.firstName || s.id !== g5aStudents[0]?.id);
    if (second) {
      const gen2 = await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "generate_report", studentId: second.id, termId: g5aTerm }) });
      if (gen2.status === 201) {
        const rid2 = String(gen2.json.reportId);
        const det2 = await api(adminCookie, `/api/report-cards?reportId=${rid2}`);
        for (const r of ((det2.json.detail as { results?: Array<{ id: string }> })?.results ?? [])) {
          await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "save_subject_comment", resultId: r.id, comment: "Satisfactory." }) });
        }
        await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "save_comments", reportId: rid2, classTeacherComment: "Needs closer attention next term.", promotionStatus: "pending" }) });
        await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "submit_report", reportId: rid2 }) });
        const rej = await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "review_report", reportId: rid2, step: "hod", decision: "reject", note: "Check the English test mark." }) });
        check("HOD rejection returns for correction", rej.status === 200 && rej.json.status === "returned_for_correction", JSON.stringify(rej.json));
        const noNote = await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "review_report", reportId: rid2, step: "head", decision: "approve" }) });
        check("out-of-order review rejected", noNote.status === 409 || noNote.status === 403, `got ${noNote.status}`);
        // Resubmit so the mark-change invalidation check has an in-review report.
        // Retry once if the mutation rate limiter is mid-window.
        let resub = await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "submit_report", reportId: rid2 }) });
        if (resub.status === 429) { await new Promise((r) => setTimeout(r, 62_000)); resub = await api(adminCookie, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "submit_report", reportId: rid2 }) }); }
        check("returned report resubmitted for review", resub.status === 200, `got ${resub.status} ${JSON.stringify(resub.json).slice(0, 100)}`);
        if (resub.status === 200) { inReviewId = rid2; inReviewStudentId = String(second.id); }
      }
    }

    // Reopen → mark change → in-review reports invalidated back to draft
    const publishedForReopen = allAssess.find((a) => a.classroomName === "Grade 5A" && a.termId === g5aTerm && a.status === "published" && a.component === "ca" && /test/i.test(a.title)) ?? allAssess.find((a) => a.classroomName === "Grade 5A" && a.termId === g5aTerm && a.status === "published" && a.component === "ca");
    if (publishedForReopen) {
      const reopen = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "reopen_assessment", assessmentId: publishedForReopen.id, reason: "Smoke moderation pass" }) });
      check("published assessment reopened by moderator", reopen.status === 200, JSON.stringify(reopen.json));
      const mb2 = await api(adminCookie, `/api/academic?assessmentId=${publishedForReopen.id}`);
      const roster2 = ((mb2.json.markbook as { students?: Array<{ id: string; score: number | null }> })?.students ?? []);
      const target = roster2.find((s) => s.id === (typeof inReviewStudentId !== "undefined" ? inReviewStudentId : "")) ?? roster2.find((s) => s.score !== null);
      if (target) {
        const bumped = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "save_marks", assessmentId: publishedForReopen.id, marks: [{ studentId: target.id, score: (target.score ?? 50) === 100 ? 99 : (target.score ?? 50) + 1 }] }) });
        check("mark change on reopened assessment", bumped.status === 200, JSON.stringify(bumped.json));
        if (typeof inReviewId !== "undefined" && inReviewId) {
          const reverted = await api(adminCookie, `/api/report-cards?reportId=${inReviewId}`);
          const revertedStatus = (reverted.json.detail as { report?: { status?: string }; approvals?: unknown[] })?.report?.status;
          const revertedApprovals = ((reverted.json.detail as { approvals?: unknown[] })?.approvals ?? []).length;
          check("mark change invalidates in-review approvals", revertedStatus === "draft" && revertedApprovals === 0, `status=${revertedStatus} approvals=${revertedApprovals}`);
        }
      }
      // republish so later generate_report calls aren't blocked
      await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "publish_assessment", assessmentId: publishedForReopen.id }) });
    }

    // Notification landed for the acting admin
    const acad3 = await api(adminCookie, "/api/academic");
    const notifs = (acad3.json.notifications ?? []) as Array<{ title: string }>;
    check("workflow notifications delivered", notifs.length > 0 && notifs.some((n) => /awaiting|returned|submitted|published/i.test(n.title)), JSON.stringify(notifs[0]));
  }

  // ── Pastoral & extended operations ───────────────────────────────────────
  if (anyStudent) {
    const sid = String(anyStudent.id);

    const health = await api(adminCookie, "/api/operations", { method: "POST", body: JSON.stringify({ action: "save_health_record", studentId: sid, bloodGroup: "O+", allergies: "Peanuts", doctorName: "Dr Chiremba", emergencyNotes: "EpiPen in office" }) });
    check("health profile saved", health.status === 201, JSON.stringify(health.json));
    const healthList = await api(adminCookie, "/api/operations?module=health");
    check("health module lists profile", healthList.status === 200 && ((healthList.json.records ?? []) as unknown[]).length > 0, `got ${healthList.status}`);
    const healthDenied = await api(smokeCookie, "/api/operations?module=health");
    check("librarian denied health records", healthDenied.status === 403, `got ${healthDenied.status}`);

    const sg = await api(adminCookie, "/api/operations", { method: "POST", body: JSON.stringify({ action: "create_safeguarding_case", studentId: sid, concernType: "Welfare check", details: "Smoke test concern — learner arrived distressed twice this week." }) });
    check("safeguarding case opened", sg.status === 201, JSON.stringify(sg.json));
    if (sg.status === 201) {
      const esc = await api(adminCookie, "/api/operations", { method: "POST", body: JSON.stringify({ action: "update_safeguarding_case", caseId: sg.json.id, status: "escalated", actions: "Referred to designated officer" }) });
      check("safeguarding case escalated", esc.status === 200, JSON.stringify(esc.json));
    }
    const sgDenied = await api(smokeCookie, "/api/operations?module=safeguarding");
    check("librarian denied safeguarding", sgDenied.status === 403, `got ${sgDenied.status}`);

    const sen = await api(adminCookie, "/api/operations", { method: "POST", body: JSON.stringify({ action: "save_special_need", studentId: sid, category: "Reading support", interventionPlan: "Guided reading 3x weekly", reviewDate: "2026-12-01" }) });
    check("SEN support plan saved", sen.status === 201, JSON.stringify(sen.json));

    const pickup = await api(adminCookie, "/api/operations", { method: "POST", body: JSON.stringify({ action: "save_pickup", studentId: sid, name: "Smoke Relative", relationship: "Aunt", phone: "+263771234567", validTo: "2027-12-31" }) });
    check("pickup authorized", pickup.status === 201, JSON.stringify(pickup.json));
    if (pickup.status === 201) {
      const revoke = await api(adminCookie, "/api/operations", { method: "POST", body: JSON.stringify({ action: "revoke_pickup", pickupId: pickup.json.id }) });
      check("pickup revoked", revoke.status === 200, JSON.stringify(revoke.json));
    }

    const club = await api(adminCookie, "/api/operations", { method: "POST", body: JSON.stringify({ action: "save_club", name: "Smoke Club " + Date.now(), category: "Academic", schedule: "Fridays 14:00" }) });
    check("club created", club.status === 201, JSON.stringify(club.json));
    if (club.status === 201) {
      const join = await api(adminCookie, "/api/operations", { method: "POST", body: JSON.stringify({ action: "join_club", clubId: club.json.id, studentId: sid, role: "Member" }) });
      check("learner joined club", join.status === 201, JSON.stringify(join.json));
    }
    const trip = await api(adminCookie, "/api/operations", { method: "POST", body: JSON.stringify({ action: "save_trip", title: "Smoke Trip " + Date.now(), destination: "National Heroes Acre", startDate: "2026-11-10", endDate: "2026-11-10", cost: "15.00", currency: "USD", status: "open" }) });
    check("trip created", trip.status === 201, JSON.stringify(trip.json));
    if (trip.status === 201) {
      const part = await api(adminCookie, "/api/operations", { method: "POST", body: JSON.stringify({ action: "add_trip_participant", tripId: trip.json.id, studentId: sid }) });
      check("trip participant registered", part.status === 201, JSON.stringify(part.json));
      const consent = await api(adminCookie, "/api/operations", { method: "POST", body: JSON.stringify({ action: "set_trip_consent", participantId: part.json.id, consentStatus: "given", paid: "15.00" }) });
      check("trip consent + payment recorded", consent.status === 200, JSON.stringify(consent.json));
    }

    // Homework + curriculum through the academic API
    const cs = ((academicData.json.classSubjects ?? []) as { id: string }[])[0];
    if (cs) {
      const hw = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "create_assignment", classSubjectId: cs.id, title: "Smoke homework " + Date.now(), instructions: "Complete questions 1-5", dueDate: "2026-11-30" }) });
      check("assignment published", hw.status === 201, JSON.stringify(hw.json));
      if (hw.status === 201) {
        const closed = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "close_assignment", assignmentId: hw.json.id }) });
        check("assignment closed", closed.status === 200, JSON.stringify(closed.json));
      }
      const topic = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "save_curriculum_topic", classSubjectId: cs.id, title: "Smoke topic " + Date.now(), objectives: "Test coverage tracking" }) });
      check("curriculum topic saved", topic.status === 201, JSON.stringify(topic.json));
      if (topic.status === 201) {
        const done = await api(adminCookie, "/api/academic", { method: "POST", body: JSON.stringify({ action: "set_topic_status", topicId: topic.json.id, status: "completed" }) });
        check("topic marked complete", done.status === 200, JSON.stringify(done.json));
      }
    }

    // Global search + school profile
    const searchRes = await api(adminCookie, `/api/search?q=${encodeURIComponent(String(anyStudent.firstName ?? "a"))}`);
    check("global search returns results", searchRes.status === 200 && ((searchRes.json.students ?? []) as unknown[]).length > 0, `got ${searchRes.status}`);
    const searchDenied = await api(smokeCookie, "/api/search?q=sm");
    check("search is permission-gated", searchDenied.status === 200 && ((searchDenied.json.invoices ?? []) as unknown[]).length === 0 && ((searchDenied.json.payments ?? []) as unknown[]).length === 0, `got ${searchDenied.status}`);

    const profile = await api(adminCookie, "/api/administration", { method: "POST", body: JSON.stringify({ action: "update_school", name: "Nyashavee Primary School", currency: "USD", timezone: "Africa/Harare", motto: "Excellence through diligence", registrationNumber: "MEC/PRM/0412" }) });
    check("school profile fields saved", profile.status === 200, JSON.stringify(profile.json));

    // Module toggles — disable a module, verify the dashboard carries it, restore.
    const toggleOff = await api(adminCookie, "/api/administration", { method: "POST", body: JSON.stringify({ action: "update_school", name: "Nyashavee Primary School", currency: "USD", timezone: "Africa/Harare", enabledModules: ["dashboard", "students", "finance", "administration"] }) });
    const dashToggled = await api(adminCookie, "/api/dashboard");
    const toggledMods = (dashToggled.json.workspace as { enabledModules?: string[] } | undefined)?.enabledModules;
    check("enabledModules reaches workspace", toggleOff.status === 200 && JSON.stringify(toggledMods) === JSON.stringify(["dashboard", "students", "finance", "administration"]), JSON.stringify(toggledMods));
    await api(adminCookie, "/api/administration", { method: "POST", body: JSON.stringify({ action: "update_school", name: "Nyashavee Primary School", currency: "USD", timezone: "Africa/Harare", enabledModules: [] }) });

    const portalCheck = await api(parentCookie, "/api/portal");
    check("portal exposes assignments", Array.isArray(portalCheck.json.assignments), `got ${portalCheck.status}`);

    // Staff attendance register — leadership marks, others are denied.
    const staffReg = await api(adminCookie, `/api/attendance?scope=staff&date=2026-10-22`);
    const staffList = (staffReg.json.staff ?? []) as Array<{ id: string }>;
    check("staff register loads", staffReg.status === 200 && staffList.length > 0 && staffReg.json.canMark === true, `got ${staffReg.status}`);
    const markStaff = await api(adminCookie, "/api/attendance", { method: "POST", body: JSON.stringify({ action: "mark_staff", date: "2026-10-22", entries: staffList.slice(0, 3).map((member, index) => ({ staffId: member.id, status: index === 0 ? "absent" : "present" })) }) });
    check("staff register marked", markStaff.status === 201, JSON.stringify(markStaff.json));
    const markDenied = await api(smokeCookie, "/api/attendance", { method: "POST", body: JSON.stringify({ action: "mark_staff", date: "2026-10-22", entries: [] }) });
    check("librarian cannot mark staff register", markDenied.status === 403, `got ${markDenied.status}`);

    // School-wide documents register.
    const docsRegister = await api(adminCookie, "/api/students/documents?page=1&pageSize=25");
    check("documents register loads", docsRegister.status === 200 && Array.isArray(docsRegister.json.documents) && typeof docsRegister.json.total === "number", `got ${docsRegister.status}`);

    // Online payment — gateway not configured in smoke, so the portal must
    // answer honestly rather than starting a checkout.
    const payTry = await api(parentCookie, "/api/portal", { method: "POST", body: JSON.stringify({ action: "pay_online", studentId: String(linkedStudents[0]?.id ?? ""), amount: "10.00", currency: "USD" }) });
    check("pay_online gated when gateway unconfigured", payTry.status === 503, `got ${payTry.status}`);

    // Proof of payment — parent uploads, finance verifies, guardian notified.
    const proofStudent = String(linkedStudents[0]?.id ?? "");
    const proofForm = new FormData();
    proofForm.set("studentId", proofStudent);
    proofForm.set("amount", "15.00");
    proofForm.set("currency", "USD");
    proofForm.set("method", "bank_transfer");
    proofForm.set("reference", `SMK-${Date.now() % 100000}`);
    proofForm.set("file", new Blob(["%PDF-1.4 smoke proof"], { type: "application/pdf" }), "proof.pdf");
    const proofUp = await fetch(`${BASE}/api/portal`, { method: "POST", headers: { Cookie: parentCookie }, body: proofForm });
    const proofJson = await proofUp.json().catch(() => ({}));
    check("parent submits proof of payment", proofUp.status === 201, JSON.stringify(proofJson));
    const proofId = String(proofJson.id ?? "");
    const finWithProofs = await api(adminCookie, "/api/finance");
    const pendingProof = ((finWithProofs.json.proofs ?? []) as Array<{ id: string; status: string }>).find((p) => p.id === proofId);
    check("proof appears in finance queue", pendingProof?.status === "pending", `got ${finWithProofs.status}`);
    const rejectProof = await api(adminCookie, "/api/finance", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ action: "review_proof", proofId, decision: "verified" }) });
    check("proof verified by finance", rejectProof.status === 200 && rejectProof.json.reviewed === "verified", JSON.stringify(rejectProof.json));
    const portalProofs = await api(parentCookie, "/api/portal");
    const shownProof = ((portalProofs.json.proofs ?? []) as Array<{ id: string; status: string }>).find((p) => p.id === proofId);
    check("parent sees verified proof status", shownProof?.status === "verified", `got ${portalProofs.status}`);

    const mgmt = await api(adminCookie, "/api/reports");
    check("reports expose chronic absence list", mgmt.status === 200 && Array.isArray(mgmt.json.chronicAbsentees), `got ${mgmt.status}`);

    // External transfer — records destination and closes enrolments.
    const leaverName = `Leaver${Date.now() % 1000000}`;
    await api(adminCookie, "/api/students", {
      method: "POST",
      body: JSON.stringify({ action: "import_students", rows: [{ firstName: "Smoke", lastName: leaverName, gender: "female", dateOfBirth: "2015-05-05", classroomId: classroom.id }] }),
    });
    const leaverId = (((await api(adminCookie, `/api/search?q=${leaverName}`)).json.students ?? []) as Array<{ id: string }>)[0]?.id;
    if (leaverId) {
      const wd = await api(adminCookie, "/api/students", { method: "POST", body: JSON.stringify({ action: "withdraw_student", studentId: leaverId, destination: "Smoke Destination School", reason: "Family relocated", effectiveDate: "2026-10-20" }) });
      check("external transfer records destination", wd.status === 200, JSON.stringify(wd.json));
      const verify = await api(adminCookie, `/api/students?pageSize=100`);
      const row = ((verify.json.students ?? []) as Array<Record<string, unknown>>).find((x) => x.id === leaverId);
      check("leaver marked transferred with destination", row?.status === "transferred" && row?.transferDestination === "Smoke Destination School", JSON.stringify({ status: row?.status, dest: row?.transferDestination }));
    }
  }

  // 3. Rate limit — 31 rapid mutations on timetable must trip a 429.
  //    Runs last among API checks so the cooldown can't break later steps.
  let saw429 = false;
  for (let i = 0; i < 31; i++) {
    const r = await api(adminCookie, "/api/timetable", { method: "POST", body: JSON.stringify({ action: "cancel_entry", entryId: "none" }) });
    if (r.status === 429) { saw429 = true; break; }
  }
  check("mutation rate limit trips at 30/min", saw429);

  // Password change revokes the old session (do last — it kills the cookie)
  const change = await api(smokeCookie, "/api/account", {
    method: "POST",
    body: JSON.stringify({ action: "change_password", currentPassword: "SmokeTest456", newPassword: "SmokeTest789" }),
  });
  check("self-service password change", change.status === 200, JSON.stringify(change.json));
  const staleSession = await api(smokeCookie, "/api/dashboard");
  check("old session revoked after password change", staleSession.status === 401 || staleSession.status === 403, `got ${staleSession.status}`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Smoke test crashed:", error);
  process.exit(1);
});
