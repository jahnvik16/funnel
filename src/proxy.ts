import { NextResponse, type NextRequest } from "next/server";

// Content-Security-Policy needs a fresh nonce per request so script-src can
// stay strict (no 'unsafe-inline') while still allowing Next.js's own
// hydration scripts, which it automatically tags with whatever nonce it
// finds on this header — this is Next's documented mechanism for strict CSP
// under the App Router, not a custom convention. Confirmed live: a static
// `script-src 'self'` (set from next.config.ts instead) blocked Next's own
// inline hydration scripts outright and broke the app.
export function proxy(request: NextRequest) {
  // Set once here (rather than lazily per log call — see
  // lib/request-context.ts) so every Server Component/Action/route handler
  // downstream of this single incoming request sees the exact same id,
  // whether or not an upstream proxy already supplied one.
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  // React's dev mode (never production — see React's own console warning)
  // uses eval() for reconstructing call stacks across dev-tooling
  // boundaries. Confirmed live: without this, `next dev` logs a harmless
  // but noisy eval-blocked warning on every page load.
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`;
  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Skip static assets — they don't render anything a CSP applies to, and
    // generating a nonce for each one is pure overhead.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
