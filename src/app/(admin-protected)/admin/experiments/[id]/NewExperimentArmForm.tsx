"use client";

import { useActionState } from "react";
import type { TrackingLinkVersion } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { createExperimentArm, type FormState } from "../actions";

const initialState: FormState = {};

export function NewExperimentArmForm({
  experimentId,
  versions,
}: {
  experimentId: string;
  versions: TrackingLinkVersion[];
}) {
  const [state, formAction] = useActionState(createExperimentArm, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="experimentId" value={experimentId} />
      <h3 className={ui.sectionTitle}>New arm</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className={ui.label}>
          Name
          <input name="name" required placeholder="control" className={ui.input} />
        </label>
        <label className={ui.label}>
          Weight
          <input name="weight" type="number" min={0} required defaultValue={50} className={ui.input} />
        </label>
        <label className={ui.label}>
          Tracking link version (optional)
          <select name="trackingLinkVersionId" className={ui.select} defaultValue="">
            <option value="">Unassigned</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                v{version.versionNumber} ({version.pathType})
              </option>
            ))}
          </select>
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Add arm</SubmitButton>
      </div>
    </form>
  );
}
