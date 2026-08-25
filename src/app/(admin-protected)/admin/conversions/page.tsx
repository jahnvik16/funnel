import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { ImportCsvForm } from "./ImportCsvForm";

export default async function ConversionsPage() {
  const [conversions, unmatchedCount, totalCount] = await Promise.all([
    prisma.conversion.findMany({
      orderBy: { receivedAt: "desc" },
      take: 50,
      include: { campaign: true, brand: true },
    }),
    prisma.conversion.count({ where: { campaignId: null } }),
    prisma.conversion.count(),
  ]);

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
        <h2 className={ui.sectionTitle}>Recent conversions</h2>
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
                  <span className={ui.muted}>No conversions imported yet.</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
