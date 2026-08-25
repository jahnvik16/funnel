"use client";

// Only fires if the root layout itself throws (error.tsx can't catch that,
// since it renders *inside* the layout) — required by Next.js to render its
// own <html>/<body> in that case. Kept minimal and dependency-free on
// purpose: if the layout is broken, this needs to still render.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif" }}>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ maxWidth: "24rem", fontSize: "0.875rem", color: "#52525b" }}>
            An unexpected error occurred. Try again, or come back in a moment.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ borderRadius: "0.25rem", background: "#18181b", color: "#fff", padding: "0.5rem 0.75rem", fontSize: "0.875rem", fontWeight: 500 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
