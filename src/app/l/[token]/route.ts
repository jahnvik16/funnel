import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveTrackingLinkVersion,
  recordClick,
  writeFunnelEvent,
  getHostname,
  getClientIp,
} from "@/lib/public-routing";

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
  const { token } = await params;
  const hostname = getHostname(request.headers);

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

  if (!result.ok) {
    return unavailableResponse();
  }

  const nextPath = result.ageGateEnabled ? `/gate/${result.clickId}` : `/path/${result.clickId}`;
  return NextResponse.redirect(new URL(nextPath, request.url));
}
