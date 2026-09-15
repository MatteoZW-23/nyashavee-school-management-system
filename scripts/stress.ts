// Stress test — pushes the production build to its ceiling against the
// volume database (4 000 learners). Measures p50/p95/max latency, error
// rates, and where the system starts shedding load (rate limits / timeouts).
const BASE = process.env.STRESS_URL ?? "http://localhost:3002";
export {};

function cookieHeader(cs: string[]) { return cs.map((c) => c.split(";")[0]).join("; "); }
async function login(email: string, password: string) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const cc = csrfRes.headers.getSetCookie();
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader(cc) },
    body: new URLSearchParams({ email, password, csrfToken }),
    redirect: "manual",
  });
  return cookieHeader([...cc, ...res.headers.getSetCookie()]);
}

type Sample = { ms: number; status: number };
function summarize(name: string, samples: Sample[]) {
  const ok = samples.filter((s) => s.status < 400);
  const limited = samples.filter((s) => s.status === 429);
  const errors = samples.filter((s) => s.status >= 400 && s.status !== 429);
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const p = (q: number) => ms[Math.floor(ms.length * q)] ?? 0;
  console.log(`  ${name.padEnd(46)} n=${samples.length}  ok=${ok.length}  429=${limited.length}  err=${errors.length}  p50=${p(0.5).toFixed(0)}ms p95=${p(0.95).toFixed(0)}ms max=${p(0.99).toFixed(0)}ms`);
  if (errors.length) console.log(`      first error: ${errors[0].status}`);
}

async function fire(cookie: string, path: string, init?: RequestInit): Promise<Sample> {
  const t = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { Cookie: cookie, ...(init?.headers as object) } });
    await res.text();
    return { ms: performance.now() - t, status: res.status };
  } catch {
    return { ms: performance.now() - t, status: 0 };
  }
}

async function main() {
  const admin = await login("admin@nyashavee.local", "admin123");
  const bursar = await login("bursar@nyashavee.local", "bursar123");
  const today = new Date().toISOString().slice(0, 10);

  console.log(`\n  STRESS TEST → ${BASE} (production build, 4 000 learners)\n  ${"─".repeat(96)}`);

  // ---- Phase 1: read flood, 200 concurrent × 3 rounds ----
  for (let round = 1; round <= 3; round++) {
    const endpoints = ["/api/dashboard", "/api/students?page=1&pageSize=25", "/api/finance", "/api/academic", "/api/reports", "/api/search?q=Takudzwa"];
    const samples: Sample[] = await Promise.all(
      Array.from({ length: 200 }, (_, i) => fire(admin, endpoints[i % endpoints.length])),
    ).then((r) => r);
    summarize(`read flood round ${round} (200 concurrent)`, samples);
  }

  // ---- Phase 2: sustained read — 30 s at ~25 req/s ----
  const sustained: Sample[] = [];
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const batch = await Promise.all(Array.from({ length: 25 }, (_, i) => fire(admin, i % 2 ? "/api/dashboard" : "/api/students?pageSize=50")));
    sustained.push(...batch);
  }
  summarize("sustained reads 30s @ ~25req/s", sustained);

  // ---- Phase 3: write burst — 30 parallel register submissions ----
  const acad = await fetch(`${BASE}/api/academic`, { headers: { Cookie: admin } }).then((r) => r.json());
  const classes = (acad.classrooms ?? []).slice(0, 30) as { id: string }[];
  const rosters = await Promise.all(classes.map((c) =>
    fetch(`${BASE}/api/attendance?classroomId=${c.id}&date=${today}`, { headers: { Cookie: admin } }).then((r) => r.json()),
  ));
  const burst = await Promise.all(classes.map((c, i) => {
    const students = (rosters[i].students ?? []) as { id: string }[];
    return fire(admin, "/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ classroomId: c.id, date: today, session: "afternoon", submit: true, entries: students.map((s) => ({ studentId: s.id, status: "present" })) }),
    });
  }));
  summarize("register burst — 30 parallel (~1 500 entries)", burst);

  // ---- Phase 4: heavy write — 5 × 120-mark save_marks ----
  const cs = (acad.classSubjects ?? [])[0];
  if (cs) {
    const term = (acad.terms ?? []).find((t: { status: string }) => t.status === "active");
    const heavy: Sample[] = [];
    for (let i = 0; i < 5; i++) {
      const a = await fetch(`${BASE}/api/academic`, { method: "POST", headers: { Cookie: admin, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ action: "create_assessment", termId: term.id, classSubjectId: cs.id, title: `Stress ${Date.now() % 99999}-${i}`, assessmentType: "test", maxMarks: 100, weightPercent: 5, dueDate: today }) }).then((r) => r.json());
      const roster = rosters[0]?.students ?? [];
      heavy.push(await fire(admin, "/api/academic", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ action: "save_marks", assessmentId: a.id ?? a.assessmentId, marks: roster.slice(0, 120).map((s: { id: string }, j: number) => ({ studentId: s.id, score: 40 + (j % 60) })) }) }));
    }
    summarize("heavy mark entry — 5 × full class", heavy);
  }

  // ---- Phase 5: full export under concurrent read load ----
  const exportSample = await Promise.all([
    fire(admin, "/api/administration/export"),
    ...Array.from({ length: 50 }, (_, i) => fire(admin, i % 2 ? "/api/dashboard" : "/api/students?pageSize=25")),
  ]);
  summarize("export + 50 concurrent reads", exportSample);

  // ---- Phase 6: finance burst — 25 parallel payments ----
  const students2 = await fetch(`${BASE}/api/students?page=5&pageSize=25`, { headers: { Cookie: admin } }).then((r) => r.json());
  const payBurst: Sample[] = [];
  for (const s of (students2.students ?? []).slice(0, 25) as { id: string }[]) {
    const inv = await fetch(`${BASE}/api/finance`, { method: "POST", headers: { Cookie: bursar, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ action: "create_invoice", studentId: s.id, currency: "USD", issueDate: today, dueDate: "2026-12-01", items: [{ description: "Stress levy", category: "levy", quantity: 1, unitAmount: "10.00" }] }) }).then((r) => r.json());
    const invoiceId = inv.id ?? inv.invoiceId ?? inv.invoice?.id;
    if (!invoiceId) { payBurst.push({ ms: 0, status: 400 }); continue; }
    payBurst.push(await fire(bursar, "/api/finance", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ action: "record_payment", studentId: s.id, currency: "USD", paymentDate: today, amount: "10.00", method: "cash", payerName: "Stress" }) }));
  }
  summarize("finance — 25 invoice+payment pairs", payBurst);

  console.log(`  ${"─".repeat(96)}\n  Done. 429s = the rate limiter protecting the school ledger — expected, not failures.\n`);
}

await main();
