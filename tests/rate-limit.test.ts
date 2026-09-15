import assert from "node:assert/strict";
import test from "node:test";
import { clientIp, rateLimit } from "../lib/rate-limit.ts";

test("development limiter enforces a sliding window without clearing other keys", async () => {
  const key = `test:${crypto.randomUUID()}`;
  assert.equal((await rateLimit(key, 2, 60_000)).allowed, true);
  assert.equal((await rateLimit(key, 2, 60_000)).allowed, true);
  const denied = await rateLimit(key, 2, 60_000);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterSeconds >= 1);
});

test("forwarded addresses are ignored unless a trusted proxy is declared", () => {
  const previous = process.env.TRUST_PROXY;
  const request = new Request("http://school.test", { headers: { "x-forwarded-for": "203.0.113.10" } });
  try {
    delete process.env.TRUST_PROXY;
    assert.equal(clientIp(request), "direct");
    process.env.TRUST_PROXY = "true";
    assert.equal(clientIp(request), "203.0.113.10");
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  }
});
