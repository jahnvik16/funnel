"use client";

import { useActionState } from "react";
import type { Brand, Platform, SocialAccount } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { updateSocialAccount, type FormState } from "../actions";

const initialState: FormState = {};

export function EditSocialAccountForm({
  account,
  brands,
  platforms,
}: {
  account: SocialAccount;
  brands: Brand[];
  platforms: Platform[];
}) {
  const [state, formAction] = useActionState(updateSocialAccount, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="id" value={account.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Brand
          <select name="brandId" required className={ui.select} defaultValue={account.brandId}>
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
          <select name="platformId" required className={ui.select} defaultValue={account.platformId}>
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
          <input name="handle" required defaultValue={account.handle} className={ui.input} />
        </label>
        <label className={ui.label}>
          Display name
          <input name="displayName" defaultValue={account.displayName ?? ""} className={ui.input} />
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}
