"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { isQueuedResponse, OFFLINE_QUEUED_MESSAGE } from "@/lib/api-client";
import { BookOpen, CheckCircle2, ClipboardList, FileText, GraduationCap, Plus, Save, School, Send, Users, type LucideIcon } from "lucide-react";
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
import type { Classroom } from "@/lib/school-types";

type AcademicData = {
  years: Array<{ id: string; name: string; startDate: string; endDate: string; status: string }>;
  gradeLevels: Array<{ id: string; name: string; gradeOrder: number; description: string | null }>;
  terms: Array<{ id: string; name: string; termNumber: number; startDate: string; endDate: string; status: string; resultsLockedAt: string | null; academicYearId: string; academicYear: string }>;
  subjects: Array<{ id: string; code: string; name: string; department: string | null; level: string; active: number }>;
  classSubjects: Array<{ id: string; classroomId: string; classroomName: string; subjectId: string; subjectCode: string; subjectName: string; teacherId: string | null; teacherName: string | null }>;
  assessments: Array<{ id: string; title: string; assessmentType: string; component: string; maxMarks: number; weightPercent: number; dueDate: string | null; status: string; publishedAt: string | null; termId: string; termName: string; classSubjectId: string; classroomName: string; subjectName: string; subjectCode: string; marksEntered: number }>;
  markbook: null | { stats: null | { count: number; average: number; highest: number; lowest: number; passRate: number }; assessment: { id: string; maxMarks: number; status: string; classroomId: string }; students: Array<{ id: string; admissionNumber: string; firstName: string; lastName: string; score: number | null; comment: string | null }> };
  instructors: Array<{ id: string; displayName: string; role: string }>;
  departments: Array<{ id: string; name: string; description: string | null; headStaffProfileId: string | null; headName: string | null; staffCount: number }>;
  staffPool: Array<{ id: string; name: string; position: string; isSenior: boolean }>;
  examSessions: Array<{ id: string; title: string; examDate: string; startTime: string; endTime: string; venue: string | null; termName: string; classroomName: string; subjectName: string | null; invigilatorName: string | null; seated: number; assessmentId: string | null; assessmentStatus: string | null }>;
  weightings: Array<{ id: string; subjectId: string | null; subjectName: string; caPercent: number; examPercent: number }>;
  lessonPlans: Array<{ id: string; classSubjectId: string; classSubjectName: string; lessonDate: string; topic: string; objectives: string | null; activities: string | null; resources: string | null; homework: string | null; status: string }>;
  notifications: Array<{ id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }>;
  unreadNotifications: number;
  teacherDesk: {
    subjects: Array<{ id: string; subjectName: string; classroomName: string; studentCount: number; assessments: Array<{ id: string; title: string; status: string; marksEntered: number; missing: number }>; missingMarks: number }>;
    missingMarks: number;
    assignments: Array<{ id: string; classSubjectId: string; title: string; dueDate: string; status: string; instructions: string }>;
    curriculum: Array<{ id: string; classSubjectId: string; title: string; objectives: string; orderIndex: number; status: string }>;
    analytics: Array<{ subjectName: string; classroomName: string; average: number | null; passRate: number | null; marked: number }>;
    watchList: Array<{ name: string; issue: string; detail: string }>;
    schoolAnalytics: Array<{ subjectName: string; average: number | null; passRate: number | null; marked: number }>;
    upcomingExams: Array<{ id: string; title: string; examDate: string; startTime: string; venue: string | null; classroomName: string }>;
    awaitingReports: Array<{ id: string; studentName: string; classroomName: string; status: string; returnedNote: string | null; termName: string }>;
    draftLessons: number;
  };
  gradingBands: Array<{ id: string; name: string; minPercent: number; maxPercent: number; grade: string; remark: string | null; isPass: number; sortOrder: number }>;
  permissions: { manageStructure: boolean; manageYears: boolean; manageAssessments: boolean; enterMarks: boolean; publishMarks: boolean };
};

type DialogMode = "year" | "grade" | "classroom" | "term" | "subject" | "assignment" | "assessment" | "department" | "exam" | "weighting" | "lesson" | "band" | "homework" | "topic" | null;
type MarkbookStudent = NonNullable<AcademicData["markbook"]>["students"][number];

function Field({ id, label, type = "text", required, defaultValue, placeholder }: { id: string; label: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}{required && <span className="text-[#b55736]">*</span>}</Label><Input id={id} name={id} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} className="h-10 border-[#d4ded9]" /></div>;
}

function statusBadge(status: string) {
  const style = status === "published" || status === "active" ? "border-[#b8d6c9] bg-[#e6f2ec] text-[#245f4d]" : status === "draft" || status === "planned" ? "border-[#e3d2a8] bg-[#fbf3dd] text-[#7c5d18]" : "border-[#d9dfdc] bg-[#f1f3f2] text-[#68756f]";
  return <Badge variant="outline" className={`capitalize ${style}`}>{status.replaceAll("_", " ")}</Badge>;
}

