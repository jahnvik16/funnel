"use client";

import { useActionState } from "react";
import type { Brand, Domain } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../_components/SubmitButton";
import { createTrackingLink, type FormState } from "./actions";

const initialState: FormState = {};

export function NewTrackingLinkForm({
  brands,
  domains,
  suggestedToken,
}: {
  brands: Brand[];
  domains: Domain[];
  suggestedToken: string;
}) {
  const [state, formAction] = useActionState(createTrackingLink, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <h2 className={ui.sectionTitle}>New tracking link</h2>
      <p className={ui.muted}>
        Only the routing basics are set here. Publish a version afterward to configure the
        path, campaign, and social account.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Label
          <input name="label" required placeholder="Spring push — Instagram bio" className={ui.input} />
        </label>
        <label className={ui.label}>
          Token (used in the public URL, cannot be changed later)
          <input name="token" required defaultValue={suggestedToken} className={ui.input} />
        </label>
        <label className={ui.label}>
          Brand (cannot be changed later)
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
          Domain
          <select name="domainId" required className={ui.select} defaultValue="">
            <option value="" disabled>
              Select a domain
            </option>
            {domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.hostname}
                {!domain.isActive ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Create tracking link</SubmitButton>
      </div>
    </form>
  );
}
