import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO, exampleAsOf, runArgs, runCli } from '../test/helpers/run-cli.js';

const KINDS = ['manual', 'exact', 'rule_based', 'fuzzy'] as const;
const LABELS: Record<string, string> = {
  Manual: 'matched_manual',
  Exact: 'matched_exact',
  'Rule-based': 'matched_rule_based',
  Fuzzy: 'matched_fuzzy',
  'Unmatched ours': 'unmatched_ours',
  'Unmatched theirs': 'unmatched_theirs',
};

const input = (example: string, name: string) => join(REPO, 'examples', example, name);
const readExpected = async (example: string) => JSON.parse(await readFile(input(example, 'expected_report.json'), 'utf8'));

/** The run report form; the hidden manual match mode has fields with the same labels. */
const inputs = (page: Page) => page.getByRole('form', { name: 'Inputs' });

/** Opens the GUI, chooses an example's files, sets the cutoff, and runs. */
async function load(page: Page, example: string, { manual = false, asOf }: { manual?: boolean; asOf?: string } = {}) {
  await page.goto('/');
  await inputs(page).getByLabel('Ours CSV').setInputFiles(input(example, 'ours.csv'));
  await inputs(page).getByLabel('Theirs CSV').setInputFiles(input(example, 'theirs.csv'));
  if (manual) {
    await inputs(page).getByLabel('Manual CSV (optional)').setInputFiles(input(example, 'manual.csv'));
    await expect(inputs(page).locator('label.file', { hasText: 'Manual CSV' })).toHaveAttribute('data-loaded', 'true');
  }
  await inputs(page).getByLabel('Cutoff (UTC)').fill(asOf ?? (await exampleAsOf(example)));
  await run(page);
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
}

const run = (page: Page) => page.getByRole('button', { name: 'Run reconciliation' }).click();

/** The summary tiles as report.json keys, retried until they equal `expected`. */
async function expectSummary(page: Page, expected: Record<string, number>) {
  await expect
    .poll(() =>
      page
        .getByLabel('Summary')
        .evaluate((dl) => [...dl.children].map((t) => [t.querySelector('dt')?.textContent ?? '', Number(t.querySelector('dd')?.textContent)] as const)),
    )
    .toEqual(Object.entries(LABELS).map(([label, key]) => [label, expected[key]]));
}

/** Displayed pairs per tier, in display order, e.g. `{ exact: ['o-001 ↔ t-101'] }`; absent tiers must not render. */
async function expectMatches(page: Page, expected: Partial<Record<(typeof KINDS)[number], string[]>>) {
  for (const kind of KINDS) {
    const region = page.getByRole('region', { name: `${kind} matches` });
    const pairs = expected[kind] ?? [];
    if (pairs.length === 0) await expect(region).toHaveCount(0);
    else await expect(region.locator('summary > span:first-child')).toHaveText(pairs);
  }
}

/** Record ids shown in one side's table, in order. */
const recordIds = (page: Page, side: 'Ours' | 'Theirs') => page.getByRole('table', { name: side }).locator('tbody tr td:nth-child(2)');

async function pin(page: Page, ours: string, theirs: string) {
  await page.getByLabel('Unmatched only').uncheck();
  await page.getByRole('radio', { name: `Select ours ${ours}` }).check();
  await page.getByRole('radio', { name: `Select theirs ${theirs}` }).check();
  await page.getByRole('button', { name: /^Pin selected pair/ }).click();
  await expect(page.getByRole('list', { name: 'Pins' })).toContainText(`${ours} ↔ ${theirs}`);
}

async function download(page: Page, button: string, to: string): Promise<string> {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
  await file.saveAs(to);
  return readFile(to, 'utf8');
}

test('loads valid CSVs and shows the expected report (example 3)', async ({ page }) => {
  const expected = await readExpected('example_3_multi_party_currency');
  await load(page, 'example_3_multi_party_currency', { manual: true });

  await expectSummary(page, expected.summary);
  await expectMatches(page, { manual: ['o-004 ↔ t-104'], exact: ['o-001 ↔ t-101'], rule_based: ['o-002 ↔ t-102'] });
  await expect(recordIds(page, 'Ours')).toHaveText(expected.unmatched_ours.map((r: { id: string }) => r.id));
  await expect(recordIds(page, 'Theirs')).toHaveText(expected.unmatched_theirs.map((r: { id: string }) => r.id));

  await page.getByText('o-002 ↔ t-102').click();
  await expect(page.getByRole('row', { name: /^fx_rate / })).toHaveText(/1\.000000\s*1\.000001/);
});

