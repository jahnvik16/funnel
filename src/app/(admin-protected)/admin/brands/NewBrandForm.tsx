"use client";

import { useActionState } from "react";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../_components/SubmitButton";
import { createBrand, type FormState } from "./actions";

const initialState: FormState = {};

export function NewBrandForm() {
  const [state, formAction] = useActionState(createBrand, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <h2 className={ui.sectionTitle}>New brand</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Name
          <input name="name" required className={ui.input} />
        </label>
        <label className={ui.label}>
          Slug
          <input name="slug" required placeholder="my-brand" className={ui.input} />
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Create brand</SubmitButton>
      </div>
    </form>
  );
}
