"use client";

import {
  ArrowRight,
  BookOpenCheck,
  CalendarCheck2,
  Check,
  ClipboardCheck,
  GraduationCap,
  Megaphone,
  School,
  ShieldCheck,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardData } from "@/lib/school-types";
import type { ModuleId } from "@/components/school-app";

function formatDate(value: string, timezone: string, options?: Intl.DateTimeFormatOptions) {
  const parsed = new Date(value.includes("T") ? value : `${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-ZW", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...options,
  }).format(parsed);
}

function friendlyAction(action: string) {
  const labels: Record<string, string> = {
    "student.created": "registered a student",
    "attendance.saved": "saved an attendance draft",
    "attendance.submitted": "submitted an attendance register",
  };
  return labels[action] ?? action.replaceAll(".", " ");
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof GraduationCap;
  accent: "forest" | "gold" | "blue" | "clay";
}) {
  const colors = {
    forest: "bg-[#e5f0eb] text-[#24634f]",
    gold: "bg-[#fbefd0] text-[#936813]",
    blue: "bg-[#e5edf4] text-[#3e617e]",
    clay: "bg-[#f4e7df] text-[#9a593b]",
  };
  return (
    <Card className="gap-4 border-[#dde5e0] bg-white py-5 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
      <CardContent className="px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.11em] text-[#73827a]">{label}</p>
            <p className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#173329]">{value}</p>
          </div>
          <span className={`grid size-10 place-items-center rounded-xl ${colors[accent]}`}><Icon className="size-5" /></span>
        </div>
        <p className="mt-4 text-xs leading-5 text-[#6b7972]">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardWorkspace({
  data,
  readiness,
  onNavigate,
  onRegister,
}: {
  data: DashboardData;
  readiness: { total: number; live: number; foundation: number; planned: number };
  onNavigate: (id: ModuleId) => void;
  onRegister: () => void;
}) {
  const firstName = data.workspace.displayName.split(/\s+/)[0] || "Administrator";
  const attendanceValue = data.summary.totalRegistersToday
    ? `${data.summary.submittedRegistersToday}/${data.summary.totalRegistersToday}`
    : "0";
  const setup = [
    { label: "Academic year", complete: Boolean(data.academicYear), detail: data.academicYear?.name ?? "No academic year configured" },
    { label: "Grade levels", complete: data.summary.gradeLevels > 0, detail: `${data.summary.gradeLevels} active` },
    { label: "Classes", complete: data.summary.classes > 0, detail: `${data.summary.classes} active` },
    { label: "Staff access", complete: data.summary.activeMemberships > 1, detail: `${data.summary.activeMemberships} active member${data.summary.activeMemberships === 1 ? "" : "s"}` },
  ];
  const setupComplete = setup.filter((item) => item.complete).length;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-[#143a31] px-6 py-7 text-white shadow-[0_18px_45px_rgba(21,58,49,.14)] sm:px-8 sm:py-8">
        <div className="absolute -right-16 -top-20 size-64 rounded-full border border-white/10" />
        <div className="absolute -right-4 -top-8 size-36 rounded-full border border-[#e3b84c]/30" />
        <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge className="border border-white/10 bg-white/10 text-white hover:bg-white/10">Live workspace</Badge>
              {data.academicYear && <Badge className="border border-[#e3b84c]/25 bg-[#e3b84c]/15 text-[#f7d77f] hover:bg-[#e3b84c]/15">{data.academicYear.name} · {data.academicYear.status}</Badge>}
            </div>
            <p className="text-sm text-white/62">{formatDate(data.today, data.workspace.timezone, { weekday: "long" })}</p>
            <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Good day, {firstName}.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/68">A verified view of {data.workspace.schoolName}. Every number below comes from your school database.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onNavigate("attendance")} variant="outline" className="border-white/18 bg-white/8 text-white shadow-none hover:bg-white/15 hover:text-white">
              <ClipboardCheck /> Take attendance
            </Button>
            <Button onClick={onRegister} className="bg-[#e3b84c] font-semibold text-[#173329] hover:bg-[#efc964]">
              <UserRoundPlus /> Register student
            </Button>
          </div>
        </div>
      </section>

      <section aria-label="Verified school summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active students" value={data.summary.activeStudents} detail={`${data.summary.guardians} guardian record${data.summary.guardians === 1 ? "" : "s"} linked across the school`} icon={GraduationCap} accent="forest" />
        <MetricCard label="Active classes" value={data.summary.classes} detail={`${data.summary.gradeLevels} configured grade level${data.summary.gradeLevels === 1 ? "" : "s"}`} icon={School} accent="gold" />
        <MetricCard label="New this month" value={data.summary.admissionsThisMonth} detail="Students with an admission date in the current month" icon={UsersRound} accent="blue" />
        <MetricCard label="Registers today" value={attendanceValue} detail={data.summary.totalRegistersToday ? "Submitted out of registers started today" : "No attendance registers started today"} icon={CalendarCheck2} accent="clay" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,.8fr)]">
        <Card className="gap-0 overflow-hidden border-[#dde5e0] bg-white py-0 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
          <CardHeader className="border-b border-[#e5ebe7] px-5 py-5 sm:px-6">
            <CardTitle className="font-serif text-xl">Class capacity</CardTitle>
            <CardDescription>Live enrolment against the configured limit.</CardDescription>
          </CardHeader>
          <CardContent className="px-5 py-5 sm:px-6">
            {data.classes.length ? (
              <div className="space-y-5">
                {data.classes.map((classroom) => {
                  const percentage = classroom.capacity ? Math.min(100, Math.round((classroom.enrolled / classroom.capacity) * 100)) : 0;
                  return (
                    <div key={classroom.id}>
                      <div className="mb-2 flex items-end justify-between gap-4">
                        <div><p className="text-sm font-semibold text-[#20352e]">{classroom.name}</p><p className="text-xs text-[#79867f]">{classroom.gradeName}</p></div>
                        <p className="text-xs font-medium text-[#65746d]"><span className="font-semibold text-[#20352e]">{classroom.enrolled}</span> / {classroom.capacity}</p>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[#edf1ef]"><div className="h-full rounded-full bg-[#3d7d67] transition-all" style={{ width: `${percentage}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-[#d9e2dd] bg-[#f8faf8] px-6 text-center">
                <div><School className="mx-auto size-7 text-[#82928a]" /><p className="mt-3 text-sm font-semibold">No active classes</p><p className="mt-1 text-xs leading-5 text-[#75837c]">Configure grades and classes before registering students.</p></div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 border-[#dde5e0] bg-white py-0 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
          <CardHeader className="border-b border-[#e5ebe7] px-5 py-5">
            <div className="flex items-center justify-between gap-4"><div><CardTitle className="font-serif text-xl">Continue setup</CardTitle><CardDescription className="mt-1">{setupComplete} of {setup.length} core checks complete</CardDescription></div><span className="font-serif text-2xl font-semibold text-[#2c6b57]">{Math.round((setupComplete / setup.length) * 100)}%</span></div>
          </CardHeader>
          <CardContent className="px-5 py-2">
            <div className="divide-y divide-[#e8edea]">
              {setup.map((item) => (
                <div key={item.label} className="flex items-center gap-3 py-4">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-full ${item.complete ? "bg-[#e3f0ea] text-[#28644f]" : "bg-[#f1f3f2] text-[#8a9690]"}`}>{item.complete ? <Check className="size-4" /> : <span className="size-2 rounded-full bg-current" />}</span>
                  <div className="min-w-0"><p className="text-sm font-semibold">{item.label}</p><p className="truncate text-xs text-[#75837c]">{item.detail}</p></div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {(data.notices?.length ?? 0) > 0 && (
        <Card className="gap-0 border-[#dde5e0] bg-white py-0 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
          <CardHeader className="border-b border-[#e5ebe7] px-5 py-5 sm:px-6">
            <div className="flex items-start justify-between gap-4"><div><CardTitle className="font-serif text-xl">School notices</CardTitle><CardDescription className="mt-1">Published announcements for staff.</CardDescription></div><Megaphone className="size-5 text-[#39735f]" /></div>
          </CardHeader>
          <CardContent className="px-5 py-2 sm:px-6">
            <ol className="divide-y divide-[#e8edea]">
              {data.notices!.map((notice) => (
                <li key={notice.id} className="py-4">
                  <p className="text-sm font-semibold">{notice.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#5f7067]">{notice.body}</p>
                  {notice.publishedAt && <p className="mt-1 text-xs text-[#78857e]">{formatDate(notice.publishedAt, data.workspace.timezone)}</p>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(330px,.85fr)]">
        <Card className="gap-0 border-[#dde5e0] bg-white py-0 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
          <CardHeader className="border-b border-[#e5ebe7] px-5 py-5 sm:px-6">
            <div className="flex items-start justify-between gap-4"><div><CardTitle className="font-serif text-xl">Recent activity</CardTitle><CardDescription className="mt-1">Real audited changes in this school.</CardDescription></div><ShieldCheck className="size-5 text-[#39735f]" /></div>
          </CardHeader>
          <CardContent className="px-5 py-2 sm:px-6">
            {data.recentActivity.length ? (
              <ol className="divide-y divide-[#e8edea]">
                {data.recentActivity.map((item) => (
                  <li key={item.id} className="flex gap-3 py-4">
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-[#d7aa3f]" />
                    <div className="min-w-0"><p className="text-sm"><span className="font-semibold">{item.actor}</span> {friendlyAction(item.action)}</p><p className="mt-1 text-xs text-[#78857e]">{formatDate(item.createdAt, data.workspace.timezone, { hour: "2-digit", minute: "2-digit" })}</p></div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="py-12 text-center"><BookOpenCheck className="mx-auto size-7 text-[#87958e]" /><p className="mt-3 text-sm font-semibold">No audited activity yet</p><p className="mt-1 text-xs text-[#75837c]">Completed actions will appear here.</p></div>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 border-[#d8e3dd] bg-[#edf4f0] py-0 shadow-none">
          <CardHeader className="px-5 pb-3 pt-5">
            <div className="flex items-center justify-between gap-4"><div><CardTitle className="font-serif text-xl">System readiness</CardTitle><CardDescription className="mt-1 text-[#61736a]">Honest delivery status across the full ERP.</CardDescription></div><Badge className="bg-[#183f35] text-white hover:bg-[#183f35]">{readiness.total} modules</Badge></div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[{ count: readiness.live, label: "Live", color: "text-[#24634f]" }, { count: readiness.foundation, label: "Foundation", color: "text-[#8a6519]" }, { count: readiness.planned, label: "Planned", color: "text-[#6f7b75]" }].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/70 bg-white/70 p-3"><p className={`font-serif text-2xl font-semibold ${item.color}`}>{item.count}</p><p className="mt-1 text-[11px] text-[#6c7b73]">{item.label}</p></div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-[#5f7067]">Only workflows with complete validation, persistence and permission checks are marked live. Planned modules remain visible so the whole system architecture is clear.</p>
            <Button variant="ghost" onClick={() => onNavigate("administration")} className="mt-3 -ml-3 text-[#245f4d] hover:bg-white/60 hover:text-[#183f35]">Review the foundation <ArrowRight /></Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
