"use client";

import { useActionState } from "react";
import type { Brand, Experiment, Platform } from "@prisma/client";
import { ExperimentSuccessMetric } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { SUCCESS_METRIC_LABELS } from "../successMetricLabels";
import { updateExperiment, type FormState } from "../actions";

const initialState: FormState = {};

function toDateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export function EditExperimentForm({
  experiment,
  brands,
  platforms,
}: {
  experiment: Experiment;
  brands: Brand[];
  platforms: Platform[];
}) {
  const [state, formAction] = useActionState(updateExperiment, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="id" value={experiment.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Brand (optional)
          <select name="brandId" className={ui.select} defaultValue={experiment.brandId ?? ""}>
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
          <select name="platformId" className={ui.select} defaultValue={experiment.platformId ?? ""}>
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
          <input name="name" required defaultValue={experiment.name} className={ui.input} />
        </label>
        <label className={ui.label}>
          Success metric
          <select name="successMetric" required className={ui.select} defaultValue={experiment.successMetric}>
            {Object.values(ExperimentSuccessMetric).map((metric) => (
              <option key={metric} value={metric}>
                {SUCCESS_METRIC_LABELS[metric]}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Started at (optional)
          <input
            name="startedAt"
            type="date"
            defaultValue={toDateInputValue(experiment.startedAt)}
            className={ui.input}
          />
        </label>
        <label className={ui.label}>
          Ended at (optional)
          <input
            name="endedAt"
            type="date"
            defaultValue={toDateInputValue(experiment.endedAt)}
            className={ui.input}
          />
        </label>
        <label className={`${ui.label} sm:col-span-2`}>
          Variant config (optional JSON metadata)
          <textarea
            name="variantConfig"
            rows={2}
            defaultValue={
              experiment.variantConfig ? JSON.stringify(experiment.variantConfig) : ""
            }
            className={`${ui.input} font-mono`}
          />
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}
