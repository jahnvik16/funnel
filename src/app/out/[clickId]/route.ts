import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClickWithSnapshot, executeOutbound } from "@/lib/public-routing";
import { logger } from "@/lib/logger";
import { getOrCreateRequestId } from "@/lib/request-context";

function unavailableResponse(): NextResponse {
  return new NextResponse("This link is not available.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clickId: string }> },
) {
  const requestId = getOrCreateRequestId(request.headers);
  const startedAt = Date.now();
  const { clickId } = await params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const loaded = await loadClickWithSnapshot(tx, clickId);
      if (!loaded) return { ok: false as const, reason: "click_not_found" as const };
      return executeOutbound(tx, clickId, loaded.snapshot);
    });

    const durationMs = Date.now() - startedAt;

    if (!result.ok) {
      logger.warn("outbound_redirect_failed", { requestId, clickId, reason: result.reason, durationMs });
      return unavailableResponse();
    }

    logger.info("outbound_redirect", { requestId, clickId, durationMs });
    return NextResponse.redirect(result.destinationUrl);
  } catch (error) {
    // Same safety-net role as /l/[token] — the real failure reasons are
    // handled above via `result.ok`; this only catches unexpected crashes.
    logger.error("route_crashed", {
      requestId,
      clickId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailableResponse();
  }
}
