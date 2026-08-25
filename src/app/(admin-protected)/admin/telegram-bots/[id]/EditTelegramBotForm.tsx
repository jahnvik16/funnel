"use client";

import { useActionState } from "react";
import type { Brand, Prisma } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { updateTelegramBot, type FormState } from "../actions";
import { TELEGRAM_BOT_SAFE_SELECT } from "../selects";

type SafeTelegramBot = Prisma.TelegramBotGetPayload<{ select: typeof TELEGRAM_BOT_SAFE_SELECT }>;

const initialState: FormState = {};

export function EditTelegramBotForm({
  bot,
  brands,
}: {
  bot: SafeTelegramBot;
  brands: Brand[];
}) {
  const [state, formAction] = useActionState(updateTelegramBot, initialState);

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="id" value={bot.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Brand
          <select name="brandId" required className={ui.select} defaultValue={bot.brandId}>
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
          <input name="name" required defaultValue={bot.name} className={ui.input} />
        </label>
        <label className={ui.label}>
          Bot token (leave blank to keep the current token)
          <input name="botToken" autoComplete="off" placeholder="•••• configured" className={ui.input} />
        </label>
        <label className={ui.label}>
          CTA label
          <input name="ctaLabel" defaultValue={bot.ctaLabel ?? ""} className={ui.input} />
        </label>
        <label className={`${ui.label} sm:col-span-2`}>
          Welcome message
          <textarea
            name="welcomeMessage"
            rows={3}
            defaultValue={bot.welcomeMessage ?? ""}
            className={ui.input}
          />
        </label>
      </div>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}
