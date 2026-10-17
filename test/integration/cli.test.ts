import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { example, listFiles, readJson, readText, removeWorkdirs, runArgs, runCli, workdir } from '../helpers/run-cli.js';

afterEach(removeWorkdirs);

const basic = () => workdir(example('example_1_basic'));
const csv = (name: string) => `test/fixtures/csv/${name}`;

describe('cli: usage errors exit 2', () => {
  it('cli: --help prints usage and exits 0', async () => {
    const r = await runCli(await workdir(), ['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: recon run --ours OURS.csv');
  });

  it.each([
    ['missing command', [], "error: missing command 'run'"],
    ['unknown command', ['frobnicate'], "error: unknown command 'frobnicate'"],
    ['missing flags', ['run', '--ours', 'ours.csv'], 'error: missing --theirs, --manual, --as-of, --output'],
    ['unknown flag', [...runArgs(), '--colour'], "Unknown option '--colour'"],
    ['flag without value', ['run', '--ours'], "Option '--ours <value>' argument missing"],
  ])('cli: %s', async (_, args, message) => {
    const r = await runCli(await basic(), args);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(message);
    expect(r.stderr).toContain('Usage:');
  });

  it.each(['2026-04-01', '2026-04-01T23:59:59.9Z', '2026-04-01T23:59:59.9999Z', '2026-04-01T23:59:59+00:00', '2026-02-30T00:00:00Z'])(
    'cli: --as-of %s is rejected (D7: exactly YYYY-MM-DDTHH:MM:SS[.sss]Z)',
    async (asOf) => {
      const r = await runCli(await basic(), runArgs({ 'as-of': asOf }));
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(`error: --as-of '${asOf}' is not a valid YYYY-MM-DDTHH:MM:SS[.sss]Z timestamp`);
    },
  );

  it.each([
    ['--amount-tolerance', '-0.01'],
    ['--time-tolerance-seconds', 'one'],
  ])('cli: %s %s is rejected', async (flag, value) => {
    const r = await runCli(await basic(), runArgs({}, [`${flag}=${value}`]));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`error: ${flag} '${value}' must be a non-negative decimal`);
  });
});

describe('cli: input errors exit 1', () => {
  it('cli: missing input file names the path', async () => {
    const r = await runCli(await basic(), runArgs({ theirs: 'nope.csv' }));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^error: cannot read input: ENOENT: .*nope\.csv'\n$/);
  });

  it('cli: invalid fields are reported as file:row: field: message, one per line', async () => {
    const cwd = await workdir({ ...example('example_1_basic'), 'ours.csv': csv('invalid_extended.csv') });
    const r = await runCli(cwd, runArgs());
    expect(r.code).toBe(1);
    const lines = r.stderr.trim().split('\n');
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe("error: ours.csv:2: quantity: '0' must be positive");
    expect(lines[10]).toBe('error: ours.csv:11: party_email: must not be empty');
  });

  it('cli: errors from several files are reported together', async () => {
    const cwd = await workdir({ 'ours.csv': csv('missing_column.csv'), 'theirs.csv': csv('empty.csv'), 'manual.csv': csv('manual_missing_column.csv') });
    const r = await runCli(cwd, runArgs());
    expect(r.code).toBe(1);
    expect(r.stderr.trim().split('\n')).toEqual([
      "error: ours.csv:1: missing column 'timestamp'",
      'error: theirs.csv: file is empty; expected a header row',
      "error: manual.csv:1: missing column 'theirs_id'",
    ]);
  });

  it('cli: conflicting manual pins fail naming the manual file and rows (D4)', async () => {
    const cwd = await workdir({ ...example('example_1_basic'), 'manual.csv': csv('manual_conflict.csv') });
    const r = await runCli(cwd, runArgs());
    expect(r.code).toBe(1);
    expect(r.stderr.trim()).toBe("error: manual.csv:3: ours_id 'o-001' is also pinned to 't-101' on row 2");
  });
});

