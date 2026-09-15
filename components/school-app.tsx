"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isQueuedResponse, OFFLINE_QUEUED_MESSAGE } from "@/lib/api-client";
import {
  Accessibility,
  Activity,
  ShieldAlert,
  UserRoundCheck,
  BarChart3,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  FileText,
  GraduationCap,
  HeartPulse,
  Home,
  KeyRound,
  Library,
  LogOut,
  Mail,
  Search,
  ShieldCheck,
  UserRoundCog,
  UserRoundPlus,
  Users,
  UsersRound,
  Bus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOut } from "next-auth/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { DocumentsWorkspace } from "@/components/documents-workspace";
import { DashboardWorkspace } from "@/components/dashboard-workspace";
import { StudentsWorkspace } from "@/components/students-workspace";
import { AttendanceWorkspace } from "@/components/attendance-workspace";
import { AcademicWorkspace } from "@/components/academic-workspace";
import { FinanceWorkspace } from "@/components/finance-workspace";
import { PastoralWorkspace, type PastoralModule } from "@/components/pastoral-workspace";
import { OperationsWorkspace, type OperationsModule } from "@/components/operations-workspace";
import { TimetableWorkspace } from "@/components/timetable-workspace";
import { ReportCardsWorkspace } from "@/components/report-cards-workspace";
import { GuardiansWorkspace } from "@/components/guardians-workspace";
import { ReportsWorkspace } from "@/components/reports-workspace";
import { AdministrationWorkspace } from "@/components/administration-workspace";
import { PortalWorkspace } from "@/components/portal-workspace";
import { ModuleWorkspace } from "@/components/module-workspace";
import type { DashboardData } from "@/lib/school-types";

export type ModuleStatus = "live" | "foundation" | "planned";
export type ModuleId =
  | "dashboard"
  | "admissions"
  | "students"
  | "guardians"
  | "parents"
  | "staff"
  | "academics"
  | "timetable"
  | "attendance"
  | "exams"
  | "reports-cards"
  | "finance"
  | "communication"
  | "discipline"
  | "clinic"
  | "library"
  | "boarding"
  | "transport"
  | "inventory"
  | "events"
  | "documents"
  | "reports"
  | "administration"
  | "health"
  | "safeguarding"
  | "sen"
  | "pickups"
  | "activities";

export type ModuleDefinition = {
  id: ModuleId;
  title: string;
  shortTitle?: string;
  description: string;
  status: ModuleStatus;
  icon: LucideIcon;
  available: string[];
  next: string[];
  roles?: string[];
};

const allStaffRoles = ["super_admin", "school_admin", "headmaster", "deputy_head", "bursar", "admissions_officer", "teacher", "class_teacher", "hod", "librarian", "boarding_staff", "transport_staff", "clinic_staff", "it_admin"];
const adminRoles = ["super_admin", "school_admin", "headmaster", "deputy_head", "it_admin"];
const financeRoles = ["super_admin", "school_admin", "headmaster", "bursar"];
const sensitiveRoles = ["super_admin", "school_admin", "headmaster", "it_admin"];
const admissionsRoles = ["super_admin", "school_admin", "headmaster", "admissions_officer"];
const staffRoles = ["super_admin", "school_admin", "headmaster", "bursar"];
const academicRoles = ["super_admin", "school_admin", "headmaster", "deputy_head", "hod", "teacher", "class_teacher"];
const disciplineRoles = ["super_admin", "school_admin", "headmaster", "deputy_head", "teacher", "class_teacher", "boarding_staff"];
const clinicRoles = ["super_admin", "school_admin", "headmaster", "clinic_staff"];
const libraryRoles = ["super_admin", "school_admin", "headmaster", "librarian"];
const boardingRoles = ["super_admin", "school_admin", "headmaster", "boarding_staff"];
const transportRoles = ["super_admin", "school_admin", "headmaster", "transport_staff"];
const inventoryRoles = ["super_admin", "school_admin", "headmaster", "bursar"];
const pastoralModules: PastoralModule[] = ["health", "safeguarding", "sen", "pickups", "activities"];
const operationalModules: OperationsModule[] = ["admissions", "staff", "communication", "discipline", "clinic", "library", "boarding", "transport", "inventory", "events"];

