import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleTelegramWebhook, type TelegramUpdate } from "@/lib/telegram-webhook";
import { logger } from "@/lib/logger";
import { getOrCreateRequestId } from "@/lib/request-context";

// Public — authenticated via the X-Telegram-Bot-Api-Secret-Token header
// checked inside handleTelegramWebhook, not admin session auth.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ botId: string }> },
) {
  const requestId = getOrCreateRequestId(request.headers);
  const startedAt = Date.now();
  const { botId } = await params;

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    logger.warn("telegram_webhook_malformed_body", { requestId, botId });
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");

  try {
    const result = await handleTelegramWebhook(prisma, botId, update, secretHeader);
    const durationMs = Date.now() - startedAt;

    if (!result.ok) {
      logger.warn("telegram_webhook_rejected", { requestId, botId, reason: result.reason, durationMs });
      if (result.reason === "unauthorized") {
        return NextResponse.json({ ok: false }, { status: 401 });
      }
      // Always 200 for every other outcome (including "nothing to do here"
      // cases like an unrecognized bot or an already-expired payload) — a
      // non-2xx makes Telegram retry delivery, which we don't want for cases
      // that will never succeed differently on retry.
      return NextResponse.json({ ok: true });
    }

    logger.info("telegram_webhook_processed", {
      requestId,
      botId,
      clickId: result.clickId,
      alreadyStarted: result.alreadyStarted,
      durationMs,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("route_crashed", {
      requestId,
      botId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    // Same "don't make Telegram retry a request that will never succeed
    // differently" reasoning as above — an unexpected crash isn't something
    // a retry fixes either.
    return NextResponse.json({ ok: true });
  }
}
