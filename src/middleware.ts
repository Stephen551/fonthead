import { defineMiddleware } from 'astro:middleware';

// Baseline security headers on every server-rendered response. The CSP locks the
// app to its own origin and still blocks off-origin scripts and resources,
// plugins, framing, base-tag hijacking, and cross-origin connections. It also
// allows the in-browser font engine what it needs: a classic Web Worker
// (worker-src 'self'), blob font/object URLs for the live preview, and the
// wawoff2 WASM binary served from an inline data: URL (connect-src data:).
//
// Two relaxations are deliberate, not unfinished work:
//   - script-src 'unsafe-eval': wawoff2, the Emscripten WASM compressor that
//     builds woff2 in the browser, runs its glue through new Function. A WASM
//     toolchain in the browser does not run without it.
//   - 'unsafe-inline' on script and style: Astro injects inline island-hydration
//     scripts, and the UI is built on inline style attributes. The only way to
//     hash those away is Astro's CSP feature, which is documented as incompatible
//     with both ClientRouter (the View Transitions this app uses) and inline
//     style attributes. Dropping it would mean re-doing the navigation and
//     converting the whole UI off inline styles, for no real XSS gain: every
//     user-input sink is already escaped (escapeJsonForScript, the action input
//     refines), so the injection surface is closed by output encoding, not by
//     the CSP.
//
// Static assets are served by the assets binding and bypass this; the CSP
// governs the HTML that loads them.
const CSP = [
  "default-src 'self'",
  // static.cloudflareinsights.com serves the Cloudflare Web Analytics beacon
  // (auto-injected on the zone); it reports back to cloudflareinsights.com below.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "worker-src 'self' blob:",
  // the wawoff2 module fetches its WASM binary from an inline data: URL; the
  // Cloudflare Web Analytics beacon posts to cloudflareinsights.com
  "connect-src 'self' data: https://cloudflareinsights.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const onRequest = defineMiddleware(async (_ctx, next) => {
  const res = await next();
  try {
    res.headers.set('content-security-policy', CSP);
    res.headers.set('x-content-type-options', 'nosniff');
    res.headers.set('x-frame-options', 'DENY');
    res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    // Force HTTPS for a year on revisits (the *.workers.dev host can't be
    // preloaded, but the header is correct posture and carries to a custom domain).
    res.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains; preload');
    // The app uses none of these powerful features; lock them off.
    res.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  } catch {
    /* immutable response (e.g. a static asset) — nothing to decorate */
  }
  return res;
});
