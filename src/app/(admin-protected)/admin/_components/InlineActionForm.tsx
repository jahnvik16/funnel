import { SubmitButton } from "./SubmitButton";

// A one-button form posting a single hidden `id` field to a Server Action —
// used for archive/unarchive/status-toggle actions across every entity list.
export function InlineActionForm({
  action,
  id,
  label,
  variant = "secondary",
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant={variant}>{label}</SubmitButton>
    </form>
  );
}
