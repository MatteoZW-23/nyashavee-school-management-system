"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileText, RefreshCw, Search, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DocumentRow = {
  id: string;
  documentType: string;
  filename: string;
  byteSize: number;
  notes: string | null;
  createdAt: string;
  uploadedBy: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  classroomName: string | null;
};

type RegisterData = {
  documents: DocumentRow[];
  total: number;
  page: number;
  pageSize: number;
  permissions: { upload: boolean; viewSensitive: boolean };
};

const TYPE_OPTIONS = [
  "birth_certificate", "previous_report", "transfer_letter", "guardian_id", "medical", "photo", "other",
];

function sizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DocumentsWorkspace() {
  const [data, setData] = useState<RegisterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (typeFilter) params.set("type", typeFilter);
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/students/documents?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Documents could not be loaded.");
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Documents could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const totalPages = useMemo(() => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1), [data]);

  async function download(row: DocumentRow) {
    window.open(`/api/students/documents?download=${encodeURIComponent(row.id)}`, "_blank", "noopener");
  }

  async function remove(row: DocumentRow) {
    setDeleting(row.id);
    try {
      const response = await fetch(`/api/students/documents?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The document could not be deleted.");
      toast.success(`"${row.filename}" deleted.`);
      await load();
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "The document could not be deleted.");
    } finally {
      setDeleting("");
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2"><Badge className="border border-[#b9d7c9] bg-[#e8f3ed] text-[#24604d] hover:bg-[#e8f3ed]">Central register</Badge></div>
          <h1 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-[#173329] sm:text-4xl">Documents</h1>
          <p className="mt-2 max-w-2xl text-sm text-[#68776f]">Every learner file stored by the school — certificates, transfer letters, IDs and medical records — in one auditable register.</p>
        </div>
        {!data?.permissions.viewSensitive && (
          <div className="flex items-center gap-2 rounded-xl border border-[#e3d3ab] bg-[#fbf4df] px-3 py-2 text-xs text-[#775816]"><ShieldAlert className="size-4" />Medical documents are hidden from your role.</div>
        )}
      </section>

      <Card className="gap-0 border-[#dce4e0] bg-white py-0">
        <CardHeader className="border-b border-[#e4eae7] px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><CardTitle className="text-base">Document register</CardTitle><CardDescription>{data ? `${data.total} file${data.total === 1 ? "" : "s"} on record` : "Loading…"}</CardDescription></div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[#8a958f]" />
                <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Learner, admission no. or filename" className="h-9 w-64 pl-8 text-sm" />
              </div>
              <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }} className="h-9 rounded-md border border-[#d4ded9] bg-white px-2 text-sm">
                <option value="">All types</option>
                {TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
              </select>
              <Button variant="ghost" size="icon" onClick={() => void load()}><RefreshCw className="size-4" /></Button>
            </div>
          </div>
        </CardHeader>
        {loading && !data ? (
          <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12 w-full rounded-lg" />)}</div>
        ) : error && !data ? (
          <div className="p-8 text-center"><p className="text-sm text-[#9a4e35]">{error}</p><Button variant="outline" className="mt-4" onClick={() => void load()}>Try again</Button></div>
        ) : data?.documents.length ? (
          <Table>
            <TableHeader className="bg-[#f7f9f8]">
              <TableRow>
                <TableHead className="pl-5">File</TableHead>
                <TableHead>Learner</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="pr-5 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.documents.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="py-3 pl-5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#eef3f0] text-[#4f6a5e]"><FileText className="size-4" /></span>
                      <div className="min-w-0">
                        <p className="max-w-56 truncate font-medium">{row.filename}</p>
                        {row.notes && <p className="max-w-56 truncate text-xs text-[#78857e]">{row.notes}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{row.studentName}</p>
                    <p className="text-xs text-[#78857e]">{row.admissionNumber}{row.classroomName ? ` · ${row.classroomName}` : ""}</p>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{row.documentType.replaceAll("_", " ")}</Badge></TableCell>
                  <TableCell className="text-sm text-[#67766e]">{sizeLabel(row.byteSize)}</TableCell>
                  <TableCell>
                    <p className="text-sm">{row.uploadedBy}</p>
                    <p className="text-xs text-[#78857e]">{new Date(row.createdAt).toLocaleDateString()}</p>
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => void download(row)}><Download className="size-4" /></Button>
                      {data.permissions.upload && (
                        <Button variant="ghost" size="sm" disabled={deleting === row.id} onClick={() => void remove(row)} className="text-[#984e34]"><Trash2 className="size-4" /></Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <FileText className="size-8 text-[#9aa8a1]" />
            <p className="font-semibold text-[#3d4d46]">No documents match</p>
            <p className="max-w-sm text-sm text-[#7a8781]">Files are uploaded from a learner&apos;s profile under Documents. Adjust the search or type filter.</p>
          </div>
        )}
        {data && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[#e4eae7] px-5 py-3">
            <p className="text-xs text-[#78857e]">Page {data.page} of {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
