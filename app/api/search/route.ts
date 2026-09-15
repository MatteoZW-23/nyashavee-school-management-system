import { z } from "zod";
import { getDb } from "@/db";
import { getSchoolContext } from "@/lib/request-context";
import { hasPermission } from "@/lib/permissions";

// Global school-scoped search. Every bucket is gated by the same
// permission that guards its owning module — search never widens access.
export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    const q = z.string().trim().min(2).max(80).parse(new URL(request.url).searchParams.get("q"));
    const db = getDb();
    const like = { contains: q, mode: "insensitive" as const };

    const [students, guardians, staff, invoices, payments] = await Promise.all([
      hasPermission(context.role, "students.view")
        ? db.student.findMany({
            where: { schoolId: context.schoolId, archivedAt: null, OR: [{ firstName: like }, { lastName: like }, { admissionNumber: like }] },
            select: { id: true, firstName: true, lastName: true, admissionNumber: true, status: true, classroom: { select: { name: true } } },
            take: 8,
          })
        : [],
      hasPermission(context.role, "guardians.view")
        ? db.guardian.findMany({
            where: { schoolId: context.schoolId, OR: [{ firstName: like }, { lastName: like }, { phone: like }, { email: like }] },
            select: { id: true, firstName: true, lastName: true, phone: true },
            take: 8,
          })
        : [],
      hasPermission(context.role, "staff.view")
        ? db.staffProfile.findMany({
            where: { schoolId: context.schoolId, OR: [{ firstName: like }, { lastName: like }, { employeeNumber: like }] },
            select: { id: true, firstName: true, lastName: true, employeeNumber: true, position: true, status: true },
            take: 8,
          })
        : [],
      hasPermission(context.role, "finance.view")
        ? db.feeInvoice.findMany({
            where: { schoolId: context.schoolId, invoiceNumber: like },
            select: { id: true, invoiceNumber: true, state: true, currency: true, totalMinor: true, student: { select: { firstName: true, lastName: true } } },
            take: 8,
          })
        : [],
      hasPermission(context.role, "finance.view")
        ? db.payment.findMany({
            where: { schoolId: context.schoolId, OR: [{ receiptNumber: like }, { payerNameSnapshot: like }] },
            select: { id: true, receiptNumber: true, payerNameSnapshot: true, currency: true, amountMinor: true },
            take: 8,
          })
        : [],
    ]);

    return Response.json({
      students: students.map((s) => ({ id: s.id, label: `${s.firstName} ${s.lastName}`, detail: `${s.admissionNumber} · ${s.classroom?.name ?? "Unassigned"}`, module: "students" })),
      guardians: guardians.map((g) => ({ id: g.id, label: `${g.firstName} ${g.lastName}`, detail: g.phone, module: "guardians" })),
      staff: staff.map((s) => ({ id: s.id, label: `${s.firstName} ${s.lastName}`, detail: `${s.position} · ${s.status}`, module: "staff" })),
      invoices: invoices.map((i) => ({ id: i.id, label: i.invoiceNumber, detail: `${i.student.firstName} ${i.student.lastName} · ${i.state}`, module: "finance" })),
      payments: payments.map((p) => ({ id: p.id, label: p.receiptNumber, detail: p.payerNameSnapshot ?? "", module: "finance" })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof z.ZodError) return Response.json({ error: "Type at least 2 characters." }, { status: 400 });
    return Response.json({ error: "Search failed." }, { status: 500 });
  }
}
