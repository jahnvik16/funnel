"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog, redactSecretFields } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { isValidTelegramBotTokenFormat } from "@/lib/telegram";

const baseFields = z.object({
  brandId: z.string().trim().min(1, "Brand is required."),
  name: z.string().trim().min(1, "Name is required."),
  welcomeMessage: z.string().trim().optional().transform((v) => (v ? v : null)),
  ctaLabel: z.string().trim().optional().transform((v) => (v ? v : null)),
});

const createSchema = baseFields.extend({
  botToken: z
    .string()
    .trim()
    .min(1, "Bot token is required.")
    .refine(isValidTelegramBotTokenFormat, "That doesn't look like a valid Telegram bot token."),
});

const updateSchema = baseFields.extend({
  // Blank on edit means "keep the existing token".
  botToken: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isValidTelegramBotTokenFormat(v), "That doesn't look like a valid Telegram bot token."),
});

export type FormState = { error?: string };

export async function createTelegramBot(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = createSchema.safeParse({
    brandId: formData.get("brandId"),
    name: formData.get("name"),
    welcomeMessage: formData.get("welcomeMessage"),
    ctaLabel: formData.get("ctaLabel"),
    botToken: formData.get("botToken"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { botToken, ...rest } = parsed.data;

  await prisma.$transaction(async (tx) => {
    const bot = await tx.telegramBot.create({
      data: { ...rest, botTokenCiphertext: encryptSecret(botToken) },
    });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "CREATE",
      entityType: "TelegramBot",
      entityId: bot.id,
      after: redactSecretFields(bot, ["botTokenCiphertext"]),
    });
  });

  redirect("/admin/telegram-bots");
}

export async function updateTelegramBot(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const parsed = updateSchema.safeParse({
    brandId: formData.get("brandId"),
    name: formData.get("name"),
    welcomeMessage: formData.get("welcomeMessage"),
    ctaLabel: formData.get("ctaLabel"),
    botToken: formData.get("botToken") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { botToken, ...rest } = parsed.data;

  await prisma.$transaction(async (tx) => {
    const before = await tx.telegramBot.findUniqueOrThrow({ where: { id } });
    const after = await tx.telegramBot.update({
      where: { id },
      data: { ...rest, ...(botToken ? { botTokenCiphertext: encryptSecret(botToken) } : {}) },
    });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "TelegramBot",
      entityId: id,
      before: redactSecretFields(before, ["botTokenCiphertext"]),
      after: redactSecretFields(after, ["botTokenCiphertext"]),
    });
  });

  redirect("/admin/telegram-bots");
}

async function setTelegramBotStatus(formData: FormData, status: "ACTIVE" | "ARCHIVED") {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));

  await prisma.$transaction(async (tx) => {
    const before = await tx.telegramBot.findUniqueOrThrow({ where: { id } });
    const after = await tx.telegramBot.update({ where: { id }, data: { status } });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: status === "ARCHIVED" ? "ARCHIVE" : "UNARCHIVE",
      entityType: "TelegramBot",
      entityId: id,
      before: redactSecretFields(before, ["botTokenCiphertext"]),
      after: redactSecretFields(after, ["botTokenCiphertext"]),
    });
  });

  redirect("/admin/telegram-bots");
}

export async function archiveTelegramBot(formData: FormData): Promise<void> {
  await setTelegramBotStatus(formData, "ARCHIVED");
}

export async function unarchiveTelegramBot(formData: FormData): Promise<void> {
  await setTelegramBotStatus(formData, "ACTIVE");
}