export function AcademicWorkspace({ initialTab = "desk" }: { initialTab?: "desk" | "structure" | "assessments" | "markbook" | "reports" }) {
  const [data, setData] = useState<AcademicData | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState("");
  const [marks, setMarks] = useState<Record<string, { score: string; comment: string }>>({});
  const [bulk, setBulk] = useState("");

  const load = useCallback(async (assessmentId?: string) => {
    setError("");
    try {
      const [academicResponse, classesResponse] = await Promise.all([
        fetch(`/api/academic${assessmentId ? `?assessmentId=${encodeURIComponent(assessmentId)}` : ""}`, { cache: "no-store" }),
        fetch("/api/classes", { cache: "no-store" }),
      ]);
      const [academicData, classesData] = await Promise.all([academicResponse.json(), classesResponse.json()]);
      if (!academicResponse.ok) throw new Error(academicData.error || "Academic records could not be loaded.");
      if (!classesResponse.ok) throw new Error(classesData.error || "Classes could not be loaded.");
      setData(academicData);
      setClassrooms(classesData.classrooms);
      if (academicData.markbook) {
        setMarks(Object.fromEntries(academicData.markbook.students.map((student: MarkbookStudent) => [student.id, { score: student.score === null ? "" : String(student.score), comment: student.comment ?? "" }])));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Academic records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function send(payload: object, success: string) {
    setSubmitting(true);
    try {
      const response = await fetch("/api/academic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (isQueuedResponse(result)) { toast.info(OFFLINE_QUEUED_MESSAGE); return result; }
      if (!response.ok) throw new Error(result.error || "The academic record could not be saved.");
      toast.success(success);
      setDialog(null);
      await load(selectedAssessmentId || undefined);
      return result;
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The academic record could not be saved.");
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (dialog === "year") await send({ action: "create_year", name: values.get("name"), startDate: values.get("startDate"), endDate: values.get("endDate") }, "Academic year created.");
    if (dialog === "grade") await send({ action: "create_grade", name: values.get("name"), gradeOrder: Number(values.get("gradeOrder")), description: values.get("description") || undefined, descriptorOnly: values.get("descriptorOnly") === "on" }, "Grade level created.");
    if (dialog === "classroom") await send({ action: "create_class", academicYearId: values.get("academicYearId"), gradeLevelId: values.get("gradeLevelId"), name: values.get("name"), capacity: Number(values.get("capacity")), room: values.get("room") || undefined, classTeacherId: values.get("classTeacherId") || undefined }, "Class created.");
    if (dialog === "term") await send({ action: "create_term", academicYearId: values.get("academicYearId"), name: values.get("name"), termNumber: Number(values.get("termNumber")), startDate: values.get("startDate"), endDate: values.get("endDate") }, "Academic term created.");
    if (dialog === "subject") await send({ action: "create_subject", code: values.get("code"), name: values.get("name"), department: values.get("department") || undefined, level: values.get("level") }, "Subject created.");
    if (dialog === "assignment") await send({ action: "assign_subject", classroomId: values.get("classroomId"), subjectId: values.get("subjectId"), teacherId: values.get("teacherId") || undefined }, "Subject assigned to the class.");
    if (dialog === "assessment") await send({ action: "create_assessment", termId: values.get("termId"), classSubjectId: values.get("classSubjectId"), title: values.get("title"), assessmentType: values.get("assessmentType"), maxMarks: Number(values.get("maxMarks")), weightPercent: Number(values.get("weightPercent")), dueDate: values.get("dueDate") }, "Assessment created.");
    if (dialog === "department") await send({ action: "create_department", name: values.get("name"), description: values.get("description") || undefined }, "Department created.");
    if (dialog === "weighting") await send({ action: "upsert_weighting", subjectId: values.get("subjectId") || undefined, caPercent: Number(values.get("caPercent")), examPercent: Number(values.get("examPercent")) }, "Report weighting saved.");
    if (dialog === "band") await send({ action: "upsert_grading_band", name: values.get("name"), minPercent: Number(values.get("minPercent")), maxPercent: Number(values.get("maxPercent")), grade: values.get("grade"), remark: values.get("remark") || undefined, isPass: values.get("isPass") === "on", sortOrder: Number(values.get("sortOrder")) }, "Grading band saved.");
    if (dialog === "homework") await send({ action: "create_assignment", classSubjectId: values.get("classSubjectId"), title: values.get("title"), instructions: values.get("instructions") || undefined, dueDate: values.get("dueDate"), publishAt: values.get("publishAt") || undefined }, "Assignment published to the portal.");
    if (dialog === "topic") await send({ action: "save_curriculum_topic", classSubjectId: values.get("classSubjectId"), title: values.get("title"), objectives: values.get("objectives") || undefined, orderIndex: Number(values.get("orderIndex") ?? 0) }, "Curriculum topic saved.");
    if (dialog === "lesson") await send({ action: "save_lesson_plan", classSubjectId: values.get("classSubjectId"), termId: values.get("termId") || undefined, lessonDate: values.get("lessonDate"), topic: values.get("topic"), objectives: values.get("objectives") || undefined, activities: values.get("activities") || undefined, resources: values.get("resources") || undefined, homework: values.get("homework") || undefined }, "Lesson plan saved.");
    if (dialog === "exam") await send({ action: "create_exam_session", termId: values.get("termId"), classroomId: values.get("classroomId"), subjectId: values.get("subjectId") || undefined, title: values.get("title"), examDate: values.get("examDate"), startTime: values.get("startTime"), endTime: values.get("endTime"), venue: values.get("venue") || undefined, invigilatorId: values.get("invigilatorId") || undefined, withAssessment: values.get("withAssessment") === "on" }, "Exam session scheduled.");
  }

  async function chooseAssessment(id: string) {
    setSelectedAssessmentId(id);
    setLoading(true);
    await load(id);
  }

  async function saveMarkbook() {
    if (!data?.markbook) return;
    const payloadMarks = data.markbook.students.map((student) => ({ studentId: student.id, score: marks[student.id]?.score === "" ? null : Number(marks[student.id].score), comment: marks[student.id]?.comment || undefined }));
    const result = await send({ action: "save_marks", assessmentId: data.markbook.assessment.id, marks: payloadMarks }, `${payloadMarks.length} mark${payloadMarks.length === 1 ? "" : "s"} saved.`);
    if (result) await chooseAssessment(data.markbook.assessment.id);
  }

  function applyBulk() {
    if (!data?.markbook) return;
    const byAdmission = new Map(data.markbook.students.map((st) => [st.admissionNumber, st.id]));
    const byName = new Map(data.markbook.students.map((st) => [(st.lastName + " " + st.firstName).toLowerCase(), st.id]));
    const next = { ...marks };
    let applied = 0;
    const skipped: string[] = [];
    for (const line of bulk.split(/\r?\n/)) {
      const parts = line.split(/[\t,]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const key = byAdmission.get(parts[0]) ?? byName.get(parts[0].toLowerCase()) ?? null;
      const score = Number(parts[1]);
      if (!key || Number.isNaN(score)) { skipped.push(line.trim()); continue; }
      next[key] = { score: parts[1], comment: parts.slice(2).join(" ") || next[key]?.comment || "" };
      applied++;
    }
    setMarks(next);
    if (skipped.length) toast.error(applied + " applied; " + skipped.length + " line(s) skipped — check the learner id or score.");
    else toast.success(applied + " mark(s) applied — review and save.");
    setBulk("");
  }
  async function reopenAssessment(id: string) {
    const reason = window.prompt("Reason for reopening this published assessment (visible in the audit log):");
    if (!reason || reason.trim().length < 5) return;
    await send({ action: "reopen_assessment", assessmentId: id, reason: reason.trim() }, "Assessment reopened for corrections.");
  }

  const selectedAssessment = data?.assessments.find((assessment) => assessment.id === selectedAssessmentId);
  const structureReady = Boolean(data?.terms.length && data.subjects.length && data.classSubjects.length);

  if (loading && !data) return <div className="space-y-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 w-full rounded-xl" />)}</div>;
  if (error && !data) return <div className="rounded-xl border border-[#ead6cd] bg-white p-8 text-center text-sm text-[#9a4e35]">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div><div className="flex items-center gap-2"><Badge className="border border-[#e3d2a8] bg-[#fbf3dd] text-[#7c5d18] hover:bg-[#fbf3dd]">Operational core</Badge><span className="text-xs text-[#78867f]">Teaching & learning</span></div><h1 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-[#173329] sm:text-4xl">Academics</h1><p className="mt-2 text-sm text-[#68776f]">Configure the teaching structure, create assessments and enter marks.</p></div>
        <div className="flex flex-wrap gap-2">{data.permissions.manageAssessments && <Button onClick={() => setDialog("assessment")} className="bg-[#173f35] hover:bg-[#245e4e]" disabled={!structureReady}><Plus /> New assessment</Button>}</div>
      </section>

      <Tabs defaultValue={initialTab} className="gap-5">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl border border-[#dae3de] bg-white p-1 sm:w-fit">
          <TabsTrigger value="desk" className="px-4 py-2">My desk{data.unreadNotifications ? <span className="ml-2 rounded-full bg-[#b55736] px-1.5 py-0.5 text-[10px] font-semibold text-white">{data.unreadNotifications}</span> : null}</TabsTrigger>
          <TabsTrigger value="structure" className="px-4 py-2">Structure</TabsTrigger>
          <TabsTrigger value="assessments" className="px-4 py-2">Assessments</TabsTrigger>
          <TabsTrigger value="markbook" className="px-4 py-2">Markbook</TabsTrigger>
          <TabsTrigger value="reports" className="px-4 py-2">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="desk" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <Summary label="Classes & subjects" value={data.teacherDesk.subjects.length} icon={BookOpen} />
            <Summary label="Missing marks" value={data.teacherDesk.missingMarks} icon={ClipboardList} />
            <Summary label="Reports awaiting" value={data.teacherDesk.awaitingReports.length} icon={FileText} />
            <Summary label="Draft lessons" value={data.teacherDesk.draftLessons} icon={CheckCircle2} />
          </div>

          {data.teacherDesk.awaitingReports.length ? <Card className="gap-0 border-[#e3d2a8] bg-[#fdf9ef] py-0"><CardContent className="px-5 py-4"><p className="text-sm font-semibold text-[#7c5d18]">Reports awaiting your action</p><div className="mt-3 space-y-2">{data.teacherDesk.awaitingReports.map((r) => <div key={r.id} className="flex items-center justify-between rounded-lg border border-[#e9dfc0] bg-white px-4 py-2 text-sm"><div><span className="font-semibold">{r.studentName}</span><span className="ml-2 text-xs text-[#8a7a4e]">{r.classroomName} · {r.termName} · {r.status.replaceAll("_", " ")}</span>{r.returnedNote ? <p className="text-xs text-[#984e34]">Returned: {r.returnedNote}</p> : null}</div></div>)}</div><p className="mt-3 text-xs text-[#8a7a4e]">Open the Report cards workspace to review, comment and move these through approval.</p></CardContent></Card> : null}

          <div className="grid gap-5 lg:grid-cols-2">
            <StructureCard title="My subjects" description="Marks-entry status per class subject" action={data.permissions.manageAssessments ? () => setDialog("assessment") : undefined}>
              {data.teacherDesk.subjects.length ? data.teacherDesk.subjects.map((sub) => <div key={sub.id} className="py-3"><div className="flex items-center justify-between"><p className="text-sm font-semibold">{sub.subjectName} · {sub.classroomName}</p><span className="text-xs text-[#74817a]">{sub.studentCount} learners</span></div>{sub.assessments.map((a) => <button key={a.id} onClick={() => void chooseAssessment(a.id)} className="mt-1.5 flex w-full items-center justify-between rounded-lg border border-[#e4eae7] px-3 py-1.5 text-left text-xs hover:bg-[#f5f9f7]"><span>{a.title}</span><span className={a.missing > 0 ? "font-semibold text-[#984e34]" : "text-[#2d6754]"}>{a.marksEntered} entered{a.missing > 0 ? " · " + a.missing + " missing" : ""} · {a.status}</span></button>)}</div>) : <Empty text="No subjects assigned to you yet" />}
            </StructureCard>

            {data.teacherDesk.analytics.some((a)=>a.average!==null)?<Card className="gap-0 border-[#dce4e0] bg-white py-0 lg:col-span-2"><CardHeader className="border-b border-[#e5ebe8] px-5 py-4"><CardTitle className="font-serif text-lg">Subject performance</CardTitle><CardDescription className="mt-1">Average and pass rate across published assessments</CardDescription></CardHeader><CardContent className="px-5 py-3"><div className="grid gap-2 sm:grid-cols-2">{data.teacherDesk.analytics.filter((a)=>a.average!==null).map((a)=><div key={a.subjectName+a.classroomName} className="flex items-center justify-between rounded-lg border border-[#e7ece9] px-3 py-2 text-sm"><span className="font-medium">{a.subjectName} <span className="text-xs text-[#87928d]">{a.classroomName}</span></span><span className="text-xs"><b>{a.average}%</b> avg · <b>{a.passRate}%</b> pass · {a.marked} marks</span></div>)}</div></CardContent></Card>:null}
            <StructureCard title="Upcoming exams" description="Sessions for your classes or invigilation">
              {data.teacherDesk.upcomingExams.length ? data.teacherDesk.upcomingExams.map((exam) => <RecordLine key={exam.id} title={exam.title} detail={exam.examDate + " " + exam.startTime + " · " + exam.classroomName + " · " + (exam.venue ?? "Venue TBC")} />) : <Empty text="No upcoming exams" />}
            </StructureCard>

            <StructureCard title="Lesson plans" description="Plan, deliver and record lessons" action={() => setDialog("lesson")}>
              {data.lessonPlans.length ? data.lessonPlans.map((plan) => <RecordLine key={plan.id} title={plan.topic} detail={plan.lessonDate + " · " + plan.classSubjectName + (plan.homework ? " · HW: " + plan.homework : "")} status={plan.status} action={plan.status === "planned" ? <Button size="sm" variant="ghost" onClick={() => void send({ action: "complete_lesson_plan", planId: plan.id }, "Lesson marked delivered.")}>Delivered</Button> : undefined} />) : <Empty text="No lesson plans yet" />}
            </StructureCard>

            {data.teacherDesk.watchList.length?<Card className="gap-0 border-[#e5c3b4] bg-white py-0"><CardHeader className="border-b border-[#efe0d8] px-5 py-4"><CardTitle className="font-serif text-lg text-[#984e34]">Watch list</CardTitle><CardDescription className="mt-1">Learners needing attention — failing or frequently absent</CardDescription></CardHeader><CardContent className="max-h-64 divide-y divide-[#f0e4dd] overflow-y-auto px-5 py-1">{data.teacherDesk.watchList.map((w,i)=><div key={i} className="flex items-center justify-between gap-3 py-2.5"><div><p className="text-sm font-semibold">{w.name}</p><p className="text-xs text-[#8a6a5c]">{w.detail}</p></div><Badge variant="outline" className="border-[#e5c3b4] text-[#984e34]">{w.issue}</Badge></div>)}</CardContent></Card>:null}

            {data.teacherDesk.schoolAnalytics.length?<Card className="gap-0 border-[#dce4e0] bg-white py-0"><CardHeader className="border-b border-[#e5ebe8] px-5 py-4"><CardTitle className="font-serif text-lg">School performance</CardTitle><CardDescription className="mt-1">Average and pass rate by subject across all published marks</CardDescription></CardHeader><CardContent className="px-5 py-3"><div className="space-y-1.5">{data.teacherDesk.schoolAnalytics.map((a)=><div key={a.subjectName} className="flex items-center gap-3 text-sm"><span className="w-32 truncate font-medium">{a.subjectName}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef2f0]"><div className="h-full rounded-full bg-[#2d6754]" style={{width:(a.passRate??0)+"%"}}/></div><span className="w-32 shrink-0 text-right text-xs text-[#68756f]">{a.average}% avg · {a.passRate}% pass</span></div>)}</div></CardContent></Card>:null}

            <Card className="gap-0 border-[#dce4e0] bg-white py-0"><CardHeader className="border-b border-[#e5ebe8] px-5 py-4"><div className="flex items-center justify-between"><div><CardTitle className="font-serif text-lg">Homework</CardTitle><CardDescription className="mt-1">Published to the parent and student portal</CardDescription></div>{data.permissions.enterMarks&&<Button size="sm" variant="outline" onClick={()=>setDialog("homework")}>New assignment</Button>}</div></CardHeader><CardContent className="max-h-64 divide-y divide-[#eef1ef] overflow-y-auto px-5 py-1">{data.teacherDesk.assignments.length?data.teacherDesk.assignments.map((a)=><div key={a.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold">{a.title}</p><p className="text-xs text-[#87928d]">{data.classSubjects.find((cs)=>cs.id===a.classSubjectId)?.subjectName??""} · due {String(a.dueDate).slice(0,10)}</p></div>{a.status==="published"?<Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={()=>void send({action:"close_assignment",assignmentId:a.id},"Assignment closed.")}>Close</Button>:<Badge variant="outline" className="text-[10px]">closed</Badge>}</div>):<p className="py-6 text-sm text-[#68776f]">No homework published yet.</p>}</CardContent></Card>

            <Card className="gap-0 border-[#dce4e0] bg-white py-0"><CardHeader className="border-b border-[#e5ebe8] px-5 py-4"><div className="flex items-center justify-between"><div><CardTitle className="font-serif text-lg">Curriculum coverage</CardTitle><CardDescription className="mt-1">Topic progress across your subjects</CardDescription></div>{data.permissions.enterMarks&&<Button size="sm" variant="outline" onClick={()=>setDialog("topic")}>Add topic</Button>}</div></CardHeader><CardContent className="max-h-64 divide-y divide-[#eef1ef] overflow-y-auto px-5 py-1">{data.teacherDesk.curriculum.length?data.teacherDesk.curriculum.map((t)=><div key={t.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold">{t.title}</p><p className="text-xs text-[#87928d]">{data.classSubjects.find((cs)=>cs.id===t.classSubjectId)?.subjectName??""}</p></div>{data.permissions.enterMarks?<select defaultValue={t.status} className="h-7 rounded-md border border-[#d4ded9] bg-white px-2 text-xs" onChange={(e)=>void send({action:"set_topic_status",topicId:t.id,status:e.target.value},"Topic updated.")}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select>:<Badge variant="outline" className="text-[10px]">{t.status.replaceAll("_"," ")}</Badge>}</div>):<p className="py-6 text-sm text-[#68776f]">No curriculum topics defined.</p>}</CardContent></Card>

            <StructureCard title="Notifications" description="Workflow alerts for your role" action={data.unreadNotifications ? () => void send({ action: "mark_notifications_read" }, "Notifications read.") : undefined}>
              {data.notifications.length ? data.notifications.map((n) => <RecordLine key={n.id} title={n.title + (n.readAt ? "" : " •")} detail={n.body} />) : <Empty text="No notifications" />}
            </StructureCard>
          </div>
        </TabsContent>

        <TabsContent value="structure" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3"><Summary label="Academic years" value={data.years.length} icon={CalendarIcon} /><Summary label="Classes" value={classrooms.length} icon={School} /><Summary label="Class offerings" value={data.classSubjects.length} icon={Users} /></div>
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            <StructureCard title="Academic years" description="The dated container for classes and terms" action={data.permissions.manageStructure ? () => setDialog("year") : undefined}>
              {data.years.length ? data.years.map((year) => <RecordLine key={year.id} title={year.name} detail={`${year.startDate} – ${year.endDate}`} status={year.status} action={data.permissions.manageYears && year.status === "planned" ? <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Activate ${year.name}? Confirmed enrolments become active, the current year's enrolments close, and top-grade leavers are marked as graduated.`)) void send({ action: "set_year_status", yearId: year.id, status: "active" }, `Academic year ${year.name} activated — enrolments rolled over.`); }}>Activate</Button> : undefined} />) : <Empty text="No academic years configured" />}
            </StructureCard>
            <StructureCard title="Grades" description="Ordered grade and form levels" action={data.permissions.manageStructure ? () => setDialog("grade") : undefined}>
              {data.gradeLevels.length ? data.gradeLevels.map((grade) => <RecordLine key={grade.id} title={grade.name} detail={`Order ${grade.gradeOrder}${grade.description ? ` · ${grade.description}` : ""}`} />) : <Empty text="No grade levels configured" />}
            </StructureCard>
            <StructureCard title="Classes" description="Year-specific learner groups" action={data.permissions.manageStructure ? () => setDialog("classroom") : undefined}>
              {classrooms.length ? classrooms.map((classroom) => <RecordLine key={classroom.id} title={classroom.name} detail={`${classroom.gradeName ?? "Grade pending"} · ${classroom.academicYear} · capacity ${classroom.capacity}`} />) : <Empty text="No classes configured" />}
            </StructureCard>
            <StructureCard title="Terms" description="School dates within an academic year" action={data.permissions.manageStructure ? () => setDialog("term") : undefined}>
              {data.terms.length ? data.terms.map((term) => <RecordLine key={term.id} title={`${term.academicYear} · ${term.name}`} detail={`${term.startDate} – ${term.endDate}${term.resultsLockedAt ? " · results locked" : ""}`} status={term.status} action={data.permissions.manageStructure ? <span className="flex gap-1">{term.status !== "closed" && <Button size="sm" variant="ghost" onClick={() => void send({ action: "set_term_status", termId: term.id, status: term.status === "active" ? "closed" : "active" }, `Term ${term.status === "active" ? "closed" : "activated"}.`)}>{term.status === "active" ? "Close" : "Activate"}</Button>}{term.status !== "closed" && <Button size="sm" variant="ghost" className={term.resultsLockedAt ? "text-[#984e34]" : ""} onClick={() => void send({ action: "lock_term_results", termId: term.id, locked: !term.resultsLockedAt }, `Results ${term.resultsLockedAt ? "unlocked" : "locked"}.`)}>{term.resultsLockedAt ? "Unlock results" : "Lock results"}</Button>}</span> : undefined} />) : <Empty text="No terms configured" />}
            </StructureCard>
            <StructureCard title="Subjects" description="School curriculum catalogue" action={data.permissions.manageStructure ? () => setDialog("subject") : undefined}>
              {data.subjects.length ? data.subjects.map((subject) => <RecordLine key={subject.id} title={subject.name} detail={`${subject.code} · ${subject.level.replaceAll("_", " ")}`} />) : <Empty text="No subjects configured" />}
            </StructureCard>
            <StructureCard title="Class subjects" description="Subjects offered to each class" action={data.permissions.manageStructure ? () => setDialog("assignment") : undefined}>
              {data.classSubjects.length ? data.classSubjects.map((item) => <RecordLine key={item.id} title={`${item.classroomName} · ${item.subjectName}`} detail={item.teacherName ?? "Teacher not assigned"} />) : <Empty text="No class subjects assigned" />}
            </StructureCard>
            <StructureCard title="Departments" description="Subject departments and their heads" action={data.permissions.manageStructure ? () => setDialog("department") : undefined}>
              {data.departments.length ? data.departments.map((department) => <RecordLine key={department.id} title={department.name} detail={`${department.staffCount} staff${department.headName ? ` · Head: ${department.headName}` : " · No head assigned"}`} action={data.permissions.manageStructure ? <select className="h-8 max-w-40 rounded-md border border-[#d4ded9] bg-white px-2 text-xs" value={department.headStaffProfileId ?? ""} onChange={(event) => void send({ action: "assign_department_head", departmentId: department.id, staffProfileId: event.target.value || null }, "Department head updated.")}><option value="">No head</option>{data.staffPool.map((member) => <option key={member.id} value={member.id}>{member.name}{member.isSenior ? " (Snr)" : ""}</option>)}</select> : undefined} />) : <Empty text="No departments configured" />}
            </StructureCard>
            {data.permissions.manageStructure ? <>
            <StructureCard title="Report weighting" description="CA vs examination split per subject" action={() => setDialog("weighting")}>
              {data.weightings.length ? data.weightings.map((w) => <RecordLine key={w.id} title={w.subjectName} detail={"CA " + w.caPercent + "% · Exam " + w.examPercent + "%"} />) : <Empty text="Using default CA 40 / exam 60" />}
            </StructureCard>
            <StructureCard title="Grading scale" description="Percentage bands to letter grades" action={() => setDialog("band")}>
              {data.gradingBands.length ? data.gradingBands.map((band) => <RecordLine key={band.id} title={band.grade + " — " + band.remark} detail={band.minPercent + "–" + band.maxPercent + "%" + (band.isPass ? "" : " · fail")} action={<Button size="sm" variant="ghost" onClick={() => void send({ action: "delete_grading_band", bandId: band.id }, "Grading band removed.")}>✕</Button>} />) : <Empty text="No grading bands configured" />}
            </StructureCard>
            </> : null}
            <StructureCard title="Exam sessions" description="Scheduled exams with venues, invigilators and seating" action={data.permissions.manageStructure ? () => setDialog("exam") : undefined}>
              {data.examSessions.length ? data.examSessions.map((exam) => <RecordLine key={exam.id} title={exam.title + (exam.subjectName ? " — " + exam.subjectName : "")} detail={`${exam.examDate} ${exam.startTime}–${exam.endTime} · ${exam.classroomName} · ${exam.venue ?? "Venue TBC"}${exam.invigilatorName ? " · " + exam.invigilatorName : ""} · ${exam.seated} seated${exam.assessmentId ? " · markbook linked" : ""}`} action={data.permissions.manageStructure ? <div className="flex gap-1">{exam.seated === 0 ? <Button size="sm" variant="outline" onClick={() => void send({ action: "generate_exam_seating", examSessionId: exam.id }, "Seating generated.")}>Seat</Button> : <a href={`/print/seating/${exam.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md border border-[#d3ddd7] px-2 py-1 text-xs font-medium text-[#28624f] hover:bg-[#f2f7f4]">Seating plan</a>}<Button size="sm" variant="ghost" onClick={() => void send({ action: "cancel_exam_session", examSessionId: exam.id }, "Exam session removed.")}>✕</Button></div> : undefined} />) : <Empty text="No exam sessions scheduled" />}
            </StructureCard>
          </div>
        </TabsContent>

        <TabsContent value="assessments">
          <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><div className="flex items-center justify-between border-b border-[#e4eae7] px-5 py-4"><div><p className="text-sm font-semibold">Assessment register</p><p className="mt-1 text-xs text-[#74817a]">{data.assessments.length} assessment{data.assessments.length === 1 ? "" : "s"}</p></div>{data.permissions.manageAssessments && <Button size="sm" onClick={() => setDialog("assessment")} disabled={!structureReady}><Plus /> Create</Button>}</div>
            {data.assessments.length ? <Table><TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Assessment</TableHead><TableHead>Class & subject</TableHead><TableHead>Term</TableHead><TableHead>Marks</TableHead><TableHead className="pr-5 text-right">Status</TableHead></TableRow></TableHeader><TableBody>{data.assessments.map((assessment) => <TableRow key={assessment.id}><TableCell className="py-4 pl-5"><p className="font-semibold">{assessment.title}</p><p className="text-xs capitalize text-[#74817a]">{assessment.assessmentType} · /{assessment.maxMarks} · {assessment.weightPercent}%</p></TableCell><TableCell>{assessment.classroomName}<p className="text-xs text-[#74817a]">{assessment.subjectName}</p></TableCell><TableCell>{assessment.termName}</TableCell><TableCell>{assessment.marksEntered}</TableCell><TableCell className="pr-5 text-right">{statusBadge(assessment.status)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyPanel icon={ClipboardList} title="No assessments" text="Create a term, subject offering and then the first assessment." />}
          </Card>
        </TabsContent>

        <TabsContent value="markbook" className="space-y-4">
          <Card className="gap-0 border-[#dce4e0] bg-white py-0"><CardContent className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-end"><div className="flex-1 space-y-2"><Label htmlFor="markbook-assessment">Assessment</Label><select id="markbook-assessment" value={selectedAssessmentId} onChange={(event) => void chooseAssessment(event.target.value)} className="h-10 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm"><option value="">Select an assessment</option>{data.assessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.classroomName} · {assessment.subjectName} · {assessment.title}</option>)}</select></div>{selectedAssessment && <Badge variant="outline" className="self-center border-[#d4ded9] capitalize">{selectedAssessment.component === "exam" ? "Examination" : "Continuous assessment"}</Badge>}{selectedAssessment && data.permissions.enterMarks && <Button onClick={() => void saveMarkbook()} disabled={submitting || selectedAssessment.status === "published"}><Save /> Save draft</Button>}{selectedAssessment && data.permissions.enterMarks && selectedAssessment.status !== "published" && <Button variant="outline" onClick={() => void send({ action: "publish_assessment", assessmentId: selectedAssessment.id }, "Marks submitted for moderation.")}><Send /> Submit marks</Button>}{selectedAssessment && data.permissions.publishMarks && selectedAssessment.status === "published" && <Button variant="outline" className="text-[#984e34]" onClick={() => void reopenAssessment(selectedAssessment.id)}>Reopen for correction</Button>}</CardContent></Card>
          {data.markbook && data.permissions.enterMarks && selectedAssessment?.status !== "published" ? <Card className="gap-0 border-[#dce4e0] bg-white py-0"><CardContent className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-end"><div className="flex-1 space-y-2"><Label htmlFor="bulk-marks">Bulk paste (Excel/CSV — one per line: admission no, score, optional comment)</Label><textarea id="bulk-marks" value={bulk} onChange={(e) => setBulk(e.target.value)} rows={3} placeholder={"NYP-0001, 78\nNYP-0002, 65"} className="w-full rounded-md border border-[#d4ded9] bg-white px-3 py-2 font-mono text-xs" /></div><Button variant="outline" onClick={applyBulk} disabled={!bulk.trim()}>Apply</Button></CardContent></Card> : null}
          {loading ? <Skeleton className="h-72 w-full rounded-xl" /> : data.markbook ? <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><div className="border-b border-[#e4eae7] px-5 py-4"><p className="text-sm font-semibold">Student marks</p><p className="mt-1 text-xs text-[#74817a]">Maximum {data.markbook.assessment.maxMarks} · {data.markbook.students.length} students{data.markbook.stats?` · avg ${data.markbook.stats.average} · high ${data.markbook.stats.highest} · low ${data.markbook.stats.lowest} · ${data.markbook.stats.passRate}% pass`:""}</p></div>{data.markbook.students.length ? <Table><TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Student</TableHead><TableHead>Admission no.</TableHead><TableHead className="w-36">Score</TableHead><TableHead className="pr-5">Comment</TableHead></TableRow></TableHeader><TableBody>{data.markbook.students.map((student) => <TableRow key={student.id}><TableCell className="py-3 pl-5 font-semibold">{student.firstName} {student.lastName}</TableCell><TableCell className="font-mono text-xs">{student.admissionNumber}{data.permissions.enterMarks?<button title="Record an academic observation" className="ml-2 rounded border border-[#d4ded9] px-1.5 py-0.5 text-[10px] text-[#5c6b63] hover:bg-[#f2f7f4]" onClick={()=>{const note=window.prompt("Private observation for "+student.firstName+" "+student.lastName+" (kept separate from report comments):");if(note&&note.trim().length>1)void send({action:"create_student_note",studentId:student.id,subjectId:selectedAssessment?undefined:undefined,note:note.trim()},"Observation recorded.");}}>note</button>:null}</TableCell><TableCell><Input type="number" min={0} max={data.markbook!.assessment.maxMarks} value={marks[student.id]?.score ?? ""} className={"h-9 " + ((marks[student.id]?.score ?? "") === "" ? "border-[#e0b8a4] bg-[#fdf6f1]" : "")} onChange={(event) => setMarks((current) => ({ ...current, [student.id]: { score: event.target.value, comment: current[student.id]?.comment ?? "" } }))} disabled={selectedAssessment?.status === "published" || !data.permissions.enterMarks} /></TableCell><TableCell className="pr-5"><Input value={marks[student.id]?.comment ?? ""} onChange={(event) => setMarks((current) => ({ ...current, [student.id]: { score: current[student.id]?.score ?? "", comment: event.target.value } }))} disabled={selectedAssessment?.status === "published" || !data.permissions.enterMarks} placeholder="Optional" className="h-9" /></TableCell></TableRow>)}</TableBody></Table> : <EmptyPanel icon={GraduationCap} title="No active students" text="This class has no students available for mark entry." />}</Card> : <EmptyPanel icon={ClipboardList} title="Choose an assessment" text="Select an assessment to open its school-scoped markbook." />}
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <Card className="gap-0 border-[#dce4e0] bg-white py-0"><CardHeader className="border-b border-[#e5ebe8] px-5 py-5"><CardTitle className="font-serif text-xl">Published assessments</CardTitle><CardDescription className="mt-1">Locked assessment sets ready for report-card generation.</CardDescription></CardHeader><CardContent className="px-5 py-5">{data.assessments.some((item) => item.status === "published") ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.assessments.filter((item) => item.status === "published").map((item) => <div key={item.id} className="rounded-xl border border-[#dfe6e2] p-4"><div className="flex items-start justify-between gap-3"><FileText className="size-5 text-[#34705c]" />{statusBadge(item.status)}</div><p className="mt-4 font-semibold">{item.title}</p><p className="mt-1 text-sm text-[#66766e]">{item.classroomName} · {item.subjectName}</p><p className="mt-3 text-xs text-[#78857e]">{item.marksEntered} locked result{item.marksEntered === 1 ? "" : "s"}</p></div>)}</div> : <Empty text="No assessments have been published" />}</CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle className="font-serif text-2xl">{academicDialogTitle(dialog)}</DialogTitle><DialogDescription>All references are verified within the active school before saving.</DialogDescription></DialogHeader><form onSubmit={submitDialog} className="space-y-4">
        {dialog === "year" && <><Field id="name" label="Academic year name" required placeholder="2027" /><div className="grid gap-4 sm:grid-cols-2"><Field id="startDate" label="Start date" type="date" required /><Field id="endDate" label="End date" type="date" required /></div></>}
        {dialog === "grade" && <><div className="grid gap-4 sm:grid-cols-2"><Field id="name" label="Grade or form" required placeholder="Grade 4" /><Field id="gradeOrder" label="Display order" type="number" required defaultValue="4" /></div><Field id="description" label="Description" placeholder="Optional" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="descriptorOnly" className="size-4 rounded border-[#c9d5cf]"/>Descriptor-only reporting (ECD / infant — no percentages on report cards)</label></>}
        {dialog === "classroom" && <><div className="grid gap-4 sm:grid-cols-2"><SelectField id="academicYearId" label="Academic year" options={data.years.map((year) => ({ value: year.id, label: year.name }))} /><SelectField id="gradeLevelId" label="Grade" options={data.gradeLevels.map((grade) => ({ value: grade.id, label: grade.name }))} /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="name" label="Class name" required placeholder="Grade 4 Blue" /><Field id="capacity" label="Capacity" type="number" required defaultValue="40" /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="room" label="Room" placeholder="Optional" /><OptionalSelectField id="classTeacherId" label="Class teacher" options={data.instructors.map((teacher) => ({ value: teacher.id, label: `${teacher.displayName} · ${teacher.role.replaceAll("_", " ")}` }))} /></div></>}
        {dialog === "term" && <><SelectField id="academicYearId" label="Academic year" options={data.years.map((year) => ({ value: year.id, label: year.name }))} /><div className="grid gap-4 sm:grid-cols-2"><Field id="name" label="Term name" required placeholder="Term 1" /><Field id="termNumber" label="Term number" type="number" required defaultValue="1" /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="startDate" label="Start date" type="date" required /><Field id="endDate" label="End date" type="date" required /></div></>}
        {dialog === "subject" && <><div className="grid gap-4 sm:grid-cols-2"><Field id="code" label="Subject code" required placeholder="MAT" /><Field id="name" label="Subject name" required placeholder="Mathematics" /></div><Field id="department" label="Department" placeholder="Optional" /><SelectField id="level" label="Curriculum level" options={[{ value: "all", label: "All levels" }, { value: "primary", label: "Primary" }, { value: "secondary", label: "Secondary" }, { value: "high_school", label: "High school" }]} /></>}
        {dialog === "assignment" && <><SelectField id="classroomId" label="Class" options={classrooms.map((item) => ({ value: item.id, label: `${item.name} · ${item.academicYear}` }))} /><SelectField id="subjectId" label="Subject" options={data.subjects.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /><OptionalSelectField id="teacherId" label="Subject teacher" options={data.instructors.map((teacher) => ({ value: teacher.id, label: `${teacher.displayName} · ${teacher.role.replaceAll("_", " ")}` }))} /></>}
        {dialog === "exam" && <><SelectField id="termId" label="Term" options={data.terms.map((item) => ({ value: item.id, label: `${item.academicYear} · ${item.name}` }))} /><SelectField id="classroomId" label="Class" options={classrooms.map((item) => ({ value: item.id, label: `${item.name} · ${item.academicYear}` }))} /><OptionalSelectField id="subjectId" label="Subject (optional)" options={data.subjects.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /><Field id="title" label="Exam title" required placeholder="End of term examination" /><div className="grid gap-4 sm:grid-cols-3"><Field id="examDate" label="Date" type="date" required /><Field id="startTime" label="Start" type="time" required /><Field id="endTime" label="End" type="time" required /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="venue" label="Venue" placeholder="e.g. Main hall" /><OptionalSelectField id="invigilatorId" label="Invigilator" options={data.instructors.map((teacher) => ({ value: teacher.id, label: teacher.displayName }))} /></div><label className="flex items-center gap-2 text-sm text-[#43554d]"><input type="checkbox" name="withAssessment" className="size-4 rounded border-[#c9d5cf]" /> Also create the linked markbook assessment (needs a subject)</label></>}
        {dialog === "weighting" && <><OptionalSelectField id="subjectId" label="Subject (leave blank for the school default)" options={data.subjects.map((item) => ({ value: item.id, label: item.code + " · " + item.name }))} /><div className="grid gap-4 sm:grid-cols-2"><Field id="caPercent" label="Continuous assessment %" type="number" required defaultValue="40" /><Field id="examPercent" label="Examination %" type="number" required defaultValue="60" /></div><p className="text-xs text-[#74817a]">Final mark = CA score × CA% + exam score × exam%. CA and exam weights must total 100.</p></>}
        {dialog === "band" && <><div className="grid gap-4 sm:grid-cols-2"><Field id="name" label="Scale name" required defaultValue="Primary Scale" /><Field id="grade" label="Grade letter" required placeholder="A" /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="minPercent" label="Min %" type="number" required /><Field id="maxPercent" label="Max %" type="number" required /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="remark" label="Remark" placeholder="Excellent" /><Field id="sortOrder" label="Order" type="number" required defaultValue="1" /></div><label className="flex items-center gap-2 text-sm text-[#43554d]"><input type="checkbox" name="isPass" defaultChecked className="size-4 rounded border-[#c9d5cf]" /> Counts as a pass</label></>}
        {dialog === "lesson" && <><SelectField id="classSubjectId" label="Class subject" options={data.teacherDesk.subjects.map((item) => ({ value: item.id, label: item.classroomName + " · " + item.subjectName }))} /><OptionalSelectField id="termId" label="Term" options={data.terms.map((item) => ({ value: item.id, label: item.academicYear + " · " + item.name }))} /><div className="grid gap-4 sm:grid-cols-2"><Field id="lessonDate" label="Lesson date" type="date" required /><Field id="topic" label="Topic" required placeholder="Long division" /></div><Field id="objectives" label="Objectives" placeholder="Learners will…" /><Field id="activities" label="Learning activities" placeholder="Group work, worked examples…" /><div className="grid gap-4 sm:grid-cols-2"><Field id="resources" label="Resources" placeholder="Textbook ch. 4" /><Field id="homework" label="Homework" placeholder="Exercise 4.2" /></div></>}
        {dialog === "homework" && <><SelectField id="classSubjectId" label="Class subject" options={data.teacherDesk.subjects.map((item) => ({ value: item.id, label: item.classroomName + " · " + item.subjectName }))} /><Field id="title" label="Assignment title" required placeholder="Reading worksheet 4" /><Field id="instructions" label="Instructions" placeholder="Complete questions 1–6" /><div className="grid gap-4 sm:grid-cols-2"><Field id="dueDate" label="Due date" type="date" required /><Field id="publishAt" label="Publish on" type="date" /></div></>}
        {dialog === "topic" && <><SelectField id="classSubjectId" label="Class subject" options={data.teacherDesk.subjects.map((item) => ({ value: item.id, label: item.classroomName + " · " + item.subjectName }))} /><Field id="title" label="Topic" required placeholder="Fractions" /><Field id="objectives" label="Objectives" placeholder="Learners will simplify and compare fractions" /><Field id="orderIndex" label="Order" type="number" defaultValue="0" /></>}
        {dialog === "department" && <><Field id="name" label="Department name" required placeholder="Mathematics" /><Field id="description" label="Description" placeholder="Subjects and staff in this department" /></>}
        {dialog === "assessment" && <><SelectField id="termId" label="Term" options={data.terms.map((item) => ({ value: item.id, label: `${item.academicYear} · ${item.name}` }))} /><SelectField id="classSubjectId" label="Class subject" options={data.classSubjects.map((item) => ({ value: item.id, label: `${item.classroomName} · ${item.subjectName}` }))} /><Field id="title" label="Assessment title" required placeholder="Term test" /><div className="grid gap-4 sm:grid-cols-2"><SelectField id="assessmentType" label="Type" options={["assignment", "test", "project", "practical", "midterm", "exam"].map((value) => ({ value, label: value.replace(/\b\w/g, (x) => x.toUpperCase()) }))} /><Field id="dueDate" label="Assessment date" type="date" required /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="maxMarks" label="Maximum marks" type="number" required defaultValue="100" /><Field id="weightPercent" label="Report weight (%)" type="number" required defaultValue="100" /></div></>}
        <div className="flex justify-end gap-2 border-t border-[#e5ebe8] pt-4"><Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={submitting}>{submitting ? "Saving…" : "Save"}</Button></div>
      </form></DialogContent></Dialog>
    </div>
  );
}

const CalendarIcon = ClipboardList;
function Summary({ label, value, icon: Icon }: { label: string; value: number; icon: LucideIcon }) { return <Card className="gap-0 border-[#dce4e0] bg-white py-0"><CardContent className="flex items-center justify-between px-5 py-5"><div><p className="text-sm text-[#6e7c75]">{label}</p><p className="mt-1 font-serif text-3xl font-semibold">{value}</p></div><span className="grid size-10 place-items-center rounded-xl bg-[#e6f0eb] text-[#2d6754]"><Icon className="size-5" /></span></CardContent></Card>; }
function StructureCard({ title, description, action, children }: { title: string; description: string; action?: () => void; children: React.ReactNode }) { return <Card className="gap-0 border-[#dce4e0] bg-white py-0"><CardHeader className="border-b border-[#e5ebe8] px-5 py-4"><div className="flex items-start justify-between gap-3"><div><CardTitle className="font-serif text-lg">{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div>{action && <Button variant="outline" size="icon-sm" onClick={action} aria-label={`Add ${title}`}><Plus /></Button>}</div></CardHeader><CardContent className="max-h-80 divide-y divide-[#e7ece9] overflow-y-auto px-5 py-1">{children}</CardContent></Card>; }
function RecordLine({ title, detail, status, action }: { title: string; detail: string; status?: string; action?: React.ReactNode }) { return <div className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="mt-1 truncate text-xs text-[#74817a]">{detail}</p></div><div className="flex shrink-0 items-center gap-1">{status && statusBadge(status)}{action}</div></div>; }
function Empty({ text }: { text: string }) { return <div className="py-8 text-center"><CheckCircle2 className="mx-auto size-6 text-[#91a099]" /><p className="mt-2 text-sm text-[#718078]">{text}</p></div>; }
function EmptyPanel({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) { return <div className="rounded-xl border border-dashed border-[#d9e2dd] bg-white px-6 py-14 text-center"><Icon className="mx-auto size-8 text-[#87958e]" /><p className="mt-3 font-semibold">{title}</p><p className="mx-auto mt-1 max-w-sm text-sm text-[#718078]">{text}</p></div>; }
function SelectField({ id, label, options }: { id: string; label: string; options: Array<{ value: string; label: string }> }) { return <div className="space-y-2"><Label htmlFor={id}>{label}<span className="text-[#b55736]">*</span></Label><select id={id} name={id} required defaultValue="" className="h-10 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm"><option value="" disabled>Select {label.toLowerCase()}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }
function OptionalSelectField({ id, label, options }: { id: string; label: string; options: Array<{ value: string; label: string }> }) { return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><select id={id} name={id} defaultValue="" className="h-10 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm"><option value="">Not assigned</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }
function academicDialogTitle(dialog: DialogMode) { return ({ year: "Create academic year", grade: "Create grade level", classroom: "Create class", term: "Create term", subject: "Create subject", assignment: "Assign subject", assessment: "Create assessment", department: "Create department", exam: "Schedule exam session", weighting: "Report weighting", band: "Add grading band", lesson: "New lesson plan", homework: "New assignment", topic: "New curriculum topic" } as Record<string, string>)[dialog ?? ""] ?? "Academic record"; }
