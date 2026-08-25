import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkDatabaseHealth } from "@/lib/health";

// A monitor/orchestrator that only checks the HTTP status code (not the JSON
// body) needs a non-200 here to detect a database outage — the body alone
// isn't enough. `status: "ok"` regardless of DB state was flagged in the
// post-V1 engineering audit as a real gap for exactly this reason.
export async function GET() {
  const database = await checkDatabaseHealth(prisma);
  const healthy = database === "connected";

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", database },
    { status: healthy ? 200 : 503 },
  );
}
