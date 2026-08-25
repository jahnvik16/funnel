"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadClickWithSnapshot, writeFunnelEvent, hasFunnelEvent } from "@/lib/public-routing";

export async function acceptAgeGate(formData: FormData): Promise<void> {
  const clickId = String(formData.get("clickId"));

  await prisma.$transaction(async (tx) => {
    const loaded = await loadClickWithSnapshot(tx, clickId);
    if (!loaded) return;
    // Idempotent — a retried/duplicated POST shouldn't produce a second
    // "accepted" event for the same click.
    if (await hasFunnelEvent(tx, clickId, "AGE_GATE_ACCEPTED")) return;
    await writeFunnelEvent(tx, clickId, "AGE_GATE_ACCEPTED");
  });

  redirect(`/path/${clickId}`);
}

export async function declineAgeGate(formData: FormData): Promise<void> {
  const clickId = String(formData.get("clickId"));

  await prisma.$transaction(async (tx) => {
    const loaded = await loadClickWithSnapshot(tx, clickId);
    if (!loaded) return;
    if (await hasFunnelEvent(tx, clickId, "AGE_GATE_DECLINED")) return;
    await writeFunnelEvent(tx, clickId, "AGE_GATE_DECLINED");
  });

  redirect(`/gate/${clickId}?declined=1`);
}
