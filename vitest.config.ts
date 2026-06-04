import { defineConfig } from 'vitest/config';

// Unit + engine-math tests run under jsdom (canvas-backed engine paths need a
// DOM; pure byte/charset math needs nothing). Cloudflare workers-pool action
// tests are added in a second project alongside the publish/auth work.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts'],
    },
  },
});
