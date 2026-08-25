import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveTrackingLinkVersion,
  recordClick,
  writeFunnelEvent,
  getHostname,
  getClientIp,
} from "@/lib/public-routing";
import { logger } from "@/lib/logger";
import { getOrCreateRequestId } from "@/lib/request-context";

// Never reveals *why* a link didn't resolve (unknown token vs. inactive vs.
// unpublished) — that distinction is only useful internally. No Click can
// exist for these failures (there's no version to attribute one to), so
// nothing is logged; there is no ROUTE_FAILED event without a Click.
function unavailableResponse(): NextResponse {
  return new NextResponse("This link is not available.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const requestId = getOrCreateRequestId(request.headers);
  const startedAt = Date.now();
  const { token } = await params;
  const hostname = getHostname(request.headers);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const resolved = await resolveTrackingLinkVersion(tx, hostname, token);
      if (!resolved.ok) return resolved;

      const click = await recordClick(tx, resolved.link, resolved.versionId, resolved.snapshot, {
        ip: getClientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        referrer: request.headers.get("referer"),
        searchParams: request.nextUrl.searchParams,
      });
      await writeFunnelEvent(tx, click.id, "ROUTE_RESOLVED", { pathType: resolved.snapshot.pathType });

      return { ok: true as const, clickId: click.id, ageGateEnabled: resolved.snapshot.ageGateEnabled };
    });

    const durationMs = Date.now() - startedAt;

    if (!result.ok) {
      logger.info("route_resolve_failed", { requestId, hostname, token, reason: result.reason, durationMs });
      return unavailableResponse();
    }

    logger.info("route_resolved", { requestId, clickId: result.clickId, durationMs });
    const nextPath = result.ageGateEnabled ? `/gate/${result.clickId}` : `/path/${result.clickId}`;
    return NextResponse.redirect(new URL(nextPath, request.url));
  } catch (error) {
    // A safety net, not a decision point — this route's actual resolution
    // logic and failure reasons are all handled above via `result.ok`. This
    // only catches genuinely unexpected failures (e.g. the database being
    // unreachable), logs them instead of letting them surface as a raw
    // framework error, and still fails safe with the same generic response
    // a public visitor would otherwise see.
    logger.error("route_crashed", {
      requestId,
      hostname,
      token,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailableResponse();
  }
}
