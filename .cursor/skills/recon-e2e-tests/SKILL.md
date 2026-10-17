---
name: recon-e2e-tests
description: Sets up and writes Playwright (Chromium) end-to-end tests that drive the real React GUI, Fastify API, and engine, including downloads and CLI cross-checks, with retained traces for failures. Use when configuring Playwright, writing tests under e2e/, debugging a failing browser test, or wiring `npm run test:e2e` and `npm run verify`.
---

# Recon E2E Tests

## Setup

```sh
npm i -D @playwright/test
npx playwright install chromium
```

`playwright.config.ts` essentials:

```ts
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5273', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node dist/api/server.js --port 5274', url: 'http://127.0.0.1:5274/health', reuseExistingServer: false },
    { command: 'npm --prefix web run dev -- --port 5273 --strictPort', url: 'http://127.0.0.1:5273', reuseExistingServer: false },
  ],
});
```

- Use dedicated test ports different from `npm run dev`. `reuseExistingServer: false` and `--strictPort` make a port collision fail loudly instead of silently testing a stale server.
- The API needs a `GET /health` endpoint for the readiness check.

## Isolation

- Each test gets a fresh browser context (the Playwright default).
- Upload fixed fixtures from `test/fixtures/` or `examples/` with `setInputFiles`.
- Always set an explicit cutoff and never rely on the current time.
- Write downloads and CLI outputs only to `testInfo.outputPath(...)`.

## Required journeys (PLAN.md section 4.3)

1. Load valid CSVs and verify the displayed summary and the rows.
2. Add a manual pin and rerun. The pair shows as `manual` and wins over automatic matching.
3. Remove the pin and rerun. Automatic matching resumes.
4. Change the cutoff. Excluded records disappear.
5. Upload invalid data. A useful error appears.
6. Download `report.json` and `manual.csv`, run the CLI with the exported pins and the original inputs, and `toEqual` the two parsed reports, including array order.

Downloads:

```ts
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /report/i }).click()]);
await dl.saveAs(testInfo.outputPath('report.json'));
```

Use the `getByRole` and `getByLabel` locators and web-first assertions (`await expect(locator).toHaveText(...)`). Never use fixed `waitForTimeout` sleeps.

## Debugging failures

```sh
npx playwright test -g "manual pin"           # one scenario
npx playwright test --headed --debug           # step through
npx playwright show-trace test-results/<test>/trace.zip
npx playwright show-report
```

## Verify command

`"verify": "npm run typecheck && npm run build && npm test && npm run test:e2e"` runs everything with no manually started servers.
