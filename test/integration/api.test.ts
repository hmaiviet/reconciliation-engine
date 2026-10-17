import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { BODY_LIMIT, buildApp } from '../../src/api/app.js';
import { REPO, example, exampleAsOf, readJson, removeWorkdirs, runArgs, runCli, workdir } from '../helpers/run-cli.js';

const app = buildApp();
afterAll(() => app.close());
afterEach(removeWorkdirs);

const read = (path: string) => readFileSync(join(REPO, path), 'utf8');
const exampleBody = (name: string) => ({
  ours: read(`examples/${name}/ours.csv`),
  theirs: read(`examples/${name}/theirs.csv`),
  manual: read(`examples/${name}/manual.csv`),
  as_of: read(`examples/${name}/as_of.txt`).trim(),
});
const post = (payload: unknown) => app.inject({ method: 'POST', url: '/reconcile', payload: payload as object });

const EXAMPLES = ['example_1_basic', 'example_2_with_manual', 'example_3_multi_party_currency', 'example_4_fuzzy_memo'];

describe('api: POST /reconcile (D8)', () => {
  it.each(EXAMPLES.slice(0, 3))('api: %s returns the expected report', async (name) => {
    const res = await post(exampleBody(name));
    expect(res.statusCode).toBe(200);
    expect(res.json().report).toEqual(JSON.parse(read(`examples/${name}/expected_report.json`)));
  });

  it.each(EXAMPLES)('equivalence: CLI report.json equals the API report for %s', async (name) => {
    const cwd = await workdir(example(name));
    await runCli(cwd, runArgs({ 'as-of': await exampleAsOf(name) }));
    expect((await post(exampleBody(name))).json().report).toEqual(await readJson(cwd));
  });

  it('api: response carries warnings, default tolerances, eligible records, and pins alongside the report', async () => {
    const body = (await post(exampleBody('example_2_with_manual'))).json();
    expect(Object.keys(body)).toEqual(['report', 'warnings', 'tolerances', 'records', 'pins']);
    expect(body.warnings).toEqual([]);
    expect(body.tolerances).toEqual({ amount: '0.01', seconds: '1' });
    expect(body.pins).toEqual([{ ours_id: 'o-002', theirs_id: 't-102' }]);
    expect(body.records.ours.map((r: { id: string }) => r.id)).toEqual(['o-001', 'o-002', 'o-003']);
    expect(body.records.theirs[1]).toEqual({ id: 't-102', amount: '999.99', timestamp: '2026-04-01T15:00:00.000Z', memo: 'settlement' });
    expect(body.report.unmatched_theirs[0]).not.toHaveProperty('memo');
  });

  it('api: records have no memo key when the file has no memo column', async () => {
    const body = (await post({ ...exampleBody('example_1_basic'), ours: 'id,amount,timestamp\no-1,10.00,2026-04-01T10:00:00Z\n' })).json();
    expect(body.records.ours).toEqual([{ id: 'o-1', amount: '10.00', timestamp: '2026-04-01T10:00:00Z' }]);
  });

  it('api: records exclude everything after as_of', async () => {
    const body = (await post({ ...exampleBody('example_1_basic'), as_of: '2026-04-01T12:00:00.000Z' })).json();
    expect(body.records.ours.map((r: { id: string }) => r.id)).toEqual(['o-001', 'o-002']);
  });

  it('api: identical repeated pins are returned once', async () => {
    const body = (await post({ ...exampleBody('example_1_basic'), manual: 'ours_id,theirs_id\no-001,t-101\no-001,t-101\n' })).json();
    expect(body.pins).toEqual([{ ours_id: 'o-001', theirs_id: 't-101' }]);
  });

  it('api: skipped pins come back as warnings and the pin stays listed (D4)', async () => {
    const res = await post({ ...exampleBody('example_1_basic'), manual: read('test/fixtures/csv/manual_missing_id.csv') });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toEqual([{ file: 'manual.csv', row: 2, message: "theirs_id 't-999' not found; pin skipped" }]);
    expect(res.json().pins).toEqual([{ ours_id: 'o-001', theirs_id: 't-999' }]);
  });

  it('api: custom tolerances change matching and are echoed (D1)', async () => {
    const body = (await post({ ...exampleBody('example_4_fuzzy_memo'), tolerances: { amount: '0.03' } })).json();
    expect(body.tolerances).toEqual({ amount: '0.03', seconds: '1' });
    expect(body.report.summary.matched_rule_based).toBe(2);
  });

  it('api: an empty manual string means no pins', async () => {
    const body = (await post({ ...exampleBody('example_2_with_manual'), manual: '' })).json();
    expect(body.report.summary.matched_manual).toBe(0);
  });
});

describe('api: 400 errors use the CLI error shape', () => {
  it('api: invalid CSV fields are reported with file, row, and field', async () => {
    const res = await post({ ...exampleBody('example_1_basic'), ours: 'id,amount,timestamp,memo\no-1,100,2026-04-01T10:00:00Z,\n' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      errors: [{ file: 'ours.csv', row: 2, field: 'amount', message: "'100' is not a decimal with exactly 2 decimal places" }],
    });
  });

  it('api: errors from several inputs are reported together', async () => {
    const res = await post({ ours: '', theirs: 'id,amount\n', manual: 'ours_id\n', as_of: 'today', tolerances: { amount: '-1', seconds: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([
      { field: 'as_of', message: "'today' is not a valid YYYY-MM-DDTHH:MM:SS[.sss]Z timestamp" },
      { field: 'tolerances.amount', message: "'-1' must be a non-negative decimal" },
      { field: 'tolerances.seconds', message: "'x' must be a non-negative decimal" },
      { file: 'ours.csv', message: 'file is empty; expected a header row' },
      { file: 'theirs.csv', row: 1, message: "missing column 'timestamp'" },
      { file: 'manual.csv', row: 1, message: "missing column 'theirs_id'" },
    ]);
  });

  it('api: conflicting pins are a 400 naming manual.csv rows (D4)', async () => {
    const res = await post({ ...exampleBody('example_1_basic'), manual: read('test/fixtures/csv/manual_conflict.csv') });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ file: 'manual.csv', row: 3, message: "ours_id 'o-001' is also pinned to 't-101' on row 2" }]);
  });

  it.each([
    ['missing field', { ours: '', theirs: '', as_of: '' }, [{ field: 'manual', message: "must have required property 'manual'" }]],
    ['unknown field', { ...exampleBody('example_1_basic'), extra: 1 }, [{ field: 'extra', message: 'must NOT have additional properties' }]],
    ['number instead of string', { ...exampleBody('example_1_basic'), as_of: 20260401 }, [{ field: 'as_of', message: 'must be string' }]],
    ['unknown tolerance', { ...exampleBody('example_1_basic'), tolerances: { percent: '1' } }, [{ field: 'tolerances.percent', message: 'must NOT have additional properties' }]],
  ])('api: schema rejects %s', async (_, payload, errors) => {
    const res = await post(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ errors });
  });

  it('api: malformed JSON is a 400 with an errors list', async () => {
    const res = await app.inject({ method: 'POST', url: '/reconcile', headers: { 'content-type': 'application/json' }, payload: '{"ours":' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toHaveLength(1);
  });

  it('api: bodies over the size limit are rejected with 413', async () => {
    const res = await post({ ...exampleBody('example_1_basic'), memo: 'x'.repeat(BODY_LIMIT) });
    expect(res.statusCode).toBe(413);
    expect(res.json().errors).toHaveLength(1);
  });
});
