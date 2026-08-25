"use client";

import { useActionState } from "react";
import type { Brand, Campaign, Platform } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { updateCampaign, type FormState } from "../actions";

const initialState: FormState = {};

export function EditCampaignForm({
  campaign,
  brands,
  platforms,
}: {
  campaign: Campaign;
  brands: Brand[];
  platforms: Platform[];
}) {
  const [state, formAction] = useActionState(updateCampaign, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="id" value={campaign.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Brand
          <select name="brandId" required className={ui.select} defaultValue={campaign.brandId}>
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
          <select name="platformId" required className={ui.select} defaultValue={campaign.platformId}>
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
          <input name="name" required defaultValue={campaign.name} className={ui.input} />
        </label>
        <label className={ui.label}>
          Slug
          <input name="slug" required defaultValue={campaign.slug} className={ui.input} />
        </label>
        <label className={ui.label}>
          Paybig URL
          <input
            name="paybigUrl"
            required
            type="url"
            defaultValue={campaign.paybigUrl}
            className={ui.input}
          />
        </label>
        <label className={ui.checkboxRow}>
          <input type="checkbox" name="isDefault" defaultChecked={campaign.isDefault} />
          Default/fallback campaign for this brand + platform
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}
