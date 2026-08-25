import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleTelegramWebhook, type TelegramUpdate } from "@/lib/telegram-webhook";

// Public — authenticated via the X-Telegram-Bot-Api-Secret-Token header
// checked inside handleTelegramWebhook, not admin session auth.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ botId: string }> },
) {
  const { botId } = await params;

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  const result = await handleTelegramWebhook(prisma, botId, update, secretHeader);

  if (!result.ok && result.reason === "unauthorized") {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Always 200 for every other outcome (including "nothing to do here"
  // cases like an unrecognized bot or an already-expired payload) — a
  // non-2xx makes Telegram retry delivery, which we don't want for cases
  // that will never succeed differently on retry.
  return NextResponse.json({ ok: true });
}
