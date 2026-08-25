"use client";

import { useFormStatus } from "react-dom";
import { ui } from "@/lib/ui";

type Variant = "primary" | "secondary" | "danger";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: ui.primaryButton,
  secondary: ui.secondaryButton,
  danger: ui.dangerButton,
};

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: Variant;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={VARIANT_CLASS[variant]}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </button>
  );
}
