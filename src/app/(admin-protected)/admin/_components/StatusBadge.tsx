import { ui } from "@/lib/ui";

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "ACTIVE"
      ? ui.badgeActive
      : status === "PAUSED"
        ? ui.badgePaused
        : ui.badgeArchived;

  return <span className={`${ui.badge} ${variant}`}>{status}</span>;
}
