"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { isQueuedResponse, OFFLINE_QUEUED_MESSAGE } from "@/lib/api-client";
import { ArrowUpRight, Download, FileText, GraduationCap, HeartPulse, Pencil, Search, Upload, UserRoundPlus, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Classroom, Student } from "@/lib/school-types";

type Guardian = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  relationship: string;
};

function Field({ label, name, type = "text", required, placeholder, defaultValue }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string; defaultValue?: string | number }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}{required && <span className="text-[#b55736]" aria-hidden="true">*</span>}</Label>
      <Input id={name} name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue} className="h-10 border-[#d3ddd7] bg-white" />
    </div>
  );
}

function niceGender(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function StudentsWorkspace({
  initialSearch,
  registrationRequest,
  onChanged,
}: {
  initialSearch: string;
  registrationRequest: number;
  onChanged: () => Promise<void>;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(initialSearch);
  const [classFilter, setClassFilter] = useState("all");
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [guardianMode, setGuardianMode] = useState<"new" | "existing">("new");
  const [guardianQuery, setGuardianQuery] = useState("");
  const [guardianResults, setGuardianResults] = useState<Guardian[]>([]);
  const [guardianSearching, setGuardianSearching] = useState(false);
  const [selectedGuardian, setSelectedGuardian] = useState<Guardian | null>(null);
  const [permissions, setPermissions] = useState({ create: true, update: true, promote: true, transfer: true, withdraw: true });
  const [lifecycle, setLifecycle] = useState<{ student: Student; action: "promote_student" | "repeat_student" | "transfer_student" | "withdraw_student" } | null>(null);
  const [lifecycleSubmitting, setLifecycleSubmitting] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [leadershipOpen, setLeadershipOpen] = useState(false);
  const [onboardingResult, setOnboardingResult] = useState<{ studentName: string; admissionNumber: string; parentInvitation: { email: string; sent: boolean; existingAccount: boolean } | null; letterPath: string; notified: boolean } | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importErrors, setImportErrors] = useState<{ row: number; error: string }[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkSource, setBulkSource] = useState("");
  const [bulkMode, setBulkMode] = useState<"promote" | "repeat">("promote");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;
  const [documents, setDocuments] = useState<Array<{ id: string; documentType: string; filename: string; byteSize: number; notes: string | null; createdAt: string; uploadedBy?: { displayName: string } | null }>>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [canManageDocuments, setCanManageDocuments] = useState(false);

  async function refresh(targetPage = page) {
    setLoading(true);
    setError("");
    try {
      const [studentsResponse, classesResponse] = await Promise.all([
        fetch(`/api/students?page=${targetPage}&pageSize=${pageSize}`, { cache: "no-store" }),
        fetch("/api/classes", { cache: "no-store" }),
      ]);
      const [studentData, classData] = await Promise.all([studentsResponse.json(), classesResponse.json()]);
      if (!studentsResponse.ok) throw new Error(studentData.error || "Student records could not be loaded.");
      if (!classesResponse.ok) throw new Error(classData.error || "Classes could not be loaded.");
      setStudents(studentData.students);
      setTotal(studentData.total ?? studentData.students.length);
      setPage(studentData.page ?? 1);
      if (studentData.permissions) setPermissions(studentData.permissions);
      setClassrooms(classData.classrooms);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Student records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  useEffect(() => {
    if (!initialSearch) return;
    const timer = window.setTimeout(() => setSearch(initialSearch), 0);
    return () => window.clearTimeout(timer);
  }, [initialSearch]);

  useEffect(() => {
    if (registrationRequest <= 0) return;
    const timer = window.setTimeout(() => setRegistrationOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [registrationRequest]);

  useEffect(() => {
    const studentId = selectedStudent?.id;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!studentId) {
        setDocuments([]);
        return;
      }
      setDocumentsLoading(true);
      try {
        const response = await fetch(`/api/students/documents?studentId=${encodeURIComponent(studentId)}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (response.ok) {
          setDocuments(data.documents);
          setCanManageDocuments(Boolean(data.permissions?.manage));
        }
      } finally {
        setDocumentsLoading(false);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedStudent]);

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStudent) return;
    const form = event.currentTarget;
    const file = (form.get("file") as File | null);
    if (!file || file.size === 0) {
      toast.error("Choose a file to upload.");
      return;
    }
    setDocumentUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("studentId", selectedStudent.id);
      body.set("documentType", String(form.get("documentType")));
      body.set("notes", String(form.get("notes") || ""));
      const response = await fetch("/api/students/documents", { method: "POST", body });
      const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
      if (!response.ok) throw new Error(data.error || "The document could not be uploaded.");
      toast.success("Document uploaded.");
      const list = await fetch(`/api/students/documents?studentId=${encodeURIComponent(selectedStudent.id)}`, { cache: "no-store" });
      const listData = await list.json();
      if (list.ok) setDocuments(listData.documents);
      form.reset();
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : "The document could not be uploaded.");
    } finally {
      setDocumentUploading(false);
    }
  }

  async function uploadPhoto(file: File | null) {
    if (!selectedStudent || !file) return;
    const body = new FormData();
    body.set("photo", file);
    body.set("studentId", selectedStudent.id);
    const response = await fetch("/api/students", { method: "POST", body });
    const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
    if (!response.ok) { toast.error(data.error || "The photo could not be uploaded."); return; }
    toast.success("Photo updated.");
    setSelectedStudent({ ...selectedStudent, photoPath: data.photoPath });
    void refresh();
  }

  async function deleteDocument(documentId: string) {
    if (!selectedStudent) return;
    try {
      const response = await fetch(`/api/students/documents?id=${encodeURIComponent(documentId)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The document could not be deleted.");
      setDocuments((current) => current.filter((document) => document.id !== documentId));
      toast.success("Document removed.");
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "The document could not be deleted.");
    }
  }

  useEffect(() => {
    if (guardianMode !== "existing" || guardianQuery.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setGuardianSearching(true);
      try {
        const response = await fetch(`/api/guardians?q=${encodeURIComponent(guardianQuery.trim())}`, { signal: controller.signal });
        const data = await response.json();
        if (response.ok) setGuardianResults(data.guardians);
      } finally {
        setGuardianSearching(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [guardianMode, guardianQuery]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return students.filter((student) => {
      const matchesText = !needle || `${student.firstName} ${student.middleName ?? ""} ${student.lastName} ${student.admissionNumber} ${student.classroomName ?? ""}`.toLowerCase().includes(needle);
      const matchesClass = classFilter === "all" || student.classroomId === classFilter;
      return matchesText && matchesClass;
    });
  }, [students, search, classFilter]);

  async function registerStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guardianMode === "existing" && !selectedGuardian) {
      toast.error("Select an existing guardian before registering the student.");
      return;
    }
    setSubmitting(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      firstName: values.get("firstName"),
      middleName: values.get("middleName") || undefined,
      lastName: values.get("lastName"),
      gender: values.get("gender"),
      dateOfBirth: values.get("dateOfBirth"),
      admissionDate: values.get("admissionDate") || undefined,
      classroomId: values.get("classroomId"),
      medicalAlert: values.get("medicalAlert") || undefined,
      zimsecCandidateNumber: values.get("zimsecCandidateNumber") || undefined,
      ...(guardianMode === "existing"
        ? { guardianId: selectedGuardian!.id }
        : {
            guardian: {
              firstName: values.get("guardianFirstName"),
              lastName: values.get("guardianLastName"),
              phone: values.get("guardianPhone"),
              email: values.get("guardianEmail") || undefined,
              relationship: values.get("relationship"),
            },
          }),
    };

    try {
      const response = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
      if (!response.ok) throw new Error(data.error || "The student could not be registered.");
      form.reset();
      setSelectedGuardian(null);
      setGuardianQuery("");
      setGuardianMode("new");
      setRegistrationOpen(false);
      toast.success(`${data.student.firstName} ${data.student.lastName} registered as ${data.student.admissionNumber}.`);
      if (data.onboarding) {
        setOnboardingResult({ studentName: `${data.student.firstName} ${data.student.lastName}`, admissionNumber: data.student.admissionNumber, ...data.onboarding });
      }
      await Promise.all([refresh(), onChanged()]);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The student could not be registered.");
    } finally {
      setSubmitting(false);
    }
  }

  // Minimal CSV parser — handles quoted fields with commas/double-quotes.
  function parseCsv(text: string): Record<string, string>[] {
    const rows: string[][] = [];
    let cell = "", row: string[] = [], inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cell += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    if (rows.length < 2) return [];
    const headers = rows[0].map((h) => h.trim().toLowerCase().replaceAll(" ", "_"));
    return rows.slice(1).map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i]?.trim() ?? ""])));
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportErrors([]);
    const values = new FormData(event.currentTarget);
    const classroomId = String(values.get("classroomId") || "");
    const file = values.get("file") as File | null;
    const pasted = String(values.get("csv") || "");
    const text = file && file.size > 0 ? await file.text() : pasted;
    if (!text.trim()) {
      toast.error("Upload a CSV file or paste CSV rows.");
      return;
    }
    const records = parseCsv(text);
    const rows = records.map((record) => ({
      firstName: record.first_name ?? record.firstname ?? "",
      middleName: record.middle_name ?? record.middlename ?? "",
      lastName: record.last_name ?? record.lastname ?? record.surname ?? "",
      gender: (record.gender ?? "").toLowerCase(),
      dateOfBirth: record.date_of_birth ?? record.dob ?? "",
      medicalAlert: record.medical_alert ?? "",
      classroomId,
    }));
    if (!rows.length) {
      toast.error("The CSV needs a header row and at least one learner row.");
      return;
    }
    if (!classroomId) {
      toast.error("Choose the class to enrol these learners into.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import_students", rows }),
      });
      const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
      if (!response.ok) {
        if (Array.isArray(data.errors)) setImportErrors(data.errors);
        throw new Error(data.error || "The import could not be completed.");
      }
      toast.success(`Imported ${data.imported} learner${data.imported === 1 ? "" : "s"}.`);
      setImportOpen(false);
      await refresh();
      onChanged?.();
    } catch (importError) {
      toast.error(importError instanceof Error ? importError.message : "The import could not be completed.");
    } finally {
      setSubmitting(false);
    }
  }

  function exportStudents() {
    if (!filtered.length) {
      toast.info("There are no visible student records to export.");
      return;
    }
    const rows = [
      ["Admission number", "First name", "Middle name", "Surname", "Gender", "Date of birth", "Class", "Status", "Admission date"],
      ...filtered.map((student) => [student.admissionNumber, student.firstName, student.middleName ?? "", student.lastName, niceGender(student.gender), student.dateOfBirth, student.classroomName ?? "", student.status, student.admissionDate ?? ""]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `student-directory-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const lifecycleTargets = useMemo(() => {
    if (!lifecycle) return [];
    const current = classrooms.find((classroom) => classroom.id === lifecycle.student.classroomId);
    if (!current) return [];
    if (lifecycle.action === "transfer_student") {
      return classrooms.filter((classroom) => classroom.academicYearId === current.academicYearId && classroom.id !== current.id);
    }
    if (lifecycle.action === "repeat_student") {
      return classrooms.filter((classroom) => classroom.gradeLevelId === current.gradeLevelId && classroom.academicYearId !== current.academicYearId);
    }
    return classrooms.filter((classroom) => classroom.academicYearId !== current.academicYearId);
  }, [lifecycle, classrooms]);

  const lifecycleCopy = {
    promote_student: { title: "Promote learner", description: "Place the learner into a class in the next academic year. If that year is still planned, the move is confirmed and applies when the year is activated." },
    repeat_student: { title: "Repeat grade", description: "Enrol the learner in the same grade level again for the next academic year." },
    transfer_student: { title: "Transfer class", description: "Move the learner to a different class within the current academic year. The move applies immediately." },
    withdraw_student: { title: "Withdraw learner", description: "Close all enrolments and mark the learner as withdrawn. Their records remain for audit." },
  } as const;

  async function submitLifecycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lifecycle) return;
    setLifecycleSubmitting(true);
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: lifecycle.action,
          studentId: lifecycle.student.id,
          targetClassroomId: values.get("targetClassroomId") || undefined,
          destination: values.get("destination") || undefined,
          effectiveDate: values.get("effectiveDate") || undefined,
          reason: values.get("reason") || undefined,
        }),
      });
      const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
      if (!response.ok) throw new Error(data.error || "The request could not be completed.");
      const name = `${lifecycle.student.firstName} ${lifecycle.student.lastName}`;
      toast.success(
        data.withdrawn ? `${name} has been withdrawn.`
        : data.transferred ? `${name} has been transferred.`
        : data.status === "confirmed" ? `${name} will move when the new academic year is activated.`
        : `${name} has been moved.`,
      );
      setLifecycle(null);
      setSelectedStudent(null);
      await Promise.all([refresh(), onChanged()]);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The request could not be completed.");
    } finally {
      setLifecycleSubmitting(false);
    }
  }

  async function submitLeadership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStudent) return;
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign_leadership",
          studentId: selectedStudent.id,
          title: values.get("title"),
          customTitle: values.get("customTitle") || undefined,
          scope: values.get("scope"),
          classroomId: values.get("scope") === "class" ? values.get("classroomId") || undefined : undefined,
          startDate: values.get("startDate"),
        }),
      });
      const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
      if (!response.ok) throw new Error(data.error || "The request could not be completed.");
      toast.success("Leadership role assigned.");
      setLeadershipOpen(false);
      await Promise.all([refresh(), onChanged()]);
      // Keep the open profile in sync with the new role.
      setSelectedStudent((current) => current ? { ...current, leaderships: [...(current.leaderships ?? []), { id: data.id, title: String(values.get("title") === "other" ? values.get("customTitle") : values.get("title")).replaceAll("_", " "), scope: String(values.get("scope")), classroomName: null, active: true, startDate: String(values.get("startDate")), endDate: null }] } : current);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The request could not be completed.");
    }
  }

  async function endLeadership(leadershipId: string, title: string) {
    if (!window.confirm(`End the "${title}" role?`)) return;
    try {
      const response = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end_leadership", leadershipId }),
      });
      const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
      if (!response.ok) throw new Error(data.error || "The request could not be completed.");
      toast.success("Leadership role ended.");
      setSelectedStudent((current) => current ? { ...current, leaderships: (current.leaderships ?? []).map((role) => role.id === leadershipId ? { ...role, active: false, endDate: new Date().toISOString() } : role) } : current);
      await Promise.all([refresh(), onChanged()]);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The request could not be completed.");
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingStudent) return;
    setEditSubmitting(true);
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_student",
          studentId: editingStudent.id,
          firstName: values.get("firstName"),
          middleName: values.get("middleName") || undefined,
          lastName: values.get("lastName"),
          gender: values.get("gender"),
          dateOfBirth: values.get("dateOfBirth"),
          medicalAlert: values.get("medicalAlert") || undefined,
          zimsecCandidateNumber: values.get("zimsecCandidateNumber") || undefined,
        }),
      });
      const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
      if (!response.ok) throw new Error(data.error || "The student could not be updated.");
      toast.success("Student details updated.");
      setEditingStudent(null);
      setSelectedStudent(null);
      await Promise.all([refresh(), onChanged()]);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The student could not be updated.");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function submitBulk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBulkSubmitting(true);
    const values = new FormData(event.currentTarget);
    const sourceId = String(values.get("sourceClassroomId") || "");
    try {
      const response = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "promote_class",
          sourceClassroomId: sourceId,
          targetClassroomId: values.get("targetClassroomId"),
          mode: values.get("mode"),
          effectiveDate: values.get("effectiveDate") || undefined,
          reason: values.get("reason") || undefined,
        }),
      });
      const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
      if (!response.ok) throw new Error(data.error || "Bulk promotion could not be completed.");
      toast.success(
        data.status === "confirmed"
          ? `${data.moved} learner${data.moved === 1 ? "" : "s"} confirmed into the next year${data.skipped ? ` (${data.skipped} already placed)` : ""}.`
          : `${data.moved} learner${data.moved === 1 ? "" : "s"} moved immediately${data.skipped ? ` (${data.skipped} already placed)` : ""}.`,
      );
      setBulkOpen(false);
      await Promise.all([refresh(), onChanged()]);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "Bulk promotion could not be completed.");
    } finally {
      setBulkSubmitting(false);
    }
  }

  const bulkTargets = useMemo(() => {
    const source = classrooms.find((classroom) => classroom.id === bulkSource);
    if (!source) return [];
    return classrooms.filter((classroom) =>
      classroom.academicYearId !== source.academicYearId &&
      (bulkMode === "promote" || classroom.gradeLevelId === source.gradeLevelId),
    );
  }, [bulkSource, bulkMode, classrooms]);

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2"><Badge className="border border-[#bad7ca] bg-[#e8f2ed] text-[#245f4d] hover:bg-[#e8f2ed]">Live module</Badge><span className="text-xs text-[#78867f]">Admissions & student information</span></div>
          <h1 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-[#173329] sm:text-4xl">Student records</h1>
          <p className="mt-2 text-sm text-[#68776f]">Secure, school-scoped learner profiles and enrolment.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportStudents} className="border-[#d2dcd7] bg-white"><Download /> Export CSV</Button>
          {permissions.promote && <Button variant="outline" onClick={() => { setBulkSource(""); setBulkMode("promote"); setBulkOpen(true); }} className="border-[#d2dcd7] bg-white"><ArrowUpRight /> Bulk promote</Button>}
          {permissions.create && <Button variant="outline" onClick={() => setImportOpen(true)} className="border-[#d2dcd7] bg-white"><Upload /> Import CSV</Button>}
          {permissions.create && <Button onClick={() => setRegistrationOpen(true)} className="bg-[#173f35] hover:bg-[#245e4e]"><UserRoundPlus /> Register student</Button>}
        </div>
      </section>

      <Card className="gap-0 border-[#dce4e0] bg-white py-0 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
        <CardContent className="px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7c8982]" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 border-[#d6dfda] pl-9" placeholder="Search by name, admission number or class" aria-label="Search student records" /></div>
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="h-10 rounded-md border border-[#d6dfda] bg-white px-3 text-sm outline-none focus:border-[#397561] focus:ring-2 focus:ring-[#397561]/20" aria-label="Filter students by class">
              <option value="all">All classes</option>
              {classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
        <div className="flex items-center justify-between border-b border-[#e4eae7] px-5 py-4">
          <div><p className="text-sm font-semibold">Student directory</p><p className="mt-0.5 text-xs text-[#75827b]">{loading ? "Loading records" : `${filtered.length} shown on this page · ${total} student${total === 1 ? "" : "s"} total`}</p></div>
          <Badge variant="outline" className="bg-[#f8faf9] text-[#5d6c65]">Active records</Badge>
        </div>
        {loading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div>
        ) : error ? (
          <div className="px-6 py-16 text-center"><p className="text-sm font-semibold text-[#9b5037]">{error}</p><Button variant="outline" onClick={() => void refresh()} className="mt-4">Try again</Button></div>
        ) : filtered.length ? (
          <Table>
            <TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5 text-xs uppercase tracking-wide text-[#74817b]">Student</TableHead><TableHead className="text-xs uppercase tracking-wide text-[#74817b]">Admission no.</TableHead><TableHead className="text-xs uppercase tracking-wide text-[#74817b]">Class</TableHead><TableHead className="text-xs uppercase tracking-wide text-[#74817b]">Gender</TableHead><TableHead className="pr-5 text-right text-xs uppercase tracking-wide text-[#74817b]">Profile</TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.map((student) => (
                <TableRow key={student.id} className="border-[#e8edea]">
                  <TableCell className="py-3.5 pl-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-[#e4efe9] text-xs font-bold text-[#2c6653]">{student.firstName[0]}{student.lastName[0]}</span><div><p className="font-semibold text-[#20362e]">{student.firstName} {student.middleName ? `${student.middleName} ` : ""}{student.lastName}</p><p className="mt-0.5 text-xs capitalize text-[#77847d]">{student.status}</p></div></div></TableCell>
                  <TableCell className="font-mono text-xs text-[#4f6058]">{student.admissionNumber}</TableCell>
                  <TableCell>{student.classroomName ?? <span className="text-[#8a9690]">Unassigned</span>}</TableCell>
                  <TableCell>{niceGender(student.gender)}</TableCell>
                  <TableCell className="pr-5 text-right"><Button variant="ghost" size="sm" onClick={() => setSelectedStudent(student)} className="text-[#28624f]">View profile</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="px-6 py-16 text-center"><GraduationCap className="mx-auto size-8 text-[#849189]" /><p className="mt-4 text-sm font-semibold">{students.length ? "No students match these filters" : "No students registered yet"}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[#75827b]">{students.length ? "Clear or change the search criteria to see more records." : "Register the first learner once the academic year and class are configured."}</p>{!students.length && <Button onClick={() => setRegistrationOpen(true)} className="mt-5 bg-[#173f35] hover:bg-[#245e4e]"><UserRoundPlus /> Register first student</Button>}</div>
        )}
        {!loading && !error && total > pageSize && (
          <div className="flex items-center justify-between border-t border-[#e4eae7] px-5 py-3">
            <p className="text-xs text-[#75827b]">Page {page} of {Math.ceil(total / pageSize)}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => void refresh(page - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => void refresh(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={registrationOpen} onOpenChange={setRegistrationOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-[#d7e0db] p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-[#e2e8e5] bg-[#f8faf9] px-6 py-5">
            <DialogTitle className="font-serif text-2xl text-[#173329]">Register a student</DialogTitle>
            <DialogDescription>Creates the learner, guardian relationship, class enrolment and audit record together.</DialogDescription>
          </DialogHeader>
          <form onSubmit={registerStudent} className="space-y-7 px-6 pb-6">
            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-[#e8edea] pb-3"><span className="grid size-7 place-items-center rounded-full bg-[#173f35] text-xs font-bold text-white">1</span><div><h2 className="text-sm font-semibold">Learner details</h2><p className="text-xs text-[#78857e]">Identity and safeguarding information</p></div></div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="First name" name="firstName" required /><Field label="Middle name" name="middleName" /><Field label="Surname" name="lastName" required /><div className="space-y-2"><Label htmlFor="gender">Gender<span className="text-[#b55736]">*</span></Label><select id="gender" name="gender" required defaultValue="" className="h-10 w-full rounded-md border border-[#d3ddd7] bg-white px-3 text-sm"><option value="" disabled>Select gender</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select></div><Field label="Date of birth" name="dateOfBirth" type="date" required /><Field label="Learner email" name="email" type="email" placeholder="Optional — used for portal login" /><Field label="Medical alert" name="medicalAlert" placeholder="Optional" /><Field label="ZIMSEC candidate no." name="zimsecCandidateNumber" placeholder="Grade 7 only" /></div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-[#e8edea] pb-3"><span className="grid size-7 place-items-center rounded-full bg-[#173f35] text-xs font-bold text-white">2</span><div><h2 className="text-sm font-semibold">Primary guardian</h2><p className="text-xs text-[#78857e]">Create a new contact or securely reuse an existing one</p></div></div>
              <div className="inline-flex rounded-lg border border-[#d5dfda] bg-[#f5f7f6] p-1">
                <button type="button" onClick={() => { setGuardianMode("new"); setSelectedGuardian(null); setGuardianResults([]); }} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${guardianMode === "new" ? "bg-white text-[#173f35] shadow-sm" : "text-[#718078]"}`}>New guardian</button>
                <button type="button" onClick={() => { setGuardianMode("existing"); setGuardianResults([]); }} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${guardianMode === "existing" ? "bg-white text-[#173f35] shadow-sm" : "text-[#718078]"}`}>Existing guardian</button>
              </div>
              {guardianMode === "new" ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="First name" name="guardianFirstName" required /><Field label="Surname" name="guardianLastName" required /><Field label="Relationship" name="relationship" required placeholder="e.g. Mother" /><Field label="Phone" name="guardianPhone" type="tel" required /><Field label="Email" name="guardianEmail" type="email" /></div>
              ) : (
                <div className="space-y-3">
                  <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7a8880]" /><Input value={guardianQuery} onChange={(event) => { const value = event.target.value; setGuardianQuery(value); setSelectedGuardian(null); if (value.trim().length < 2) setGuardianResults([]); }} className="h-10 pl-9" placeholder="Search by name, phone, email or national ID" aria-label="Search existing guardians" /></div>
                  {guardianSearching && <p className="text-xs text-[#74817a]">Searching guardian records…</p>}
                  {!guardianSearching && guardianQuery.trim().length >= 2 && !guardianResults.length && <p className="rounded-lg bg-[#f5f7f6] px-3 py-3 text-xs text-[#718078]">No matching guardians found.</p>}
                  <div className="grid gap-2 sm:grid-cols-2">{guardianResults.map((guardian) => <button type="button" key={guardian.id} onClick={() => setSelectedGuardian(guardian)} className={`flex items-center gap-3 rounded-xl border p-3 text-left ${selectedGuardian?.id === guardian.id ? "border-[#397561] bg-[#edf5f1] ring-1 ring-[#397561]" : "border-[#dce3df] bg-white hover:border-[#b9cac2]"}`}><span className="grid size-9 place-items-center rounded-full bg-[#e5eee9] text-[#2e6956]"><UsersRound className="size-4" /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{guardian.firstName} {guardian.lastName}</span><span className="block truncate text-xs text-[#74817a]">{guardian.phone} · {guardian.relationship}</span></span></button>)}</div>
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-[#e8edea] pb-3"><span className="grid size-7 place-items-center rounded-full bg-[#173f35] text-xs font-bold text-white">3</span><div><h2 className="text-sm font-semibold">Placement</h2><p className="text-xs text-[#78857e]">Admission date and active class allocation</p></div></div>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="Admission date" name="admissionDate" type="date" /><div className="space-y-2"><Label htmlFor="classroomId">Class<span className="text-[#b55736]">*</span></Label><select id="classroomId" name="classroomId" required defaultValue="" className="h-10 w-full rounded-md border border-[#d3ddd7] bg-white px-3 text-sm"><option value="" disabled>Select an active class</option>{classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name} · {classroom.academicYear}</option>)}</select></div></div>
              {!classrooms.length && <p className="rounded-lg border border-[#ead8a9] bg-[#fbf4df] px-3 py-2 text-xs text-[#775816]">An active academic year, grade and class are required before registration.</p>}
            </section>

            <div className="flex flex-col-reverse gap-2 border-t border-[#e5ebe8] pt-5 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => setRegistrationOpen(false)}>Cancel</Button><Button disabled={submitting || !classrooms.length} className="bg-[#173f35] hover:bg-[#245e4e]">{submitting ? "Registering…" : "Complete registration"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedStudent)} onOpenChange={(open) => !open && setSelectedStudent(null)}>
        <DialogContent className="sm:max-w-xl">
          {selectedStudent && <><DialogHeader><div className="flex items-center gap-4"><label className="group relative block size-12 cursor-pointer overflow-hidden rounded-xl bg-[#e4efe9]" title="Click to change photo">{selectedStudent.photoPath ? <img src={`/api/students?photo=${selectedStudent.id}`} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center font-serif text-lg font-semibold text-[#28624f]">{selectedStudent.firstName[0]}{selectedStudent.lastName[0]}</span>}<span className="absolute inset-x-0 bottom-0 hidden bg-[#173f35]/80 py-0.5 text-center text-[8px] font-semibold uppercase tracking-wide text-white group-hover:block">Photo</span><input type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={(event) => void uploadPhoto(event.target.files?.[0] ?? null)} /></label><div><DialogTitle className="font-serif text-2xl">{selectedStudent.firstName} {selectedStudent.middleName ? `${selectedStudent.middleName} ` : ""}{selectedStudent.lastName}</DialogTitle><DialogDescription className="font-mono text-xs">{selectedStudent.admissionNumber}</DialogDescription></div></div></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><ProfileFact label="Class" value={selectedStudent.classroomName ?? "Unassigned"} /><ProfileFact label="Status" value={selectedStudent.status} /><ProfileFact label="Gender" value={niceGender(selectedStudent.gender)} /><ProfileFact label="Date of birth" value={selectedStudent.dateOfBirth} /><ProfileFact label="Admission date" value={selectedStudent.admissionDate ?? "Not recorded"} /><ProfileFact label="Medical alert" value={selectedStudent.medicalAlert || "None recorded"} alert={Boolean(selectedStudent.medicalAlert)} /><ProfileFact label="ZIMSEC no." value={selectedStudent.zimsecCandidateNumber || "—"} /></div>
          {(selectedStudent.enrollments?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7b8881]">Enrolment history</p>
              <div className="space-y-2">
                {selectedStudent.enrollments!.map((enrollment, index) => (
                  <div key={index} className="flex items-center justify-between rounded-xl border border-[#e1e7e4] bg-[#fafbfa] px-3 py-2.5">
                    <div>
                      <p className="text-sm font-semibold text-[#263b33]">{enrollment.yearName} · {enrollment.classroomName}</p>
                      <p className="text-xs text-[#77847d]">{enrollment.gradeName}{enrollment.exitReason ? ` · ${enrollment.exitReason.replaceAll("_", " ")}` : ""}</p>
                    </div>
                    <Badge variant="outline" className="capitalize">{enrollment.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
          {((selectedStudent.leaderships?.length ?? 0) > 0 || (selectedStudent.status === "active" && permissions.update)) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7b8881]">Leadership roles</p>
                {selectedStudent.status === "active" && permissions.update && <button type="button" onClick={() => setLeadershipOpen(true)} className="text-xs font-semibold text-[#28624f] hover:underline">Assign role</button>}
              </div>
              {(selectedStudent.leaderships?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  {selectedStudent.leaderships!.map((role) => (
                    <div key={role.id} className="flex items-center justify-between rounded-xl border border-[#e1e7e4] bg-[#fafbfa] px-3 py-2.5">
                      <div>
                        <p className="text-sm font-semibold capitalize text-[#263b33]">{role.title}</p>
                        <p className="text-xs text-[#77847d]">{role.scope}{role.classroomName ? ` · ${role.classroomName}` : ""} · since {role.startDate.slice(0, 10)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={role.active ? "border-[#b8d6c9] bg-[#e6f2ec] text-[#245f4d]" : ""}>{role.active ? "Active" : "Ended"}</Badge>
                        {role.active && permissions.update && <Button size="sm" variant="ghost" className="text-[#984e34]" onClick={() => void endLeadership(role.id, role.title)}>End</Button>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-[#77847d]">No leadership roles recorded.</p>}
            </div>
          )}
          {selectedStudent.status === "active" && (permissions.update || permissions.promote || permissions.transfer || permissions.withdraw) && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7b8881]">Record actions</p>
              <div className="flex flex-wrap gap-2">
                {permissions.update && <Button size="sm" variant="outline" onClick={() => setEditingStudent(selectedStudent)} className="border-[#c8d8cf]"><Pencil /> Edit details</Button>}
                {permissions.promote && <Button size="sm" variant="outline" disabled={!selectedStudent.classroomId} onClick={() => setLifecycle({ student: selectedStudent, action: "promote_student" })} className="border-[#c8d8cf]">Promote to next year</Button>}
                {permissions.promote && <Button size="sm" variant="outline" disabled={!selectedStudent.classroomId} onClick={() => setLifecycle({ student: selectedStudent, action: "repeat_student" })} className="border-[#c8d8cf]">Repeat grade</Button>}
                {permissions.transfer && <Button size="sm" variant="outline" disabled={!selectedStudent.classroomId} onClick={() => setLifecycle({ student: selectedStudent, action: "transfer_student" })} className="border-[#c8d8cf]">Transfer class</Button>}
                {permissions.withdraw && <Button size="sm" variant="outline" onClick={() => setLifecycle({ student: selectedStudent, action: "withdraw_student" })} className="border-[#e6c7ba] text-[#984e34]">Withdraw</Button>}
              </div>
            </div>
          )}
          {selectedStudent.status === "graduated" && permissions.update && (
            <a href={`/print/certificate/${selectedStudent.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#28624f] hover:underline"><GraduationCap className="size-3.5" /> Print graduation certificate</a>
          )}
          <a href={`/print/acceptance/${selectedStudent.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#28624f] hover:underline"><FileText className="size-3.5" /> Print acceptance letter</a>
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7b8881]">Documents</p>
            {documentsLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : documents.length ? (
              <div className="space-y-2">
                {documents.map((document) => (
                  <div key={document.id} className="flex items-center justify-between rounded-xl border border-[#e1e7e4] bg-[#fafbfa] px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#263b33]">{document.filename}</p>
                      <p className="text-xs capitalize text-[#77847d]">{document.documentType.replaceAll("_", " ")} · {(document.byteSize / 1024).toFixed(0)} KB{document.notes ? ` · ${document.notes}` : ""}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <a href={`/api/students/documents?download=${encodeURIComponent(document.id)}`} className="rounded-md px-2 py-1 text-xs font-semibold text-[#28624f] hover:bg-[#e8f2ed]">Download</a>
                      {canManageDocuments && <button type="button" onClick={() => void deleteDocument(document.id)} className="rounded-md px-2 py-1 text-xs font-semibold text-[#9b5037] hover:bg-[#fbf3ef]">Delete</button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-[#d3ddd7] px-3 py-3 text-xs text-[#77847d]">No documents on file yet.</p>
            )}
            {canManageDocuments && (
              <form onSubmit={uploadDocument} className="flex flex-col gap-2 rounded-xl border border-[#e1e7e4] bg-[#fafbfa] p-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1"><Label htmlFor="file" className="text-xs">File (max 5 MB)</Label><Input id="file" name="file" type="file" required className="h-9 border-[#d3ddd7] bg-white text-xs" /></div>
                <div className="space-y-1"><Label htmlFor="documentType" className="text-xs">Type</Label><select id="documentType" name="documentType" className="h-9 w-full rounded-md border border-[#d3ddd7] bg-white px-2 text-xs"><option value="birth_certificate">Birth certificate</option><option value="medical">Medical</option><option value="previous_report">Previous report</option><option value="transfer_letter">Transfer letter</option><option value="guardian_id">Guardian ID</option><option value="photo">Photo</option><option value="other">Other</option></select></div>
                <div className="flex-1 space-y-1"><Label htmlFor="docNotes" className="text-xs">Notes</Label><Input id="docNotes" name="notes" placeholder="Optional" className="h-9 border-[#d3ddd7] bg-white text-xs" /></div>
                <Button type="submit" size="sm" disabled={documentUploading} className="bg-[#173f35] hover:bg-[#245e4e]">{documentUploading ? "Uploading…" : "Upload"}</Button>
              </form>
            )}
          </div>
          <div className="rounded-xl border border-[#e1e7e4] bg-[#f7f9f8] p-4"><div className="flex items-start gap-3"><HeartPulse className="mt-0.5 size-4 shrink-0 text-[#3d715f]" /><p className="text-xs leading-5 text-[#69776f]">Attendance, academics, finance and safeguarding details for this learner live in their dedicated workspaces — this card shows the profile record and enrolment history.</p></div></div></>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(lifecycle)} onOpenChange={(open) => !open && setLifecycle(null)}>
        <DialogContent className="sm:max-w-lg">
          {lifecycle && (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">{lifecycleCopy[lifecycle.action].title}</DialogTitle>
                <DialogDescription>
                  {lifecycle.student.firstName} {lifecycle.student.lastName} · {lifecycle.student.classroomName ?? "Unassigned"} — {lifecycleCopy[lifecycle.action].description}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submitLifecycle} className="space-y-4">
                {lifecycle.action !== "withdraw_student" && (
                  <div className="space-y-2">
                    <Label htmlFor="targetClassroomId">Destination class<span className="text-[#b55736]">*</span></Label>
                    <select id="targetClassroomId" name="targetClassroomId" required defaultValue="" className="h-10 w-full rounded-md border border-[#d3ddd7] bg-white px-3 text-sm">
                      <option value="" disabled>Select destination class</option>
                      {lifecycleTargets.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name} · {classroom.academicYear}{classroom.gradeName ? ` (${classroom.gradeName})` : ""}</option>)}
                    </select>
                    {!lifecycleTargets.length && (
                      <p className="rounded-lg border border-[#ead8a9] bg-[#fbf4df] px-3 py-2 text-xs text-[#775816]">
                        {lifecycle.action === "transfer_student"
                          ? "No other classes exist in this academic year."
                          : lifecycle.action === "repeat_student"
                            ? "No class at the same grade level exists in another academic year — create next year's class in Academics first."
                            : "No classes exist in another academic year — create next year's classes in Academics first."}
                      </p>
                    )}
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={lifecycle.action === "withdraw_student" ? "Exit date" : "Effective date"} name="effectiveDate" type="date" />
                  {lifecycle.action === "withdraw_student" && (
                    <div className="space-y-2">
                      <Label htmlFor="destination">Destination school (optional)</Label>
                      <Input id="destination" name="destination" placeholder="e.g. Borrowdale Primary — records the transfer destination" className="h-10 border-[#d3ddd7] bg-white" />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="reason">Reason</Label>
                    <Input id="reason" name="reason" placeholder={lifecycle.action === "withdraw_student" ? "e.g. Relocated to Bulawayo" : "Optional"} className="h-10 border-[#d3ddd7] bg-white" />
                  </div>
                </div>
                <div className="flex flex-col-reverse gap-2 border-t border-[#e5ebe8] pt-5 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" onClick={() => setLifecycle(null)}>Cancel</Button>
                  <Button disabled={lifecycleSubmitting || (lifecycle.action !== "withdraw_student" && !lifecycleTargets.length)} className={lifecycle.action === "withdraw_student" ? "bg-[#9b5037] hover:bg-[#83442c]" : "bg-[#173f35] hover:bg-[#245e4e]"}>
                    {lifecycleSubmitting ? "Saving…" : lifecycleCopy[lifecycle.action].title}
                  </Button>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingStudent)} onOpenChange={(open) => !open && setEditingStudent(null)}>
        <DialogContent className="sm:max-w-2xl">
          {editingStudent && (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">Edit student details</DialogTitle>
                <DialogDescription className="font-mono text-xs">{editingStudent.admissionNumber}</DialogDescription>
              </DialogHeader>
              <form onSubmit={submitEdit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="First name" name="firstName" required defaultValue={editingStudent.firstName} />
                  <Field label="Middle name" name="middleName" defaultValue={editingStudent.middleName ?? ""} />
                  <Field label="Surname" name="lastName" required defaultValue={editingStudent.lastName} />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2"><Label htmlFor="gender">Gender<span className="text-[#b55736]">*</span></Label><select id="gender" name="gender" required defaultValue={editingStudent.gender} className="h-10 w-full rounded-md border border-[#d3ddd7] bg-white px-3 text-sm"><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select></div>
                  <Field label="Date of birth" name="dateOfBirth" type="date" required defaultValue={editingStudent.dateOfBirth?.slice(0, 10)} /><Field label="Learner email" name="email" type="email" defaultValue={editingStudent.email ?? ""} />
                  <Field label="Medical alert" name="medicalAlert" defaultValue={editingStudent.medicalAlert ?? ""} />
                </div>
                <div className="flex flex-col-reverse gap-2 border-t border-[#e5ebe8] pt-5 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" onClick={() => setEditingStudent(null)}>Cancel</Button>
                  <Button disabled={editSubmitting} className="bg-[#173f35] hover:bg-[#245e4e]">{editSubmitting ? "Saving…" : "Save changes"}</Button>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Bulk promote a class</DialogTitle>
            <DialogDescription>Move every active learner in a class into a class in another academic year. Confirmed moves apply when the destination year is activated.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitBulk} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sourceClassroomId">From class<span className="text-[#b55736]">*</span></Label>
                <select id="sourceClassroomId" name="sourceClassroomId" required value={bulkSource} onChange={(event) => setBulkSource(event.target.value)} className="h-10 w-full rounded-md border border-[#d3ddd7] bg-white px-3 text-sm">
                  <option value="" disabled>Select source class</option>
                  {classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name} · {classroom.academicYear}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mode">Mode<span className="text-[#b55736]">*</span></Label>
                <select id="mode" name="mode" required value={bulkMode} onChange={(event) => setBulkMode(event.target.value as "promote" | "repeat")} className="h-10 w-full rounded-md border border-[#d3ddd7] bg-white px-3 text-sm">
                  <option value="promote">Promote (next grade)</option>
                  <option value="repeat">Repeat (same grade)</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="targetClassroomId">Destination class<span className="text-[#b55736]">*</span></Label>
              <select id="targetClassroomId" name="targetClassroomId" required defaultValue="" key={`${bulkSource}-${bulkMode}`} className="h-10 w-full rounded-md border border-[#d3ddd7] bg-white px-3 text-sm">
                <option value="" disabled>Select destination class</option>
                {bulkTargets.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name} · {classroom.academicYear}{classroom.gradeName ? ` (${classroom.gradeName})` : ""}</option>)}
              </select>
              {bulkSource && !bulkTargets.length && <p className="rounded-lg border border-[#ead8a9] bg-[#fbf4df] px-3 py-2 text-xs text-[#775816]">{bulkMode === "repeat" ? "No class at the same grade level exists in another year — create it in Academics first." : "No classes exist in another academic year — create next year's classes in Academics first."}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Effective date" name="effectiveDate" type="date" />
              <div className="space-y-2"><Label htmlFor="bulkReason">Reason</Label><Input id="bulkReason" name="reason" placeholder="Optional" className="h-10 border-[#d3ddd7] bg-white" /></div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#e5ebe8] pt-5 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
              <Button disabled={bulkSubmitting || !bulkTargets.length} className="bg-[#173f35] hover:bg-[#245e4e]">{bulkSubmitting ? "Processing…" : "Run bulk move"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Import learners from CSV</DialogTitle>
            <DialogDescription>Enrol many learners into one class at once. Columns: <span className="font-mono text-xs">first_name, last_name, gender, date_of_birth</span> with optional <span className="font-mono text-xs">middle_name, medical_alert</span>. Gender must be female, male, other or prefer_not_to_say; dates as YYYY-MM-DD.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitImport} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="importClassroomId">Enrol into class<span className="text-[#b55736]">*</span></Label>
              <select id="importClassroomId" name="classroomId" required defaultValue="" className="h-10 w-full rounded-md border border-[#d3ddd7] bg-white px-3 text-sm">
                <option value="" disabled>Select class</option>
                {classrooms.filter((classroom) => classroom.yearStatus === "active" || classroom.yearStatus === "planned").map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name} · {classroom.academicYear}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="file">CSV file</Label>
              <Input id="file" name="file" type="file" accept=".csv,text/csv" className="h-10 border-[#d3ddd7] bg-white" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="csv">Or paste CSV rows</Label>
              <textarea id="csv" name="csv" rows={5} placeholder={"first_name,last_name,gender,date_of_birth\nTariro,Moyo,female,2016-03-12"} className="w-full rounded-md border border-[#d3ddd7] bg-white px-3 py-2 font-mono text-xs" />
            </div>
            {importErrors.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-[#e6c7ba] bg-[#fbf3ef] p-3">
                {importErrors.slice(0, 30).map((item) => <p key={item.row} className="text-xs text-[#984e34]">Row {item.row}: {item.error}</p>)}
                {importErrors.length > 30 && <p className="text-xs text-[#984e34]">…and {importErrors.length - 30} more</p>}
              </div>
            )}
            <div className="flex flex-col-reverse gap-2 border-t border-[#e5ebe8] pt-5 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
              <Button disabled={submitting} className="bg-[#173f35] hover:bg-[#245e4e]">{submitting ? "Importing…" : "Import learners"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={leadershipOpen} onOpenChange={setLeadershipOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Assign leadership role</DialogTitle>
            <DialogDescription>{selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : ""}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitLeadership} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Role</Label>
              <select id="title" name="title" required className="h-10 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm">
                <option value="">Select a role</option>
                {[["prefect","Prefect"],["senior_prefect","Senior prefect"],["head_boy","Head boy"],["head_girl","Head girl"],["class_monitor","Class monitor"],["sports_captain","Sports captain"],["hostel_prefect","Hostel prefect"],["library_prefect","Library prefect"],["dining_prefect","Dining prefect"],["chorister_lead","Chorister lead"],["debate_captain","Debate captain"],["other","Other…"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <Field name="customTitle" label="Custom title (for Other)" placeholder="e.g. Chess captain" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="scope">Scope</Label>
                <select id="scope" name="scope" required className="h-10 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm">
                  {[["school","Whole school"],["class","Class"],["dormitory","Dormitory"],["house","House"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <Field name="startDate" label="Start date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="classroomId">Class (for class-scoped roles)</Label>
              <select id="classroomId" name="classroomId" className="h-10 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm">
                <option value="">Not needed</option>
                {classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#e5ebe8] pt-5 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setLeadershipOpen(false)}>Cancel</Button>
              <Button className="bg-[#173f35] hover:bg-[#245e4e]">Assign role</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(onboardingResult)} onOpenChange={(open) => !open && setOnboardingResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Registration complete</DialogTitle>
            <DialogDescription>{onboardingResult ? `${onboardingResult.studentName} · ${onboardingResult.admissionNumber}` : ""}</DialogDescription>
          </DialogHeader>
          {onboardingResult && (
            <div className="space-y-4">
              <div className={`rounded-xl border p-3 text-sm ${onboardingResult.notified ? "border-[#b8d6c9] bg-[#e6f2ec] text-[#245f4d]" : "border-[#e3d2a8] bg-[#fbf3dd] text-[#7c5d18]"}`}>
                {onboardingResult.notified
                  ? "The primary guardian has been emailed a private account-activation link."
                  : "No invitation was sent. Confirm a deliverable primary-guardian email and email-provider configuration before resending."}
              </div>
              {onboardingResult.parentInvitation && (
                <div className="rounded-xl border border-[#e1e7e4] bg-[#fafbfa] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7b8881]">Parent / guardian portal</p>
                  <p className="mt-1 text-sm font-semibold text-[#263b33]">{onboardingResult.parentInvitation.email}</p>
                  <p className="mt-0.5 text-xs text-[#7b8881]">{onboardingResult.parentInvitation.sent ? "A one-time activation link was sent. The recipient chooses their own password." : onboardingResult.parentInvitation.existingAccount ? "This email already has an account. No access was linked automatically." : "No invitation could be delivered."}</p>
                </div>
              )}
              <div className="flex flex-col-reverse gap-2 border-t border-[#e5ebe8] pt-5 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setOnboardingResult(null)}>Done</Button>
                <Button className="bg-[#173f35] hover:bg-[#245e4e]" onClick={() => window.open(onboardingResult.letterPath, "_blank")}>Print acceptance letter</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileFact({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return <div className={`rounded-xl border p-3 ${alert ? "border-[#e6c7ba] bg-[#fbf3ef]" : "border-[#e1e7e4] bg-[#fafbfa]"}`}><p className="text-[10px] font-semibold uppercase tracking-wide text-[#7b8881]">{label}</p><p className={`mt-1 text-sm font-semibold capitalize ${alert ? "text-[#984e34]" : "text-[#263b33]"}`}>{value}</p></div>;
}
