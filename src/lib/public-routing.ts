import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import type { Click, TrackingLink, FunnelStepType } from "@prisma/client";
import type { TrackingLinkVersionSnapshot } from "@/lib/tracking-link-publishing";
import { createTelegramStartPayload } from "@/lib/telegram-payload";

// Kept framework-independent (no next/headers, no Next.js Request/Response
// types) so it's directly callable from integration tests, the same
// reasoning as lib/tracking-link-publishing.ts.
type Db = Prisma.TransactionClient;

export type ResolvedRoute =
  | {
      ok: true;
      link: TrackingLink;
      versionId: string;
      snapshot: TrackingLinkVersionSnapshot;
    }
  | {
      ok: false;
      reason:
        | "domain_not_found"
        | "domain_inactive"
        | "link_not_found"
        | "link_inactive"
        | "no_published_version";
    };

// Public traffic resolves a link by (domain, token) — never by token alone,
// see DECISIONS.md D015. Only an ACTIVE link with a published version is
// resolvable; PAUSED/ARCHIVED links and unpublished links are treated
// identically as "not available" to the public (no internal detail leaks).
export async function resolveTrackingLinkVersion(
  db: Db,
  hostname: string,
  token: string,
): Promise<ResolvedRoute> {
  const domain = await db.domain.findUnique({ where: { hostname } });
  if (!domain) return { ok: false, reason: "domain_not_found" };
  if (!domain.isActive) return { ok: false, reason: "domain_inactive" };

  const link = await db.trackingLink.findUnique({
    where: { domainId_token: { domainId: domain.id, token } },
    include: { currentVersion: true },
  });
  if (!link) return { ok: false, reason: "link_not_found" };
  if (link.status !== "ACTIVE") return { ok: false, reason: "link_inactive" };
  if (!link.currentVersion) return { ok: false, reason: "no_published_version" };

  return {
    ok: true,
    link,
    versionId: link.currentVersion.id,
    snapshot: link.currentVersion.snapshot as unknown as TrackingLinkVersionSnapshot,
  };
}

// Standard Web `Headers`, not a Next.js type — keeps this testable without
// spinning up a Next.js request.
// Lowercased because hostnames are case-insensitive (RFC 4343) but Postgres
// text equality isn't — a stored "links.acme.example" would otherwise fail
// to match a request Host header sent as "Links.Acme.Example".
export function getHostname(headers: Headers): string {
  const host = headers.get("host") ?? "";
  return host.split(":")[0].toLowerCase();
}

export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip");
}

export type RequestMeta = {
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
  searchParams: URLSearchParams;
};

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

export function extractUtmParams(searchParams: URLSearchParams): Prisma.InputJsonValue | undefined {
  const entries: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = searchParams.get(key);
    if (value) entries[key] = value;
  }
  return Object.keys(entries).length > 0 ? entries : undefined;
}

// No salt/rotation policy yet — see docs/funnelcore/OPEN_QUESTIONS.md
// "Attribution edge cases". This is a placeholder that satisfies "hash
// before storage, no raw IP retention", not the final scheme.
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex");
}

export function classifyDeviceType(userAgent: string | null): string | null {
  if (!userAgent) return null;
  return /Mobi|Android|iPhone|iPad/i.test(userAgent) ? "mobile" : "desktop";
}

// Click is the attribution-context snapshot at click time, copied from the
// (already-frozen) TrackingLinkVersion snapshot — never re-derived from live
// config. See DECISIONS.md D004.
export async function recordClick(
  db: Db,
  link: TrackingLink,
  versionId: string,
  snapshot: TrackingLinkVersionSnapshot,
  meta: RequestMeta,
): Promise<Click> {
  return db.click.create({
    data: {
      trackingLinkId: link.id,
      trackingLinkVersionId: versionId,
      brandId: snapshot.brand.id,
      platformId: snapshot.platform?.id ?? null,
      socialAccountId: snapshot.socialAccount?.id ?? null,
      campaignId: snapshot.campaign.id,
      ipHash: hashIp(meta.ip),
      userAgent: meta.userAgent,
      referrer: meta.referrer,
      utmParams: extractUtmParams(meta.searchParams),
      deviceType: classifyDeviceType(meta.userAgent),
    },
  });
}

