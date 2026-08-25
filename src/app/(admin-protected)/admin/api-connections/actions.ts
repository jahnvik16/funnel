"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { ApiConnectionAuthType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog, redactSecretFields } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

const baseFields = z.object({
  brandId: z.string().trim().optional().transform((v) => (v ? v : null)),
  name: z.string().trim().min(1, "Name is required."),
  provider: z.string().trim().min(1, "Provider is required."),
  baseUrl: z.string().trim().url("Enter a valid base URL."),
  authType: z.nativeEnum(ApiConnectionAuthType),
});

const createSchema = baseFields.extend({
  credentials: z
    .string()
    .trim()
    .min(1, "Credentials are required.")
    .refine(isValidJson, "Credentials must be valid JSON."),
});

const updateSchema = baseFields.extend({
  // Blank on edit means "keep the existing credentials".
  credentials: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isValidJson(v), "Credentials must be valid JSON."),
});

export type FormState = { error?: string };

export async function createApiConnection(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = createSchema.safeParse({
    brandId: formData.get("brandId"),
    name: formData.get("name"),
    provider: formData.get("provider"),
    baseUrl: formData.get("baseUrl"),
    authType: formData.get("authType"),
    credentials: formData.get("credentials"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { credentials, ...rest } = parsed.data;

  await prisma.$transaction(async (tx) => {
    const connection = await tx.apiConnection.create({
      data: { ...rest, credentialsCiphertext: encryptSecret(credentials) },
    });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "CREATE",
      entityType: "ApiConnection",
      entityId: connection.id,
      after: redactSecretFields(connection, ["credentialsCiphertext"]),
    });
  });

  redirect("/admin/api-connections");
}

export async function updateApiConnection(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const parsed = updateSchema.safeParse({
    brandId: formData.get("brandId"),
    name: formData.get("name"),
    provider: formData.get("provider"),
    baseUrl: formData.get("baseUrl"),
    authType: formData.get("authType"),
    credentials: formData.get("credentials") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { credentials, ...rest } = parsed.data;

  await prisma.$transaction(async (tx) => {
    const before = await tx.apiConnection.findUniqueOrThrow({ where: { id } });
    const after = await tx.apiConnection.update({
      where: { id },
      data: { ...rest, ...(credentials ? { credentialsCiphertext: encryptSecret(credentials) } : {}) },
    });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "ApiConnection",
      entityId: id,
      before: redactSecretFields(before, ["credentialsCiphertext"]),
      after: redactSecretFields(after, ["credentialsCiphertext"]),
    });
  });

  redirect("/admin/api-connections");
}

async function setApiConnectionStatus(formData: FormData, status: "ACTIVE" | "ARCHIVED") {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));

  await prisma.$transaction(async (tx) => {
    const before = await tx.apiConnection.findUniqueOrThrow({ where: { id } });
    const after = await tx.apiConnection.update({ where: { id }, data: { status } });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: status === "ARCHIVED" ? "ARCHIVE" : "UNARCHIVE",
      entityType: "ApiConnection",
      entityId: id,
      before: redactSecretFields(before, ["credentialsCiphertext"]),
      after: redactSecretFields(after, ["credentialsCiphertext"]),
    });
  });

  redirect("/admin/api-connections");
}

export async function archiveApiConnection(formData: FormData): Promise<void> {
  await setApiConnectionStatus(formData, "ARCHIVED");
}

export async function unarchiveApiConnection(formData: FormData): Promise<void> {
  await setApiConnectionStatus(formData, "ACTIVE");
}
