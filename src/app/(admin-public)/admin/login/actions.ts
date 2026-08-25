"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { isLockedOut, recordFailedLogin, recordSuccessfulLogin } from "@/lib/auth/login-rate-limit";
import { logger } from "@/lib/logger";
import { getOrCreateRequestId } from "@/lib/request-context";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginState = { error?: string };

const INVALID_CREDENTIALS: LoginState = { error: "Invalid email or password." };
const LOCKED_OUT: LoginState = {
  error: "Too many failed attempts on this account. Try again in a few minutes.",
};

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const requestId = getOrCreateRequestId(await headers());

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return INVALID_CREDENTIALS;
  }

  const { email, password } = parsed.data;
  const adminUser = await prisma.adminUser.findUnique({ where: { email } });

  // Checked before the password comparison, and skips it entirely when
  // locked — this doesn't reopen the email-enumeration timing gap D036
  // closed, since only an account an attacker already drove to 5 real
  // failures can be in this state; it doesn't distinguish "unregistered"
  // from "registered" email addresses.
  if (adminUser && isLockedOut(adminUser)) {
    logger.warn("login_locked_out", { requestId, adminUserId: adminUser.id });
    return LOCKED_OUT;
  }

  // Same generic error whether the email doesn't exist, the account is
  // disabled, or the password is wrong — never reveal which case it was.
  // Also same *timing*: always pay bcrypt's cost, even for an unknown email,
  // so response time alone can't be used to enumerate valid admin accounts.
  const passwordValid = await verifyPassword(password, adminUser?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!adminUser || !adminUser.isActive || !passwordValid) {
    if (adminUser) {
      await recordFailedLogin(prisma, adminUser.id);
      logger.warn("login_failed", { requestId, adminUserId: adminUser.id });
    } else {
      logger.warn("login_failed", { requestId, adminUserId: null });
    }
    return INVALID_CREDENTIALS;
  }

  await recordSuccessfulLogin(prisma, adminUser.id);
  logger.info("login_succeeded", { requestId, adminUserId: adminUser.id });
  await createSession(adminUser.id);
  redirect("/admin");
}
