import test from "node:test";
import assert from "node:assert/strict";
import { isValidPassword, passwordPolicyError } from "../lib/password-policy.ts";

test("password policy requires length and mixed character classes", () => {
  assert.equal(isValidPassword("Short1"), false);
  assert.equal(isValidPassword("alllowercase123"), false);
  assert.equal(isValidPassword("ALLUPPERCASE123"), false);
  assert.equal(isValidPassword("NoDigitsAtAllxx"), false);
  assert.equal(isValidPassword("AProperSchoolPass2026"), true);
});

test("password policy rejects common passwords", () => {
  assert.ok(passwordPolicyError("Password1234"));
});