export const moduleGroups: Array<{ label: string; items: ModuleDefinition[] }> = [
  {
    label: "Workspace",
    items: [
      { id: "dashboard", title: "Dashboard", description: "A verified snapshot of school operations.", status: "live", icon: Home, available: ["Real enrolment counts", "Class capacity", "Recent audit activity"], next: [] },
    ],
  },
  {
    label: "Enrolment & people",
    items: [
      { id: "admissions", title: "Admissions", description: "Move applicants from enquiry through approval to class placement.", status: "live", icon: UserRoundPlus, available: ["Application register", "Review and approval workflow", "Atomic guardian, learner and class enrolment"], next: ["Admission letter templates", "Applicant document upload"], roles: admissionsRoles },
      { id: "students", title: "Students", description: "The authoritative learner directory and digital profile.", status: "live", icon: GraduationCap, available: ["School-scoped directory", "Validated registration", "CSV export"], next: ["Transfers and promotions", "Profile editing", "Alumni workflow"] },
      { id: "guardians", title: "Guardians", description: "Family contacts and learner relationships.", status: "live", icon: UsersRound, available: ["Searchable guardian directory", "Multiple-child relationships", "Pickup and financial contact details"], next: ["Bulk guardian import"] },
      { id: "parents", title: "Parent portal", description: "One secure view of every linked child.", status: "live", icon: Users, available: ["Multiple linked children", "Balances, attendance and reports", "Timetable, announcements and events"], next: ["Online payment provider"], roles: ["parent"] },
      { id: "staff", title: "Staff & HR", description: "Employee directory, employment records and leave decisions.", status: "live", icon: BriefcaseBusiness, available: ["Employee directory", "Employment status", "Leave requests and decisions"], next: ["Contract documents", "Payslip generation"], roles: staffRoles },
    ],
  },
  {
    label: "Teaching & learning",
    items: [
      { id: "academics", title: "Academic structure", shortTitle: "Academics", description: "Academic years, terms, grades, classes, subjects and teaching assignments.", status: "live", icon: BookOpen, available: ["Academic years and terms", "Subjects and class offerings", "Teacher-scoped access"], next: ["Department administration", "Curriculum templates"], roles: academicRoles },
      { id: "timetable", title: "Timetables", description: "Conflict-aware class, room and teacher schedules.", status: "live", icon: CalendarDays, available: ["Weekly class schedule", "Teacher and room assignment", "Conflict detection and cancellation"], next: ["Reusable period templates", "Dedicated exam schedules"], roles: academicRoles },
      { id: "attendance", title: "Attendance", description: "Daily school-scoped class registers with an audit trail.", status: "live", icon: ClipboardCheck, available: ["Morning and afternoon registers", "Staff attendance register", "Draft and submit workflow", "Guardian absence notifications", "Chronic absence flagging"], next: [], roles: [...academicRoles, "boarding_staff"] },
      { id: "exams", title: "Exams & marks", description: "Assessments, mark entry, submission and moderation.", status: "live", icon: ClipboardList, available: ["CA/exam components per assessment", "Spreadsheet markbook + bulk paste", "Submit → reopen by HOD with audit"], next: [], roles: academicRoles },
      { id: "reports-cards", title: "Report cards", description: "Weighted CA + exam reports with a full approval pipeline.", status: "live", icon: FileBarChart, available: ["CA + exam weighted finals", "Class teacher → HOD → Head sign-off", "Previous-term trends and class position"], next: ["Branded PDF templates"], roles: academicRoles },
    ],
  },
  {
    label: "Finance & engagement",
    items: [
      { id: "finance", title: "Fees & finance", description: "Currency-safe fee invoicing, collections, receipts and debtors.", status: "live", icon: CircleDollarSign, available: ["Separate USD and ZiG records", "Multi-invoice allocations and credits", "Audited receipts and reversals"], next: ["Bank-statement import and reconciliation"], roles: financeRoles },
      { id: "communication", title: "Communication", description: "Targeted notices with honest delivery-state tracking.", status: "live", icon: Mail, available: ["Draft and publish workflow", "Audience targeting", "In-app and provider outbox states"], next: ["Email/SMS provider connection", "WhatsApp provider integration"], roles: allStaffRoles },
    ],
  },
  {
    label: "Student welfare",
    items: [
      { id: "discipline", title: "Behaviour & discipline", shortTitle: "Discipline", description: "Positive behaviour and incident resolution with protected narratives.", status: "live", icon: ShieldCheck, available: ["Incident and merit records", "Severity and guardian status", "Resolution workflow"], next: ["Protected counselling workspace", "Parent meeting minutes"], roles: disciplineRoles },
      { id: "health", title: "Health profiles", description: "Confidential medical details, allergies and emergency instructions.", status: "live", icon: HeartPulse, available: ["Blood group, allergies, conditions", "Medications and doctor contacts", "Emergency notes"], next: [], roles: ["super_admin", "school_admin", "headmaster", "clinic_staff"] },
      { id: "safeguarding", title: "Safeguarding", description: "Child-protection cases — restricted to designated officers.", status: "live", icon: ShieldAlert, available: ["Concern register", "Escalation and referral", "Designated officer assignment"], next: [], roles: ["super_admin", "school_admin", "headmaster"] },
      { id: "sen", title: "Learning support", shortTitle: "Support", description: "Special educational needs, intervention plans and review cycles.", status: "live", icon: Accessibility, available: ["Need categories and assessments", "Intervention plans and accommodations", "Targets and review dates"], next: [], roles: ["super_admin", "school_admin", "headmaster", "deputy_head", "hod", "clinic_staff"] },
      { id: "pickups", title: "Pickup authorization", shortTitle: "Pickups", description: "Named adults authorized to collect each learner.", status: "live", icon: UserRoundCheck, available: ["Authorized persons per learner", "Validity windows and ID", "Revocation with audit"], next: [], roles: ["super_admin", "school_admin", "headmaster", "deputy_head", "admissions_officer", "class_teacher", "boarding_staff"] },
      { id: "activities", title: "Clubs & trips", description: "Extracurricular clubs, excursions, consent and payments.", status: "live", icon: Activity, available: ["Club register and membership", "Trip planning and rosters", "Consent and payment tracking"], next: ["Sports fixtures"], roles: allStaffRoles },
      { id: "clinic", title: "Clinic & health", shortTitle: "Clinic", description: "Restricted clinic visits, treatment and disposition records.", status: "live", icon: HeartPulse, available: ["Role-restricted visit records", "Treatment and disposition", "Close-visit workflow"], next: ["Medication stock", "Emergency provider notifications"], roles: clinicRoles },
    ],
  },
  {
    label: "School operations",
    items: [
      { id: "library", title: "Library", description: "Physical catalogue, circulation and due-date control.", status: "live", icon: Library, available: ["Titles and copies", "Learner checkout", "Return history"], next: ["Barcode scanning", "Overdue notices and fines"], roles: libraryRoles },
      { id: "boarding", title: "Boarding", description: "Dormitory capacity, beds and student allocation.", status: "live", icon: Building2, available: ["Dormitory register", "Capacity and gender checks", "Bed allocation and release"], next: ["Weekend leave", "Visitor register and meals"], roles: boardingRoles },
      { id: "transport", title: "Transport", description: "Vehicles, routes, pickup points and rider assignments.", status: "live", icon: Bus, available: ["Vehicle and route register", "Pickup points", "Learner assignment lifecycle"], next: ["Driver HR records", "Fuel and maintenance logs"], roles: transportRoles },
      { id: "inventory", title: "Inventory & assets", shortTitle: "Inventory", description: "Track serialized school property through its lifecycle.", status: "live", icon: Boxes, available: ["Asset register", "Location and assignment", "Maintenance and retirement"], next: ["Consumable stock movements", "Purchase order workflow"], roles: inventoryRoles },
      { id: "events", title: "Events & calendar", shortTitle: "Events", description: "Terms, holidays, meetings, trips and school events.", status: "live", icon: CalendarDays, available: ["Scheduled event register", "Audience targeting", "Cancellation history"], next: ["Reminder delivery", "Calendar feeds"], roles: allStaffRoles },
      { id: "documents", title: "Documents", description: "Metadata for controlled student documents and generated records.", status: "live", icon: FileText, available: ["School-wide document register", "Search by learner or filename", "Type filter, download and delete", "Sensitive medical files hidden by role"], next: ["Private object storage", "Virus scanning"] , roles: adminRoles},
    ],
  },
  {
    label: "Management",
    items: [
      { id: "reports", title: "Reports & analytics", shortTitle: "Reports", description: "Operational, financial and academic insight from live school data.", status: "live", icon: BarChart3, available: ["Population and capacity", "Attendance and finance summaries", "Academic distribution, print and CSV"], next: ["Custom report designer"] , roles: adminRoles},
      { id: "administration", title: "Administration", description: "School settings, access control, audit and resilience.", status: "live", icon: UserRoundCog, available: ["School memberships and role assignment", "School settings", "Immutable audit viewer"], next: ["Custom role builder", "Automated off-site backup policy"] , roles: sensitiveRoles},
    ],
  },
];

