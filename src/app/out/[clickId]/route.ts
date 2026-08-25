import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClickWithSnapshot, executeOutbound } from "@/lib/public-routing";

function unavailableResponse(): NextResponse {
  return new NextResponse("This link is not available.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clickId: string }> },
) {
  const { clickId } = await params;

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadClickWithSnapshot(tx, clickId);
    if (!loaded) return { ok: false as const, reason: "click_not_found" as const };
    return executeOutbound(tx, clickId, loaded.snapshot);
  });

  if (!result.ok) {
    return unavailableResponse();
  }

  return NextResponse.redirect(result.destinationUrl);
}
