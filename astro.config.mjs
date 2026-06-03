// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

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
  },
});
