import { defineConfig, devices } from '@playwright/test';

// Dedicated ports, so e2e runs never touch `npm run dev` (3001/5173). A busy port fails the run.
const API_PORT = '3101';
const WEB_PORT = '5273';

export default defineConfig({
  testDir: 'e2e',
  // Keeps traces, screenshots, and downloads only for failed tests.
  preserveOutput: 'failures-only',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run build && node dist/api/server.js',
      port: Number(API_PORT),
      env: { API_PORT },
      reuseExistingServer: false,
    },
    {
      command: 'npx vite web',
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { API_PORT, WEB_PORT },
      reuseExistingServer: false,
    },
  ],
});
