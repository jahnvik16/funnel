import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { ImportCsvForm } from "./ImportCsvForm";

const PAGE_SIZE = 50;

type SearchParams = { page?: string; q?: string };

export default async function ConversionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const q = params.q?.trim() ?? "";

  // Search matches the Paybig conversion id only — the id an admin is
  // actually handed when Paybig reports an issue with a specific
  // conversion. Broader search (campaign name, amount, etc.) isn't needed
  // yet; add it if that assumption turns out wrong.
  const where: Prisma.ConversionWhereInput = q
    ? { paybigConversionId: { contains: q, mode: "insensitive" } }
    : {};

  const [conversions, unmatchedCount, totalCount, matchingCount] = await Promise.all([
    prisma.conversion.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { campaign: true, brand: true },
    }),
    prisma.conversion.count({ where: { campaignId: null } }),
    prisma.conversion.count(),
    prisma.conversion.count({ where }),
  ]);

  const hasNextPage = page * PAGE_SIZE < matchingCount;
  const hasPrevPage = page > 1;

  return (
    <div className="flex flex-col gap-6">
      <h1 className={ui.pageTitle}>Conversions</h1>
      <p className={ui.muted}>
        {totalCount} conversion{totalCount === 1 ? "" : "s"} on file, {unmatchedCount} unmatched
        to a campaign. See the{" "}
        <a href="/admin/reports" className={ui.link}>
          attribution dashboard
        </a>{" "}
        for filtered metrics.
      </p>

      <ImportCsvForm />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <h2 className={ui.sectionTitle}>
            {q ? `Conversions matching "${q}"` : "Recent conversions"}
          </h2>
          <form method="get" className="flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search by Paybig conversion ID"
              className={`${ui.input} w-64`}
            />
            <button type="submit" className={ui.secondaryButton}>
              Search
            </button>
            {q ? (
              <a href="/admin/conversions" className={ui.secondaryButton}>
                Clear
              </a>
            ) : null}
          </form>
        </div>
        <table className={ui.table}>
          <thead>
            <tr>
              <th className={ui.th}>Paybig conversion ID</th>
              <th className={ui.th}>Campaign</th>
              <th className={ui.th}>Brand</th>
              <th className={ui.th}>Amount</th>
              <th className={ui.th}>Occurred at</th>
              <th className={ui.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {conversions.map((conversion) => (
              <tr key={conversion.id}>
                <td className={ui.td}>
                  {conversion.paybigConversionId.startsWith("composite:") ? (
                    <span title={conversion.paybigConversionId}>synthetic key</span>
                  ) : (
                    conversion.paybigConversionId
                  )}
                </td>
                <td className={ui.td}>
                  {conversion.campaign ? (
                    <>
                      {conversion.campaign.name}
                      {conversion.campaign.isDefault ? " (default)" : ""}
                    </>
                  ) : (
                    <span className={ui.error}>Unmatched</span>
                  )}
                </td>
                <td className={ui.td}>{conversion.brand?.name ?? <span className={ui.muted}>—</span>}</td>
                <td className={ui.td}>
                  {conversion.amount ? `${conversion.amount} ${conversion.currency ?? ""}` : "—"}
                </td>
                <td className={ui.td}>{conversion.occurredAt.toISOString()}</td>
                <td className={ui.td}>{conversion.status}</td>
              </tr>
            ))}
            {conversions.length === 0 ? (
              <tr>
                <td className={ui.td} colSpan={6}>
                  <span className={ui.muted}>
                    {q ? "No conversions match that search." : "No conversions imported yet."}
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="flex items-center justify-between">
          <span className={ui.muted}>
            Page {page} of {Math.max(1, Math.ceil(matchingCount / PAGE_SIZE))} ({matchingCount} total)
          </span>
          <div className="flex gap-2">
            {hasPrevPage ? (
              <a
                href={`/admin/conversions?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page - 1) })}`}
                className={ui.secondaryButton}
              >
                Previous
              </a>
            ) : null}
            {hasNextPage ? (
              <a
                href={`/admin/conversions?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`}
                className={ui.secondaryButton}
              >
                Next
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
