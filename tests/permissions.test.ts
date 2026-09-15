import assert from "node:assert/strict";
import test from "node:test";
import { canAssignRole, hasPermission } from "../lib/permissions.ts";

test("school administrators can manage students and attendance", () => {
  assert.equal(hasPermission("school_admin", "students.create"), true);
  assert.equal(hasPermission("school_admin", "attendance.correct"), true);
});

test("teachers can view classes and take attendance but cannot correct submitted registers", () => {
  assert.equal(hasPermission("teacher", "classes.view"), true);
  assert.equal(hasPermission("teacher", "attendance.take"), true);
  assert.equal(hasPermission("teacher", "attendance.correct"), false);
});

test("unknown roles receive no permissions", () => {
  assert.equal(hasPermission("unknown", "students.view"), false);
  assert.equal(hasPermission("unknown", "*"), false);
});

test("finance duties remain separated from teaching duties", () => {
  assert.equal(hasPermission("bursar", "finance.payment"), true);
  assert.equal(hasPermission("bursar", "finance.reverse"), true);
  assert.equal(hasPermission("teacher", "finance.view"), false);
  assert.equal(hasPermission("teacher", "finance.payment"), false);
});

test("health and operational records are restricted by role", () => {
  assert.equal(hasPermission("clinic_staff", "clinic.manage"), true);
  assert.equal(hasPermission("librarian", "clinic.view"), false);
  assert.equal(hasPermission("librarian", "library.manage"), true);
  assert.equal(hasPermission("transport_staff", "transport.manage"), true);
  assert.equal(hasPermission("transport_staff", "boarding.manage"), false);
});

test("report approval is limited to authorised leadership", () => {
  assert.equal(hasPermission("class_teacher", "reports.comment"), true);
  assert.equal(hasPermission("class_teacher", "reports.publish"), false);
  assert.equal(hasPermission("headmaster", "reports.publish"), true);
});

test("learner promotion and withdrawal are restricted to administrative roles", () => {
  assert.equal(hasPermission("school_admin", "students.promote"), true);
  assert.equal(hasPermission("deputy_head", "students.promote"), true);
  assert.equal(hasPermission("teacher", "students.promote"), false);
  assert.equal(hasPermission("bursar", "students.promote"), false);
  assert.equal(hasPermission("admissions_officer", "students.update"), true);
  assert.equal(hasPermission("teacher", "students.update"), false);
  assert.equal(hasPermission("parent", "students.view"), false);
});

test("user account administration is admin-only", () => {
  assert.equal(hasPermission("school_admin", "memberships.manage"), true);
  assert.equal(hasPermission("school_admin", "roles.assign"), true);
  assert.equal(hasPermission("headmaster", "memberships.manage"), false);
  assert.equal(hasPermission("deputy_head", "memberships.manage"), false);
  assert.equal(hasPermission("it_admin", "memberships.manage"), false);
});

test("role assignment cannot create a privilege escalation path", () => {
  assert.equal(canAssignRole("school_admin", "teacher"), true);
  assert.equal(canAssignRole("school_admin", "school_admin"), false);
  assert.equal(canAssignRole("school_admin", "super_admin"), false);
  assert.equal(canAssignRole("school_admin", "teacher", "school_admin"), false);
  assert.equal(canAssignRole("it_admin", "teacher"), false);
  assert.equal(canAssignRole("super_admin", "school_admin", "school_admin"), true);
});
