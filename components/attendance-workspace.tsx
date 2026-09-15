"use client";

import { useEffect, useMemo, useState } from "react";
import { isQueuedResponse, OFFLINE_QUEUED_MESSAGE } from "@/lib/api-client";
import { CalendarCheck2, Check, CheckCircle2, Clock3, RotateCcw, Save, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Classroom } from "@/lib/school-types";

type AttendanceStatus = "present" | "absent" | "late" | "excused" | "sick";
type AttendanceStudent = {
  id: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  status: AttendanceStatus;
  reason: string | null;
};
type Register = { id: string; status: "draft" | "submitted"; submittedAt: string | null; lockedAt: string | null };

const statuses: Array<{ value: AttendanceStatus; label: string; short: string; selected: string }> = [
  { value: "present", label: "Present", short: "P", selected: "border-[#76ad96] bg-[#e2f1e9] text-[#215c48]" },
  { value: "late", label: "Late", short: "L", selected: "border-[#d9b65a] bg-[#fbf0cf] text-[#7c5a13]" },
  { value: "absent", label: "Absent", short: "A", selected: "border-[#d69a83] bg-[#f8e9e2] text-[#914a30]" },
  { value: "excused", label: "Excused", short: "E", selected: "border-[#9db3c7] bg-[#e8eff5] text-[#405f7a]" },
  { value: "sick", label: "Sick", short: "S", selected: "border-[#b8a4c9] bg-[#f0eaf5] text-[#644b78]" },
];

const staffStatuses = [
  { value: "present", label: "Present", short: "P", selected: "border-[#76ad96] bg-[#e2f1e9] text-[#215c48]" },
  { value: "late", label: "Late", short: "L", selected: "border-[#d9b65a] bg-[#fbf0cf] text-[#7c5a13]" },
  { value: "absent", label: "Absent", short: "A", selected: "border-[#d69a83] bg-[#f8e9e2] text-[#914a30]" },
  { value: "leave", label: "On leave", short: "V", selected: "border-[#9db3c7] bg-[#e8eff5] text-[#405f7a]" },
] as const;

