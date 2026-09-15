import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { hasPermission } from "@/lib/permissions";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

export default async function SeatingPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) notFound();

  const db = getDb();
  const membership = await db.schoolMembership.findFirst({
    where: { userId, active: true, user: { active: true } },
    include: { school: true },
  });
  if (!membership || !hasPermission(membership.role, "academics.manage")) notFound();

  const exam = await db.examSession.findFirst({
    where: { id, schoolId: membership.schoolId },
    include: {
      term: { select: { name: true } },
      classroom: { select: { name: true } },
      subject: { select: { name: true } },
      invigilator: { select: { displayName: true } },
      seats: {
        include: { student: { select: { firstName: true, lastName: true, admissionNumber: true } } },
        orderBy: { seatNumber: "asc" },
      },
    },
  });
  if (!exam) notFound();

  return (
    <div className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0">
      <div className="absolute right-6 top-6 print:hidden"><PrintButton /></div>
      <div className="mx-auto w-full max-w-3xl bg-white p-10 shadow print:shadow-none">
        <div className="border-b-2 border-slate-800 pb-4 text-center">
          <h1 className="font-serif text-2xl font-bold text-slate-900">{membership.school.name}</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.25em] text-slate-500">Examination seating plan</p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs uppercase text-slate-500">Examination</p><p className="font-semibold">{exam.title}{exam.subject ? ` — ${exam.subject.name}` : ""}</p></div>
          <div><p className="text-xs uppercase text-slate-500">Class</p><p className="font-semibold">{exam.classroom.name}</p></div>
          <div><p className="text-xs uppercase text-slate-500">Date & time</p><p className="font-semibold">{exam.examDate.toISOString().slice(0, 10)} · {exam.startTime}–{exam.endTime}</p></div>
          <div><p className="text-xs uppercase text-slate-500">Venue / Invigilator</p><p className="font-semibold">{exam.venue ?? "TBC"}{exam.invigilator ? ` · ${exam.invigilator.displayName}` : ""}</p></div>
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-700 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2">Seat</th><th className="py-2">Learner</th><th className="py-2">Admission no.</th><th className="py-2 text-right">Signature</th>
            </tr>
          </thead>
          <tbody>
            {exam.seats.map((seat) => (
              <tr key={seat.id} className="border-b border-slate-200">
                <td className="py-2 font-mono font-semibold">{seat.seatNumber}</td>
                <td className="py-2">{seat.student.firstName} {seat.student.lastName}</td>
                <td className="py-2 font-mono text-xs text-slate-600">{seat.student.admissionNumber}</td>
                <td className="py-2"><div className="ml-auto h-5 w-28 border-b border-slate-300" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!exam.seats.length && <p className="mt-6 text-center text-sm text-slate-500">No seating generated yet.</p>}
      </div>
    </div>
  );
}
