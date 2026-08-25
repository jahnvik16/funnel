"use client";

import { useActionState } from "react";
import type { Platform } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { updatePlatform, type FormState } from "../actions";

const initialState: FormState = {};

export function EditPlatformForm({ platform }: { platform: Platform }) {
  const [state, formAction] = useActionState(updatePlatform, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="id" value={platform.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Name
          <input name="name" required defaultValue={platform.name} className={ui.input} />
        </label>
        <label className={ui.label}>
          Slug
          <input name="slug" required defaultValue={platform.slug} className={ui.input} />
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}