test('a manual pin overrides an exact match after rerun (example 2)', async ({ page }) => {
  await load(page, 'example_2_with_manual', { manual: true });
  await expectMatches(page, { manual: ['o-002 ↔ t-102'], exact: ['o-001 ↔ t-101'] });

  await pin(page, 'o-001', 't-103');
  await expect(page.getByText('Pins changed since the last run')).toBeVisible();
  await run(page);

  await expectSummary(page, { matched_manual: 2, matched_exact: 0, matched_rule_based: 0, matched_fuzzy: 0, unmatched_ours: 1, unmatched_theirs: 1 });
  await expectMatches(page, { manual: ['o-001 ↔ t-103', 'o-002 ↔ t-102'] });
  await page.getByLabel('Unmatched only').check();
  await expect(recordIds(page, 'Ours')).toHaveText(['o-003']);
  await expect(recordIds(page, 'Theirs')).toHaveText(['t-101']);
});

test('removing a pin lets automatic matching resume (example 2)', async ({ page }) => {
  const expected = await readExpected('example_2_with_manual');
  await load(page, 'example_2_with_manual', { manual: true });
  await pin(page, 'o-001', 't-103');
  await run(page);
  await expectMatches(page, { manual: ['o-001 ↔ t-103', 'o-002 ↔ t-102'] });

  await page.getByRole('button', { name: 'Remove pin o-001 ↔ t-103' }).click();
  await run(page);

  await expectSummary(page, expected.summary);
  await expectMatches(page, { manual: ['o-002 ↔ t-102'], exact: ['o-001 ↔ t-101'] });
});

test('an earlier cutoff removes later records (example 1)', async ({ page }) => {
  await load(page, 'example_1_basic');
  await expectSummary(page, { matched_manual: 0, matched_exact: 5, matched_rule_based: 0, matched_fuzzy: 0, unmatched_ours: 0, unmatched_theirs: 0 });

  await inputs(page).getByLabel('Cutoff (UTC)').fill('2026-04-01T12:00:00Z');
  await run(page);

  await expect(page.getByText('As of 2026-04-01T12:00:00.000Z')).toBeVisible();
  await expectSummary(page, { matched_manual: 0, matched_exact: 2, matched_rule_based: 0, matched_fuzzy: 0, unmatched_ours: 0, unmatched_theirs: 0 });
  await page.getByLabel('Unmatched only').uncheck();
  await expect(recordIds(page, 'Ours')).toHaveText(['o-001', 'o-002']);
  await expect(recordIds(page, 'Theirs')).toHaveText(['t-101', 't-102']);
});

test('invalid inputs show actionable errors and no results', async ({ page }) => {
  await page.goto('/');
  await inputs(page).getByLabel('Ours CSV').setInputFiles(join(REPO, 'test/fixtures/csv/invalid_simple.csv'));
  await inputs(page).getByLabel('Theirs CSV').setInputFiles(input('example_1_basic', 'theirs.csv'));
  await inputs(page).getByLabel('Cutoff (UTC)').fill('2026-04-01');
  await run(page);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText("as_of: '2026-04-01' is not a valid YYYY-MM-DDTHH:MM:SS[.sss]Z timestamp");
  await expect(alert).toContainText("ours.csv:2: amount: '100' is not a decimal with exactly 2 decimal places");
  await expect(page.getByRole('region', { name: 'Results' })).toHaveCount(0);
});

test('exported manual.csv reproduces the GUI report through the CLI (example 2)', async ({ page }, testInfo) => {
  await load(page, 'example_2_with_manual', { manual: true });
  await pin(page, 'o-003', 't-103');
  await run(page);
  await expectSummary(page, { matched_manual: 2, matched_exact: 1, matched_rule_based: 0, matched_fuzzy: 0, unmatched_ours: 0, unmatched_theirs: 0 });

  const dir = testInfo.outputPath();
  await mkdir(dir, { recursive: true });
  const guiReport = await download(page, 'Download report.json', join(dir, 'gui-report.json'));
  const manual = await download(page, 'Download manual.csv', join(dir, 'manual.csv'));
  expect(manual).toBe('ours_id,theirs_id\no-002,t-102\no-003,t-103\n');

  const ex = 'example_2_with_manual';
  const cli = await runCli(
    dir,
    runArgs({ ours: input(ex, 'ours.csv'), theirs: input(ex, 'theirs.csv'), manual: 'manual.csv', 'as-of': await exampleAsOf(ex), output: 'cli-report.json' }),
  );
  expect(cli.code, cli.stderr).toBe(0);
  const cliReport = await readFile(join(dir, 'cli-report.json'), 'utf8');
  expect(JSON.parse(guiReport)).toEqual(JSON.parse(cliReport));
  expect(guiReport).toBe(cliReport);
});

