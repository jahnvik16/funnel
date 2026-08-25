"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginState = { error?: string };

const INVALID_CREDENTIALS: LoginState = { error: "Invalid email or password." };

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return INVALID_CREDENTIALS;
  }

  const { email, password } = parsed.data;
  const adminUser = await prisma.adminUser.findUnique({ where: { email } });

  // Same generic error whether the email doesn't exist, the account is
  // disabled, or the password is wrong — never reveal which case it was.
  if (!adminUser || !adminUser.isActive) {
    return INVALID_CREDENTIALS;
  }

  const passwordValid = await verifyPassword(password, adminUser.passwordHash);
  if (!passwordValid) {
    return INVALID_CREDENTIALS;
  }

  await createSession(adminUser.id);
  redirect("/admin");
}
