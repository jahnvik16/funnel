import type { Prisma } from "@prisma/client";

// Framework-independent (no next/headers) so it's directly testable — same
// split as lib/tracking-link-publishing.ts. login/actions.ts calls this
// around the existing bcrypt comparison; it does not replace it.
type Db = Prisma.TransactionClient;

// Independent of DECISIONS.md D036's timing-safe dummy-hash comparison —
// D036 stops an attacker from learning *which emails are registered* via
// response timing; this slows down guessing a *known* email's password via
// repeated attempts. Deliberately DB-backed (not in-memory) so it survives a
// restart and works correctly across multiple app instances, per
// OPEN_QUESTIONS.md's original reasoning for why an in-memory counter was
// rejected.
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export function isLockedOut(admin: { lockedUntil: Date | null }, now: Date = new Date()): boolean {
  return admin.lockedUntil !== null && admin.lockedUntil > now;
}

// Called only when the account exists (an unknown email has no row to update
// — nothing to persist, and persisting nothing for unknown emails is itself
// part of not leaking which emails are registered). Locks the account once
// the threshold is crossed and resets the counter so a fresh lockout window
// starts clean the next time.
export async function recordFailedLogin(db: Db, adminUserId: string, now: Date = new Date()): Promise<void> {
  const admin = await db.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
  const attempts = admin.failedLoginAttempts + 1;
  const shouldLock = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;

  await db.adminUser.update({
    where: { id: adminUserId },
    data: {
      failedLoginAttempts: shouldLock ? 0 : attempts,
      lockedUntil: shouldLock ? new Date(now.getTime() + LOGIN_LOCKOUT_DURATION_MS) : admin.lockedUntil,
    },
  });
}

export async function recordSuccessfulLogin(db: Db, adminUserId: string): Promise<void> {
  await db.adminUser.update({
    where: { id: adminUserId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}
