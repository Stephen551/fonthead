import { defineConfig, devices } from '@playwright/test';

// The typographic corpus run: builds every fixture sheet through the real
// maker and lints the resulting fonts (fusion, rhythm, word spaces). Heavier
// than the e2e suite (one real build per face), so it lives behind its own
// command: npm run test:corpus. Run it before deploys and whenever the trim,
// kern, or engine code moves.
export default defineConfig({
  testDir: './e2e-corpus',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4321',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
