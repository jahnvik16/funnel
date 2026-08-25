"use client";

import { useActionState } from "react";
import type { Brand, Experiment } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { updateExperiment, type FormState } from "../actions";

const initialState: FormState = {};

type TrackingLinkOption = { id: string; label: string; token: string };

function toDateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export function EditExperimentForm({
  experiment,
  brands,
  trackingLinks,
}: {
  experiment: Experiment;
  brands: Brand[];
  trackingLinks: TrackingLinkOption[];
}) {
  const [state, formAction] = useActionState(updateExperiment, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="id" value={experiment.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Brand
          <select name="brandId" required className={ui.select} defaultValue={experiment.brandId}>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
                {brand.status === "ARCHIVED" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Tracking link (optional)
          <select
            name="trackingLinkId"
            className={ui.select}
            defaultValue={experiment.trackingLinkId ?? ""}
          >
            <option value="">None</option>
            {trackingLinks.map((link) => (
              <option key={link.id} value={link.id}>
                {link.label} ({link.token})
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Name
          <input name="name" required defaultValue={experiment.name} className={ui.input} />
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
