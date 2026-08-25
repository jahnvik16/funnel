"use client";

import { useActionState } from "react";
import type { Brand, Platform } from "@prisma/client";
import { ExperimentSuccessMetric } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../_components/SubmitButton";
import { SUCCESS_METRIC_LABELS } from "./successMetricLabels";
import { createExperiment, type FormState } from "./actions";

const initialState: FormState = {};

export function NewExperimentForm({ brands, platforms }: { brands: Brand[]; platforms: Platform[] }) {
  const [state, formAction] = useActionState(createExperiment, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <h2 className={ui.sectionTitle}>New experiment</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Brand (optional)
          <select name="brandId" className={ui.select} defaultValue="">
            <option value="">All brands</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
                {brand.status === "ARCHIVED" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Platform (optional)
          <select name="platformId" className={ui.select} defaultValue="">
            <option value="">All platforms</option>
            {platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
                {platform.status === "ARCHIVED" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Name
          <input name="name" required placeholder="Aggregator vs Telegram" className={ui.input} />
        </label>
        <label className={ui.label}>
          Success metric
          <select name="successMetric" required className={ui.select} defaultValue={ExperimentSuccessMetric.OUTBOUND_REDIRECTS}>
            {Object.values(ExperimentSuccessMetric).map((metric) => (
              <option key={metric} value={metric}>
                {SUCCESS_METRIC_LABELS[metric]}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Started at (optional)
          <input name="startedAt" type="date" className={ui.input} />
        </label>
        <label className={ui.label}>
          Ended at (optional)
          <input name="endedAt" type="date" className={ui.input} />
        </label>
        <label className={`${ui.label} sm:col-span-2`}>
          Variant config (optional JSON metadata)
          <textarea name="variantConfig" rows={2} className={`${ui.input} font-mono`} />
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Create experiment</SubmitButton>
      </div>
    </form>
  );
}
