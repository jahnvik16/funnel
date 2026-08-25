"use client";

import { useActionState } from "react";
import type { Brand, Platform } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../_components/SubmitButton";
import { createSocialAccount, type FormState } from "./actions";

const initialState: FormState = {};

export function NewSocialAccountForm({
  brands,
  platforms,
}: {
  brands: Brand[];
  platforms: Platform[];
}) {
  const [state, formAction] = useActionState(createSocialAccount, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <h2 className={ui.sectionTitle}>New social account</h2>
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
          Handle
          <input name="handle" required placeholder="@handle" className={ui.input} />
        </label>
        <label className={ui.label}>
          Display name
          <input name="displayName" className={ui.input} />
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Create social account</SubmitButton>
      </div>
    </form>
  );
}
