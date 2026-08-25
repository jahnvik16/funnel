import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  let database: "connected" | "unreachable" = "unreachable";

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "connected";
  } catch {
    database = "unreachable";
  }

  return NextResponse.json({ status: "ok", database });
}
