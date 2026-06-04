import { defineMiddleware } from 'astro:middleware';

// Baseline security headers on every server-rendered response. The CSP locks the
// app to its own origin while still allowing what the in-browser font engine
// needs: a classic Web Worker (worker-src 'self'), the wawoff2 WASM compressor
// (its Emscripten glue calls new Function, so script-src needs 'unsafe-eval'),
// blob font/object URLs for the live preview, and data/blob images from the
// canvas. Inline scripts/styles are allowed because Astro emits some inline
// bootstraps. Even with those script relaxations the policy still blocks
// off-origin scripts and resources, plugins, framing, base-tag hijacking, and
// cross-origin connections. Tightening the script source to hashes is a
// follow-up (Astro's experimental CSP). Static assets are served by the assets
// binding and bypass this, which is fine — the CSP governs the HTML that loads
// them.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "worker-src 'self' blob:",
  // the wawoff2 module fetches its WASM binary from an inline data: URL
  "connect-src 'self' data:",
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
  } catch {
    /* immutable response (e.g. a static asset) — nothing to decorate */
  }
  return res;
});
