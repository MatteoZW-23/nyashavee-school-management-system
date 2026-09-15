import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { hasPermission } from "@/lib/permissions";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

export default async function AcceptancePrintPage({ params }: { params: Promise<{ id: string }> }) {
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

  const student = await db.student.findFirst({
    where: { id, schoolId: membership.schoolId },
    select: {
      id: true, firstName: true, middleName: true, lastName: true,
      admissionNumber: true, admissionDate: true, status: true,
      classroom: { select: { name: true, gradeLevel: { select: { name: true } } } },
      studentGuardians: {
        where: { isPrimaryContact: true },
        select: { guardian: { select: { firstName: true, lastName: true, portalUserId: true } } },
        take: 1,
      },
    },
  });
  if (!student) notFound();

  // Staff need students.view; guardians only see their own child's letter.
  const isStaff = hasPermission(membership.role, "students.view");
  const isGuardian = student.studentGuardians.some((link) => link.guardian.portalUserId === userId);
  if (!isStaff && !isGuardian) notFound();

  const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
  const guardian = student.studentGuardians[0]?.guardian;
  const guardianName = guardian ? `${guardian.firstName} ${guardian.lastName}` : "Parent/Guardian";
  const date = student.admissionDate ?? new Date();
  const letterNo = `ACC-${student.admissionNumber}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 print:bg-white print:p-0">
      <div className="absolute right-6 top-6 print:hidden"><PrintButton /></div>
      <div className="w-full max-w-3xl bg-white p-14 text-slate-900 shadow print:shadow-none">
        <div className="border-b-2 border-slate-800 pb-6 text-center">
          <h1 className="font-serif text-3xl font-bold">{membership.school.name}</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.3em] text-slate-500">Official letter of acceptance</p>
        </div>

        <div className="mt-8 flex justify-between text-xs text-slate-600">
          <p>Reference: <span className="font-mono font-semibold">{letterNo}</span></p>
          <p>Date: {date.toISOString().slice(0, 10)}</p>
        </div>

        <p className="mt-8 text-sm">{guardianName}</p>

        <p className="mt-6 font-semibold">RE: ACCEPTANCE OF {fullName.toUpperCase()}</p>

        <p className="mt-5 text-sm leading-7 text-slate-700">
          We are pleased to inform you that <strong>{fullName}</strong> has been accepted for admission
          to <strong>{membership.school.name}</strong>, effective {date.toISOString().slice(0, 10)}.
        </p>

        <table className="mt-6 w-full text-sm">
          <tbody>
            <tr className="border-b border-slate-200"><td className="py-2 text-slate-500">Admission number</td><td className="py-2 text-right font-mono font-semibold">{student.admissionNumber}</td></tr>
            <tr className="border-b border-slate-200"><td className="py-2 text-slate-500">Grade / Form</td><td className="py-2 text-right font-semibold">{student.classroom?.gradeLevel?.name ?? "To be confirmed"}</td></tr>
            <tr className="border-b border-slate-200"><td className="py-2 text-slate-500">Class</td><td className="py-2 text-right font-semibold">{student.classroom?.name ?? "To be assigned"}</td></tr>
            <tr className="border-b border-slate-200"><td className="py-2 text-slate-500">Learner status</td><td className="py-2 text-right font-semibold capitalize">{student.status}</td></tr>
          </tbody>
        </table>

        <p className="mt-6 text-sm leading-7 text-slate-700">
          Portal login details for the learner and the responsible guardian accompany this letter.
          Please report to the school office with the learner on the first day of attendance and bring
          the learner&rsquo;s birth certificate and proof of residence if not yet submitted.
        </p>

        <p className="mt-10 text-sm">Yours faithfully,</p>
        <div className="mt-14 grid max-w-md grid-cols-2 gap-12 text-xs text-slate-500">
          <div className="border-t border-slate-400 pt-2"><p>Head teacher</p></div>
          <div className="border-t border-slate-400 pt-2"><p>School seal</p></div>
        </div>
      </div>
    </div>
  );
}
