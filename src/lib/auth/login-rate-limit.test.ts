try {
  process.loadEnvFile();
} catch {
  // No .env present (e.g. CI with vars injected directly) — fine.
}

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import { prisma } from "../prisma";
import {
  isLockedOut,
  recordFailedLogin,
  recordSuccessfulLogin,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from "./login-rate-limit";

function unique(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

const cleanup: Array<() => Promise<unknown>> = [];
after(async () => {
  for (const fn of cleanup.reverse()) {
    await fn();
  }
  await prisma.$disconnect();
});

async function makeAdmin() {
  const admin = await prisma.adminUser.create({
    data: { email: `${unique("test-admin")}@example.com`, passwordHash: "test-not-a-real-hash" },
  });
  cleanup.push(() => prisma.adminUser.delete({ where: { id: admin.id } }));
  return admin;
}

test("isLockedOut is false when lockedUntil is null", () => {
  assert.equal(isLockedOut({ lockedUntil: null }), false);
});

test("isLockedOut is true while lockedUntil is in the future, false once it's past", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const future = new Date("2026-01-01T00:05:00Z");
  const past = new Date("2025-12-31T23:55:00Z");
  assert.equal(isLockedOut({ lockedUntil: future }, now), true);
  assert.equal(isLockedOut({ lockedUntil: past }, now), false);
});

test("recordFailedLogin increments the counter without locking before the threshold", async () => {
  const admin = await makeAdmin();
  await recordFailedLogin(prisma, admin.id);
  await recordFailedLogin(prisma, admin.id);

  const updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
  assert.equal(updated.failedLoginAttempts, 2);
  assert.equal(updated.lockedUntil, null);
});

test("recordFailedLogin locks the account once MAX_FAILED_LOGIN_ATTEMPTS is reached, and resets the counter", async () => {
  const admin = await makeAdmin();
  for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
    await recordFailedLogin(prisma, admin.id);
  }

  const updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
  assert.equal(updated.failedLoginAttempts, 0);
  assert.ok(updated.lockedUntil !== null);
  assert.ok(updated.lockedUntil!.getTime() > Date.now());
  assert.equal(isLockedOut(updated), true);
});

test("recordSuccessfulLogin clears both the counter and any lockout", async () => {
  const admin = await makeAdmin();
  for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
    await recordFailedLogin(prisma, admin.id);
  }
  let updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
  assert.equal(isLockedOut(updated), true);

  await recordSuccessfulLogin(prisma, admin.id);
  updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
  assert.equal(updated.failedLoginAttempts, 0);
  assert.equal(updated.lockedUntil, null);
});
