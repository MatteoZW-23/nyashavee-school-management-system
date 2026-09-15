import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { hasPermission } from "@/lib/permissions";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

function money(minor: number, currency: string) {
  return `${currency === "ZWG" ? "ZiG" : currency} ${(minor / 100).toFixed(2)}`;
}

export default async function PayslipsPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) notFound();

  const db = getDb();
  const membership = await db.schoolMembership.findFirst({
    where: { userId, active: true, user: { active: true } },
    include: { school: true },
  });
  if (!membership || !hasPermission(membership.role, "payroll.manage")) notFound();

  const run = await db.payrollRun.findFirst({
    where: { id, schoolId: membership.schoolId },
    include: {
      entries: {
        include: { staffProfile: { select: { firstName: true, lastName: true, employeeNumber: true, position: true, department: true, payeNumber: true, nssaNumber: true, pscNumber: true } } },
        orderBy: { staffProfile: { lastName: "asc" } },
      },
    },
  });
  if (!run) notFound();

  return (
    <div className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0">
      <div className="absolute right-6 top-6 print:hidden"><PrintButton /></div>
      {run.entries.map((entry) => {
        const staff = entry.staffProfile;
        return (
          <div key={entry.id} className="mx-auto mb-8 w-full max-w-3xl bg-white p-10 shadow break-after-page print:mb-0 print:shadow-none">
            <div className="flex items-start justify-between border-b-2 border-slate-800 pb-4">
              <div>
                <h1 className="font-serif text-2xl font-bold text-slate-900">{membership.school.name}</h1>
                <p className="mt-1 text-xs uppercase tracking-[0.25em] text-slate-500">Payslip — {run.period}</p>
              </div>
              <p className="font-mono text-xs text-slate-500">{staff.employeeNumber}</p>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Employee</p>
                <p className="mt-1 font-semibold text-slate-900">{staff.firstName} {staff.lastName}</p>
                <p className="text-xs text-slate-500">{staff.position}{staff.department ? ` · ${staff.department}` : ""}</p>
              </div>
              <div className="space-y-1 text-right text-xs text-slate-600">
                {staff.payeNumber && <p>PAYE: <span className="font-mono">{staff.payeNumber}</span></p>}
                {staff.nssaNumber && <p>NSSA: <span className="font-mono">{staff.nssaNumber}</span></p>}
                {staff.pscNumber && <p>PSC: <span className="font-mono">{staff.pscNumber}</span></p>}
              </div>
            </div>

            <table className="mt-6 w-full text-sm">
              <tbody>
                <tr className="border-b border-slate-200"><td className="py-2 text-slate-600">Basic salary</td><td className="py-2 text-right font-medium">{money(entry.basicMinor, run.currency)}</td></tr>
                <tr className="border-b border-slate-200"><td className="py-2 text-slate-600">Allowances</td><td className="py-2 text-right font-medium">{money(entry.allowancesMinor, run.currency)}</td></tr>
                <tr className="border-b border-slate-200"><td className="py-2 text-slate-600">Deductions</td><td className="py-2 text-right font-medium text-red-700">−{money(entry.deductionsMinor, run.currency)}</td></tr>
                {entry.note && <tr className="border-b border-slate-200"><td className="py-2 text-slate-500" colSpan={2}>Note: {entry.note}</td></tr>}
                <tr><td className="py-3 font-bold text-slate-900">Net pay</td><td className="py-3 text-right font-serif text-xl font-bold text-slate-900">{money(entry.netMinor, run.currency)}</td></tr>
              </tbody>
            </table>

            <div className="mt-10 grid max-w-md grid-cols-2 gap-12 text-xs text-slate-500">
              <div className="border-t border-slate-400 pt-2"><p>Bursar</p></div>
              <div className="border-t border-slate-400 pt-2"><p>Employee signature</p></div>
            </div>
          </div>
        );
      })}
      {!run.entries.length && <p className="text-center text-sm text-slate-500">No entries in this payroll run.</p>}
    </div>
  );
}
