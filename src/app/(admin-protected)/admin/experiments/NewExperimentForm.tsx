"use client";

import { useActionState } from "react";
import type { Brand } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../_components/SubmitButton";
import { createExperiment, type FormState } from "./actions";

const initialState: FormState = {};

type TrackingLinkOption = { id: string; label: string; token: string };

export function NewExperimentForm({
  brands,
  trackingLinks,
}: {
  brands: Brand[];
  trackingLinks: TrackingLinkOption[];
}) {
  const [state, formAction] = useActionState(createExperiment, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <h2 className={ui.sectionTitle}>New experiment</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Brand
          <select name="brandId" required className={ui.select} defaultValue="">
            <option value="" disabled>
              Select a brand
            </option>
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
          <select name="trackingLinkId" className={ui.select} defaultValue="">
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
          <input name="name" required className={ui.input} />
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