type StaffRow = { id: string; employeeNumber: string; name: string; position: string; status: string; note: string | null; marked: boolean };

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function AttendanceWorkspace({ onChanged }: { onChanged: () => Promise<void> }) {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [classroomId, setClassroomId] = useState("");
  const [date, setDate] = useState(todayInputValue);
  const [session, setSession] = useState<"morning" | "afternoon">("morning");
  const [students, setStudents] = useState<AttendanceStudent[]>([]);
  const [register, setRegister] = useState<Register | null>(null);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingRegister, setLoadingRegister] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadClasses() {
      try {
        const response = await fetch("/api/classes", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Classes could not be loaded.");
        if (!active) return;
        setClassrooms(data.classrooms);
        setClassroomId((current) => current || data.classrooms[0]?.id || "");
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Classes could not be loaded.");
      } finally {
        if (active) setLoadingClasses(false);
      }
    }
    void loadClasses();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!classroomId) {
      return;
    }
    const controller = new AbortController();
    async function loadRegister() {
      setLoadingRegister(true);
      setError("");
      try {
        const response = await fetch(`/api/attendance?classroomId=${encodeURIComponent(classroomId)}&date=${encodeURIComponent(date)}&session=${session}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "The register could not be loaded.");
        setStudents(data.students);
        setRegister(data.register);
        setDirty(false);
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") setError(loadError instanceof Error ? loadError.message : "The register could not be loaded.");
      } finally {
        setLoadingRegister(false);
      }
    }
    void loadRegister();
    return () => controller.abort();
  }, [classroomId, date, session]);

  const counts = useMemo(() => Object.fromEntries(statuses.map((status) => [status.value, students.filter((student) => student.status === status.value).length])) as Record<AttendanceStatus, number>, [students]);
  const [scope, setScope] = useState<"learners" | "staff">("learners");
  const [staffRows, setStaffRows] = useState<StaffRow[]>([]);
  const [staffCanMark, setStaffCanMark] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffDirty, setStaffDirty] = useState(false);

  useEffect(() => {
    if (scope !== "staff") return;
    const controller = new AbortController();
    queueMicrotask(() => setStaffLoading(true));
    fetch(`/api/attendance?scope=staff&date=${encodeURIComponent(date)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "The staff register could not be loaded.");
        setStaffRows(data.staff ?? []);
        setStaffCanMark(Boolean(data.canMark));
        setStaffDirty(false);
      })
      .catch(() => undefined)
      .finally(() => setStaffLoading(false));
    return () => controller.abort();
  }, [scope, date]);

  function markStaff(staffId: string, status: string) {
    if (!staffCanMark) return;
    setStaffRows((current) => current.map((row) => row.id === staffId ? { ...row, status } : row));
    setStaffDirty(true);
  }

  async function saveStaff() {
    setSaving(true);
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_staff", date, entries: staffRows.map(({ id, status, note }) => ({ staffId: id, status, note: note || undefined })) }),
      });
      const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
      if (!response.ok) throw new Error(data.error || "The staff register could not be saved.");
      setStaffDirty(false);
      toast.success(`Staff register saved — ${data.marked} marked.`);
      await onChanged();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The staff register could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const selectedClass = classrooms.find((classroom) => classroom.id === classroomId);
  const readOnly = register?.status === "submitted" || Boolean(register?.lockedAt);

  function mark(studentId: string, status: AttendanceStatus) {
    if (readOnly) return;
    setStudents((current) => current.map((student) => student.id === studentId ? { ...student, status } : student));
    setDirty(true);
  }

  function markAllPresent() {
    if (readOnly) return;
    setStudents((current) => current.map((student) => ({ ...student, status: "present" })));
    setDirty(true);
  }

  async function save(submit: boolean) {
    if (!classroomId || !students.length) return;
    setSaving(true);
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classroomId, date, session, submit, entries: students.map(({ id, status, reason }) => ({ studentId: id, status, reason: reason || undefined })) }),
      });
      const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
      if (!response.ok) throw new Error(data.error || "The register could not be saved.");
      setRegister(data.register);
      setDirty(false);
      toast.success(submit ? "Attendance register submitted." : "Attendance draft saved.");
      await onChanged();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The register could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2"><Badge className="border border-[#bad7ca] bg-[#e8f2ed] text-[#245f4d] hover:bg-[#e8f2ed]">Live module</Badge><span className="text-xs text-[#78867f]">Student attendance</span></div>
          <div className="mt-3 flex items-center gap-3">
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#173329] sm:text-4xl">{scope === "staff" ? "Staff register" : "Class register"}</h1>
            <div className="flex rounded-lg border border-[#d5ded9] bg-white p-0.5">
              <button type="button" onClick={() => setScope("learners")} className={`rounded-md px-3 py-1 text-xs font-semibold ${scope === "learners" ? "bg-[#173f35] text-white" : "text-[#5d6d65]"}`}>Learners</button>
              <button type="button" onClick={() => setScope("staff")} className={`rounded-md px-3 py-1 text-xs font-semibold ${scope === "staff" ? "bg-[#173f35] text-white" : "text-[#5d6d65]"}`}>Staff</button>
            </div>
          </div>
          <p className="mt-2 text-sm text-[#68776f]">{scope === "staff" ? "Daily staff attendance — marked once per day by school leadership." : "Save a draft, review every learner, then submit an auditable register."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {scope === "staff" ? (
            staffCanMark ? <Button onClick={() => void saveStaff()} disabled={!staffDirty || saving || !staffRows.length} className="bg-[#173f35] hover:bg-[#245e4e]"><Save /> {saving ? "Saving…" : "Save staff register"}</Button> : <span className="self-center text-xs text-[#78867f]">Only leadership records staff attendance</span>
          ) : null}
          {scope === "learners" && <><Button variant="outline" onClick={markAllPresent} disabled={!students.length || readOnly || loadingRegister} className="border-[#d2dcd7] bg-white"><Check /> Mark all present</Button>
          <Button variant="outline" onClick={() => void save(false)} disabled={!dirty || saving || readOnly || !students.length} className="border-[#d2dcd7] bg-white"><Save /> {saving ? "Saving…" : "Save draft"}</Button>
          <Button onClick={() => void save(true)} disabled={saving || readOnly || !students.length} className="bg-[#173f35] hover:bg-[#245e4e]"><Send /> {saving ? "Submitting…" : "Submit register"}</Button></>}
        </div>
      </section>

      {scope === "staff" ? (
        <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4eae7] px-5 py-4">
            <div><p className="text-sm font-semibold">Staff attendance — {date}</p><p className="mt-0.5 text-xs text-[#75827b]">{staffRows.length} staff · {staffRows.filter((r) => r.marked).length} already marked</p></div>
            {staffDirty && <span className="flex items-center gap-1.5 text-xs font-medium text-[#8a6519]"><RotateCcw className="size-3.5" /> Unsaved changes</span>}
          </div>
          <CardContent className="px-4 py-4 sm:px-5">
            <div className="max-w-xs space-y-1.5 pb-4"><label htmlFor="staff-date" className="text-xs font-semibold text-[#56665e]">Register date</label><Input id="staff-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-10 border-[#d4ded9]" /></div>
            {staffLoading ? (
              <div className="space-y-3">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div>
            ) : !staffRows.length ? (
              <div className="px-6 py-12 text-center"><Users className="mx-auto size-8 text-[#849189]" /><p className="mt-4 text-sm font-semibold">No active staff</p><p className="mt-1 text-xs text-[#75827b]">Add staff under Staff & HR before taking the register.</p></div>
            ) : (
              <Table>
                <TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-3 text-xs uppercase tracking-wide text-[#74817b]">Staff member</TableHead><TableHead className="text-xs uppercase tracking-wide text-[#74817b]">Employee no.</TableHead><TableHead className="text-xs uppercase tracking-wide text-[#74817b]">Position</TableHead><TableHead className="pr-3 text-right text-xs uppercase tracking-wide text-[#74817b]">Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {staffRows.map((member) => (
                    <TableRow key={member.id} className="border-[#e8edea]">
                      <TableCell className="py-3 pl-3"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-full bg-[#e5eee9] text-xs font-bold text-[#2e6654]">{member.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span><span className="font-semibold text-[#20362e]">{member.name}</span></div></TableCell>
                      <TableCell className="font-mono text-xs text-[#55655d]">{member.employeeNumber}</TableCell>
                      <TableCell className="text-xs text-[#55655d]">{member.position}</TableCell>
                      <TableCell className="pr-3"><div className="flex justify-end gap-1.5">{staffStatuses.map((status) => <button key={status.value} type="button" title={status.label} aria-label={`Mark ${member.name} ${status.label}`} aria-pressed={member.status === status.value} onClick={() => markStaff(member.id, status.value)} disabled={!staffCanMark} className={`grid size-8 place-items-center rounded-lg border text-xs font-bold transition disabled:cursor-not-allowed ${member.status === status.value ? status.selected : "border-[#dfe5e2] bg-white text-[#7a8780] hover:bg-[#f3f6f4]"}`}>{status.short}</button>)}</div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {scope === "learners" ? <>
      <Card className="gap-0 border-[#dce4e0] bg-white py-0 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
        <CardContent className="grid gap-4 px-4 py-4 sm:grid-cols-3 sm:px-5 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end">
          <div className="space-y-1.5"><label htmlFor="attendance-class" className="text-xs font-semibold text-[#56665e]">Class</label><select id="attendance-class" value={classroomId} onChange={(event) => { const value = event.target.value; setClassroomId(value); if (!value) { setStudents([]); setRegister(null); } }} disabled={loadingClasses} className="h-10 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm"><option value="">{loadingClasses ? "Loading classes…" : "Select a class"}</option>{classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name} · {classroom.academicYear}</option>)}</select></div>
          <div className="space-y-1.5"><label htmlFor="attendance-date" className="text-xs font-semibold text-[#56665e]">Register date</label><Input id="attendance-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-10 border-[#d4ded9]" /></div>
          <div className="space-y-1.5"><label htmlFor="attendance-session" className="text-xs font-semibold text-[#56665e]">Session</label><select id="attendance-session" value={session} onChange={(event) => setSession(event.target.value as "morning" | "afternoon")} className="h-10 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm"><option value="morning">Morning</option><option value="afternoon">Afternoon</option></select></div>
          <div className="flex h-10 items-center"><Badge variant="outline" className={register?.status === "submitted" ? "border-[#b9d7ca] bg-[#e6f2ec] text-[#245e4c]" : register ? "border-[#e4d2a4] bg-[#fbf2d9] text-[#805e16]" : "border-[#d9dfdc] bg-[#f3f5f4] text-[#68756f]"}>{register?.status === "submitted" ? "Submitted" : register ? "Draft" : "Not started"}</Badge></div>
        </CardContent>
      </Card>

      {students.length > 0 && !loadingRegister && (
        <section aria-label="Attendance summary" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {statuses.map((status) => <div key={status.value} className="rounded-xl border border-[#dce4e0] bg-white p-4"><p className="text-xs font-semibold text-[#75827c]">{status.label}</p><p className="mt-1 font-serif text-2xl font-semibold text-[#20362e]">{counts[status.value]}</p></div>)}
        </section>
      )}

      <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4eae7] px-5 py-4">
          <div><p className="text-sm font-semibold">{selectedClass?.name ?? "Attendance roster"}</p><p className="mt-0.5 text-xs text-[#75827b]">{students.length} active student{students.length === 1 ? "" : "s"} · {session} session</p></div>
          {dirty && !readOnly && <span className="flex items-center gap-1.5 text-xs font-medium text-[#8a6519]"><RotateCcw className="size-3.5" /> Unsaved changes</span>}
          {readOnly && <span className="flex items-center gap-1.5 text-xs font-medium text-[#28624f]"><CheckCircle2 className="size-3.5" /> Submitted and read-only</span>}
        </div>
        {loadingClasses || loadingRegister ? (
          <div className="space-y-3 p-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div>
        ) : error ? (
          <div className="px-6 py-16 text-center"><p className="text-sm font-semibold text-[#9b5037]">{error}</p></div>
        ) : !classroomId ? (
          <div className="px-6 py-16 text-center"><CalendarCheck2 className="mx-auto size-8 text-[#849189]" /><p className="mt-4 text-sm font-semibold">Select an active class</p><p className="mt-1 text-xs text-[#75827b]">A roster appears after a class, date and session are selected.</p></div>
        ) : !students.length ? (
          <div className="px-6 py-16 text-center"><Users className="mx-auto size-8 text-[#849189]" /><p className="mt-4 text-sm font-semibold">No active students in this class</p><p className="mt-1 text-xs text-[#75827b]">Register or allocate students before starting attendance.</p></div>
        ) : (
          <Table>
            <TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5 text-xs uppercase tracking-wide text-[#74817b]">Student</TableHead><TableHead className="text-xs uppercase tracking-wide text-[#74817b]">Admission no.</TableHead><TableHead className="pr-5 text-right text-xs uppercase tracking-wide text-[#74817b]">Attendance status</TableHead></TableRow></TableHeader>
            <TableBody>
              {students.map((student) => (
                <TableRow key={student.id} className="border-[#e8edea]">
                  <TableCell className="py-4 pl-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-[#e5eee9] text-xs font-bold text-[#2e6654]">{student.firstName[0]}{student.lastName[0]}</span><span className="font-semibold text-[#20362e]">{student.firstName} {student.lastName}</span></div></TableCell>
                  <TableCell className="font-mono text-xs text-[#55655d]">{student.admissionNumber}</TableCell>
                  <TableCell className="pr-5"><div className="flex justify-end gap-1.5" role="group" aria-label={`Attendance for ${student.firstName} ${student.lastName}`}>{statuses.map((status) => <button key={status.value} type="button" title={status.label} aria-label={`Mark ${student.firstName} ${status.label}`} aria-pressed={student.status === status.value} onClick={() => mark(student.id, status.value)} disabled={readOnly} className={`grid size-8 place-items-center rounded-lg border text-xs font-bold transition disabled:cursor-not-allowed ${student.status === status.value ? status.selected : "border-[#dfe5e2] bg-white text-[#7a8780] hover:bg-[#f3f6f4]"}`}>{status.short}</button>)}</div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {students.length > 0 && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#e5ebe8] bg-[#fafbfa] px-5 py-3">{statuses.map((status) => <span key={status.value} className="flex items-center gap-1.5 text-[11px] text-[#6f7d76]"><span className={`grid size-5 place-items-center rounded border text-[9px] font-bold ${status.selected}`}>{status.short}</span>{status.label}</span>)}<span className="ml-auto flex items-center gap-1.5 text-[11px] text-[#77847d]"><Clock3 className="size-3.5" /> Drafts remain editable until submission</span></div>}
      </Card>
      </> : null}
    </div>
  );
}
