"use client";

import { useActionState, useState } from "react";
import type { Campaign, Experiment, ExperimentArm, SocialAccount } from "@prisma/client";
import { PathType } from "@prisma/client";
import { ui } from "@/lib/ui";
import { SubmitButton } from "../../_components/SubmitButton";
import { publishTrackingLinkVersion, type FormState } from "../actions";

const initialState: FormState = {};

type TelegramBotOption = { id: string; name: string; status: string };
type ExperimentWithArms = Experiment & { arms: ExperimentArm[] };

export function PublishVersionForm({
  trackingLinkId,
  campaigns,
  socialAccounts,
  telegramBots,
  experiments,
}: {
  trackingLinkId: string;
  campaigns: Campaign[];
  socialAccounts: SocialAccount[];
  telegramBots: TelegramBotOption[];
  experiments: ExperimentWithArms[];
}) {
  const [state, formAction] = useActionState(publishTrackingLinkVersion, initialState);
  const [pathType, setPathType] = useState<PathType>(PathType.DIRECT);
  const [experimentId, setExperimentId] = useState<string>("");

  const arms = experiments.find((e) => e.id === experimentId)?.arms ?? [];

  if (campaigns.length === 0) {
    return (
      <p className={ui.muted}>
        This brand has no campaigns yet. Create a campaign before publishing a version.
      </p>
    );
  }

  return (
    <form action={formAction} className={ui.form}>
      <input type="hidden" name="trackingLinkId" value={trackingLinkId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={ui.label}>
          Campaign
          <select name="campaignId" required className={ui.select} defaultValue="">
            <option value="" disabled>
              Select a campaign
            </option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
                {campaign.status === "ARCHIVED" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Social account (optional)
          <select name="socialAccountId" className={ui.select} defaultValue="">
            <option value="">None</option>
            {socialAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.handle}
                {account.status === "ARCHIVED" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Path type
          <select
            name="pathType"
            required
            className={ui.select}
            value={pathType}
            onChange={(e) => setPathType(e.target.value as PathType)}
          >
            <option value={PathType.DIRECT}>Direct</option>
            <option value={PathType.AGGREGATOR}>Aggregator</option>
            <option value={PathType.TELEGRAM}>Telegram</option>
          </select>
        </label>
        <label className={ui.checkboxRow}>
          <input type="checkbox" name="ageGateEnabled" />
          Require 18+ age gate
        </label>

        {pathType === PathType.DIRECT || pathType === PathType.AGGREGATOR ? (
          <label className={`${ui.label} sm:col-span-2`}>
            Destination URL
            <input name="destinationUrl" required type="url" placeholder="https://" className={ui.input} />
          </label>
        ) : (
          <>
            <label className={ui.label}>
              Telegram bot
              <select name="telegramBotId" required className={ui.select} defaultValue="">
                <option value="" disabled>
                  Select a bot
                </option>
                {telegramBots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name}
                    {bot.status === "ARCHIVED" ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={ui.label}>
              Start param template (optional)
              <input name="startParamTemplate" className={ui.input} />
            </label>
          </>
        )}

        <label className={ui.label}>
          Experiment (optional)
          <select
            className={ui.select}
            value={experimentId}
            onChange={(e) => setExperimentId(e.target.value)}
          >
            <option value="">None</option>
            {experiments.map((experiment) => (
              <option key={experiment.id} value={experiment.id}>
                {experiment.name}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Experiment arm (optional)
          <select name="experimentArmId" className={ui.select} defaultValue="" disabled={!experimentId}>
            <option value="">None</option>
            {arms.map((arm) => (
              <option key={arm.id} value={arm.id}>
                {arm.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={ui.muted}>
        Publishing creates a new immutable version and makes it the current version for this
        link. Past versions and the clicks attributed to them are never changed.
      </p>
      {state.error ? <p className={ui.error}>{state.error}</p> : null}
      <div>
        <SubmitButton pendingLabel="Publishing…">Publish version</SubmitButton>
      </div>
    </form>
  );
}
