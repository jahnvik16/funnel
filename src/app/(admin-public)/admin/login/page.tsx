import { LoginForm } from "./LoginForm";

// This route must never be statically prerendered. src/proxy.ts generates a
// fresh CSP nonce on every request, but a statically cached page's HTML has
// whatever nonce was baked in at build/cache time -- on a real CDN (Vercel),
// every subsequent request serves that stale HTML against a freshly
// mismatched nonce, and the browser blocks every script on the page. This
// route had no dynamic data dependency, so Next silently static-optimized
// it despite the nonce requirement -- confirmed live via curl against
// production (`X-Vercel-Cache: HIT`, a different nonce in the CSP header on
// every request, zero matching nonce anywhere in the cached HTML). See
// DECISIONS.md D057.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm />;
}
