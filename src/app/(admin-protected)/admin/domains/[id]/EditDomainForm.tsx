"use client";

import { useActionState } from "react";
import type { Brand, Domain } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { updateDomain, type FormState } from "../actions";

const initialState: FormState = {};

export function EditDomainForm({ domain, brands }: { domain: Domain; brands: Brand[] }) {
  const [state, formAction] = useActionState(updateDomain, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="id" value={domain.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Hostname
          <input name="hostname" required defaultValue={domain.hostname} className={ui.input} />
        </label>
        <label className={ui.label}>
          Brand (optional — leave blank for a shared domain)
          <select name="brandId" className={ui.select} defaultValue={domain.brandId ?? ""}>
            <option value="">Shared (no brand)</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
                {brand.status === "ARCHIVED" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}