for (const ex of ['example_1_basic', 'example_2_with_manual', 'example_3_multi_party_currency']) {
  test(`GUI and CLI produce the same report for ${ex}`, async ({ page }, testInfo) => {
    await load(page, ex, { manual: true });
    const dir = testInfo.outputPath();
    await mkdir(dir, { recursive: true });
    const guiReport = JSON.parse(await download(page, 'Download report.json', join(dir, 'gui-report.json')));

    const cli = await runCli(
      dir,
      runArgs({
        ours: input(ex, 'ours.csv'),
        theirs: input(ex, 'theirs.csv'),
        manual: input(ex, 'manual.csv'),
        'as-of': await exampleAsOf(ex),
        output: 'cli-report.json',
      }),
    );
    expect(cli.code, cli.stderr).toBe(0);
    expect(guiReport).toEqual(JSON.parse(await readFile(join(dir, 'cli-report.json'), 'utf8')));
    expect(guiReport).toEqual(await readExpected(ex));
  });
}

/** Switches to manual match mode, chooses an example's files, and returns the record-matching region. */
async function openManual(page: Page, example: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Manual match', exact: true }).click();
  const files = page.getByRole('region', { name: 'Manual match files' });
  await files.getByLabel('Ours CSV').setInputFiles(input(example, 'ours.csv'));
  await files.getByLabel('Theirs CSV').setInputFiles(input(example, 'theirs.csv'));
  const region = page.getByRole('region', { name: 'Manual matching' });
  await expect(region).toBeVisible();
  return region;
}

async function matchPair(region: Locator, ours: string, theirs: string) {
  await region.getByRole('radio', { name: `Select ours ${ours}` }).check();
  await region.getByRole('radio', { name: `Select theirs ${theirs}` }).check();
  await region.getByRole('button', { name: 'Match selected pair' }).click();
}

test('manual match mode moves matched pairs to a list and cancelling puts them back (example 2)', async ({ page }) => {
  const region = await openManual(page, 'example_2_with_manual');
  const ids = (side: 'Ours' | 'Theirs') => region.getByRole('table', { name: side }).locator('tbody tr td:nth-child(2)');
  await expect(ids('Ours')).toHaveText(['o-001', 'o-002', 'o-003']);
  await expect(ids('Theirs')).toHaveText(['t-101', 't-102', 't-103']);

  await matchPair(region, 'o-001', 't-103');
  await expect(ids('Ours')).toHaveText(['o-002', 'o-003']);
  await expect(ids('Theirs')).toHaveText(['t-101', 't-102']);
  await expect(region.getByRole('table', { name: 'Manual matches' }).locator('tbody td:first-child')).toHaveText(['o-001']);

  await region.getByRole('button', { name: 'Cancel match o-001 ↔ t-103' }).click();
  await expect(ids('Ours')).toHaveText(['o-001', 'o-002', 'o-003']);
  await expect(ids('Theirs')).toHaveText(['t-101', 't-102', 't-103']);
  await expect(region.getByRole('table', { name: 'Manual matches' })).toHaveCount(0);
});

for (const ex of ['example_1_basic', 'example_2_with_manual', 'example_3_multi_party_currency', 'example_4_fuzzy_memo']) {
  test(`manual match mode with the pins from manual.csv reproduces expected_report.json for ${ex}`, async ({ page }, testInfo) => {
    const region = await openManual(page, ex);
    const pins = (await readFile(input(ex, 'manual.csv'), 'utf8')).trim().split('\n').slice(1);
    for (const line of pins) {
      const [ours, theirs] = line.split(',');
      await matchPair(region, ours!, theirs!);
    }
    await page.getByRole('form', { name: 'Manual match settings' }).getByLabel('Cutoff (UTC)').fill(await exampleAsOf(ex));
    await run(page);
    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();

    const results = page.getByRole('region', { name: 'Results' });
    const expected = await readExpected(ex);
    await expect(results.getByRole('radio')).toHaveCount(0);
    await expect(results.getByRole('list', { name: 'Pins' })).toHaveCount(0);
    for (const side of ['Ours', 'Theirs'] as const) {
      const rows = results.getByRole('table', { name: side }).locator('tbody tr td:first-child');
      const ids = expected[`unmatched_${side.toLowerCase()}`].map((r: { id: string }) => r.id);
      await expect(rows).toHaveText(ids.length ? ids : ['No records.']);
    }

    const dir = testInfo.outputPath();
    await mkdir(dir, { recursive: true });
    const guiReport = await download(page, 'Download report.json', join(dir, 'gui-report.json'));
    expect(JSON.parse(guiReport)).toEqual(await readExpected(ex));

    const cli = await runCli(
      dir,
      runArgs({
        ours: input(ex, 'ours.csv'),
        theirs: input(ex, 'theirs.csv'),
        manual: input(ex, 'manual.csv'),
        'as-of': await exampleAsOf(ex),
        output: 'cli-report.json',
      }),
    );
    expect(cli.code, cli.stderr).toBe(0);
    expect(guiReport).toBe(await readFile(join(dir, 'cli-report.json'), 'utf8'));
  });
}
