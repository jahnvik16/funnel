"use client";

import { useActionState } from "react";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { createExperimentArm, type FormState } from "../actions";

const initialState: FormState = {};

export function NewExperimentArmForm({ experimentId }: { experimentId: string }) {
  const [state, formAction] = useActionState(createExperimentArm, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="experimentId" value={experimentId} />
      <h3 className={ui.sectionTitle}>New arm</h3>
      <p className={ui.muted}>
        Wire this arm to a tracking link by publishing that link and selecting this experiment
        and arm on the publish form — see the tracking link&apos;s page.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Name
          <input name="name" required placeholder="aggregator" className={ui.input} />
        </label>
        <label className={ui.label}>
          Weight
          <input name="weight" type="number" min={0} required defaultValue={50} className={ui.input} />
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Add arm</SubmitButton>
      </div>
    </form>
  );
}
