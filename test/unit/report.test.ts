import { describe, expect, it } from 'vitest';
import { buildReport, serializeReport } from '../../src/report/report.js';
import { AS_OF, ext, run, txn, type Scenario } from '../helpers/builders.js';

const report = (s: Scenario) => buildReport(run(s), s.asOf ?? AS_OF);
const diffs = (s: Scenario) => report(s).matches.map((m) => [m.amount_diff, m.timestamp_diff_seconds]);

describe('money and diffs (D5)', () => {
  it('diffs: signed as ours - theirs (example 3 o-002/t-102)', () => {
    const s = { ours: [txn('o-1', { amount: '10000.00' })], theirs: [txn('t-1', { amount: '10000.01', timestamp: '2026-01-01T10:00:00.500Z' })] };
    expect(diffs(s)).toEqual([['-0.01', '-0.500']]);
  });

  it('diffs: positive when ours is larger and later', () => {
    const s = { ours: [txn('o-1', { amount: '100.01', timestamp: '2026-01-01T10:00:00.250Z' })], theirs: [txn('t-1')] };
    expect(diffs(s)).toEqual([['0.01', '0.250']]);
  });

  it('diffs: manual pin far apart (example 2 o-002/t-102)', () => {
    const s: Scenario = {
      ours: [txn('o-1', { amount: '50.00', timestamp: '2026-01-01T11:00:00.000Z' })],
      theirs: [txn('t-1', { amount: '999.99', timestamp: '2026-01-01T15:00:00.000Z' })],
      manual: [['o-1', 't-1']],
    };
    expect(diffs(s)).toEqual([['-949.99', '-14400.000']]);
  });

  it('money: negative amounts', () => {
    expect(diffs({ ours: [txn('o-1', { amount: '-50.00' })], theirs: [txn('t-1', { amount: '-50.01' })] })).toEqual([['0.01', '0.000']]);
  });

  it('money: zero amounts match exactly', () => {
    expect(diffs({ ours: [txn('o-1', { amount: '0.00' })], theirs: [txn('t-1', { amount: '0.00' })] })).toEqual([['0.00', '0.000']]);
  });

  it('money: large values keep cent precision', () => {
    const s = { ours: [txn('o-1', { amount: '99999999999999999.99' })], theirs: [txn('t-1', { amount: '99999999999999999.98' })] };
    expect(diffs(s)).toEqual([['0.01', '0.000']]);
  });

  it.each([
    ['10:00:00.0005', '0.001'],
    ['09:59:59.9995', '-0.001'],
    ['10:00:00.0004', '0.000'],
    ['09:59:59.9996', '0.000'],
  ])('rounding: ours @%s vs theirs @10:00:00.000 reports %s (half-up, no negative zero)', (time, expected) => {
    const s = { ours: [txn('o-1', { timestamp: `2026-01-01T${time}Z` })], theirs: [txn('t-1')] };
    expect(diffs(s)).toEqual([['0.00', expected]]);
  });
});

describe('report shape and ordering', () => {
  it('summary: counts every kind, including matched_fuzzy 0', () => {
    const r = report({
      ours: [txn('o-1'), txn('o-2', { amount: '50.00' }), txn('o-3', { amount: '7.00' }), txn('o-4', { amount: '1.00' })],
      theirs: [txn('t-1'), txn('t-2', { amount: '50.01' }), txn('t-3', { amount: '8.00' }), txn('t-9', { amount: '2.00' })],
      manual: [['o-3', 't-3']],
    });
    expect(r.summary).toEqual({
      matched_manual: 1,
      matched_exact: 1,
      matched_rule_based: 1,
      matched_fuzzy: 0,
      unmatched_ours: 1,
      unmatched_theirs: 1,
    });
  });

  it('ordering: matches by kind, then ours_id in code-unit order', () => {
    const r = report({
      ours: [txn('o-2'), txn('o-10'), txn('o-B', { amount: '5.00' }), txn('o-a', { amount: '6.00' }), txn('o-9', { amount: '50.00' })],
      theirs: [txn('t-1'), txn('t-2'), txn('t-3', { amount: '5.01' }), txn('t-4', { amount: '6.01' }), txn('t-5', { amount: '1.00' })],
      manual: [['o-9', 't-5']],
    });
    expect(r.matches.map((m) => [m.kind, m.ours_id])).toEqual([
      ['manual', 'o-9'],
      ['exact', 'o-10'],
      ['exact', 'o-2'],
      ['rule_based', 'o-B'],
      ['rule_based', 'o-a'],
    ]);
  });

  it('ordering: unmatched records sorted by id on each side', () => {
    const r = report({
      ours: [txn('o-b', { amount: '1.00' }), txn('o-a', { amount: '2.00' }), txn('o-C', { amount: '3.00' })],
      theirs: [txn('t-2', { amount: '4.00' }), txn('t-10', { amount: '5.00' })],
    });
    expect(r.unmatched_ours.map((u) => u.id)).toEqual(['o-C', 'o-a', 'o-b']);
    expect(r.unmatched_theirs.map((u) => u.id)).toEqual(['t-10', 't-2']);
  });

  it('echo: simple records echo id, amount, timestamp as input strings, without memo (D6)', () => {
    const r = report({ ours: [txn('o-1', { amount: '-5.10', timestamp: '2026-01-01T10:00:00Z', memo: 'coffee' })], theirs: [] });
    expect(r.unmatched_ours).toEqual([{ id: 'o-1', amount: '-5.10', timestamp: '2026-01-01T10:00:00Z' }]);
    expect(Object.keys(r.unmatched_ours[0]!)).toEqual(['id', 'amount', 'timestamp']);
  });

  it('echo: extended records add the five fields in order, quantity as a number (D6, example 3)', () => {
    const r = report({ ours: [], theirs: [ext('t-1', { quantity: '10', price_per_share: '50.00', currency: 'EUR', party_email: 'c@x.com' })] });
    expect(r.unmatched_theirs).toEqual([
      {
        id: 't-1',
        amount: '100.00',
        timestamp: '2026-01-01T10:00:00.000Z',
        currency: 'EUR',
        quantity: 10,
        price_per_share: '50.00',
        fx_rate: '1.000000',
        party_email: 'c@x.com',
      },
    ]);
    expect(Object.keys(r.unmatched_theirs[0]!)).toEqual(['id', 'amount', 'timestamp', 'currency', 'quantity', 'price_per_share', 'fx_rate', 'party_email']);
  });

  it('report: top-level keys in schema order and as_of passed through', () => {
    const r = report({ ours: [], theirs: [], asOf: '2026-04-01T23:59:59.000Z' });
    expect(Object.keys(r)).toEqual(['as_of', 'summary', 'matches', 'unmatched_ours', 'unmatched_theirs']);
    expect(r.as_of).toBe('2026-04-01T23:59:59.000Z');
  });

  it('determinism: shuffled input order serializes byte-identically', () => {
    const ours = [txn('o-1'), txn('o-2', { amount: '50.00' }), txn('o-3', { amount: '7.00' }), txn('o-4', { amount: '100.01' })];
    const theirs = [txn('t-1'), txn('t-2', { amount: '50.01' }), txn('t-3', { amount: '9.00' }), txn('t-4', { amount: '100.00' })];
    const a = serializeReport(report({ ours, theirs, manual: [['o-3', 't-3']] }));
    const b = serializeReport(report({ ours: [...ours].reverse(), theirs: [...theirs].reverse(), manual: [['o-3', 't-3']] }));
    expect(b).toBe(a);
    expect(a.endsWith('}\n')).toBe(true);
  });
});
