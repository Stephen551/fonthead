import { defineConfig, devices } from '@playwright/test';

// End-to-end smoke tests run against a local astro dev server. Browser binaries
// install via `npx playwright install chromium` (done in CI).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // The in-browser font builds are CPU-heavy (a flat colour sample traces three
  // layers per glyph, ~27s). Run serially against one dev server so builds do
  // not starve each other, and allow generous per-test time.
  workers: 1,
  timeout: 90_000,
  use: {
    // astro dev binds to localhost (IPv6 ::1 on Windows), so target localhost
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
