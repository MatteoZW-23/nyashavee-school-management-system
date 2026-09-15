import assert from "node:assert/strict";
import test from "node:test";
import { clearedStudentIds } from "../lib/fee-gate.ts";

test("a learner with zero balance in every currency is cleared", () => {
  const cleared = clearedStudentIds(["s1"], [
    { studentId: "s1", currency: "USD", outstandingMinor: 0 },
    { studentId: "s1", currency: "ZWG", outstandingMinor: 0 },
  ]);
  assert.equal(cleared.has("s1"), true);
});

test("a learner with any outstanding balance is locked", () => {
  const cleared = clearedStudentIds(["s1"], [
    { studentId: "s1", currency: "USD", outstandingMinor: 0 },
    { studentId: "s1", currency: "ZWG", outstandingMinor: 8000 },
  ]);
  assert.equal(cleared.has("s1"), false);
});

test("a cleared USD balance cannot mask an unpaid ZiG invoice", () => {
  const cleared = clearedStudentIds(["s1"], [
    { studentId: "s1", currency: "USD", outstandingMinor: -500 },
    { studentId: "s1", currency: "ZWG", outstandingMinor: 100 },
  ]);
  assert.equal(cleared.has("s1"), false);
});

test("siblings are cleared independently", () => {
  const cleared = clearedStudentIds(["s1", "s2"], [
    { studentId: "s1", currency: "USD", outstandingMinor: 0 },
    { studentId: "s1", currency: "ZWG", outstandingMinor: 0 },
    { studentId: "s2", currency: "USD", outstandingMinor: 30000 },
    { studentId: "s2", currency: "ZWG", outstandingMinor: 0 },
  ]);
  assert.equal(cleared.has("s1"), true);
  assert.equal(cleared.has("s2"), false);
});
