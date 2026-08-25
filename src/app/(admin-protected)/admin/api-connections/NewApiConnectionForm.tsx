"use client";

import { useActionState } from "react";
import type { Brand } from "@prisma/client";
import { ApiConnectionAuthType } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../_components/SubmitButton";
import { createApiConnection, type FormState } from "./actions";

const initialState: FormState = {};

const AUTH_TYPES = Object.values(ApiConnectionAuthType);

export function NewApiConnectionForm({ brands }: { brands: Brand[] }) {
  const [state, formAction] = useActionState(createApiConnection, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <h2 className={ui.sectionTitle}>New API connection</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Brand (optional — leave blank for account-wide)
          <select name="brandId" className={ui.select} defaultValue="">
            <option value="">Account-wide</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
                {brand.status === "ARCHIVED" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Name
          <input name="name" required className={ui.input} />
        </label>
        <label className={ui.label}>
          Provider
          <input name="provider" required placeholder="paybig" className={ui.input} />
        </label>
        <label className={ui.label}>
          Base URL
          <input name="baseUrl" required type="url" placeholder="https://" className={ui.input} />
        </label>
        <label className={ui.label}>
          Auth type
          <select name="authType" required className={ui.select} defaultValue={ApiConnectionAuthType.NONE}>
            {AUTH_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className={`${ui.label} sm:col-span-2`}>
          Credentials (JSON)
          <textarea
            name="credentials"
            required
            rows={3}
            placeholder='{"apiKey": "..."}'
            className={`${ui.input} font-mono`}
          />
        </label>
      </div>
      <p className={ui.muted}>
        Credentials are encrypted at rest and never displayed again after saving.
      </p>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Create connection</SubmitButton>
      </div>
    </form>
  );
}
