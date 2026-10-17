import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO, example, exampleAsOf, readJson, readText, removeWorkdirs, runArgs, runCli, workdir } from '../helpers/run-cli.js';

afterEach(removeWorkdirs);

const expected = (path: string) => JSON.parse(readFileSync(join(REPO, path), 'utf8'));

describe('supplied examples', () => {
  it.each(['example_1_basic', 'example_2_with_manual', 'example_3_multi_party_currency'])(
    'example: %s matches expected_report.json exactly',
    async (name) => {
      const cwd = await workdir(example(name));
      const r = await runCli(cwd, runArgs({ 'as-of': await exampleAsOf(name) }));
      expect(r).toMatchObject({ code: 0, stderr: '' });
      expect(await readJson(cwd)).toEqual(expected(`examples/${name}/expected_report.json`));
    },
  );

  // The supplied expected report needs the fuzzy tier (o-003/t-103 differ by 0.03, above the D1 tolerance).
  // Until fuzzy exists, the documented expectation is that both records stay unmatched.
  it('example 4 without fuzzy tier: o-003/t-103 remain unmatched', async () => {
    const name = 'example_4_fuzzy_memo';
    const cwd = await workdir(example(name));
    const r = await runCli(cwd, runArgs({ 'as-of': await exampleAsOf(name) }));
    expect(r.code).toBe(0);
    expect(await readJson(cwd)).toEqual(expected('test/fixtures/example_4_nonfuzzy_expected.json'));
  });

  it('determinism: two runs produce byte-identical reports', async () => {
    const name = 'example_3_multi_party_currency';
    const asOf = await exampleAsOf(name);
    const a = await workdir(example(name));
    const b = await workdir(example(name));
    await runCli(a, runArgs({ 'as-of': asOf }));
    await runCli(b, runArgs({ 'as-of': asOf }));
    expect(await readText(b)).toBe(await readText(a));
  });
});
