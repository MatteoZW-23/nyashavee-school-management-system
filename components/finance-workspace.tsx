"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { isQueuedResponse, OFFLINE_QUEUED_MESSAGE } from "@/lib/api-client";
import { Banknote, BookOpen, Check, X, CircleDollarSign, FileText, HandCoins, Layers, Plus, Printer, ReceiptText, RefreshCw, RotateCcw, TrendingDown, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Currency = "USD" | "ZWG";
type FinanceData = {
  summary: Record<Currency, { invoicedMinor: number; paidMinor: number; outstandingMinor: number; unappliedMinor: number; overdueMinor: number }>;
  invoices: Array<{ id: string; invoiceNumber: string; studentId: string; admissionNumber: string; studentName: string; issueDate: string; dueDate: string; currency: Currency; totalMinor: number; paidMinor: number; outstandingMinor: number; notes: string | null; status: string }>;
  payments: Array<{ id: string; receiptNumber: string; studentId: string; admissionNumber: string; studentName: string; paymentDate: string; method: string; currency: Currency; amountMinor: number; allocatedMinor: number; unappliedMinor: number; reference: string | null; payerName: string; status: string; reversalReason: string | null; invoiceNumbers: string | null }>;
  students: Array<{ id: string; admissionNumber: string; firstName: string; lastName: string; guardianName: string | null }>;
  terms: Array<{ id: string; name: string; academicYear: string }>;
  templates: Array<{ id: string; name: string; description: string | null; currency: Currency; gradeName: string | null; items: { description: string; category: string; quantity: number; unitAmount: string; unitAmountMinor: number }[]; totalMinor: number }>;
  classes: Array<{ id: string; name: string; academicYear: string | null; gradeName: string | null; enrolled: number }>;
  receipt: null | { id: string; receiptNumber: string; paymentDate: string; currency: Currency; amountMinor: number; method: string; reference: string | null; payerName: string; studentName: string; admissionNumber: string; issuerName: string; recordedAt: string; reversalNumber: string | null; reversalReason: string | null; reversalDate: string | null; exchangeRate: number | null };
  projects: Array<{ id: string; name: string; description: string | null; active: boolean; totals: Record<string, number>; budgets: Array<{ id: string; label: string; amountMinor: number; currency: string }>; stockItems: Array<{ id: string; name: string; unit: string; onHand: number }> }>;
  stockMovements: Array<{ id: string; kind: string; quantity: number; note: string | null; occurredOn: string; ledgerEntryId: string | null; itemName: string; unit: string; projectName: string; supplierName: string | null; invoiceRef: string | null }>;
  suppliers: Array<{ id: string; name: string; contact: string | null; phone: string | null; email: string | null }>;
  ledger: Array<{ id: string; kind: string; counterpart: string | null; description: string; amountMinor: number; currency: Currency; occurredOn: string; reference: string | null; reversed: boolean; projectName: string | null }>;
  proofs: Array<{ id: string; studentId: string; amountMinor: number; currency: Currency; method: string; reference: string | null; note: string | null; filename: string; status: string; reviewNote: string | null; createdAt: string; studentName: string; admissionNumber: string; guardianName: string; receiptNumber: string | null }>;
  ledgerTotals: Record<string, number>;
  school: { name: string; code: string; exchangeRateZwgPerUsd?: string | null };
  permissions: { createInvoice: boolean; recordPayment: boolean; allocatePayment: boolean; reverseFinance: boolean; reports: boolean; ledger: boolean };
};

type DialogMode = "invoice" | "payment" | "receipt" | "reverse" | "bulk" | "project" | "ledger" | "stock_item" | "stock_move" | "supplier" | "budget" | "proof_reject" | null;
type InvoiceLine = { description: string; category: string; quantity: string; unitAmount: string };

const today = new Date().toISOString().slice(0, 10);
const dueDefault = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

function moneyLabel(minor: number, currency: Currency) {
  const prefix = currency === "ZWG" ? "ZiG" : "US$";
  return `${prefix} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusBadge(status: string) {
  const style = status === "paid" || status === "posted" ? "border-[#b9d9ca] bg-[#e8f4ee] text-[#23634e]" : status === "overdue" || status === "reversed" ? "border-[#e7c6b9] bg-[#fff0e9] text-[#a04e31]" : "border-[#e3d3ab] bg-[#fbf4df] text-[#7b5d18]";
  return <Badge variant="outline" className={`capitalize ${style}`}>{status.replaceAll("_", " ")}</Badge>;
}

function SummaryCard({ label, value, icon: Icon, note }: { label: string; value: string; icon: typeof Banknote; note: string }) {
  return <Card className="gap-3 border-[#dce5e0] bg-white py-5 shadow-none"><CardContent className="flex items-start justify-between px-5"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#77857e]">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-[#173329]">{value}</p><p className="mt-1 text-xs text-[#7a8781]">{note}</p></div><span className="grid size-10 place-items-center rounded-xl bg-[#e8f1ed] text-[#2c6a56]"><Icon className="size-5" /></span></CardContent></Card>;
}

export function FinanceWorkspace() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<FinanceData["receipt"]>(null);
  const [reverseTarget, setReverseTarget] = useState<{ type: "invoice" | "payment"; id: string; label: string } | null>(null);
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([{ description: "Tuition fees", category: "tuition", quantity: "1", unitAmount: "" }]);
  const [bulkLines, setBulkLines] = useState<InvoiceLine[]>([{ description: "Tuition fees", category: "tuition", quantity: "1", unitAmount: "" }]);
  const [bulkTemplateId, setBulkTemplateId] = useState("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [payStudentId, setPayStudentId] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [payInvoiceId, setPayInvoiceId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [tendered, setTendered] = useState("");

  function resetPayment() {
    setPayStudentId("");
    setStudentQuery("");
    setPayInvoiceId("");
    setPayAmount("");
    setTendered("");
    setProofForPay(null);
    setPayPrefill(null);
  }

  const load = useCallback(async (params = "") => {
    setError("");
    try {
      const response = await fetch(`/api/finance${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Finance records could not be loaded.");
      setData(result);
      if (result.receipt) setReceipt(result.receipt);
      return result as FinanceData;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Finance records could not be loaded.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const invoices = useMemo(() => data?.invoices.filter((item) => item.currency === currency) ?? [], [data, currency]);
  const payments = useMemo(() => data?.payments.filter((item) => item.currency === currency) ?? [], [data, currency]);
  const openInvoices = useMemo(() => invoices.filter((item) => item.outstandingMinor > 0 && item.status !== "reversed"), [invoices]);
  const proofRows = data?.proofs ?? [];
  const pendingProofs = proofRows.filter((item) => item.status === "pending");
  const payStudent = data?.students.find((student) => student.id === payStudentId) ?? null;
  const payGuardianName = payStudent?.guardianName ?? "";
  const learnerInvoices = useMemo(() => openInvoices.filter((item) => item.studentId === payStudentId), [openInvoices, payStudentId]);
  const filteredStudents = useMemo(() => {
    const all = data?.students ?? [];
    const query = studentQuery.trim().toLowerCase();
    if (!query) return all;
    return all.filter((student) => `${student.firstName} ${student.lastName} ${student.admissionNumber}`.toLowerCase().includes(query));
  }, [data, studentQuery]);
  const payAmountMinor = Math.round((Number(payAmount) || 0) * 100);
  const tenderedMinor = Math.round((Number(tendered) || 0) * 100);
  const changeDueMinor = tendered && tenderedMinor > payAmountMinor ? tenderedMinor - payAmountMinor : 0;
  const summary = data?.summary[currency] ?? { invoicedMinor: 0, paidMinor: 0, outstandingMinor: 0, unappliedMinor: 0, overdueMinor: 0 };

  async function post(payload: object, success: string) {
    setSubmitting(true);
    try {
      const response = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (isQueuedResponse(result)) { toast.info(OFFLINE_QUEUED_MESSAGE); return result; }
      if (!response.ok) throw new Error(result.error || "The finance record could not be saved.");
      toast.success(success);
      setDialog(null);
      setReverseTarget(null);
      await load();
      return result;
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The finance record could not be saved.");
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function submitInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await post({ action: "create_invoice", studentId: values.get("studentId"), termId: values.get("termId") || undefined, issueDate: values.get("issueDate"), dueDate: values.get("dueDate"), currency, notes: values.get("notes") || undefined, items: invoiceLines.map((line) => ({ description: line.description, category: line.category, quantity: Number(line.quantity), unitAmount: line.unitAmount })) }, "Invoice issued.");
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (!payStudentId) {
      toast.error("Choose the learner first — type their name or admission number above.");
      return;
    }
    const invoiceId = payInvoiceId;
    const result = await post({ action: "record_payment", studentId: payStudentId, currency, paymentDate: values.get("paymentDate"), amount: payAmount, method: values.get("method"), reference: values.get("reference") || undefined, payerName: values.get("payerName"), exchangeRate: values.get("exchangeRate") || undefined, allocations: invoiceId ? [{ invoiceId, amount: String(values.get("allocAmount") || payAmount) }] : [] }, "Payment recorded and receipt created.");
    if (result?.payment?.id) {
      const linkedProof = proofForPay;
      resetPayment();
      await showReceipt(result.payment.id);
      if (linkedProof) {
        await post({ action: "review_proof", proofId: linkedProof.id, decision: "verified", paymentId: result.payment.id }, "Proof verified — the guardian has been notified.");
      }
    }
  }

  const [proofForPay, setProofForPay] = useState<FinanceData["proofs"][number] | null>(null);
  const [proofReject, setProofReject] = useState<FinanceData["proofs"][number] | null>(null);
  const [payPrefill, setPayPrefill] = useState<{ method: string; reference: string; payer: string } | null>(null);

  function verifyAndRecord(proof: FinanceData["proofs"][number]) {
    setProofForPay(proof);
    setPayStudentId(proof.studentId);
    setStudentQuery("");
    setPayInvoiceId("");
    setPayAmount((proof.amountMinor / 100).toFixed(2));
    setPayPrefill({ method: proof.method, reference: proof.reference ?? "", payer: proof.guardianName });
    setDialog("payment");
  }

  async function submitProofReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "");
    if (!proofReject) return;
    await post({ action: "review_proof", proofId: proofReject.id, decision: "rejected", note: note || undefined }, "Proof rejected — the guardian has been notified.");
    setProofReject(null);
  }

  async function submitBulk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const items = bulkLines
      .filter((line) => line.description.trim() && line.unitAmount.trim())
      .map((line) => ({ description: line.description, category: line.category, quantity: Number(line.quantity), unitAmount: line.unitAmount }));
    if (!items.length) {
      toast.error("Add at least one invoice item.");
      return;
    }
    if (saveAsTemplate) {
      const templateName = String(values.get("templateName") || "").trim();
      if (templateName.length < 2) {
        toast.error("Enter a template name to save these items.");
        return;
      }
      const saved = await post(
        { action: "save_fee_template", name: templateName, description: values.get("templateDescription") || undefined, currency, items },
        "Fee template saved.",
      );
      if (!saved) return;
    }
    const result = await post(
      {
        action: "issue_class_invoices",
        classroomId: values.get("classroomId"),
        termId: values.get("termId") || undefined,
        issueDate: values.get("issueDate"),
        dueDate: values.get("dueDate"),
        currency,
        notes: values.get("notes") || undefined,
        items,
      },
      "Class invoices issued.",
    );
    if (result) {
      setBulkLines([{ description: "Tuition fees", category: "tuition", quantity: "1", unitAmount: "" }]);
      setBulkTemplateId("");
      setSaveAsTemplate(false);
      if (result.skipped) toast.info(`${result.skipped} learner${result.skipped === 1 ? "" : "s"} already had an invoice for that term — skipped.`);
    }
  }

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await post({ action: "create_project", name: values.get("name"), description: values.get("description") || undefined }, "Project created.");
  }

  async function submitLedger(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await post({ action: "record_ledger", kind: values.get("kind"), projectId: values.get("projectId") || undefined, counterpart: values.get("counterpart") || undefined, description: values.get("description"), amount: values.get("amount"), currency, occurredOn: values.get("occurredOn"), reference: values.get("reference") || undefined }, "Entry recorded.");
  }

  async function submitReverseLedger(ledgerId: string) {
    const reason = window.prompt("Why is this entry being reversed?");
    if (!reason || reason.trim().length < 5) return;
    await post({ action: "reverse_ledger", ledgerId, reason: reason.trim() }, "Entry reversed.");
  }

  async function submitStockItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await post({ action: "create_stock_item", projectId: values.get("projectId"), name: values.get("name"), unit: values.get("unit") || "units", openingQty: Number(values.get("openingQty") || 0) }, "Stock item created.");
  }

  async function submitStockMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const kind = String(values.get("kind"));
    await post({
      action: "record_stock_movement",
      itemId: values.get("itemId"),
      kind,
      direction: kind === "adjustment" ? values.get("direction") || "out" : undefined,
      quantity: Number(values.get("quantity")),
      amount: values.get("amount") || undefined,
      currency,
      occurredOn: values.get("occurredOn"),
      note: values.get("note") || undefined,
      supplierId: kind === "purchase" ? values.get("supplierId") || undefined : undefined,
      invoiceRef: kind === "purchase" ? values.get("invoiceRef") || undefined : undefined,
    }, "Stock movement recorded.");
  }

  async function submitSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await post({ action: "create_supplier", name: values.get("name"), contact: values.get("contact") || undefined, phone: values.get("phone") || undefined, email: values.get("email") || undefined, notes: values.get("notes") || undefined }, "Supplier saved.");
  }

  async function submitBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await post({ action: "set_project_budget", projectId: values.get("projectId"), label: values.get("label"), amount: values.get("amount"), currency }, "Budget saved.");
  }

  function applyTemplate(id: string) {
    setBulkTemplateId(id);
    const template = data?.templates.find((item) => item.id === id);
    if (!template) return;
    setBulkLines(template.items.map((item) => ({ description: item.description, category: item.category, quantity: String(item.quantity), unitAmount: item.unitAmount })));
  }

  async function submitReversal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reverseTarget) return;
    const values = new FormData(event.currentTarget);
    await post({ action: "reverse_finance", targetType: reverseTarget.type, targetId: reverseTarget.id, reason: values.get("reason") }, "Reversal recorded without deleting history.");
  }

  async function showReceipt(id: string) {
    const result = await load(`?receiptId=${encodeURIComponent(id)}`);
    if (result?.receipt) setDialog("receipt");
  }

  if (loading && !data) return <div className="space-y-4">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-28 w-full rounded-xl" />)}</div>;
  if (error && !data) return <div className="rounded-xl border border-[#ead6cd] bg-white p-8 text-center"><p className="text-sm text-[#9a4e35]">{error}</p><Button variant="outline" className="mt-4" onClick={() => void load()}><RefreshCw /> Try again</Button></div>;
  if (!data) return null;

  return <div className="space-y-6">
    <section className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
      <div><div className="flex items-center gap-2"><Badge className="border border-[#b9d7c9] bg-[#e8f3ed] text-[#24604d] hover:bg-[#e8f3ed]">Double-entry safe records</Badge><span className="text-xs text-[#78867f]">Fees & collections</span></div><h1 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-[#173329] sm:text-4xl">Finance</h1><p className="mt-2 max-w-2xl text-sm text-[#68776f]">Issue fee invoices, record collections, print receipts and monitor debtors without mixing currencies.</p></div>
      <div className="flex flex-wrap gap-2">{data.permissions.createInvoice && <Button variant="outline" onClick={() => setDialog("invoice")}><FileText /> Issue invoice</Button>}{data.permissions.createInvoice && <Button variant="outline" onClick={() => setDialog("bulk")}><Layers /> Invoice a class</Button>}{data.permissions.recordPayment && <Button className="bg-[#173f35] hover:bg-[#245e4e]" onClick={() => setDialog("payment")}><Plus /> Record payment</Button>}</div>
    </section>

    <div className="inline-flex rounded-xl border border-[#d9e2dd] bg-white p-1" aria-label="Currency">
      {(["USD", "ZWG"] as Currency[]).map((code) => <button key={code} type="button" onClick={() => setCurrency(code)} className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${currency === code ? "bg-[#173f35] text-white shadow-sm" : "text-[#627169] hover:bg-[#edf3f0]"}`}>{code === "ZWG" ? "ZiG (ZWG)" : "US dollars"}</button>)}
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryCard label="Invoiced" value={moneyLabel(summary.invoicedMinor, currency)} note="Issued fee documents" icon={FileText} />
      <SummaryCard label="Collected" value={moneyLabel(summary.paidMinor, currency)} note="Active receipts" icon={Banknote} />
      <SummaryCard label="Outstanding" value={moneyLabel(summary.outstandingMinor, currency)} note="Across open invoices" icon={WalletCards} />
      <SummaryCard label="Unapplied" value={moneyLabel(summary.unappliedMinor, currency)} note="Available learner credit" icon={CircleDollarSign} />
      <SummaryCard label="Overdue" value={moneyLabel(summary.overdueMinor, currency)} note="Past due date" icon={TrendingDown} />
    </div>

    <Tabs defaultValue="invoices" className="gap-5">
      <TabsList className="h-auto rounded-xl border border-[#dae3de] bg-white p-1"><TabsTrigger value="invoices" className="px-5 py-2">Invoices</TabsTrigger><TabsTrigger value="payments" className="px-5 py-2">Payments</TabsTrigger><TabsTrigger value="proofs" className="px-5 py-2">Proofs{pendingProofs.length ? ` (${pendingProofs.length})` : ""}</TabsTrigger><TabsTrigger value="debtors" className="px-5 py-2">Debtors</TabsTrigger><TabsTrigger value="giving" className="px-5 py-2">Projects & giving</TabsTrigger></TabsList>
      <TabsContent value="invoices"><Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><CardHeader className="border-b border-[#e4eae7] px-5 py-4"><CardTitle className="text-base">Invoice register</CardTitle><CardDescription>{invoices.length} {currency === "ZWG" ? "ZiG" : "USD"} invoice{invoices.length === 1 ? "" : "s"}</CardDescription></CardHeader>{invoices.length ? <Table><TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Invoice</TableHead><TableHead>Learner</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="pr-5 text-right">Action</TableHead></TableRow></TableHeader><TableBody>{invoices.map((item) => <TableRow key={item.id}><TableCell className="py-4 pl-5"><p className="font-mono text-xs font-semibold">{item.invoiceNumber}</p><p className="mt-1 text-xs text-[#78857e]">{item.issueDate}</p></TableCell><TableCell><p className="font-semibold">{item.studentName}</p><p className="text-xs text-[#78857e]">{item.admissionNumber}</p></TableCell><TableCell>{item.dueDate}</TableCell><TableCell>{statusBadge(item.status)}</TableCell><TableCell className="text-right font-semibold">{moneyLabel(item.outstandingMinor, currency)}</TableCell><TableCell className="pr-5 text-right">{data.permissions.reverseFinance && item.status !== "reversed" && item.paidMinor === 0 ? <Button variant="ghost" size="sm" onClick={() => { setReverseTarget({ type: "invoice", id: item.id, label: item.invoiceNumber }); setDialog("reverse"); }}><RotateCcw /> Reverse</Button> : <span className="text-xs text-[#8a958f]">—</span>}</TableCell></TableRow>)}</TableBody></Table> : <Empty icon={FileText} title="No invoices in this currency" text="Issue a learner fee invoice to begin the ledger." />}</Card></TabsContent>
      <TabsContent value="payments"><Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><CardHeader className="border-b border-[#e4eae7] px-5 py-4"><CardTitle className="text-base">Payment register</CardTitle><CardDescription>Immutable receipt history and allocations</CardDescription></CardHeader>{payments.length ? <Table><TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Receipt</TableHead><TableHead>Learner</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="pr-5 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{payments.map((item) => <TableRow key={item.id}><TableCell className="py-4 pl-5"><p className="font-mono text-xs font-semibold">{item.receiptNumber}</p><p className="mt-1 text-xs text-[#78857e]">{item.paymentDate}</p></TableCell><TableCell><p className="font-semibold">{item.studentName}</p><p className="text-xs text-[#78857e]">{item.invoiceNumbers || `${moneyLabel(item.unappliedMinor, currency)} unapplied`}</p></TableCell><TableCell className="capitalize">{item.method.replaceAll("_", " ")}</TableCell><TableCell>{statusBadge(item.status)}</TableCell><TableCell className="text-right font-semibold">{moneyLabel(item.amountMinor, currency)}</TableCell><TableCell className="pr-5 text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => void showReceipt(item.id)}><ReceiptText /> Receipt</Button>{data.permissions.reverseFinance && item.status !== "reversed" && <Button variant="ghost" size="sm" onClick={() => { setReverseTarget({ type: "payment", id: item.id, label: item.receiptNumber }); setDialog("reverse"); }}><RotateCcw /></Button>}</div></TableCell></TableRow>)}</TableBody></Table> : <Empty icon={ReceiptText} title="No payments in this currency" text="Record a payment to create the first permanent receipt." />}</Card></TabsContent>
      <TabsContent value="proofs"><Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><CardHeader className="border-b border-[#e4eae7] px-5 py-4"><CardTitle className="text-base">Parent proof-of-payment queue</CardTitle><CardDescription>Uploaded receipts awaiting verification — open the file, confirm the money arrived, then record the payment.</CardDescription></CardHeader>{proofRows.length ? <Table><TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Learner</TableHead><TableHead>Guardian</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead>Submitted</TableHead><TableHead>Status</TableHead><TableHead className="pr-5 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{proofRows.map((proof) => <TableRow key={proof.id} className={proof.status === "pending" ? "" : "opacity-60"}><TableCell className="py-3 pl-5"><p className="font-semibold">{proof.studentName}</p><p className="text-xs text-[#78857e]">{proof.admissionNumber}</p></TableCell><TableCell className="text-sm">{proof.guardianName}</TableCell><TableCell className="font-semibold">{moneyLabel(proof.amountMinor, proof.currency)}</TableCell><TableCell className="capitalize text-sm">{proof.method.replaceAll("_", " ")}</TableCell><TableCell className="font-mono text-xs">{proof.reference ?? "—"}</TableCell><TableCell className="text-xs text-[#67766e]">{String(proof.createdAt).slice(0, 10)}</TableCell><TableCell>{statusBadge(proof.status)}</TableCell><TableCell className="pr-5 text-right"><div className="flex justify-end gap-1"><a href={`/api/finance?proof=${encodeURIComponent(proof.id)}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-[#28624f] hover:bg-[#eef3f0]"><FileText className="size-3.5" /> View</a>{proof.status === "pending" && <><Button variant="ghost" size="sm" onClick={() => verifyAndRecord(proof)}><Check /> Verify</Button><Button variant="ghost" size="sm" className="text-[#984e34]" onClick={() => { setProofReject(proof); setDialog("proof_reject"); }}><X /></Button></>}{proof.receiptNumber && <span className="text-xs text-[#78857e]">{proof.receiptNumber}</span>}</div></TableCell></TableRow>)}</TableBody></Table> : <Empty icon={FileText} title="No proofs submitted" text="When parents upload proof of payment from the portal it appears here for review." />}</Card></TabsContent>
      <TabsContent value="debtors"><Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><CardHeader className="border-b border-[#e4eae7] px-5 py-4"><div className="flex items-center justify-between"><div><CardTitle className="text-base">Debtors</CardTitle><CardDescription>Outstanding learner invoices, kept separate by currency</CardDescription></div>{data.permissions.createInvoice && openInvoices.length > 0 && <Button size="sm" variant="outline" disabled={submitting} onClick={() => void post({ action: "remind_debtors" }, "Reminders sent to guardians.")}>Remind all debtors</Button>}</div></CardHeader>{openInvoices.length ? <Table><TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Learner</TableHead><TableHead>Invoice</TableHead><TableHead>Due date</TableHead><TableHead className="pr-5 text-right">Outstanding</TableHead></TableRow></TableHeader><TableBody>{openInvoices.map((item) => <TableRow key={item.id}><TableCell className="py-4 pl-5"><p className="font-semibold">{item.studentName}</p><p className="text-xs text-[#78857e]">{item.admissionNumber}</p></TableCell><TableCell className="font-mono text-xs">{item.invoiceNumber}</TableCell><TableCell>{item.dueDate}</TableCell><TableCell className="pr-5 text-right font-semibold text-[#9b4c31]">{moneyLabel(item.outstandingMinor, currency)}</TableCell></TableRow>)}</TableBody></Table> : <Empty icon={WalletCards} title="No outstanding invoices" text={`There are no ${currency === "ZWG" ? "ZiG" : "USD"} debtor balances.`} />}</Card></TabsContent>
      <TabsContent value="giving" className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {([["income", "Project income"], ["expense", "Project costs"], ["donation_in", "Donations received"], ["donation_out", "Donations given"]] as const).map(([kind, label]) => (
            <Card key={kind} className="gap-1 border-[#dce5e0] bg-white py-4 shadow-none"><CardContent className="px-5"><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#77857e]">{label}</p><p className="mt-1 text-xl font-semibold text-[#173329]">{moneyLabel(data.ledgerTotals[`${kind}:${currency}`] ?? 0, currency)}</p></CardContent></Card>
          ))}
        </div>
        <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><CardHeader className="flex-row items-center justify-between border-b border-[#e4eae7] px-5 py-4"><div><CardTitle className="text-base">Income-generating projects</CardTitle><CardDescription>Garden, poultry, uniform sales — tracked against their own books</CardDescription></div>{data.permissions.ledger && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setDialog("project")} className="border-[#c8d8cf]"><Plus /> New project</Button><Button size="sm" variant="outline" onClick={() => setDialog("supplier")} className="border-[#c8d8cf]"><Plus /> Supplier</Button><Button size="sm" variant="outline" onClick={() => setDialog("budget")} className="border-[#c8d8cf]" disabled={!data.projects.length}><Plus /> Set budget</Button></div>}</CardHeader>{data.projects.length ? <Table><TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Project</TableHead><TableHead className="text-right">Income</TableHead><TableHead className="text-right">Costs</TableHead><TableHead className="text-right">Budget</TableHead><TableHead className="pr-5 text-right">Net</TableHead></TableRow></TableHeader><TableBody>{data.projects.map((project) => { const inc = project.totals[`income:${currency}`] ?? 0; const exp = project.totals[`expense:${currency}`] ?? 0; return <TableRow key={project.id}><TableCell className="py-4 pl-5"><p className="font-semibold">{project.name}</p>{project.description && <p className="mt-1 text-xs text-[#78857e]">{project.description}</p>}</TableCell><TableCell className="text-right">{moneyLabel(inc, currency)}</TableCell><TableCell className="text-right text-[#9b4c31]">{moneyLabel(exp, currency)}</TableCell><TableCell className="text-right">{(() => { const budget = (project.budgets ?? []).find((b) => b.currency === currency); return budget ? <div><p className="text-xs font-semibold">{moneyLabel(budget.amountMinor, currency)}</p><p className="text-[10px] text-[#78857e]">{budget.label} · {budget.amountMinor > 0 ? Math.round((exp / budget.amountMinor) * 100) : 0}% used</p></div> : <span className="text-xs text-[#8a958f]">—</span>; })()}</TableCell><TableCell className="pr-5 text-right font-semibold">{moneyLabel(inc - exp, currency)}</TableCell></TableRow>; })}</TableBody></Table> : <Empty icon={HandCoins} title="No projects yet" text="Create an income-generating project to track it." />}</Card>
        <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><CardHeader className="flex-row items-center justify-between border-b border-[#e4eae7] px-5 py-4"><div><CardTitle className="text-base">Ledger</CardTitle><CardDescription>Non-fee income, project costs and donations — all reversible with an audit trail</CardDescription></div>{data.permissions.ledger && <Button size="sm" onClick={() => setDialog("ledger")} className="bg-[#173f35] hover:bg-[#245e4e]"><Plus /> Record entry</Button>}</CardHeader>{data.ledger.length ? <Table><TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Date</TableHead><TableHead>Type</TableHead><TableHead>Detail</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="pr-5 text-right">Action</TableHead></TableRow></TableHeader><TableBody>{data.ledger.map((entry) => <TableRow key={entry.id}><TableCell className="py-4 pl-5 text-xs text-[#78857e]">{entry.occurredOn}</TableCell><TableCell><Badge variant="outline" className={`capitalize ${entry.kind.startsWith("donation") ? "border-[#d5c7ee] bg-[#f2edfb] text-[#5b4790]" : entry.kind === "income" ? "border-[#b9d9ca] bg-[#e8f4ee] text-[#23634e]" : "border-[#e7c6b9] bg-[#fff0e9] text-[#a04e31]"}`}>{entry.kind.replaceAll("_", " ")}</Badge></TableCell><TableCell><p className="font-semibold">{entry.description}</p><p className="mt-0.5 text-xs text-[#78857e]">{[entry.projectName, entry.counterpart, entry.reference].filter(Boolean).join(" · ")}</p></TableCell><TableCell className={`text-right font-semibold ${entry.reversed ? "line-through opacity-60" : ""}`}>{moneyLabel(entry.amountMinor, entry.currency)}</TableCell><TableCell className="pr-5 text-right">{entry.reversed ? <span className="text-xs text-[#8a958f]">Reversed</span> : data.permissions.reverseFinance ? <Button variant="ghost" size="sm" onClick={() => void submitReverseLedger(entry.id)}><RotateCcw /> Reverse</Button> : null}</TableCell></TableRow>)}</TableBody></Table> : <Empty icon={BookOpen} title="No ledger entries" text="Record a donation, project sale or cost to begin." />}</Card>
        <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><CardHeader className="flex-row items-center justify-between border-b border-[#e4eae7] px-5 py-4"><div><CardTitle className="text-base">Project stock</CardTitle><CardDescription>Birds, feed, produce — what each project holds. Sales and purchases can write the matching ledger entry automatically.</CardDescription></div>{data.permissions.ledger && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setDialog("stock_item")} className="border-[#c8d8cf]"><Plus /> Stock item</Button><Button size="sm" onClick={() => setDialog("stock_move")} className="bg-[#173f35] hover:bg-[#245e4e]" disabled={!data.projects.some((p) => p.stockItems.length)}><Plus /> Record movement</Button></div>}</CardHeader>{data.projects.some((p) => p.stockItems.length) ? <Table><TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Item</TableHead><TableHead>Project</TableHead><TableHead className="pr-5 text-right">On hand</TableHead></TableRow></TableHeader><TableBody>{data.projects.flatMap((p) => p.stockItems.map((item) => <TableRow key={item.id}><TableCell className="py-4 pl-5"><p className="font-semibold">{item.name}</p><p className="mt-0.5 text-xs text-[#78857e]">measured in {item.unit}</p></TableCell><TableCell>{p.name}</TableCell><TableCell className="pr-5 text-right"><span className={`font-semibold ${item.onHand <= 0 ? "text-[#9b4c31]" : ""}`}>{item.onHand} {item.unit}</span></TableCell></TableRow>))}</TableBody></Table> : <Empty icon={HandCoins} title="No stock tracked" text="Add a stock item to a project — e.g. Broiler birds, Feed (bags)." />}</Card>
        {data.stockMovements.length > 0 && <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><CardHeader className="border-b border-[#e4eae7] px-5 py-4"><CardTitle className="text-base">Recent stock movements</CardTitle><CardDescription>Purchases, usage, sales and adjustments</CardDescription></CardHeader><Table><TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Date</TableHead><TableHead>Type</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="pr-5 text-right">Ledger</TableHead></TableRow></TableHeader><TableBody>{data.stockMovements.map((m) => <TableRow key={m.id}><TableCell className="py-3 pl-5 text-xs text-[#78857e]">{m.occurredOn}</TableCell><TableCell><Badge variant="outline" className="capitalize">{m.kind}</Badge></TableCell><TableCell><p className="font-semibold">{m.itemName}</p><p className="text-xs text-[#78857e]">{m.projectName}{m.note ? ` · ${m.note}` : ""}</p></TableCell><TableCell className={`text-right font-semibold ${m.quantity < 0 ? "text-[#9b4c31]" : ""}`}>{m.quantity > 0 ? "+" : ""}{m.quantity} {m.unit}</TableCell><TableCell className="pr-5 text-right text-xs text-[#78857e]">{m.ledgerEntryId ? "Money recorded" : "—"}</TableCell></TableRow>)}</TableBody></Table></Card>}
      </TabsContent>
    </Tabs>

    <Dialog open={dialog === "invoice"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle className="font-serif text-2xl">Issue fee invoice</DialogTitle><DialogDescription>The invoice will be sealed as an immutable {currency === "ZWG" ? "ZiG" : "USD"} document.</DialogDescription></DialogHeader><form onSubmit={submitInvoice} className="space-y-5"><SelectField id="studentId" label="Learner" required options={data.students.map((student) => ({ value: student.id, label: `${student.lastName}, ${student.firstName} · ${student.admissionNumber}` }))} /><div className="grid gap-4 sm:grid-cols-2"><SelectField id="termId" label="Term (optional)" options={data.terms.map((term) => ({ value: term.id, label: `${term.academicYear} · ${term.name}` }))} /><Field id="issueDate" label="Issue date" type="date" required defaultValue={today} /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="dueDate" label="Due date" type="date" required defaultValue={dueDefault} /><Field id="notes" label="Notes (optional)" /></div><div className="space-y-3"><div className="flex items-center justify-between"><Label>Invoice items</Label><Button type="button" size="sm" variant="outline" onClick={() => setInvoiceLines((lines) => [...lines, { description: "", category: "other", quantity: "1", unitAmount: "" }])}><Plus /> Add item</Button></div>{invoiceLines.map((line, index) => <div key={index} className="grid gap-3 rounded-xl border border-[#dce5e0] bg-[#f8faf9] p-3 sm:grid-cols-[1.5fr_1fr_.55fr_.8fr_auto]"><Input aria-label={`Item ${index + 1} description`} required placeholder="Description" value={line.description} onChange={(event) => setInvoiceLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /><select aria-label={`Item ${index + 1} category`} value={line.category} onChange={(event) => setInvoiceLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value } : item))} className="h-9 rounded-md border border-[#d4ded9] bg-white px-2 text-sm"><option value="tuition">Tuition</option><option value="levy">Levy</option><option value="boarding">Boarding</option><option value="transport">Transport</option><option value="examination">Examination</option><option value="registration">Registration</option><option value="sports">Sports</option><option value="uniform">Uniform</option><option value="other">Other</option></select><Input aria-label={`Item ${index + 1} quantity`} required type="number" min="1" max="100" value={line.quantity} onChange={(event) => setInvoiceLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /><Input aria-label={`Item ${index + 1} amount`} required inputMode="decimal" placeholder="0.00" value={line.unitAmount} onChange={(event) => setInvoiceLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, unitAmount: event.target.value } : item))} />{invoiceLines.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setInvoiceLines((lines) => lines.filter((_, itemIndex) => itemIndex !== index))}>×</Button>}</div>)}</div><Button type="submit" disabled={submitting} className="w-full bg-[#173f35] hover:bg-[#245e4e]">{submitting ? "Issuing…" : `Issue ${currency === "ZWG" ? "ZiG" : "USD"} invoice`}</Button></form></DialogContent></Dialog>

    <Dialog open={dialog === "bulk"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle className="font-serif text-2xl">Invoice a class</DialogTitle><DialogDescription>Issue the same {currency === "ZWG" ? "ZiG" : "USD"} invoice to every active learner in a class. Learners who already have an invoice for the chosen term are skipped.</DialogDescription></DialogHeader><form onSubmit={submitBulk} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2"><SelectField id="classroomId" label="Class" required options={data.classes.map((classroom) => ({ value: classroom.id, label: `${classroom.name} · ${classroom.academicYear ?? ""} · ${classroom.enrolled} learners` }))} /><div className="space-y-2"><Label htmlFor="bulkTemplate">Fee template</Label><select id="bulkTemplate" value={bulkTemplateId} onChange={(event) => applyTemplate(event.target.value)} className="h-10 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm"><option value="">Start blank</option>{data.templates.filter((template) => template.currency === currency).map((template) => <option key={template.id} value={template.id}>{template.name} · {moneyLabel(template.totalMinor, currency)}{template.gradeName ? ` · ${template.gradeName}` : ""}</option>)}</select></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><SelectField id="termId" label="Term (optional — prevents duplicates)" options={data.terms.map((term) => ({ value: term.id, label: `${term.academicYear} · ${term.name}` }))} /><Field id="issueDate" label="Issue date" type="date" required defaultValue={today} /></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field id="dueDate" label="Due date" type="date" required defaultValue={dueDefault} /><Field id="notes" label="Notes (optional)" /></div>
      <div className="space-y-3"><div className="flex items-center justify-between"><Label>Invoice items</Label><Button type="button" size="sm" variant="outline" onClick={() => setBulkLines((lines) => [...lines, { description: "", category: "other", quantity: "1", unitAmount: "" }])}><Plus /> Add item</Button></div>{bulkLines.map((line, index) => <div key={index} className="grid gap-3 rounded-xl border border-[#dce5e0] bg-[#f8faf9] p-3 sm:grid-cols-[1.5fr_1fr_.55fr_.8fr_auto]"><Input aria-label={`Item ${index + 1} description`} required placeholder="Description" value={line.description} onChange={(event) => setBulkLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /><select aria-label={`Item ${index + 1} category`} value={line.category} onChange={(event) => setBulkLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value } : item))} className="h-9 rounded-md border border-[#d4ded9] bg-white px-2 text-sm"><option value="tuition">Tuition</option><option value="levy">Levy</option><option value="boarding">Boarding</option><option value="transport">Transport</option><option value="examination">Examination</option><option value="registration">Registration</option><option value="sports">Sports</option><option value="uniform">Uniform</option><option value="other">Other</option></select><Input aria-label={`Item ${index + 1} quantity`} required type="number" min="1" max="100" value={line.quantity} onChange={(event) => setBulkLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /><Input aria-label={`Item ${index + 1} amount`} required inputMode="decimal" placeholder="0.00" value={line.unitAmount} onChange={(event) => setBulkLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, unitAmount: event.target.value } : item))} />{bulkLines.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setBulkLines((lines) => lines.filter((_, itemIndex) => itemIndex !== index))}>×</Button>}</div>)}</div>
      <div className="rounded-xl border border-[#dce5e0] bg-[#f8faf9] p-3"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={saveAsTemplate} onChange={(event) => setSaveAsTemplate(event.target.checked)} className="size-4" /> Save these items as a reusable fee template</label>{saveAsTemplate && <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field id="templateName" label="Template name" required /><Field id="templateDescription" label="Description (optional)" /></div>}</div>
      <Button type="submit" disabled={submitting} className="w-full bg-[#173f35] hover:bg-[#245e4e]">{submitting ? "Issuing…" : `Issue ${currency === "ZWG" ? "ZiG" : "USD"} invoices to class`}</Button></form></DialogContent></Dialog>

    <Dialog open={dialog === "payment"} onOpenChange={(open) => { if (!open) { setDialog(null); resetPayment(); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Record payment</DialogTitle>
          <DialogDescription>Receipt prints immediately after recording — allocation to an invoice is optional.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitPayment} className="space-y-4">
          <input type="hidden" name="studentId" value={payStudentId} />
          <input type="hidden" name="invoiceId" value={payInvoiceId} />

          {/* Learner picker: type to search, click to select */}
          <div className="space-y-2">
            <Label htmlFor="learnerSearch">Learner<span className="text-[#b55736]">*</span></Label>
            {payStudent ? (
              <div className="flex items-center justify-between rounded-lg border border-[#b9d9ca] bg-[#f0f7f3] px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-[#173329]">{payStudent.lastName}, {payStudent.firstName}</p>
                  <p className="text-xs text-[#67766e]">{payStudent.admissionNumber}{payGuardianName ? ` · Guardian: ${payGuardianName}` : ""}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setPayStudentId(""); setPayInvoiceId(""); }}>Change</Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  id="learnerSearch"
                  autoComplete="off"
                  value={studentQuery}
                  onChange={(event) => setStudentQuery(event.target.value)}
                  placeholder="Type the learner's name or admission number…"
                  className="h-10 border-[#d3ddd7] bg-white"
                />
                {studentQuery.trim() && (
                  <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-lg border border-[#d5ded9] bg-white shadow-lg">
                    {filteredStudents.length ? filteredStudents.slice(0, 8).map((student) => (
                      <button key={student.id} type="button" onClick={() => { setPayStudentId(student.id); setStudentQuery(""); setPayInvoiceId(""); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[#f2f7f4]">
                        <span className="font-medium">{student.lastName}, {student.firstName}</span>
                        <span className="text-xs text-[#78857e]">{student.admissionNumber}</span>
                      </button>
                    )) : <p className="px-3 py-3 text-sm text-[#78857e]">No learner matches &ldquo;{studentQuery}&rdquo;.</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Open invoices for the chosen learner */}
          {payStudent && (
            <div className="space-y-2">
              <Label>Allocate to invoice</Label>
              {learnerInvoices.length ? (
                <div className="grid gap-2">
                  {learnerInvoices.map((invoice) => {
                    const selected = payInvoiceId === invoice.id;
                    return (
                      <button key={invoice.id} type="button"
                        onClick={() => { setPayInvoiceId(selected ? "" : invoice.id); if (!selected && !payAmount) setPayAmount((invoice.outstandingMinor / 100).toFixed(2)); }}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition ${selected ? "border-[#2c6a56] bg-[#eaf4ee] ring-1 ring-[#2c6a56]" : "border-[#dce5e0] bg-white hover:border-[#b9cbc3]"}`}>
                        <div>
                          <p className="font-mono text-xs font-semibold">{invoice.invoiceNumber}</p>
                          <p className="text-xs text-[#78857e]">due {invoice.dueDate}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{moneyLabel(invoice.outstandingMinor, invoice.currency)}</p>
                          <p className="text-[10px] uppercase tracking-wide text-[#78857e]">outstanding</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-lg border border-[#dce5e0] bg-[#f8faf9] px-3 py-2.5 text-xs text-[#67766e]">No open {currency === "ZWG" ? "ZiG" : "USD"} invoices — the payment will sit as unapplied credit on this account.</p>
              )}
            </div>
          )}

          {/* Money: amount, tendered, change */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount ({currency === "ZWG" ? "ZiG" : "USD"})<span className="text-[#b55736]">*</span></Label>
              <Input id="amount" required inputMode="decimal" placeholder="0.00" value={payAmount} onChange={(event) => setPayAmount(event.target.value)} className="h-10 border-[#d3ddd7] bg-white text-base font-semibold" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tendered">Cash tendered (optional)</Label>
              <Input id="tendered" inputMode="decimal" placeholder="0.00" value={tendered} onChange={(event) => setTendered(event.target.value)} className="h-10 border-[#d3ddd7] bg-white" />
            </div>
          </div>
          {changeDueMinor > 0 && (
            <p className="rounded-lg border border-[#e3d3ab] bg-[#fbf4df] px-3 py-2 text-sm font-semibold text-[#7b5d18]">Change due: {moneyLabel(changeDueMinor, currency)}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="paymentDate" label="Payment date" type="date" required defaultValue={today} />
            <div className="space-y-2">
              <Label htmlFor="method">Method<span className="text-[#b55736]">*</span></Label>
              <select id="method" name="method" required defaultValue={payPrefill?.method ?? "cash"} key={`method-${payPrefill?.method ?? "cash"}`} className="h-10 w-full rounded-md border border-[#d3ddd7] bg-white px-3 text-sm">
                <option value="cash">Cash</option><option value="ecocash">EcoCash</option><option value="onemoney">OneMoney</option><option value="bank_transfer">Bank transfer</option><option value="pos">POS</option><option value="paynow">Paynow</option><option value="card">Card</option><option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="payerName" label="Payer name" required defaultValue={payPrefill?.payer ?? payGuardianName} key={`payer-${payStudentId}-${payPrefill?.payer ?? ""}`} />
            <Field id="reference" label="Reference (optional)" placeholder="EcoCash code / deposit slip no." defaultValue={payPrefill?.reference ?? ""} key={`ref-${payPrefill?.reference ?? "x"}`} />
          </div>

          {payInvoiceId && learnerInvoices.find((invoice) => invoice.id === payInvoiceId)?.currency !== currency && (() => {
            const prevailing = data.school.exchangeRateZwgPerUsd ? Number(data.school.exchangeRateZwgPerUsd) : null;
            const suggested = prevailing ? (currency === "ZWG" ? prevailing : Math.round((1 / prevailing) * 1e6) / 1e6) : null;
            return (
              <div>
                <Field id="exchangeRate" label="Exchange rate (cross-currency)" placeholder={suggested ? `Prevailing: ${suggested}` : "e.g. 27 ZiG per USD 1"} required={!suggested} defaultValue={suggested ? String(suggested) : ""} key={`rate-${payInvoiceId}-${currency}`} />
                {suggested && <p className="-mt-2 text-[11px] text-[#6f7d76]">Prevailing school rate applied — adjust only if the office quoted a different rate today.</p>}
                {!suggested && <p className="-mt-2 text-[11px] text-[#a04e31]">No prevailing rate configured — enter today&apos;s rate, or set it in Administration → School settings.</p>}
              </div>
            );
          })()}
          {payInvoiceId && (
            <Field id="allocAmount" label="Amount to apply to this invoice" placeholder="Defaults to the payment amount" />
          )}

          <Button type="submit" disabled={submitting || !payStudentId || !payAmount} className="w-full bg-[#173f35] hover:bg-[#245e4e]">
            {submitting ? "Recording…" : `Record ${currency === "ZWG" ? "ZiG" : "USD"} payment & print receipt`}
          </Button>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={dialog === "reverse"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="font-serif text-2xl">Record a reversal</DialogTitle><DialogDescription>{reverseTarget?.label} will remain in the audit history. This action does not delete or overwrite it.</DialogDescription></DialogHeader><form onSubmit={submitReversal} className="space-y-4"><div className="space-y-2"><Label htmlFor="reason">Reason</Label><textarea id="reason" name="reason" required minLength={5} maxLength={240} className="min-h-24 w-full rounded-md border border-[#d4ded9] bg-white px-3 py-2 text-sm" placeholder="Explain why this document is being reversed" /></div><Button type="submit" variant="destructive" disabled={submitting} className="w-full">{submitting ? "Recording…" : "Confirm reversal"}</Button></form></DialogContent></Dialog>

    <Dialog open={dialog === "receipt"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-lg"><DialogHeader className="print:hidden"><DialogTitle>Payment receipt</DialogTitle><DialogDescription>Permanent receipt projection from the finance ledger.</DialogDescription></DialogHeader>{receipt && <div className="relative overflow-hidden rounded-xl border border-[#d9e2dd] bg-white p-6 print:border-0 print:p-0">{receipt.reversalNumber && <div className="absolute inset-x-[-50px] top-36 rotate-[-18deg] border-y-4 border-[#b65d42]/20 py-3 text-center text-4xl font-black uppercase tracking-[.3em] text-[#b65d42]/20">Reversed</div>}<div className="flex justify-between gap-4 border-b border-[#dfe6e2] pb-5"><div><p className="font-serif text-2xl font-semibold text-[#173329]">{data.school.name}</p><p className="mt-1 text-xs uppercase tracking-[.16em] text-[#738078]">Official payment receipt</p></div><div className="text-right"><p className="font-mono text-xs font-semibold">{receipt.receiptNumber}</p><p className="mt-1 text-xs text-[#738078]">{receipt.paymentDate}</p></div></div><dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm"><ReceiptField label="Received from" value={receipt.payerName} /><ReceiptField label="Learner" value={`${receipt.studentName} · ${receipt.admissionNumber}`} /><ReceiptField label="Amount" value={moneyLabel(receipt.amountMinor, receipt.currency)} /><ReceiptField label="Method" value={receipt.method.replaceAll("_", " ")} /><ReceiptField label="Reference" value={receipt.reference || "—"} />{receipt.exchangeRate ? <ReceiptField label="Exchange rate" value={String(receipt.exchangeRate)} /> : null}<ReceiptField label="Recorded by" value={receipt.issuerName} /></dl>{receipt.reversalNumber && <div className="mt-5 rounded-lg border border-[#e9c9bd] bg-[#fff3ee] p-3 text-xs text-[#904b34]"><p className="font-semibold">Reversed · {receipt.reversalNumber}</p><p className="mt-1">{receipt.reversalReason}</p></div>}<p className="mt-6 text-center text-[10px] text-[#87928c]">This receipt is generated from an immutable school finance record.</p></div>}<Button variant="outline" onClick={() => window.print()} className="print:hidden"><Printer /> Print receipt</Button></DialogContent></Dialog>

    <Dialog open={dialog === "project"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="font-serif text-2xl">New income project</DialogTitle><DialogDescription>e.g. School garden, poultry, uniform sales, tuckshop.</DialogDescription></DialogHeader><form onSubmit={submitProject} className="space-y-4"><Field id="name" label="Project name" required placeholder="School garden" /><Field id="description" label="Description (optional)" placeholder="Produce sold at the Saturday market" /><Button type="submit" disabled={submitting} className="w-full bg-[#173f35] hover:bg-[#245e4e]">{submitting ? "Saving…" : "Create project"}</Button></form></DialogContent></Dialog>

    <Dialog open={dialog === "ledger"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle className="font-serif text-2xl">Record a ledger entry</DialogTitle><DialogDescription>Non-fee income, project costs, donations in or out — in {currency === "ZWG" ? "ZiG" : "USD"}.</DialogDescription></DialogHeader><form onSubmit={submitLedger} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><SelectField id="kind" label="Type" required options={[{ value: "income", label: "Income (project sale / other)" }, { value: "expense", label: "Expense (project cost)" }, { value: "donation_in", label: "Donation received" }, { value: "donation_out", label: "Donation given" }]} /><SelectField id="projectId" label="Project (optional)" options={data.projects.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} /></div><Field id="description" label="Description" required placeholder="Tomato sales at market day" /><div className="grid gap-4 sm:grid-cols-2"><Field id="amount" label="Amount" required placeholder="0.00" /><Field id="occurredOn" label="Date" type="date" required defaultValue={today} /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="counterpart" label="Donor / recipient / vendor" placeholder="Required for donations" /><Field id="reference" label="Reference (optional)" placeholder="Receipt or transfer no." /></div><Button type="submit" disabled={submitting} className="w-full bg-[#173f35] hover:bg-[#245e4e]">{submitting ? "Recording…" : "Record entry"}</Button></form></DialogContent></Dialog>

    <Dialog open={dialog === "supplier"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="font-serif text-2xl">New supplier</DialogTitle><DialogDescription>Who the school buys stock and supplies from.</DialogDescription></DialogHeader><form onSubmit={submitSupplier} className="space-y-4"><Field id="name" label="Supplier name" required placeholder="e.g. National Foods" /><div className="grid gap-4 sm:grid-cols-2"><Field id="contact" label="Contact person" /><Field id="phone" label="Phone" /></div><Field id="email" label="Email" type="email" /><Field id="notes" label="Notes" /><Button type="submit" disabled={submitting} className="w-full bg-[#173f35] hover:bg-[#245e4e]">{submitting ? "Saving…" : "Save supplier"}</Button></form></DialogContent></Dialog>

    <Dialog open={dialog === "budget"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="font-serif text-2xl">Set project budget</DialogTitle><DialogDescription>One budget per project per {currency === "ZWG" ? "ZiG" : "USD"} — spend shows as % used.</DialogDescription></DialogHeader><form onSubmit={submitBudget} className="space-y-4"><SelectField id="projectId" label="Project" required options={data.projects.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} /><Field id="label" label="Budget label" required placeholder="e.g. 2026 season" /><Field id="amount" label={`Amount (${currency === "ZWG" ? "ZiG" : "USD"})`} required placeholder="0.00" /><Button type="submit" disabled={submitting} className="w-full bg-[#173f35] hover:bg-[#245e4e]">{submitting ? "Saving…" : "Save budget"}</Button></form></DialogContent></Dialog>

    <Dialog open={dialog === "stock_item"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="font-serif text-2xl">New stock item</DialogTitle><DialogDescription>Something a project holds — e.g. Broiler birds, Feed (bags).</DialogDescription></DialogHeader><form onSubmit={submitStockItem} className="space-y-4"><SelectField id="projectId" label="Project" required options={data.projects.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} /><Field id="name" label="Item name" required placeholder="Broiler birds" /><div className="grid gap-4 sm:grid-cols-2"><Field id="unit" label="Unit" required defaultValue="units" placeholder="birds / bags / crates" /><Field id="openingQty" label="Opening quantity" type="number" defaultValue="0" /></div><Button type="submit" disabled={submitting} className="w-full bg-[#173f35] hover:bg-[#245e4e]">{submitting ? "Saving…" : "Create stock item"}</Button></form></DialogContent></Dialog>

    <Dialog open={dialog === "stock_move"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle className="font-serif text-2xl">Record stock movement</DialogTitle><DialogDescription>Purchases and sales can also record the {currency === "ZWG" ? "ZiG" : "USD"} ledger entry.</DialogDescription></DialogHeader><form onSubmit={submitStockMove} className="space-y-4"><SelectField id="itemId" label="Stock item" required options={data.projects.flatMap((p) => p.stockItems.map((item) => ({ value: item.id, label: `${p.name} · ${item.name} (${item.onHand} ${item.unit})` })))} /><div className="grid gap-4 sm:grid-cols-2"><SelectField id="kind" label="Movement" required options={[{ value: "purchase", label: "Purchase (stock in)" }, { value: "sale", label: "Sale (stock out)" }, { value: "usage", label: "Used / consumed" }, { value: "adjustment", label: "Adjustment (count fix)" }]} /><SelectField id="direction" label="Adjustment direction" options={[{ value: "in", label: "Stock in" }, { value: "out", label: "Stock out" }]} /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="quantity" label="Quantity" type="number" required /><Field id="occurredOn" label="Date" type="date" required defaultValue={today} /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="amount" label="Amount (purchases & sales)" placeholder="0.00 — optional" /><Field id="note" label="Note" placeholder="e.g. Sold 20 birds at market" /><SelectField id="supplierId" label="Supplier (purchases)" options={(data.suppliers ?? []).map((x) => ({ value: x.id, label: x.name }))} /><Field id="invoiceRef" label="Purchase invoice ref" placeholder="e.g. INV-1042 — optional" /></div><Button type="submit" disabled={submitting} className="w-full bg-[#173f35] hover:bg-[#245e4e]">{submitting ? "Recording…" : "Record movement"}</Button></form></DialogContent></Dialog>

      <Dialog open={dialog === "proof_reject"} onOpenChange={(open) => { if (!open) { setDialog(null); setProofReject(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Reject proof of payment</DialogTitle><DialogDescription>{proofReject ? `${proofReject.guardianName} · ${moneyLabel(proofReject.amountMinor, proofReject.currency)} for ${proofReject.studentName}` : ""}</DialogDescription></DialogHeader>
          <form onSubmit={submitProofReject} className="space-y-4">
            <Field id="note" label="Reason shown to the guardian" placeholder="e.g. Amount does not match the deposit slip" required />
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => { setDialog(null); setProofReject(null); }}>Cancel</Button><Button type="submit" disabled={submitting} className="bg-[#93452c] hover:bg-[#7c3a24]">{submitting ? "Saving…" : "Reject and notify"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
  </div>;
}

function Field({ id, label, type = "text", required, defaultValue, placeholder }: { id: string; label: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} name={id} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} className="h-10 border-[#d4ded9]" /></div>;
}

function SelectField({ id, label, options, required }: { id: string; label: string; options: Array<{ value: string; label: string }>; required?: boolean }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><select id={id} name={id} required={required} className="h-10 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm"><option value="">Select {label.toLowerCase()}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
}

function ReceiptField({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-[#78857e]">{label}</dt><dd className="mt-1 font-semibold capitalize text-[#233b32]">{value}</dd></div>;
}

function Empty({ icon: Icon, title, text }: { icon: typeof FileText; title: string; text: string }) {
  return <div className="grid min-h-64 place-items-center px-6 py-10 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#edf3f0] text-[#4d7567]"><Icon className="size-5" /></span><p className="mt-4 font-semibold text-[#263b33]">{title}</p><p className="mt-1 text-sm text-[#77837d]">{text}</p></div></div>;
}
