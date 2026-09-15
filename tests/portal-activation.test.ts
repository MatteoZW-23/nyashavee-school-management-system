import assert from "node:assert/strict";
import test from "node:test";
import { activationIdentifier, createActivationToken, hashActivationToken, parseActivationIdentifier } from "../lib/portal-activation.ts";

test("activation tokens are high-entropy values and only their hashes are persisted", () => {
  const token = createActivationToken();
  assert.ok(token.length >= 40);
  assert.notEqual(hashActivationToken(token), token);
  assert.match(hashActivationToken(token), /^[a-f0-9]{64}$/);
});

test("activation metadata binds one invitation to one optional portal profile", () => {
  const identifier = activationIdentifier({ userId: "user-1", membershipId: "member-1", profileType: "parent", profileId: "guardian-1" });
  assert.deepEqual(parseActivationIdentifier(identifier), { userId: "user-1", membershipId: "member-1", profileType: "parent", profileId: "guardian-1" });
  assert.equal(parseActivationIdentifier("portal-activation:not-json"), null);
  assert.equal(parseActivationIdentifier("ordinary@example.test"), null);
});
