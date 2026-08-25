import type { NextConfig } from "next";

// Applied to every route — admin and public alike. Content-Security-Policy
// is deliberately NOT set here: it needs a fresh nonce per request so
// script-src can stay strict while still allowing Next.js's own hydration
// scripts, which only works set dynamically — see src/middleware.ts. Setting
// it both here (static) and in middleware (dynamic) would send two
// CSP headers, and browsers enforce the *intersection* of multiple CSP
// headers — the static one's un-nonced `script-src 'self'` would silently
// override the nonce and break hydration again.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Browsers ignore this over plain HTTP, so it's safe to always send —
  // only takes effect once the deployment is actually served over HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
