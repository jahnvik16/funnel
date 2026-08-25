"use client";

import { useActionState } from "react";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../_components/SubmitButton";
import { createPlatform, type FormState } from "./actions";

const initialState: FormState = {};

export function NewPlatformForm() {
  const [state, formAction] = useActionState(createPlatform, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <h2 className={ui.sectionTitle}>New platform</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Name
          <input name="name" required className={ui.input} />
        </label>
        <label className={ui.label}>
          Slug
          <input name="slug" required placeholder="instagram" className={ui.input} />
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Create platform</SubmitButton>
      </div>
    </form>
  );
}