describe('cli: successful runs', () => {
  it('cli: a pin to a missing id warns on stderr and still writes the report (D4)', async () => {
    const cwd = await workdir({ ...example('example_1_basic'), 'manual.csv': csv('manual_missing_id.csv') });
    const r = await runCli(cwd, runArgs());
    expect(r.code).toBe(0);
    expect(r.stderr.trim()).toBe("warning: manual.csv:2: theirs_id 't-999' not found; pin skipped");
    expect((await readJson(cwd)).summary.matched_exact).toBe(5);
  });

  it('cli: a 0-byte manual.csv means no pins (D7)', async () => {
    const cwd = await workdir({ ...example('example_2_with_manual'), 'manual.csv': csv('empty.csv') });
    const r = await runCli(cwd, runArgs());
    expect(r.code).toBe(0);
    expect((await readJson(cwd)).summary.matched_manual).toBe(0);
  });

  it('cli: as_of without milliseconds is normalized in the report (D5)', async () => {
    const cwd = await basic();
    await runCli(cwd, runArgs({ 'as-of': '2026-04-01T23:59:59Z' }));
    expect((await readJson(cwd)).as_of).toBe('2026-04-01T23:59:59.000Z');
  });

  it('cli: tolerance flags change rule-based matching (D1)', async () => {
    const files = example('example_4_fuzzy_memo');
    const asOf = '2026-05-01T23:59:59.999Z';
    const cwd = await workdir(files);
    await runCli(cwd, runArgs({ 'as-of': asOf }, ['--amount-tolerance', '0.03']));
    expect((await readJson(cwd)).summary).toMatchObject({ matched_rule_based: 2, unmatched_ours: 0 });
  });

  it('cli: relative paths resolve against the working directory, including subdirectories', async () => {
    const cwd = await workdir({ 'in/a.csv': 'examples/example_1_basic/ours.csv', 'in/b.csv': 'examples/example_1_basic/theirs.csv', 'in/m.csv': 'examples/example_1_basic/manual.csv' });
    const r = await runCli(cwd, runArgs({ ours: 'in/a.csv', theirs: 'in/b.csv', manual: 'in/m.csv', output: 'in/out.json' }));
    expect(r.code).toBe(0);
    expect((await readJson(cwd, 'in/out.json')).summary.matched_exact).toBe(5);
  });

  it('cli: stdout shows a readable summary with the output path', async () => {
    const cwd = await basic();
    const r = await runCli(cwd, runArgs());
    expect(r.stdout).toContain('Reconciliation as of 2026-04-01T23:59:59.999Z');
    expect(r.stdout).toMatch(/matched exact\s+5/);
    expect(r.stdout).toContain('report.json');
  });

  it('cli: an existing report is replaced on success', async () => {
    const cwd = await basic();
    await writeFile(join(cwd, 'report.json'), 'old');
    expect((await runCli(cwd, runArgs())).code).toBe(0);
    expect((await readJson(cwd)).summary.matched_exact).toBe(5);
  });
});

describe('cli: atomic output', () => {
  it('atomicity: invalid input leaves an existing report untouched and no temp file', async () => {
    const cwd = await workdir({ ...example('example_1_basic'), 'ours.csv': csv('invalid_simple.csv') });
    await writeFile(join(cwd, 'report.json'), 'SENTINEL');
    const r = await runCli(cwd, runArgs());
    expect(r.code).toBe(1);
    expect(await readText(cwd)).toBe('SENTINEL');
    expect(await listFiles(cwd)).toEqual(['manual.csv', 'ours.csv', 'report.json', 'theirs.csv']);
  });

  it('atomicity: conflicting pins leave an existing report untouched', async () => {
    const cwd = await workdir({ ...example('example_1_basic'), 'manual.csv': csv('manual_conflict.csv') });
    await writeFile(join(cwd, 'report.json'), 'SENTINEL');
    expect((await runCli(cwd, runArgs())).code).toBe(1);
    expect(await readText(cwd)).toBe('SENTINEL');
  });

  it('atomicity: an unwritable output path fails with exit 1 and leaves no files', async () => {
    const cwd = await basic();
    const r = await runCli(cwd, runArgs({ output: 'missing-dir/report.json' }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('error: cannot write report:');
    expect(await listFiles(cwd)).toEqual(['manual.csv', 'ours.csv', 'theirs.csv']);
  });
});
