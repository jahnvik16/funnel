"use client";

import { useActionState } from "react";
import type { Brand } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../_components/SubmitButton";
import { createTelegramBot, type FormState } from "./actions";

const initialState: FormState = {};

export function NewTelegramBotForm({ brands }: { brands: Brand[] }) {
  const [state, formAction] = useActionState(createTelegramBot, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <h2 className={ui.sectionTitle}>New Telegram bot</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Brand
          <select name="brandId" required className={ui.select} defaultValue="">
            <option value="" disabled>
              Select a brand
            </option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
                {brand.status === "ARCHIVED" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Bot name
          <input name="name" required className={ui.input} />
        </label>
        <label className={ui.label}>
          Bot token
          <input
            name="botToken"
            required
            autoComplete="off"
            placeholder="123456789:AA..."
            className={ui.input}
          />
        </label>
        <label className={ui.label}>
          CTA label
          <input name="ctaLabel" placeholder="Chat with us" className={ui.input} />
        </label>
        <label className={`${ui.label} sm:col-span-2`}>
          Welcome message
          <textarea name="welcomeMessage" rows={3} className={ui.input} />
        </label>
      </div>
      <p className={ui.muted}>
        The token is validated for format and encrypted at rest. It is never displayed again
        after saving.
      </p>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Create bot</SubmitButton>
      </div>
    </form>
  );
}
