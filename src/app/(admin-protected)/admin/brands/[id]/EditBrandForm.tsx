"use client";

import { useActionState } from "react";
import type { Brand } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { updateBrand, type FormState } from "../actions";

const initialState: FormState = {};

export function EditBrandForm({ brand }: { brand: Brand }) {
  const [state, formAction] = useActionState(updateBrand, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="id" value={brand.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Name
          <input name="name" required defaultValue={brand.name} className={ui.input} />
        </label>
        <label className={ui.label}>
          Slug
          <input name="slug" required defaultValue={brand.slug} className={ui.input} />
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}
