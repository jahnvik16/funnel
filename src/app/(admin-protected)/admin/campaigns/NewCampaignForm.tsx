"use client";

import { useActionState } from "react";
import type { Brand, Platform } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../_components/SubmitButton";
import { createCampaign, type FormState } from "./actions";

const initialState: FormState = {};

export function NewCampaignForm({ brands, platforms }: { brands: Brand[]; platforms: Platform[] }) {
  const [state, formAction] = useActionState(createCampaign, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <h2 className={ui.sectionTitle}>New campaign</h2>
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
          Platform
          <select name="platformId" required className={ui.select} defaultValue="">
            <option value="" disabled>
              Select a platform
            </option>
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
          <input name="name" required className={ui.input} />
        </label>
        <label className={ui.label}>
          Slug
          <input name="slug" required placeholder="spring-push" className={ui.input} />
        </label>
        <label className={ui.label}>
          Paybig URL
          <input name="paybigUrl" required type="url" placeholder="https://" className={ui.input} />
        </label>
        <label className={ui.checkboxRow}>
          <input type="checkbox" name="isDefault" />
          Default/fallback campaign for this brand + platform
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Create campaign</SubmitButton>
      </div>
    </form>
  );
}
