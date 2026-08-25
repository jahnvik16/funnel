import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import type { TrackingLinkVersionSnapshot } from "@/lib/tracking-link-publishing";

type Db = Prisma.TransactionClient;

// Short-lived on purpose: this is a "click to Telegram" handoff token, not a
// long-lived credential. Consumed almost immediately in the normal flow.
const PAYLOAD_TTL_MS = 15 * 60 * 1000;

export async function createTelegramStartPayload(
  db: Db,
  clickId: string,
  telegramBotId: string,
): Promise<{ payloadToken: string; expiresAt: Date }> {
  // Opaque and unguessable — carries no information itself; all it does is
  // map to server-side state. Never contains click/campaign/link ids.
  const payloadToken = randomBytes(16).toString("base64url");
  const expiresAt = new Date(Date.now() + PAYLOAD_TTL_MS);

  await db.telegramStartPayload.create({
    data: { clickId, telegramBotId, payloadToken, expiresAt },
  });

  return { payloadToken, expiresAt };
}

export type ResolvedTelegramPayload = {
  clickId: string;
  trackingLinkId: string;
  trackingLinkVersionId: string;
  campaignId: string | null;
  experimentArmId: string | null;
  snapshot: TrackingLinkVersionSnapshot;
};

export type TelegramPayloadResolution =
  | { ok: true; alreadyConsumed: boolean; payload: ResolvedTelegramPayload }
  | { ok: false; reason: "not_found" | "expired" };

// Resolves the payload to everything the webhook needs — click_id,
// tracking_link_id, tracking_link_version_id, campaign_id, and (where an arm
// was attached at publish time) experiment_arm_id — without the payload
// itself ever having carried any of that. Idempotent: a second resolution of
// an already-consumed-but-not-expired payload still succeeds (Telegram may
// retry webhook delivery), it just reports `alreadyConsumed: true`.
export async function resolveTelegramStartPayload(
  db: Db,
  payloadToken: string,
): Promise<TelegramPayloadResolution> {
  const payload = await db.telegramStartPayload.findUnique({
    where: { payloadToken },
    include: { click: { include: { trackingLinkVersion: true } } },
  });
  if (!payload) return { ok: false, reason: "not_found" };
  if (payload.expiresAt < new Date()) return { ok: false, reason: "expired" };

  const alreadyConsumed = payload.consumedAt !== null;
  if (!alreadyConsumed) {
    await db.telegramStartPayload.update({
      where: { id: payload.id },
      data: { consumedAt: new Date() },
    });
  }

  const arm = await db.experimentArm.findFirst({
    where: { trackingLinkVersionId: payload.click.trackingLinkVersionId },
    select: { id: true },
  });

  return {
    ok: true,
    alreadyConsumed,
    payload: {
      clickId: payload.clickId,
      trackingLinkId: payload.click.trackingLinkId,
      trackingLinkVersionId: payload.click.trackingLinkVersionId,
      campaignId: payload.click.campaignId,
      experimentArmId: arm?.id ?? null,
      snapshot: payload.click.trackingLinkVersion.snapshot as unknown as TrackingLinkVersionSnapshot,
    },
  };
}
