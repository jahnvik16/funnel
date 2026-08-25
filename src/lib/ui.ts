// Shared Tailwind class strings for the admin CRUD forms/tables. Functionality
// and consistency over visual polish — see CLAUDE.md and this milestone's brief.
export const ui = {
  label: "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300",
  input:
    "rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50",
  select:
    "rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50",
  checkboxRow: "flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300",
  form: "flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800",
  primaryButton:
    "rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900",
  secondaryButton:
    "rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-50",
  dangerButton:
    "rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-400",
  error: "text-sm text-red-600 dark:text-red-400",
  success: "text-sm text-emerald-600 dark:text-emerald-400",
  table: "w-full border-collapse text-sm",
  th: "border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500 dark:border-zinc-800",
  td: "border-b border-zinc-100 px-3 py-2 dark:border-zinc-900",
  pageTitle: "text-xl font-semibold text-zinc-900 dark:text-zinc-50",
  sectionTitle: "text-base font-semibold text-zinc-900 dark:text-zinc-50",
  muted: "text-sm text-zinc-500 dark:text-zinc-400",
  link: "text-zinc-900 underline underline-offset-2 dark:text-zinc-50",
  badge:
    "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
  badgeActive: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  badgeArchived: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
  badgePaused: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
} as const;
