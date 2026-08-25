import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "./password";

test("hashPassword never returns the plaintext value", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.notEqual(hash, "correct horse battery staple");
});

test("verifyPassword accepts the correct password", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
});

test("verifyPassword rejects an incorrect password", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("wrong password", hash), false);
});

test("hashing the same password twice produces different hashes", async () => {
  const [a, b] = await Promise.all([
    hashPassword("same password"),
    hashPassword("same password"),
  ]);
  assert.notEqual(a, b);
});

test("DUMMY_PASSWORD_HASH is a valid bcrypt hash that no real password matches", async () => {
  assert.equal(await verifyPassword("password", DUMMY_PASSWORD_HASH), false);
  assert.equal(await verifyPassword("", DUMMY_PASSWORD_HASH), false);
  assert.equal(await verifyPassword("funnelcore-timing-safe-dummy-password-guess", DUMMY_PASSWORD_HASH), false);
});

// Login compares against DUMMY_PASSWORD_HASH when no account matches the
// submitted email, specifically so that path still pays bcrypt's cost — a
// fast-path bypass here would let response timing reveal whether an email
// is registered. This doesn't assert exact timing equality (too flaky for a
// unit test) — it confirms both paths actually run bcrypt's comparison
// rather than short-circuiting.
test("verifying against DUMMY_PASSWORD_HASH costs roughly as much as a real comparison", async () => {
  const realHash = await hashPassword("some real password");

  const realStart = performance.now();
  await verifyPassword("a guess", realHash);
  const realDurationMs = performance.now() - realStart;

  const dummyStart = performance.now();
  await verifyPassword("a guess", DUMMY_PASSWORD_HASH);
  const dummyDurationMs = performance.now() - dummyStart;

  assert.ok(realDurationMs > 5, `expected a real bcrypt compare to take >5ms, took ${realDurationMs}ms`);
  assert.ok(dummyDurationMs > 5, `expected the dummy bcrypt compare to take >5ms, took ${dummyDurationMs}ms`);
});
