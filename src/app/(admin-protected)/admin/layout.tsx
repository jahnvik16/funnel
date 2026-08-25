import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import { logout } from "./actions";

const NAV_LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/brands", label: "Brands" },
  { href: "/admin/platforms", label: "Platforms" },
  { href: "/admin/social-accounts", label: "Social accounts" },
  { href: "/admin/domains", label: "Domains" },
  { href: "/admin/campaigns", label: "Campaigns" },
  { href: "/admin/tracking-links", label: "Tracking links" },
  { href: "/admin/telegram-bots", label: "Telegram bots" },
  { href: "/admin/api-connections", label: "API connections" },
  { href: "/admin/experiments", label: "Experiments" },
  { href: "/admin/conversions", label: "Conversions" },
  { href: "/admin/reports", label: "Reports" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          FunnelCore Admin
        </span>
        <div className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          <span>{admin.email}</span>
          <form action={logout}>
            <button
              type="submit"
              className="text-zinc-900 underline underline-offset-2 dark:text-zinc-50"
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      <div className="flex flex-1">
        <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-zinc-200 p-4 dark:border-zinc-800">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
