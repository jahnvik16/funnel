"use client";

import { useEffect } from "react";

// Catches unexpected render/action errors anywhere under the root layout
// (admin pages, /gate, /path) that don't have their own more specific
// error.tsx, so a real user sees a plain, non-technical page instead of a
// framework crash screen or a blank response. Does not change what happens
// on the success path anywhere — this is a safety net, not a redesign of
// any route.
export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side error — only ever visible in the browser console, same as
    // any other client exception. Message only, never the full error object
    // (which could carry more than intended into a browser console someone
    // else might be looking at, e.g. during a shared screen).
    console.error("client_error_boundary", error.message, error.digest ? `digest=${error.digest}` : "");
  }, [error]);

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 p-8 text-center dark:bg-black">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Something went wrong</h1>
      <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
        An unexpected error occurred. Try again, or come back in a moment.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
      >
        Try again
      </button>
    </div>
  );
}
