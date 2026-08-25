"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog, redactSecretFields } from "@/lib/audit";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { isValidTelegramBotTokenFormat, getBotInfo, setWebhook, generateWebhookSecret } from "@/lib/telegram";

const SECRET_FIELDS: ("botTokenCiphertext" | "webhookSecretCiphertext")[] = [
  "botTokenCiphertext",
  "webhookSecretCiphertext",
];

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
      after: redactSecretFields(bot, SECRET_FIELDS),
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
  // Rotating the token invalidates any prior validation — the old username
  // and webhook registration may not correspond to the new token at all.
  const rotatingToken = Boolean(botToken);

  await prisma.$transaction(async (tx) => {
    const before = await tx.telegramBot.findUniqueOrThrow({ where: { id } });
    const after = await tx.telegramBot.update({
      where: { id },
      data: {
        ...rest,
        ...(botToken
          ? { botTokenCiphertext: encryptSecret(botToken) }
          : {}),
        ...(rotatingToken ? { botUsername: null, webhookSecretCiphertext: null } : {}),
      },
    });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "TelegramBot",
      entityId: id,
      before: redactSecretFields(before, SECRET_FIELDS),
      after: redactSecretFields(after, SECRET_FIELDS),
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
      before: redactSecretFields(before, SECRET_FIELDS),
      after: redactSecretFields(after, SECRET_FIELDS),
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

export type ValidateFormState = {
  error?: string;
  success?: boolean;
  username?: string;
  warning?: string;
};

// Calls Telegram's live getMe API to confirm the stored token actually works
// and to learn the bot's real @username (never admin-entered — see
// DECISIONS.md). Best-effort registers our webhook so future /start events
// can be verified; a webhook failure (e.g. APP_BASE_URL isn't a public HTTPS
// URL, as in local dev) doesn't block validation from succeeding.
export async function validateTelegramBot(
  _prevState: ValidateFormState,
  formData: FormData,
): Promise<ValidateFormState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));

  const bot = await prisma.telegramBot.findUniqueOrThrow({ where: { id } });
  const botToken = decryptSecret(bot.botTokenCiphertext);

  const info = await getBotInfo(botToken);
  if (!info.ok) {
    return { error: `Validation failed: ${info.description}` };
  }
  if (!info.result.username) {
    return { error: "Telegram did not return a username for this bot." };
  }

  const webhookSecret = generateWebhookSecret();
  const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const webhookUrl = `${appBaseUrl}/api/telegram/webhook/${id}`;
  const webhookResult = await setWebhook(botToken, webhookUrl, webhookSecret);

  await prisma.$transaction(async (tx) => {
    const before = await tx.telegramBot.findUniqueOrThrow({ where: { id } });
    const after = await tx.telegramBot.update({
      where: { id },
      data: {
        botUsername: info.result.username,
        ...(webhookResult.ok ? { webhookSecretCiphertext: encryptSecret(webhookSecret) } : {}),
      },
    });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "VALIDATE",
      entityType: "TelegramBot",
      entityId: id,
      before: redactSecretFields(before, SECRET_FIELDS),
      after: redactSecretFields(after, SECRET_FIELDS),
    });
  });

  revalidatePath(`/admin/telegram-bots/${id}`);
  revalidatePath("/admin/telegram-bots");

  return {
    success: true,
    username: info.result.username,
    ...(webhookResult.ok
      ? {}
      : {
          warning:
            "Bot validated, but webhook registration failed (expected in local dev without a public HTTPS URL).",
        }),
  };
}
