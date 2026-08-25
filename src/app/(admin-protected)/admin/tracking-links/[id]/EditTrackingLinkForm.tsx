"use client";

import { useActionState } from "react";
import type { Domain, TrackingLink } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { updateTrackingLinkDetails, type FormState } from "../actions";

const initialState: FormState = {};

export function EditTrackingLinkForm({ link, domains }: { link: TrackingLink; domains: Domain[] }) {
  const [state, formAction] = useActionState(updateTrackingLinkDetails, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="id" value={link.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Label
          <input name="label" required defaultValue={link.label} className={ui.input} />
        </label>
        <label className={ui.label}>
          Domain
          <select name="domainId" required className={ui.select} defaultValue={link.domainId}>
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
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}
