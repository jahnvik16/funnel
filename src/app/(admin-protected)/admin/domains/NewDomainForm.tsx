"use client";

import { useActionState } from "react";
import type { Brand } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../_components/SubmitButton";
import { createDomain, type FormState } from "./actions";

const initialState: FormState = {};

export function NewDomainForm({ brands }: { brands: Brand[] }) {
  const [state, formAction] = useActionState(createDomain, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <h2 className={ui.sectionTitle}>New domain</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Hostname
          <input name="hostname" required placeholder="links.example.com" className={ui.input} />
        </label>
        <label className={ui.label}>
          Brand (optional — leave blank for a shared domain)
          <select name="brandId" className={ui.select} defaultValue="">
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
        <SubmitButton>Create domain</SubmitButton>
      </div>
    </form>
  );
}
