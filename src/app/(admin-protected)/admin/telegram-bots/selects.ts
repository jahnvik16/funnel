import type { Prisma } from "@prisma/client";

// Never select botTokenCiphertext for anything that reaches a page/component —
// callers that need to know "is a token set" use this shape, not the raw column.
export const TELEGRAM_BOT_SAFE_SELECT = {
  id: true,
  brandId: true,
  name: true,
  botUsername: true,
  welcomeMessage: true,
  ctaLabel: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TelegramBotSelect;
