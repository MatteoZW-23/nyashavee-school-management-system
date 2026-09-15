/* eslint-disable @typescript-eslint/no-explicit-any -- load-test reads intentionally heterogeneous HTTP payloads without coupling to route-internal response types. */
// Load test — exercises every core flow against the volume-seeded school
// (4 000 learners, 100 teachers). Reports latency + failures per flow.
const BASE = process.env.SMOKE_URL ?? "http://localhost:3001";

type Res = { status: number; json: Record<string, any>; ms: number };
const results: { name: string; ms: number; ok: boolean; detail?: string }[] = [];

function cookieHeader(cs: string[]) { return cs.map((c) => c.split(";")[0]).join("; "); }

async function login(email: string, password: string) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const csrfCookies = csrfRes.headers.getSetCookie();
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader(csrfCookies) },
    body: new URLSearchParams({ email, password, csrfToken }),
    redirect: "manual",
  });
  return cookieHeader([...csrfCookies, ...res.headers.getSetCookie()]);
}

async function call(cookie: string, path: string, init?: RequestInit): Promise<Res> {
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Cookie: cookie, ...(init?.body ? { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() } : {}), ...(init?.headers as object) },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, ms: performance.now() - started };
}

const mark = (name: string, r: Res, expect = 200) =>
  results.push({ name, ms: r.ms, ok: r.status === expect, detail: r.status !== expect ? `status ${r.status}: ${JSON.stringify(r.json).slice(0, 100)}` : undefined });

