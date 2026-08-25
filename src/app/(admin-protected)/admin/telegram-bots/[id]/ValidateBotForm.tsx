"use client";

import { useActionState } from "react";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { validateTelegramBot, type ValidateFormState } from "../actions";

const initialState: ValidateFormState = {};

export function ValidateBotForm({ botId }: { botId: string }) {
  const [state, formAction] = useActionState(validateTelegramBot, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="id" value={botId} />
      <p className={ui.muted}>
        Calls Telegram&apos;s API to confirm the stored token works, records the bot&apos;s
        real username, and registers our webhook.
      </p>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      {state.success ? (
        <p className={ui.success}>Validated — @{state.username}</p>
      ) : null}
      {state.warning ? <p className={ui.error}>{state.warning}</p> : null}
      <div>
        <SubmitButton variant="secondary" pendingLabel="Validating…">
          Validate
        </SubmitButton>
      </div>
    </form>
  );
}
