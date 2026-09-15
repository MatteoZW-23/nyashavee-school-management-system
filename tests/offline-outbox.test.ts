import assert from "node:assert/strict";
import test from "node:test";
import { labelFor } from "../lib/offline-outbox.ts";

// The outbox labels are what staff read in the sync queue — they must stay
// human-friendly for known actions and honest for unknown ones.

test("known finance actions get friendly labels", () => {
  const body = JSON.stringify({ action: "record_payment", amount: "50" });
  assert.equal(labelFor("/api/finance", body), "Fee payment → finance");
});

test("attendance registers are labelled plainly", () => {
  const body = JSON.stringify({ action: "save_register" });
  assert.equal(labelFor("/api/attendance", body), "Class register → attendance");
});

test("unknown actions fall back to a readable verb", () => {
  const body = JSON.stringify({ action: "create_learner" });
  assert.equal(labelFor("/api/students", body), "create learner → students");
});

test("no body falls back to the endpoint path", () => {
  assert.equal(labelFor("/api/finance?tab=payments", null), "finance → finance");
});

test("a malformed body never throws — it returns the url", () => {
  assert.equal(labelFor("/api/finance", "{not json"), "/api/finance");
});

test("query strings never leak into the label", () => {
  const body = JSON.stringify({ action: "mark_staff" });
  assert.equal(labelFor("/api/attendance?scope=staff&date=2026-09-14", body), "Staff register → attendance");
});
