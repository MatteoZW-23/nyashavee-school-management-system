import { z } from "zod";
import { getDb } from "@/db";
import { getSchoolContext, requirePermission } from "@/lib/request-context";

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// Downloadable fee statement for a parent's own child — CSV so it opens in
// Excel/Calc and can be printed at the school office.
export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    if (context.role !== "parent") {
      return new Response("Statements are available to parent portal accounts.", { status: 403 });
    }
    requirePermission(context, "portal.parent");
    const db = getDb();
    const studentId = z.string().min(1).max(64).parse(new URL(request.url).searchParams.get("studentId"));

    const student = await db.student.findFirst({
      where: { id: studentId, schoolId: context.schoolId, studentGuardians: { some: { guardian: { schoolId: context.schoolId, portalUserId: context.userId } } } },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true },
    });
    if (!student) return Response.json({ error: "Learner not linked to your account." }, { status: 404 });

    const [invoices, payments] = await Promise.all([
      db.feeInvoice.findMany({
        where: { schoolId: context.schoolId, studentId, financeReversals: { none: {} } },
        select: { invoiceNumber: true, issueDate: true, dueDate: true, currency: true, totalMinor: true, state: true },
        orderBy: { issueDate: "asc" },
      }),
      db.payment.findMany({
        where: { schoolId: context.schoolId, studentId, financeReversals: { none: {} } },
        select: { receiptNumber: true, paymentDate: true, currency: true, amountMinor: true, method: true },
        orderBy: { paymentDate: "asc" },
      }),
    ]);

    const rows = [
      ["Type", "Reference", "Date", "Currency", "Amount", "Method/Status"],
      ...invoices.map((invoice) => [
        "INVOICE",
        invoice.invoiceNumber,
        invoice.issueDate.toISOString().slice(0, 10),
        invoice.currency,
        (invoice.totalMinor / 100).toFixed(2),
        invoice.state,
      ]),
      ...payments.map((payment) => [
        "PAYMENT",
        payment.receiptNumber,
        payment.paymentDate.toISOString().slice(0, 10),
        payment.currency,
        `-${(payment.amountMinor / 100).toFixed(2)}`,
        payment.method,
      ]),
    ];
    for (const currency of ["USD", "ZWG"]) {
      const invoiced = invoices.filter((i) => i.currency === currency && i.state === "issued").reduce((s, i) => s + i.totalMinor, 0);
      const paid = payments.filter((p) => p.currency === currency).reduce((s, p) => s + p.amountMinor, 0);
      rows.push(["BALANCE", "", "", currency, ((invoiced - paid) / 100).toFixed(2), "outstanding"]);
    }

    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const name = `statement-${student.admissionNumber}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof z.ZodError) return Response.json({ error: "Missing or invalid learner." }, { status: 400 });
    return Response.json({ error: "The statement could not be generated." }, { status: 500 });
  }
}
