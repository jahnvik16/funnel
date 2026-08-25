import { PathType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { buildAttributionReport, type ReportFilters } from "@/lib/attribution-report";

type SearchParams = {
  dateFrom?: string;
  dateTo?: string;
  brandId?: string;
  platformId?: string;
  campaignId?: string;
  trackingLinkId?: string;
  pathType?: string;
  socialAccountId?: string;
  experimentId?: string;
  experimentArmId?: string;
};

const PATH_TYPES = Object.values(PathType);

function parseFilters(params: SearchParams): ReportFilters {
  const filters: ReportFilters = {};
  if (params.dateFrom) filters.dateFrom = new Date(`${params.dateFrom}T00:00:00.000Z`);
  if (params.dateTo) filters.dateTo = new Date(`${params.dateTo}T23:59:59.999Z`);
  if (params.brandId) filters.brandId = params.brandId;
  if (params.platformId) filters.platformId = params.platformId;
  if (params.campaignId) filters.campaignId = params.campaignId;
  if (params.trackingLinkId) filters.trackingLinkId = params.trackingLinkId;
  if (params.pathType && PATH_TYPES.includes(params.pathType as PathType)) {
    filters.pathType = params.pathType as PathType;
  }
  if (params.socialAccountId) filters.socialAccountId = params.socialAccountId;
  if (params.experimentId) filters.experimentId = params.experimentId;
  if (params.experimentArmId) filters.experimentArmId = params.experimentArmId;
  return filters;
}

function formatRate(rate: number | null): string {
  return rate === null ? "N/A" : `${(rate * 100).toFixed(1)}%`;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const filters = parseFilters(params);

  const [brands, platforms, campaigns, trackingLinks, socialAccounts, experiments, experimentArms, report] =
    await Promise.all([
      prisma.brand.findMany({ orderBy: { name: "asc" } }),
      prisma.platform.findMany({ orderBy: { name: "asc" } }),
      prisma.campaign.findMany({ orderBy: { name: "asc" }, include: { brand: true } }),
      prisma.trackingLink.findMany({ orderBy: { label: "asc" }, include: { brand: true } }),
      prisma.socialAccount.findMany({ orderBy: { handle: "asc" }, include: { brand: true } }),
      prisma.experiment.findMany({ orderBy: { name: "asc" } }),
      prisma.experimentArm.findMany({ orderBy: { name: "asc" }, include: { experiment: true } }),
      buildAttributionReport(prisma, filters),
    ]);

  const incompatibleReasons: string[] = [];
  if (filters.trackingLinkId) incompatibleReasons.push("tracking link");
  if (filters.pathType) incompatibleReasons.push("path");
  if (filters.socialAccountId) incompatibleReasons.push("social account");
  if (filters.experimentId) incompatibleReasons.push("experiment");
  if (filters.experimentArmId) incompatibleReasons.push("experiment arm");

  return (
    <div className="flex flex-col gap-6">
      <h1 className={ui.pageTitle}>Attribution dashboard</h1>

      <form method="get" className={ui.form}>
        <h2 className={ui.sectionTitle}>Filters</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className={ui.label}>
            From
            <input type="date" name="dateFrom" defaultValue={params.dateFrom ?? ""} className={ui.input} />
          </label>
          <label className={ui.label}>
            To
            <input type="date" name="dateTo" defaultValue={params.dateTo ?? ""} className={ui.input} />
          </label>
          <div />
          <label className={ui.label}>
            Brand
            <select name="brandId" defaultValue={params.brandId ?? ""} className={ui.select}>
              <option value="">All brands</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </label>
          <label className={ui.label}>
            Platform
            <select name="platformId" defaultValue={params.platformId ?? ""} className={ui.select}>
              <option value="">All platforms</option>
              {platforms.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.name}
                </option>
              ))}
            </select>
          </label>
          <label className={ui.label}>
            Campaign
            <select name="campaignId" defaultValue={params.campaignId ?? ""} className={ui.select}>
              <option value="">All campaigns</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.brand.name} — {campaign.name}
                  {campaign.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className={ui.label}>
            Tracking link
            <select name="trackingLinkId" defaultValue={params.trackingLinkId ?? ""} className={ui.select}>
              <option value="">All tracking links</option>
              {trackingLinks.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.brand.name} — {link.label} ({link.token})
                </option>
              ))}
            </select>
          </label>
          <label className={ui.label}>
            Path
            <select name="pathType" defaultValue={params.pathType ?? ""} className={ui.select}>
              <option value="">All paths</option>
              <option value="DIRECT">Direct</option>
              <option value="AGGREGATOR">Aggregator</option>
              <option value="TELEGRAM">Telegram</option>
            </select>
          </label>
          <label className={ui.label}>
            Social account
            <select name="socialAccountId" defaultValue={params.socialAccountId ?? ""} className={ui.select}>
              <option value="">All social accounts</option>
              {socialAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.brand.name} — {account.handle}
                </option>
              ))}
            </select>
          </label>
          <label className={ui.label}>
            Experiment
            <select name="experimentId" defaultValue={params.experimentId ?? ""} className={ui.select}>
              <option value="">All experiments</option>
              {experiments.map((experiment) => (
                <option key={experiment.id} value={experiment.id}>
                  {experiment.name}
                </option>
              ))}
            </select>
          </label>
          <label className={ui.label}>
            Experiment arm
            <select name="experimentArmId" defaultValue={params.experimentArmId ?? ""} className={ui.select}>
              <option value="">All arms</option>
              {experimentArms.map((arm) => (
                <option key={arm.id} value={arm.id}>
                  {arm.experiment.name} — {arm.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          <button type="submit" className={ui.primaryButton}>
            Apply filters
          </button>
          <a href="/admin/reports" className={ui.secondaryButton}>
            Reset
          </a>
        </div>
      </form>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className={ui.sectionTitle}>Funnel metrics</h2>
          <p className={ui.muted}>
            Computed directly from Click/FunnelEvent rows — precise at whatever filter
            granularity is selected above, including path, social account, and experiment arm.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            { label: "Clicks", value: report.funnel.clicks },
            { label: "Age gate accepts", value: report.funnel.ageGateAccepts },
            { label: "Aggregator views", value: report.funnel.aggregatorViews },
            { label: "Telegram starts", value: report.funnel.telegramStarts },
            { label: "Outbound Paybig redirects", value: report.funnel.outboundRedirects },
            { label: "Outbound redirect rate", value: formatRate(report.funnel.outboundRedirectRate) },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">{stat.label}</dt>
              <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className={ui.sectionTitle}>Signup attribution (campaign-level)</h2>
          <p className={ui.muted}>
            Paybig only reports conversions against a campaign_slug, so signups can only be
            attributed at the campaign level — never to an individual click, path, social
            account, or experiment arm. These figures respect date/brand/platform/campaign
            filters only.
          </p>
        </div>
        {incompatibleReasons.length > 0 ? (
          <p className={`${ui.error} rounded border border-red-300 p-3 dark:border-red-800`}>
            Your {incompatibleReasons.join(", ")} filter{incompatibleReasons.length > 1 ? "s" : ""}{" "}
            cannot be applied to signup data — Paybig conversions carry no path/social-account/
            experiment information. The signups figure below still reflects the campaign-level
            filters only (date, brand, platform, campaign); the per-click and
            per-outbound-redirect rates are marked N/A because dividing a campaign-wide signup
            count by a more narrowly filtered click count would misrepresent the real conversion
            rate — not merely a less precise number, an actively misleading one.
          </p>
        ) : null}
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            { label: "Signups", value: report.signupAttribution.signups },
            { label: "Signup rate per click", value: formatRate(report.signupAttribution.signupRatePerClick) },
            {
              label: "Signup rate per outbound redirect",
              value: formatRate(report.signupAttribution.signupRatePerOutboundRedirect),
            },
            {
              label: "Unmatched conversions (all brands, in range)",
              value: report.signupAttribution.unmatchedConversions,
            },
            { label: "Default/catch-all conversions", value: report.signupAttribution.defaultConversions },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <dt className="text-xs uppercase tracking-wide text-zinc-500">{stat.label}</dt>
              <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
