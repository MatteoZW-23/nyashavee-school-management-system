import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { hasPermission } from "@/lib/permissions";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

export default async function ReportPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) notFound();

  const db = getDb();
  const membership = await db.schoolMembership.findFirst({
    where: { userId, active: true, user: { active: true } },
    include: { school: true },
  });
  if (!membership) notFound();

  const report = await db.reportCard.findFirst({
    where: { id, schoolId: membership.schoolId, status: "published" },
    include: {
      results: { orderBy: { subjectNameSnapshot: "asc" } },
      term: { include: { academicYear: true } },
      approvals: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!report) notFound();

  // Staff with reports.view, or the learner's own fee-cleared guardians.
  const isStaff = hasPermission(membership.role, "reports.view");
  if (!isStaff) {
    const linked = await db.student.findFirst({
      where: {
        id: report.studentId,
        schoolId: membership.schoolId,
        OR: [
          { portalUserId: userId },
          { studentGuardians: { some: { guardian: { portalUserId: userId } } } },
        ],
      },
      select: { id: true },
    });
    if (!linked) notFound();
    // Fee gate mirrors the portal: issued invoices minus allocated payments.
    const [invoiced, allocated] = await Promise.all([
      db.feeInvoice.findMany({
        where: { schoolId: membership.schoolId, studentId: report.studentId, state: "issued", financeReversals: { none: {} } },
        select: { currency: true, totalMinor: true },
      }),
      db.paymentAllocation.findMany({
        where: {
          schoolId: membership.schoolId,
          studentId: report.studentId,
          financeReversals: { none: {} },
          invoice: { financeReversals: { none: {} } },
          payment: { financeReversals: { none: {} } },
        },
        select: { currency: true, amountMinor: true },
      }),
    ]);
    const cleared = ["USD", "ZWG"].every((code) =>
      invoiced.filter((i) => i.currency === code).reduce((s, i) => s + i.totalMinor, 0)
        - allocated.filter((a) => a.currency === code).reduce((s, a) => s + a.amountMinor, 0) <= 0,
    );
    if (!cleared) notFound();
  }

  const school = membership.school;

  return (
    <div className="mx-auto max-w-3xl bg-white p-10 text-slate-900 print:p-0">
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-6">
        <div>
          <h1 className="font-serif text-3xl font-bold">{school.name}</h1>
          {school.motto ? <p className="text-sm italic text-slate-500">{school.motto}</p> : null}
          <p className="text-sm text-slate-500">
            {[school.address, school.phone, school.email].filter(Boolean).join(" · ") || `${school.code} · Official report card`}
          </p>
          {school.registrationNumber ? <p className="text-xs text-slate-400">Reg. {school.registrationNumber}</p> : null}
        </div>
        <PrintButton />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div><p className="text-xs uppercase text-slate-500">Learner</p><p className="font-semibold">{report.studentNameSnapshot}</p></div>
        <div><p className="text-xs uppercase text-slate-500">Admission no.</p><p className="font-mono">{report.admissionNumberSnapshot}</p></div>
        <div><p className="text-xs uppercase text-slate-500">Class</p><p className="font-semibold">{report.classroomSnapshot}</p></div>
        <div><p className="text-xs uppercase text-slate-500">Period</p><p className="font-semibold">{report.term.academicYear.name} · {report.term.name}</p></div>
      </div>

      <table className="mt-8 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="py-2 pr-3">Subject</th>
            {!report.descriptorOnly && <th className="py-2 pr-3 text-right">CA</th>}
            {!report.descriptorOnly && <th className="py-2 pr-3 text-right">Exam</th>}
            {!report.descriptorOnly && <th className="py-2 pr-3 text-right">Final</th>}
            {!report.descriptorOnly && <th className="py-2 pr-3 text-right">Prev</th>}
            {!report.descriptorOnly && <th className="py-2 pr-3 text-right">Change</th>}
            <th className="py-2 pr-3 text-right">{report.descriptorOnly ? "Achievement" : "Grade"}</th>
            <th className="py-2 pr-3">Trend</th>
            <th className="py-2">Teacher comment</th>
          </tr>
        </thead>
        <tbody>
          {report.results.map((result) => (
            <tr key={result.id} className="border-b border-slate-200">
              <td className="py-2 pr-3 font-medium">{result.subjectNameSnapshot}</td>
              {!report.descriptorOnly && <td className="py-2 pr-3 text-right">{result.caPercent ?? "—"}</td>}
              {!report.descriptorOnly && <td className="py-2 pr-3 text-right">{result.examPercent ?? "—"}</td>}
              {!report.descriptorOnly && <td className="py-2 pr-3 text-right font-semibold">{result.scorePercent}%</td>}
              {!report.descriptorOnly && <td className="py-2 pr-3 text-right text-slate-500">{result.previousPercent ?? "—"}</td>}
              {!report.descriptorOnly && <td className="py-2 pr-3 text-right">{result.changePercent !== null && result.changePercent !== undefined ? (result.changePercent > 0 ? "+" : "") + result.changePercent + "%" : "—"}</td>}
              <td className="py-2 pr-3 text-right font-semibold">{result.grade ?? "—"}</td>
              <td className="py-2 pr-3 text-xs capitalize">{result.trend === "improving" ? "↑ Improving" : result.trend === "declining" ? "↓ Declined" : result.trend === "stable" ? "→ Stable" : ""}</td>
              <td className="py-2 text-xs italic text-slate-600">{result.teacherComment ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-8 grid grid-cols-4 gap-4 text-sm">
        {!report.descriptorOnly && <div><p className="text-xs uppercase text-slate-500">Average</p><p className="font-serif text-3xl font-bold">{report.averagePercent ?? "—"}%</p></div>}
        {report.classPosition ? <div><p className="text-xs uppercase text-slate-500">Position</p><p className="font-serif text-3xl font-bold">{report.classPosition}<span className="text-base font-normal text-slate-500"> of {report.classSize}</span></p></div> : null}
        <div><p className="text-xs uppercase text-slate-500">Attendance</p><p className="font-semibold">{report.presentSessions} present · {report.absentSessions} absent</p></div>
        <div><p className="text-xs uppercase text-slate-500">Promotion</p><p className="font-semibold capitalize">{report.promotionStatus?.replaceAll("_", " ") ?? "—"}</p></div>
      </div>

      {(report.classTeacherComment || report.headComment) && (
        <div className="mt-8 space-y-4 border-t border-slate-300 pt-4 text-sm">
          {report.classTeacherComment && <div><p className="text-xs uppercase text-slate-500">Class teacher</p><p>{report.classTeacherComment}</p></div>}
          {report.headComment && <div><p className="text-xs uppercase text-slate-500">Head teacher</p><p>{report.headComment}</p></div>}
        </div>
      )}

      {report.approvals.length > 0 && (
        <div className="mt-10 grid grid-cols-3 gap-6 border-t border-slate-300 pt-6 text-sm">
          {(["class_teacher", "hod", "head"] as const).map((step) => {
            const approval = report.approvals.find((a) => a.step === step);
            return (
              <div key={step}>
                <p className="text-xs uppercase text-slate-500">{step === "class_teacher" ? "Class teacher" : step === "hod" ? "Head of department" : "Head"}</p>
                {approval ? (
                  <>
                    <p className="mt-4 font-semibold">{approval.actorName}</p>
                    <p className="text-xs text-slate-500">Signed {new Date(approval.createdAt).toLocaleDateString("en-ZW")} · {approval.action}</p>
                  </>
                ) : (
                  <p className="mt-4 border-b border-slate-400 pb-1 text-xs text-slate-400">Signature</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-10 flex items-end justify-between text-xs text-slate-500">
        <div>
          <p>Verification code: <span className="font-mono font-semibold text-slate-700">{report.verificationCode}</span></p>
          <p>Published {report.publishedAt ? new Date(report.publishedAt).toLocaleDateString("en-ZW") : ""} · v{report.version}</p>
        </div>
        <p>Verify at /verify</p>
      </div>
    </div>
  );
}