async function main() {
  const t0 = performance.now();
  const [admin, bursar, teacher, parent] = await Promise.all([
    login("admin@nyashavee.local", "admin123"),
    login("bursar@nyashavee.local", "bursar123"),
    login("teacher@nyashavee.local", "teacher123"),
    login("parent@nyashavee.local", "parent123"),
  ]);
  results.push({ name: "4 logins", ms: performance.now() - t0, ok: true });

  // ---- Read latency at scale ----
  for (const [name, path, cookie] of [
    ["dashboard", "/api/dashboard", admin],
    ["students p1", "/api/students?page=1&pageSize=25", admin],
    ["students p80 (deep)", "/api/students?page=80&pageSize=50", admin],
    ["finance workspace", "/api/finance", bursar],
    ["academic workspace", "/api/academic", teacher],
    ["administration", "/api/administration", admin],
    ["reports", "/api/reports", admin],
    ["parent portal", "/api/portal", parent],
    ["global search", "/api/search?q=Takudzwa", admin],
    ["documents register", "/api/students/documents", admin],
  ] as const) {
    const r = await call(cookie, path);
    mark(name, r);
  }

  // ---- Attendance: 10 classes submit registers in parallel (≈510 entries) ----
  const att = await call(admin, "/api/academic");
  const allClasses = (att.json.classrooms ?? []) as any[];
  const g5a = allClasses.find((c: any) => c.name === "Grade 5A");
  const classes = g5a ? [g5a, ...allClasses.filter((c: any) => c.id !== g5a.id).slice(0, 9)] : allClasses.slice(0, 10);
  const date = new Date().toISOString().slice(0, 10);
  const regStart = performance.now();
  const regResults = await Promise.all(classes.map(async (cls: any) => {
    const roster = await call(admin, `/api/attendance?classroomId=${cls.id}&date=${date}`);
    const students = (roster.json.students ?? []) as any[];
    if (!students.length) return { status: 0, json: { error: "empty roster" }, ms: 0 };
    return call(admin, "/api/attendance", {
      method: "POST",
      body: JSON.stringify({
        classroomId: cls.id, date, session: "morning", submit: true,
        entries: students.map((s: any) => ({ studentId: s.id, status: "present" })),
      }),
    });
  }));
  const regOk = regResults.filter((r) => r.status === 200 || r.status === 201).length;
  results.push({ name: `10 parallel class registers (${regOk}/10)`, ms: performance.now() - regStart, ok: regOk === 10, detail: regOk === 10 ? undefined : JSON.stringify(regResults.find(r => r.status > 299)?.json ?? {}).slice(0, 100) });

  // ---- Marks: create assessment, enter 55 marks, publish ----
  const cs = classes[0] && ((att.json.classSubjects ?? []) as any[]).find((x) => x.classroomId === classes[0].id || x.classroom?.id === classes[0].id);
  const activeTerm = (att.json.terms ?? []).find((t: any) => t.status === "active");
  if (cs && activeTerm) {
    const a = await call(admin, "/api/academic", { method: "POST", body: JSON.stringify({ action: "create_assessment", termId: activeTerm.id, classSubjectId: cs.id, title: "Load Test CA", assessmentType: "test", maxMarks: 100, weightPercent: 100, dueDate: date }) });
    mark("create assessment", a, 201);
    const roster = await call(admin, `/api/attendance?classroomId=${classes[0].id}&date=${date}`);
    const ids = ((roster.json.students ?? []) as any[]).map((s) => s.id);
    const m = await call(admin, "/api/academic", { method: "POST", body: JSON.stringify({ action: "save_marks", assessmentId: a.json.id ?? a.json.assessmentId, marks: ids.map((id: string, i: number) => ({ studentId: id, score: 40 + (i % 55) })) }) });
    mark(`save ${ids.length} marks`, m);
    const pub = await call(admin, "/api/academic", { method: "POST", body: JSON.stringify({ action: "publish_assessment", assessmentId: a.json.id ?? a.json.assessmentId }) });
    mark("publish assessment", pub);
  } else {
    results.push({ name: "assessment flow", ms: 0, ok: false, detail: "no classSubject/activeTerm found" });
  }

  // ---- Finance: 20 parallel payments against fresh invoices ----
  const someStudents = ((await call(admin, "/api/students?page=2&pageSize=25")).json.students ?? []) as any[];
  const finStart = performance.now();
  const payResults = await Promise.all(someStudents.slice(0, 10).map(async (s: any) => {
    const inv = await call(bursar, "/api/finance", { method: "POST", body: JSON.stringify({ action: "create_invoice", studentId: s.id, currency: "USD", issueDate: date, dueDate: "2026-12-01", items: [{ description: "Term 3 levy", category: "levy", quantity: 1, unitAmount: "50.00" }] }) });
    if (inv.status !== 201) return inv;
    return call(bursar, "/api/finance", { method: "POST", body: JSON.stringify({ action: "record_payment", studentId: s.id, currency: "USD", paymentDate: date, amount: "50.00", method: "cash", payerName: "Load Test" }) });
  }));
  const payOk = payResults.filter((r) => r.status === 201 || r.status === 200).length;
  results.push({ name: `10 invoice→payment pairs (${payOk}/10)`, ms: performance.now() - finStart, ok: payOk === 10, detail: payOk === 10 ? undefined : JSON.stringify(payResults.find(r => r.status > 299)?.json ?? {}).slice(0, 120) });

  // ---- Reports: publish assessments for the class, then generate ----
  if (activeTerm) {
    const classCss = ((att.json.classSubjects ?? []) as any[]).filter((x) => x.classroomId === classes[0]?.id);
    const roster2 = await call(admin, `/api/attendance?classroomId=${classes[0].id}&date=${date}`);
    const rosterIds = ((roster2.json.students ?? []) as any[]).map((x) => x.id);
    for (const c of classCss) {
      const a2 = await call(admin, "/api/academic", { method: "POST", body: JSON.stringify({ action: "create_assessment", termId: activeTerm.id, classSubjectId: c.id, title: "LT Exam", assessmentType: "exam", component: "exam", maxMarks: 100, weightPercent: 100, dueDate: date }) });
      const aId = a2.json.id ?? a2.json.assessmentId;
      if (!aId) continue;
      await call(admin, "/api/academic", { method: "POST", body: JSON.stringify({ action: "save_marks", assessmentId: aId, marks: rosterIds.map((id: string, i: number) => ({ studentId: id, score: 50 + (i % 45) })) }) });
      await call(admin, "/api/academic", { method: "POST", body: JSON.stringify({ action: "publish_assessment", assessmentId: aId }) });
    }
    // report for learners IN that class — the register roster is the truth
    const classStudents = rosterIds.slice(0, 5).map((id: string) => ({ id }));
    const repStart = performance.now();
    const reps = await Promise.all(classStudents.map((s: any) =>
      call(admin, "/api/report-cards", { method: "POST", body: JSON.stringify({ action: "generate_report", studentId: s.id, termId: activeTerm.id }) })));
    const repOk = reps.filter((r) => r.status === 200 || r.status === 201).length;
    results.push({ name: `5 report generations (${repOk}/5)`, ms: performance.now() - repStart, ok: repOk > 0, detail: repOk === 0 ? JSON.stringify(reps[0]?.json).slice(0, 120) : undefined });
  }

  // ---- Summary ----
  console.log("\n  LOAD TEST — 100 teachers / 4 000 learners\n  " + "─".repeat(58));
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(38)} ${r.ms.toFixed(0).padStart(6)} ms${r.detail ? "  " + r.detail : ""}`);
  const fails = results.filter((r) => !r.ok);
  console.log(`  ${"─".repeat(58)}\n  ${results.length - fails.length}/${results.length} passed · total wall time ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  if (fails.length) process.exitCode = 1;
}

await main();
export {};