function visibleGroups(role?: string, enabledModules?: string[]) {
  const enabled = enabledModules?.length ? new Set(enabledModules) : null;
  return moduleGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => (!item.roles || (role ? item.roles.includes(role) : false)) && (!enabled || enabled.has(item.id))) }))
    .filter((group) => group.items.length > 0);
}

function AppNavigation({
  active,
  role,
  enabledModules,
  onNavigate,
}: {
  active: ModuleId;
  role?: string;
  enabledModules?: string[];
  onNavigate: (id: ModuleId) => void;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarContent className="px-1 pb-2">
      {visibleGroups(role, enabledModules).map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/45">
            {group.label}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      className="h-9 gap-3 rounded-lg text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
                      isActive={active === item.id}
                      onClick={() => {
                        onNavigate(item.id);
                        setOpenMobile(false);
                      }}
                      tooltip={item.title}
                    >
                      <Icon />
                      <span>{item.shortTitle ?? item.title}</span>
                      {item.status !== "live" && (
                        <span className="ml-auto size-1.5 rounded-full bg-sidebar-foreground/30 group-data-[collapsible=icon]:hidden" />
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </SidebarContent>
  );
}

export function SchoolApp({ user }: { user: { displayName: string; email: string } }) {
  const [active, setActive] = useState<ModuleId>("dashboard");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [registrationRequest, setRegistrationRequest] = useState(0);

  const refreshDashboard = useCallback(async () => {
    try {
      setLoadError("");
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 403) setSessionExpired(true);
        throw new Error(data.error || "The school workspace could not be loaded.");
      }
      setSessionExpired(false);
      setDashboard(data);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The school workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshDashboard(), 0);
    // After queued offline writes replay, refetch so counters/lists are fresh.
    const onSynced = () => void refreshDashboard();
    window.addEventListener("nyashavee:synced", onSynced);
    return () => { window.clearTimeout(timer); window.removeEventListener("nyashavee:synced", onSynced); };
  }, [refreshDashboard]);

  const enabled = dashboard?.workspace?.enabledModules;
  const modules = useMemo(() => {
    const all = moduleGroups.flatMap((group) => group.items);
    return enabled?.length ? all.filter((item) => enabled.includes(item.id)) : all;
  }, [enabled]);
  const current = modules.find((item) => item.id === active) ?? modules[0];
  const readiness = useMemo(() => ({
    total: modules.length,
    live: modules.filter((module) => module.status === "live").length,
    foundation: modules.filter((module) => module.status === "foundation").length,
    planned: modules.filter((module) => module.status === "planned").length,
  }), [modules]);
  const workspace = dashboard?.workspace;
  const initials = (workspace?.displayName ?? user.displayName)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "NS";

  function navigate(id: ModuleId) {
    setActive(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openRegistration() {
    setActive("students");
    setRegistrationRequest((value) => value + 1);
  }

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setPasswordSubmitting(true);
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_password",
          currentPassword: values.get("currentPassword"),
          newPassword: values.get("newPassword"),
        }),
      });
      const data = await response.json();
      if (isQueuedResponse(data)) { toast.info(OFFLINE_QUEUED_MESSAGE); return data; }
      if (!response.ok) throw new Error(data.error || "The password could not be changed.");
      toast.success("Password changed.");
      form.reset();
      setPasswordOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The password could not be changed.");
    } finally {
      setPasswordSubmitting(false);
    }
  }

  const [searchResults, setSearchResults] = useState<{ group: string; id: string; label: string; detail: string; module: string }[]>([]);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const query = search.trim();
    if (!query) return;
    const moduleMatch = modules.find((item) => item.title.toLowerCase().includes(query.toLowerCase()));
    if (moduleMatch) {
      navigate(moduleMatch.id);
      return;
    }
    setStudentSearch(query);
    navigate("students");
  }

  // Debounced global search — every bucket is permission-gated server-side.
  useEffect(() => {
    const query = search.trim();
    const t = window.setTimeout(async () => {
      if (query.length < 2) { setSearchResults([]); return; }
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        setSearchResults(
          (["students", "guardians", "staff", "invoices", "payments"] as const).flatMap((group) =>
            (json[group] ?? []).map((r: { id: string; label: string; detail: string; module: string }) => ({ group, ...r }))
          ).slice(0, 12)
        );
      } catch { /* search is best-effort */ }
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  if (!loading && dashboard && dashboard.workspace.role === "parent") {
    return <><PortalWorkspace displayName={dashboard.workspace.displayName} /><Toaster position="top-right" richColors /></>;
  }

  return (
    <SidebarProvider
      style={{ "--sidebar-width": "17rem" } as React.CSSProperties}
      className="bg-[#eef2ef]"
    >
      <Sidebar collapsible="icon" className="border-r-0">
        <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
          <button
            type="button"
            onClick={() => navigate("dashboard")}
            className="flex w-full items-center gap-3 rounded-xl px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e3b84c] font-serif text-lg font-black text-[#102a24] shadow-[inset_0_0_0_1px_rgba(255,255,255,.22)]">
              N
            </span>
            <span className="min-w-0 group-data-[collapsible=icon]:hidden">
              <span className="block truncate text-[15px] font-semibold tracking-tight text-white">Nyashavee</span>
              <span className="block truncate text-[11px] text-sidebar-foreground/55">School Operations</span>
            </span>
          </button>
          {(dashboard?.schools?.length ?? 0) > 1 && (
            <select
              aria-label="Switch school"
              value={workspace?.schoolId ?? ""}
              onChange={(event) => {
                document.cookie = `school_workspace=${encodeURIComponent(event.target.value)}; path=/; max-age=31536000; samesite=lax`;
                window.location.reload();
              }}
              className="mt-2 w-full rounded-lg border border-sidebar-border bg-white/[0.06] px-2 py-1.5 text-xs text-sidebar-foreground group-data-[collapsible=icon]:hidden"
            >
              {dashboard!.schools!.map((school) => (
                <option key={school.schoolId} value={school.schoolId} className="text-slate-900">
                  {school.schoolName} · {school.role.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          )}
        </SidebarHeader>

        <AppNavigation active={active} role={workspace?.role} enabledModules={workspace?.enabledModules} onNavigate={navigate} />

        <SidebarFooter className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#d8e9e1] text-xs font-bold text-[#17483b]">{initials}</span>
            <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <span className="block truncate text-xs font-semibold text-white">{workspace?.displayName ?? user.displayName}</span>
              <span className="block truncate text-[10px] capitalize text-sidebar-foreground/55">{workspace?.role?.replaceAll("_", " ") ?? "Loading workspace"}</span>
            </span>
            <button
              type="button"
              onClick={() => setPasswordOpen(true)}
              className="rounded-md p-1.5 text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
              aria-label="Change password"
              title="Change password"
            >
              <KeyRound className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: "/login" })}
              className="rounded-md p-1.5 text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 bg-[#f4f6f4]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[#dce4df] bg-[#f8faf8]/95 px-4 backdrop-blur-xl md:px-6">
          <SidebarTrigger className="shrink-0 border border-[#d8e1dc] bg-white hover:bg-[#edf4f0]" />
          <div className="hidden min-w-0 items-center gap-2 text-sm text-[#718078] sm:flex">
            <span className="truncate">{workspace?.schoolName ?? "School workspace"}</span>
            <ChevronRight className="size-3.5 shrink-0" />
            <span className="truncate font-semibold text-[#1a2e28]">{current.title}</span>
          </div>
          <form onSubmit={submitSearch} className="relative ml-auto hidden w-full max-w-xs lg:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#829089]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 border-[#d8e1dc] bg-white pl-9 shadow-none"
              placeholder="Search students, guardians, receipts…"
              aria-label="Search the school"
            />
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-10 z-50 max-h-96 overflow-y-auto rounded-xl border border-[#dce4e0] bg-white shadow-lg">
                {searchResults.map((r) => (
                  <button
                    type="button"
                    key={`${r.group}-${r.id}`}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[#f4f7f5]"
                    onClick={() => { setSearchResults([]); setSearch(""); navigate(r.module as ModuleId); }}
                  >
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.label}</span><span className="block truncate text-xs text-[#87928d]">{r.detail}</span></span>
                    <Badge variant="outline" className="shrink-0 text-[10px] capitalize">{r.group.replace(/s$/, "")}</Badge>
                  </button>
                ))}
              </div>
            )}
          </form>
          <Badge variant="outline" className="hidden border-[#d7e2dc] bg-white px-2.5 py-1 text-[11px] capitalize text-[#4d6259] md:inline-flex">
            {workspace?.role?.replaceAll("_", " ") ?? "Secure session"}
          </Badge>
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[#173f35] text-xs font-bold text-white shadow-sm">{initials}</div>
        </header>

        <div className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {loading ? (
            <div className="space-y-6" aria-label="Loading school workspace">
              <Skeleton className="h-24 w-full rounded-xl" />
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)}</div>
              <Skeleton className="h-80 w-full rounded-xl" />
            </div>
          ) : loadError || !dashboard ? (
            <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-[#ead7cf] bg-white p-8 text-center shadow-sm">
              <Activity className="mx-auto size-8 text-[#b85d3d]" />
              <h1 className="mt-4 text-xl font-semibold">{sessionExpired ? "Session no longer valid" : "Workspace unavailable"}</h1>
              <p className="mt-2 text-sm leading-6 text-[#66756e]">{sessionExpired ? "Your access was removed or the session is out of date. Sign in again to continue." : loadError}</p>
              {sessionExpired ? (
                <button onClick={() => void signOut({ callbackUrl: "/login" })} className="mt-5 rounded-lg bg-[#173f35] px-4 py-2 text-sm font-semibold text-white">Sign in again</button>
              ) : (
                <button onClick={() => void refreshDashboard()} className="mt-5 rounded-lg bg-[#173f35] px-4 py-2 text-sm font-semibold text-white">Try again</button>
              )}
            </div>
          ) : active === "dashboard" ? (
            <DashboardWorkspace data={dashboard} readiness={readiness} onNavigate={navigate} onRegister={openRegistration} />
          ) : active === "students" ? (
            <StudentsWorkspace
              initialSearch={studentSearch}
              registrationRequest={registrationRequest}
              onChanged={refreshDashboard}
            />
          ) : active === "guardians" ? (
            <GuardiansWorkspace />
          ) : active === "attendance" ? (
            <AttendanceWorkspace onChanged={refreshDashboard} />
          ) : active === "academics" ? (
            <AcademicWorkspace initialTab="structure" />
          ) : active === "exams" ? (
            <AcademicWorkspace initialTab="assessments" />
          ) : active === "finance" ? (
            <FinanceWorkspace />
          ) : active === "timetable" ? (
            <TimetableWorkspace />
          ) : active === "reports-cards" ? (
            <ReportCardsWorkspace />
          ) : active === "reports" ? (
            <ReportsWorkspace />
          ) : active === "documents" ? (
            <DocumentsWorkspace />
          ) : active === "administration" ? (
            <AdministrationWorkspace />
          ) : pastoralModules.includes(active as PastoralModule) ? (
            <PastoralWorkspace module={active as PastoralModule} />
          ) : operationalModules.includes(active as OperationsModule) ? (
            <OperationsWorkspace module={active as OperationsModule} />
          ) : (
            <ModuleWorkspace module={current} onNavigate={navigate} />
          )}
        </div>
      </SidebarInset>
      <Toaster position="top-right" richColors />
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Change password</DialogTitle>
            <DialogDescription>Enter your current password and choose a new one (minimum 8 characters).</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPassword} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="currentPassword">Current password</Label><Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" /></div>
            <div className="space-y-2"><Label htmlFor="newPassword">New password</Label><Input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" /></div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPasswordOpen(false)} className="rounded-md border border-[#d3ddd7] bg-white px-4 py-2 text-sm font-semibold">Cancel</button>
              <button type="submit" disabled={passwordSubmitting} className="rounded-md bg-[#173f35] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{passwordSubmitting ? "Saving…" : "Change password"}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
