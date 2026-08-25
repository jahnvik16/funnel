"use client";

import { useActionState } from "react";
import type { Brand, Prisma } from "@prisma/client";
import { ApiConnectionAuthType } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { updateApiConnection, type FormState } from "../actions";
import { API_CONNECTION_SAFE_SELECT } from "../selects";

type SafeApiConnection = Prisma.ApiConnectionGetPayload<{ select: typeof API_CONNECTION_SAFE_SELECT }>;

const initialState: FormState = {};
const AUTH_TYPES = Object.values(ApiConnectionAuthType);

export function EditApiConnectionForm({
  connection,
  brands,
}: {
  connection: SafeApiConnection;
  brands: Brand[];
}) {
  const [state, formAction] = useActionState(updateApiConnection, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="id" value={connection.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Brand (optional — leave blank for account-wide)
          <select name="brandId" className={ui.select} defaultValue={connection.brandId ?? ""}>
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
          <input name="name" required defaultValue={connection.name} className={ui.input} />
        </label>
        <label className={ui.label}>
          Provider
          <input name="provider" required defaultValue={connection.provider} className={ui.input} />
        </label>
        <label className={ui.label}>
          Base URL
          <input
            name="baseUrl"
            required
            type="url"
            defaultValue={connection.baseUrl}
            className={ui.input}
          />
        </label>
        <label className={ui.label}>
          Auth type
          <select name="authType" required className={ui.select} defaultValue={connection.authType}>
            {AUTH_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className={`${ui.label} sm:col-span-2`}>
          Credentials (JSON) — leave blank to keep the current credentials
          <textarea
            name="credentials"
            rows={3}
            placeholder="•••• configured"
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
