import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { hasPermission } from "@/lib/permissions";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

export default async function CertificatePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) notFound();

  const db = getDb();
  const membership = await db.schoolMembership.findFirst({
    where: { userId, active: true, user: { active: true } },
    include: { school: true },
  });
  if (!membership || !hasPermission(membership.role, "students.view")) notFound();

  const student = await db.student.findFirst({
    where: { id, schoolId: membership.schoolId, status: "graduated" },
    select: {
      firstName: true, middleName: true, lastName: true, admissionNumber: true,
      studentEnrollments: {
        where: { status: "completed" },
        select: { exitDate: true, classroom: { select: { name: true } }, gradeLevel: { select: { name: true } } },
        orderBy: { exitDate: "desc" },
        take: 1,
      },
    },
  });
  if (!student) notFound();

  const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
  const last = student.studentEnrollments[0];
  const year = last?.exitDate ? new Date(last.exitDate).getFullYear() : new Date().getFullYear();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 print:bg-white print:p-0">
      <div className="absolute right-6 top-6 print:hidden"><PrintButton /></div>
      <div className="w-full max-w-4xl border-8 border-double border-slate-700 bg-white p-16 text-center print:border-8">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Certificate of Completion</p>
        <h1 className="mt-4 font-serif text-4xl font-bold text-slate-900">{membership.school.name}</h1>
        <p className="mt-2 text-sm text-slate-500">{membership.school.code}</p>

        <p className="mt-12 text-sm text-slate-600">This is to certify that</p>
        <p className="mt-3 font-serif text-4xl font-bold text-slate-900 underline decoration-slate-300 underline-offset-8">{fullName}</p>
        <p className="mt-8 text-sm leading-7 text-slate-600">
          has successfully completed {last?.gradeLevel?.name ?? "the final grade"} at this institution
          <br />and graduated in the academic year {year}.
        </p>

        <div className="mx-auto mt-16 grid max-w-lg grid-cols-2 gap-12 text-left text-xs text-slate-500">
          <div className="border-t border-slate-400 pt-2"><p>Head teacher</p><p className="mt-1">Date: ______________</p></div>
          <div className="border-t border-slate-400 pt-2"><p>School seal</p><p className="mt-1">Admission no: {student.admissionNumber}</p></div>
        </div>
      </div>
    </div>
  );
}
