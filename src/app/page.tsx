import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-zinc-50 p-16 text-center dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        FunnelCore
      </h1>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        Foundation scaffold. See{" "}
        <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
          docs/funnelcore/
        </code>{" "}
        for product spec, architecture, and the implementation plan.
      </p>
      <Link
        href="/admin/login"
        className="text-sm font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-50"
      >
        Admin login
      </Link>
    </div>
  );
}
