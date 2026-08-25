import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth/guard";
import { logout } from "./actions";

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
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
