"use client";

import { useActionState } from "react";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { bulkImportTrackingLinks, type BulkImportFormState } from "../actions";

const initialState: BulkImportFormState = {};

export function BulkImportForm() {
  const [state, formAction] = useActionState(bulkImportTrackingLinks, initialState);

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className={ui.form}>
        <h2 className={ui.sectionTitle}>Bulk import tracking links (CSV)</h2>
        <p className={ui.muted}>
          Required columns: brand_slug, platform_slug, campaign_name, campaign_slug, paybig_url,
          domain_hostname, tracking_link_label, tracking_link_token, path_type (direct,
          aggregator, or telegram). destination_url is required for direct/aggregator rows;
          telegram_bot_name is required for telegram rows. social_account_handle and
          age_gate_enabled (true/false) are optional. Brands, platforms, domains, and Telegram
          bots must already exist — this creates Campaigns and Tracking Links (and publishes
          each one), not the entities they belong to.
        </p>
        <p className={ui.muted}>
          Every row goes through the same validation as publishing a link by hand — nothing here
          skips a check the admin UI would otherwise enforce. A row referencing an existing
          campaign reuses it only if its paybig_url matches exactly; a mismatch is reported as
          invalid rather than silently changed. Re-running the same file is safe — rows whose
          tracking link already exists are skipped, not duplicated.
        </p>
        <label className={ui.label}>
          CSV file
          <input type="file" name="csvFile" accept=".csv,text/csv" required className={ui.input} />
        </label>
        {state.error ? <p className={ui.error}>{state.error}</p> : null}
        <div>
          <SubmitButton pendingLabel="Importing…">Import</SubmitButton>
        </div>
      </form>

      {state.summary ? <BulkImportSummaryReport summary={state.summary} /> : null}
    </div>
  );
}

function BulkImportSummaryReport({ summary }: { summary: NonNullable<BulkImportFormState["summary"]> }) {
  return (
    <div className={ui.form}>
      <h2 className={ui.sectionTitle}>Import summary</h2>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          { label: "Total rows", value: summary.totalRows },
          { label: "Created & published", value: summary.created },
          { label: "Already existed (skipped)", value: summary.skippedExisting },
          { label: "Campaigns created", value: summary.campaignsCreated },
          { label: "Campaigns reused", value: summary.campaignsReused },
          { label: "Invalid rows", value: summary.invalid.length },
        ].map((stat) => (
          <div key={stat.label} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">{stat.label}</dt>
            <dd className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {summary.invalid.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Invalid rows</h3>
          <table className={ui.table}>
            <thead>
              <tr>
                <th className={ui.th}>Row</th>
                <th className={ui.th}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {summary.invalid.map((row) => (
                <tr key={row.rowNumber}>
                  <td className={ui.td}>{row.rowNumber}</td>
                  <td className={ui.td}>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
