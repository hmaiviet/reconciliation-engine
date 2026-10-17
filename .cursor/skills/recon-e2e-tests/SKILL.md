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

`playwright.config.ts` (already in the repo) starts both servers on dedicated ports via env overrides:

- API: `npm run build && node dist/api/server.js` with `API_PORT=3101`, readiness by `port`.
- GUI: `npx vite web` with `WEB_PORT=5273 API_PORT=3101` (the Vite proxy follows `API_PORT`), readiness by `url`.
- `reuseExistingServer: false` (and Vite's `strictPort`) make a port collision fail loudly instead of silently testing a stale server.
- `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, `preserveOutput: 'failures-only'`.

In a sandboxed agent shell, `PLAYWRIGHT_BROWSERS_PATH` may point at a temp cache; run with `env -u PLAYWRIGHT_BROWSERS_PATH` to use the normal browser install.

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

`"verify": "npm run typecheck && npm test && npm run check:examples && npm run test:e2e"` runs everything with no manually started servers (`npm test` builds first).
