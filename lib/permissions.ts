export type SchoolRole =
  | "super_admin"
  | "school_admin"
  | "headmaster"
  | "deputy_head"
  | "bursar"
  | "admissions_officer"
  | "teacher"
  | "class_teacher"
  | "hod"
  | "librarian"
  | "boarding_staff"
  | "transport_staff"
  | "clinic_staff"
  | "it_admin"
  | "parent"
;

const studentManagement = ["students.view", "students.create", "students.update", "students.archive", "students.transfer", "students.promote", "students.manage-documents", "guardians.view", "guardians.create", "guardians.update", "admissions.view", "admissions.manage", "admissions.admit", "classes.view"];
const attendanceManagement = ["attendance.view", "attendance.take", "attendance.submit", "attendance.edit-draft", "attendance.correct", "attendance.lock", "attendance.unlock", "attendance.view-reports", "attendance.export", "attendance.manage-settings"];
const academicManagement = ["academics.view", "academics.manage", "timetable.view", "timetable.manage", "assessments.view", "assessments.manage", "marks.enter", "marks.moderate", "reports.view", "reports.generate", "reports.comment", "reports.publish", "assignments.manage", "curriculum.manage"];
const financeManagement = ["finance.view", "finance.invoice", "finance.payment", "finance.allocate", "finance.reverse", "finance.report"];
const operationsManagement = ["communication.view", "communication.manage", "discipline.view", "discipline.manage", "library.view", "library.manage", "boarding.view", "boarding.manage", "transport.view", "transport.manage", "inventory.view", "inventory.manage", "events.view", "events.manage", "staff.view", "staff.manage", "payroll.view", "payroll.manage", "documents.view", "documents.upload", "clinic.view", "clinic.manage", "activities.view", "activities.manage", "pickups.view", "pickups.manage"];
// Pastoral-sensitive keys are intentionally NOT in the shared lists:
// safeguarding is restricted to head/admin by default; health profiles and SEN
// records are restricted to clinic staff, HODs and leadership.
const administration = ["academic-years.manage", "classes.manage", "memberships.manage", "roles.assign", "exports.manage", "settings.manage", "audit.view"];

const grants: Record<SchoolRole, readonly string[]> = {
  super_admin: ["*"],
  school_admin: [...studentManagement, ...attendanceManagement, ...academicManagement, ...financeManagement, ...operationsManagement, ...administration, "safeguarding.view", "safeguarding.manage", "health.view", "health.manage", "sen.view", "sen.manage"],
  headmaster: [...studentManagement, ...attendanceManagement, ...academicManagement, "finance.view", "finance.report", ...operationsManagement.filter((permission) => !permission.startsWith("payroll.") && !permission.startsWith("clinic.")), "clinic.view", "audit.view", "safeguarding.view", "safeguarding.manage", "health.view", "sen.view", "sen.manage"],
  deputy_head: [...studentManagement, ...attendanceManagement, ...academicManagement, "communication.view", "communication.manage", "discipline.view", "discipline.manage", "events.view", "events.manage", "activities.view", "activities.manage", "pickups.view", "pickups.manage", "audit.view", "sen.view"],
  bursar: ["students.view", "guardians.view", "classes.view", ...financeManagement, "payroll.view", "payroll.manage", "inventory.view", "inventory.manage", "audit.view"],
  admissions_officer: ["students.view", "students.create", "students.update", "guardians.view", "guardians.create", "guardians.update", "admissions.view", "admissions.manage", "admissions.admit", "classes.view", "documents.view", "documents.upload", "pickups.view", "pickups.manage"],
  teacher: ["students.view", "classes.view", "attendance.view", "attendance.take", "attendance.submit", "attendance.edit-draft", "academics.view", "timetable.view", "assessments.view", "assessments.manage", "marks.enter", "reports.view", "communication.view", "discipline.view", "discipline.manage", "events.view", "activities.view", "assignments.manage", "curriculum.manage", "pickups.view"],
  class_teacher: ["students.view", "guardians.view", "classes.view", "attendance.view", "attendance.take", "attendance.submit", "attendance.edit-draft", "academics.view", "timetable.view", "assessments.view", "marks.enter", "reports.view", "reports.generate", "reports.comment", "communication.view", "discipline.view", "discipline.manage", "events.view", "activities.view", "assignments.manage", "curriculum.manage", "pickups.view", "pickups.manage"],
  hod: ["students.view", "classes.view", "attendance.view", "academics.view", "academics.manage", "timetable.view", "assessments.view", "assessments.manage", "marks.enter", "marks.moderate", "reports.view", "reports.generate", "reports.comment", "communication.view", "staff.view", "activities.view", "activities.manage", "assignments.manage", "curriculum.manage", "pickups.view", "sen.view"],
  librarian: ["students.view", "staff.view", "library.view", "library.manage", "communication.view", "activities.view"],
  boarding_staff: ["students.view", "guardians.view", "boarding.view", "boarding.manage", "attendance.view", "discipline.view", "discipline.manage", "clinic.view", "events.view", "pickups.view", "activities.view"],
  transport_staff: ["students.view", "guardians.view", "transport.view", "transport.manage", "events.view", "activities.view"],
  clinic_staff: ["students.view", "guardians.view", "clinic.view", "clinic.manage", "health.view", "health.manage", "sen.view", "sen.manage"],
  // IT administrators can maintain technical configuration and view audit
  // evidence, but cannot create, alter, or deactivate human access.
  it_admin: ["settings.manage", "audit.view"],
  parent: ["portal.parent"],
};

export function hasPermission(role: string, permission: string) {
  const roleGrants = grants[role as SchoolRole] ?? [];
  return roleGrants.includes("*") || roleGrants.includes(permission);
}

// Role ordering is intentionally separate from the permission lists.  A role
// with memberships.manage is not automatically allowed to grant an equal or
// more privileged role (the old behaviour permitted self-promotion).
const roleRank: Record<SchoolRole, number> = {
  parent: 0,
  teacher: 10,
  class_teacher: 11,
  librarian: 12,
  boarding_staff: 12,
  transport_staff: 12,
  clinic_staff: 13,
  admissions_officer: 20,
  bursar: 25,
  hod: 30,
  deputy_head: 40,
  headmaster: 50,
  it_admin: 60,
  school_admin: 90,
  super_admin: 100,
};

export function canAssignRole(actorRole: string, nextRole: string, currentRole?: string) {
  const actor = actorRole as SchoolRole;
  const next = nextRole as SchoolRole;
  const current = currentRole as SchoolRole | undefined;
  if (!hasPermission(actor, "roles.assign") || roleRank[actor] === undefined || roleRank[next] === undefined) return false;
  // Only a platform super administrator may manage another super admin. A
  // school administrator may manage roles below school-admin level only.
  if (actor !== "super_admin" && roleRank[next] >= roleRank[actor]) return false;
  if (current && (roleRank[current] === undefined || (actor !== "super_admin" && roleRank[current] >= roleRank[actor]))) return false;
  return true;
}
