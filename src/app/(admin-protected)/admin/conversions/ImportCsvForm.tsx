"use client";

import { useActionState } from "react";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../_components/SubmitButton";
import { importConversionsCsv, type ImportFormState } from "./actions";

const initialState: ImportFormState = {};

export function ImportCsvForm() {
  const [state, formAction] = useActionState(importConversionsCsv, initialState);

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className={ui.form}>
        <h2 className={ui.sectionTitle}>Import Paybig conversions (CSV)</h2>
        <p className={ui.muted}>
          Required columns: conversion_time, campaign_slug, amount, currency. conversion_id is
          strongly recommended — without it, duplicate detection falls back to a composite key
          (campaign + time + amount + currency) that cannot distinguish two genuinely distinct
          conversions sharing all four values. An optional status column (pending, confirmed, or
          reversed) updates an existing conversion&apos;s status when it&apos;s re-imported with a
          different value — nothing else about it is ever changed. Extra columns are preserved but
          ignored.
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

      {state.summary ? <ImportSummaryReport summary={state.summary} /> : null}
    </div>
  );
}

function ImportSummaryReport({ summary }: { summary: NonNullable<ImportFormState["summary"]> }) {
  return (
    <div className={ui.form}>
      <h2 className={ui.sectionTitle}>Import summary</h2>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          { label: "Total rows", value: summary.totalRows },
          { label: "Created", value: summary.created },
          { label: "Duplicates skipped", value: summary.duplicates },
          { label: "Status updated", value: summary.statusUpdated },
          { label: "Matched to a campaign", value: summary.matchedCampaigns },
          { label: "Unmatched", value: summary.unmatched.length },
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

      {summary.unmatched.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Unmatched campaign_slug values</h3>
          <table className={ui.table}>
            <thead>
              <tr>
                <th className={ui.th}>Row</th>
                <th className={ui.th}>campaign_slug</th>
                <th className={ui.th}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {summary.unmatched.map((row) => (
                <tr key={row.rowNumber}>
                  <td className={ui.td}>{row.rowNumber}</td>
                  <td className={ui.td}>{row.campaignSlug}</td>
                  <td className={ui.td}>
                    {row.reason === "ambiguous"
                      ? "Ambiguous — more than one campaign uses this slug"
                      : "No campaign with this slug"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
