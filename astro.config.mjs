// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Cache-bust token for the maker engine. The engine .js live at fixed /assets
// URLs cached `immutable` for a year (see public/_headers), so a browser only
// refetches one when its URL changes. make.astro appends `?v=<this>` to every
// engine <script>. Deriving the token from the engine's own bytes means any
// engine edit changes it automatically — no one has to remember to bump a
// version string. (Forgetting to bump a hardcoded one shipped several engine
// fixes that never reached cached browsers, because the URL never changed.)
function engineVersion() {
  const dir = fileURLToPath(new URL('./public/assets', import.meta.url));
  const h = createHash('sha256');
  /** @param {string} d */
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) h.update(name).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 12);
}

// fonthead.dev — Astro 5 SSR on the Cloudflare Workers adapter.
// Bindings (DB, FONTS, ASSETS) come from wrangler.jsonc and are reached at
// request time via Astro.locals.runtime.env. platformProxy surfaces them in dev.
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
    imageService: 'compile',
  }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    // Baked into the SSR bundle at build; make.astro reads it for the engine ?v=.
    define: { __ENGINE_V__: JSON.stringify(engineVersion()) },
  },
});