// Every caller that guards a one-time event with hasFunnelEvent() first
// (age-gate accept/decline, Telegram start, outbound redirect) still has a
// check-then-write race under genuinely concurrent requests — the DB-level
// partial unique index (migration 20260825200000_funnel_event_singleton_steps)
// is what actually closes it. A unique-constraint violation here means a
// concurrent request already won and recorded this exact one-time event,
// which is the desired outcome, not a failure — every one of those callers
// already treats "the event exists" as success.
export async function writeFunnelEvent(
  db: Db,
  clickId: string,
  stepType: FunnelStepType,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  try {
    await db.funnelEvent.create({
      data: { clickId, stepType, metadata: metadata ?? undefined },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }
}

export async function hasFunnelEvent(
  db: Db,
  clickId: string,
  stepType: FunnelStepType,
): Promise<boolean> {
  const existing = await db.funnelEvent.findFirst({ where: { clickId, stepType } });
  return existing !== null;
}

// Loads a previously-created Click plus the frozen snapshot it was created
// from — used by /gate, /path, and /out, which never re-resolve live config.
export async function loadClickWithSnapshot(
  db: Db,
  clickId: string,
): Promise<{ click: Click; snapshot: TrackingLinkVersionSnapshot } | null> {
  const click = await db.click.findUnique({
    where: { id: clickId },
    include: { trackingLinkVersion: true },
  });
  if (!click) return null;
  return {
    click,
    snapshot: click.trackingLinkVersion.snapshot as unknown as TrackingLinkVersionSnapshot,
  };
}

export function extractDestinationUrl(pathConfig: unknown): string | null {
  if (
    typeof pathConfig === "object" &&
    pathConfig !== null &&
    "destinationUrl" in pathConfig &&
    typeof (pathConfig as { destinationUrl?: unknown }).destinationUrl === "string"
  ) {
    const url = (pathConfig as { destinationUrl: string }).destinationUrl;
    try {
      new URL(url);
      return url;
    } catch {
      return null;
    }
  }
  return null;
}

export type PathViewResult =
  | { ok: true; render: "redirect_direct" }
  | { ok: true; render: "aggregator" }
  | { ok: true; render: "redirect_telegram"; deepLinkUrl: string }
  | { ok: false; reason: "unsupported_path_type" | "telegram_bot_missing" };

function buildTelegramDeepLink(botUsername: string, payloadToken: string): string {
  return `https://t.me/${botUsername}?start=${payloadToken}`;
}

// The decision made at /path/[clickId]: DIRECT skips straight to /out with no
// interim page; AGGREGATOR renders the owned page and logs the view;
// TELEGRAM mints a short-lived start payload for this click and redirects
// into the bot; anything else fails safely rather than attempting a redirect
// with no real destination.
export async function handlePathView(
  db: Db,
  clickId: string,
  snapshot: TrackingLinkVersionSnapshot,
): Promise<PathViewResult> {
  if (snapshot.pathType === "DIRECT") {
    return { ok: true, render: "redirect_direct" };
  }
  if (snapshot.pathType === "AGGREGATOR") {
    await writeFunnelEvent(db, clickId, "AGGREGATOR_VIEWED");
    return { ok: true, render: "aggregator" };
  }
  if (snapshot.pathType === "TELEGRAM") {
    // Publish-time validation guarantees telegramBot is set with a username
    // whenever pathType is TELEGRAM, but defend against a corrupted/stale
    // snapshot rather than throwing.
    if (!snapshot.telegramBot) {
      await writeFunnelEvent(db, clickId, "ROUTE_FAILED", { reason: "telegram_bot_missing" });
      return { ok: false, reason: "telegram_bot_missing" };
    }
    const { payloadToken } = await createTelegramStartPayload(db, clickId, snapshot.telegramBot.id);
    await writeFunnelEvent(db, clickId, "TELEGRAM_REDIRECTED", {
      telegramBotId: snapshot.telegramBot.id,
      botUsername: snapshot.telegramBot.username,
    });
    return {
      ok: true,
      render: "redirect_telegram",
      deepLinkUrl: buildTelegramDeepLink(snapshot.telegramBot.username, payloadToken),
    };
  }
  await writeFunnelEvent(db, clickId, "ROUTE_FAILED", {
    reason: "unsupported_path_type",
    pathType: snapshot.pathType,
  });
  return { ok: false, reason: "unsupported_path_type" };
}

export type OutboundResult =
  | { ok: true; destinationUrl: string }
  | { ok: false; reason: "unsupported_path_type" | "invalid_destination" };

// The single canonical egress point's logic: both DIRECT (reached
// immediately from /path) and AGGREGATOR (reached after the visitor clicks
// "Continue") end up here. Whichever it was, this is where the handoff to
// Paybig is decided and logged — see docs/funnelcore/DECISIONS.md for the
// "destinationUrl vs. campaign.paybigUrl" call.
export async function executeOutbound(
  db: Db,
  clickId: string,
  snapshot: TrackingLinkVersionSnapshot,
): Promise<OutboundResult> {
  // Idempotent: a redirect to an external host is a GET a browser/CDN may
  // legitimately retry (e.g. the client re-issuing the navigation after the
  // Server Action's redirect, seen in manual testing). Replay the same
  // destination rather than writing duplicate events for one click.
  const previous = await db.funnelEvent.findFirst({
    where: { clickId, stepType: "OUTBOUND_PAYBIG_REDIRECTED" },
    orderBy: { occurredAt: "asc" },
  });
  if (previous) {
    const previousUrl = extractDestinationUrl(previous.metadata);
    if (previousUrl) return { ok: true, destinationUrl: previousUrl };
  }

  if (
    snapshot.pathType !== "DIRECT" &&
    snapshot.pathType !== "AGGREGATOR" &&
    snapshot.pathType !== "TELEGRAM"
  ) {
    await writeFunnelEvent(db, clickId, "ROUTE_FAILED", {
      reason: "unsupported_path_type",
      pathType: snapshot.pathType,
    });
    return { ok: false, reason: "unsupported_path_type" };
  }

  if (snapshot.pathType === "AGGREGATOR") {
    await writeFunnelEvent(db, clickId, "AGGREGATOR_CONTINUE_CLICKED");
  }

  // DIRECT/AGGREGATOR use the admin-configured destinationUrl (D019);
  // TELEGRAM has no such field in its pathConfig, so its terminal handoff
  // target is the campaign's Paybig destination instead.
  const destinationUrl =
    snapshot.pathType === "TELEGRAM"
      ? extractDestinationUrl({ destinationUrl: snapshot.campaign.paybigUrl })
      : extractDestinationUrl(snapshot.pathConfig);
  if (!destinationUrl) {
    await writeFunnelEvent(db, clickId, "ROUTE_FAILED", { reason: "invalid_destination" });
    return { ok: false, reason: "invalid_destination" };
  }

  await writeFunnelEvent(db, clickId, "OUTBOUND_PAYBIG_REDIRECTED", { destinationUrl });
  return { ok: true, destinationUrl };
}
