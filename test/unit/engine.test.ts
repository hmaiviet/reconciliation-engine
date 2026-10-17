import { describe, expect, it } from 'vitest';
import { textDistance } from '../../src/domain/reconcile.js';
import { ValidationError } from '../../src/domain/types.js';
import { ext, pairs, run, txn, unmatched } from '../helpers/builders.js';

describe('manual (D4)', () => {
  it('manual: pin wins over an exact automatic candidate', () => {
    const r = run({
      ours: [txn('o-1')],
      theirs: [txn('t-1'), txn('t-2', { amount: '999.99', timestamp: '2026-01-01T14:00:00.000Z' })],
      manual: [['o-1', 't-2']],
    });
    expect(pairs(r)).toEqual([['manual', 'o-1', 't-2']]);
    expect(unmatched(r)).toEqual({ ours: [], theirs: ['t-1'] });
  });

  it('manual: pin wins even when extended fields disagree (example 3 o-004/t-104)', () => {
    const r = run({
      ours: [ext('o-1', { currency: 'EUR', quantity: '200', price_per_share: '5.00' })],
      theirs: [ext('t-1', { currency: 'USD', quantity: '250', price_per_share: '4.00' })],
      manual: [['o-1', 't-1']],
    });
    expect(pairs(r)).toEqual([['manual', 'o-1', 't-1']]);
  });

  it('manual: identical repeated pins collapse to one match', () => {
    const r = run({ ours: [txn('o-1')], theirs: [txn('t-1')], manual: [['o-1', 't-1'], ['o-1', 't-1']] });
    expect(pairs(r)).toEqual([['manual', 'o-1', 't-1']]);
    expect(r.warnings).toEqual([]);
  });

  it('manual: ours pinned to two partners fails naming both rows', () => {
    const s = { ours: [txn('o-1')], theirs: [txn('t-1'), txn('t-2')], manual: [['o-1', 't-1'], ['o-1', 't-2']] as [string, string][] };
    expect(() => run(s)).toThrow(ValidationError);
    expect(errorsOf(() => run(s))).toEqual([{ row: 3, message: "ours_id 'o-1' is also pinned to 't-1' on row 2" }]);
  });

  it('manual: theirs pinned to two partners fails naming both rows', () => {
    const s = { ours: [txn('o-1'), txn('o-2')], theirs: [txn('t-1')], manual: [['o-1', 't-1'], ['o-2', 't-1']] as [string, string][] };
    expect(errorsOf(() => run(s))).toEqual([{ row: 3, message: "theirs_id 't-1' is also pinned to 'o-1' on row 2" }]);
  });

  it('manual: chained conflicts report every conflicting row', () => {
    const s = {
      ours: [txn('o-1'), txn('o-2')],
      theirs: [txn('t-1'), txn('t-2')],
      manual: [['o-1', 't-1'], ['o-2', 't-1'], ['o-2', 't-2']] as [string, string][],
    };
    expect(errorsOf(() => run(s))).toEqual([
      { row: 3, message: "theirs_id 't-1' is also pinned to 'o-1' on row 2" },
      { row: 4, message: "ours_id 'o-2' is also pinned to 't-1' on row 3" },
    ]);
  });

  it('manual: pin to a missing theirs id is skipped with a warning; ours matches automatically', () => {
    const r = run({ ours: [txn('o-1')], theirs: [txn('t-1')], manual: [['o-1', 't-404']] });
    expect(pairs(r)).toEqual([['exact', 'o-1', 't-1']]);
    expect(r.warnings).toEqual([{ row: 2, message: "theirs_id 't-404' not found; pin skipped" }]);
  });

  it('manual: pin to a missing ours id is skipped with a warning', () => {
    const r = run({ ours: [txn('o-1')], theirs: [txn('t-1')], manual: [['o-404', 't-1']] });
    expect(pairs(r)).toEqual([['exact', 'o-1', 't-1']]);
    expect(r.warnings).toEqual([{ row: 2, message: "ours_id 'o-404' not found; pin skipped" }]);
  });

  it('manual: a skipped pin does not conflict with a valid pin on the same id', () => {
    const r = run({ ours: [txn('o-1')], theirs: [txn('t-1')], manual: [['o-1', 't-404'], ['o-1', 't-1']] });
    expect(pairs(r)).toEqual([['manual', 'o-1', 't-1']]);
    expect(r.warnings).toEqual([{ row: 2, message: "theirs_id 't-404' not found; pin skipped" }]);
  });

  it('manual: pin to a record after as_of is skipped; its partner competes automatically', () => {
    const r = run({
      ours: [txn('o-1')],
      theirs: [txn('t-1', { timestamp: '2026-01-02T10:00:00.000Z' }), txn('t-2')],
      manual: [['o-1', 't-1']],
    });
    expect(pairs(r)).toEqual([['exact', 'o-1', 't-2']]);
    expect(r.warnings).toEqual([{ row: 2, message: "theirs 't-1' is after as_of; pin skipped" }]);
  });

  it('manual: a pin to an after-cutoff record does not conflict with a valid pin', () => {
    const r = run({
      ours: [txn('o-1', { timestamp: '2026-01-02T10:00:00.000Z' }), txn('o-2')],
      theirs: [txn('t-1')],
      manual: [['o-1', 't-1'], ['o-2', 't-1']],
    });
    expect(pairs(r)).toEqual([['manual', 'o-2', 't-1']]);
    expect(r.warnings).toEqual([{ row: 2, message: "ours 'o-1' is after as_of; pin skipped" }]);
  });
});

describe('exact', () => {
  it('exact: equal amount and timestamp match', () => {
    expect(pairs(run({ ours: [txn('o-1')], theirs: [txn('t-1')] }))).toEqual([['exact', 'o-1', 't-1']]);
  });

  it('exact: differing memos are ignored', () => {
    const r = run({ ours: [txn('o-1', { memo: 'coffee' })], theirs: [txn('t-1', { memo: 'settlement' })] });
    expect(pairs(r)).toEqual([['exact', 'o-1', 't-1']]);
  });

  it('exact: equal instants written with and without milliseconds match', () => {
    const r = run({ ours: [txn('o-1', { timestamp: '2026-01-01T10:00:00Z' })], theirs: [txn('t-1')] });
    expect(pairs(r)).toEqual([['exact', 'o-1', 't-1']]);
  });

  it('exact: duplicate candidates pair by id order regardless of input order (D3)', () => {
    const expected = [['exact', 'o-1', 't-1'], ['exact', 'o-2', 't-2']];
    expect(pairs(run({ ours: [txn('o-1'), txn('o-2')], theirs: [txn('t-1'), txn('t-2')] }))).toEqual(expected);
    expect(pairs(run({ ours: [txn('o-2'), txn('o-1')], theirs: [txn('t-2'), txn('t-1')] }))).toEqual(expected);
  });

  it('exact: extended records with all five fields equal match (D2)', () => {
    expect(pairs(run({ ours: [ext('o-1')], theirs: [ext('t-1')] }))).toEqual([['exact', 'o-1', 't-1']]);
  });

  it('exact: extended records differing only in fx_rate fall to rule_based (D2)', () => {
    const r = run({ ours: [ext('o-1')], theirs: [ext('t-1', { fx_rate: '1.100000' })] });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-1']]);
  });

  it('exact: extended records differing only in price_per_share fall to rule_based (D2)', () => {
    const r = run({ ours: [ext('o-1')], theirs: [ext('t-1', { price_per_share: '100.01' })] });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-1']]);
  });

  it('exact: different currency and party_email stay unmatched (D2, example 3 o-003/t-103)', () => {
    const r = run({ ours: [ext('o-1')], theirs: [ext('t-1', { currency: 'EUR', party_email: 'c@x.com' })] });
    expect(pairs(r)).toEqual([]);
    expect(unmatched(r)).toEqual({ ours: ['o-1'], theirs: ['t-1'] });
  });

  it('exact: a simple and an extended record match on amount and timestamp (D2 mixed shapes)', () => {
    expect(pairs(run({ ours: [txn('o-1')], theirs: [ext('t-1')] }))).toEqual([['exact', 'o-1', 't-1']]);
  });

  it('exact: mixed shapes pair by id order; a taken extended partner falls back to a simple one (D2, D3)', () => {
    const r = run({ ours: [ext('o-2'), txn('o-1')], theirs: [txn('t-2'), ext('t-1')] });
    expect(pairs(r)).toEqual([['exact', 'o-1', 't-1'], ['exact', 'o-2', 't-2']]);
  });

  it('tiers: exact pairs are taken before any rule-based pair', () => {
    // A single ranking by diffs then ids would pick o-1/t-1 (rule-based, fx drift) before o-1/t-2 (exact).
    const r = run({ ours: [ext('o-1')], theirs: [ext('t-1', { fx_rate: '1.100000' }), ext('t-2')] });
    expect(pairs(r)).toEqual([['exact', 'o-1', 't-2']]);
    expect(unmatched(r)).toEqual({ ours: [], theirs: ['t-1'] });
  });
});

describe('rule-based (D1)', () => {
  const at = (s: string) => `2026-01-01T10:00:${s}Z`;

  it('rule-based: amount diff exactly at 0.01 matches', () => {
    expect(pairs(run({ ours: [txn('o-1')], theirs: [txn('t-1', { amount: '100.01' })] }))).toEqual([['rule_based', 'o-1', 't-1']]);
  });

  it('rule-based: amount diff 0.01 in the other direction matches', () => {
    expect(pairs(run({ ours: [txn('o-1')], theirs: [txn('t-1', { amount: '99.99' })] }))).toEqual([['rule_based', 'o-1', 't-1']]);
  });

  it('rule-based: amount diff just above threshold (0.02) stays unmatched', () => {
    const r = run({ ours: [txn('o-1')], theirs: [txn('t-1', { amount: '100.02' })] });
    expect(pairs(r)).toEqual([]);
    expect(unmatched(r)).toEqual({ ours: ['o-1'], theirs: ['t-1'] });
  });

  it('rule-based: timestamp diff just below threshold (0.999 s) matches', () => {
    expect(pairs(run({ ours: [txn('o-1', { timestamp: at('00.999') })], theirs: [txn('t-1')] }))).toEqual([['rule_based', 'o-1', 't-1']]);
  });

  it('rule-based: timestamp diff exactly at threshold (1.000 s) matches', () => {
    expect(pairs(run({ ours: [txn('o-1', { timestamp: at('01.000') })], theirs: [txn('t-1')] }))).toEqual([['rule_based', 'o-1', 't-1']]);
  });

  it('rule-based: timestamp diff just above threshold (1.001 s) stays unmatched', () => {
    expect(pairs(run({ ours: [txn('o-1', { timestamp: at('01.001') })], theirs: [txn('t-1')] }))).toEqual([]);
  });

  it('rule-based: timestamp diff 1.0000001 s stays unmatched at full precision (D5)', () => {
    expect(pairs(run({ ours: [txn('o-1', { timestamp: at('01.0000001') })], theirs: [txn('t-1')] }))).toEqual([]);
  });

  it('rule-based: amount and timestamp both at thresholds match', () => {
    const r = run({ ours: [txn('o-1', { timestamp: at('01.000') })], theirs: [txn('t-1', { amount: '100.01' })] });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-1']]);
  });

  it('rule-based: custom tolerances are honored', () => {
    const s = { ours: [txn('o-1', { timestamp: at('02.000') })], theirs: [txn('t-1', { amount: '100.02' })] };
    expect(pairs(run(s))).toEqual([]);
    expect(pairs(run({ ...s, tolerances: { amount: '0.02', seconds: '2' } }))).toEqual([['rule_based', 'o-1', 't-1']]);
  });

  it('rule-based: smaller amount diff wins over smaller timestamp diff (D3)', () => {
    const r = run({ ours: [txn('o-1')], theirs: [txn('t-1', { amount: '100.01' }), txn('t-2', { timestamp: at('00.400') })] });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-2']]);
  });

  it('rule-based: equal amount diff, smaller timestamp diff wins (D3)', () => {
    const r = run({
      ours: [txn('o-1')],
      theirs: [txn('t-1', { amount: '100.01', timestamp: at('00.900') }), txn('t-2', { amount: '100.01', timestamp: at('00.100') })],
    });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-2']]);
  });

  it('rule-based: timestamp diff ranks by magnitude, not sign (D3)', () => {
    const r = run({
      ours: [txn('o-1', { timestamp: at('00.500') })],
      theirs: [txn('t-1', { timestamp: at('00.900') }), txn('t-2', { timestamp: at('00.000') })],
    });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-1']]);
  });

  it('rule-based: full tie goes to the lower theirs_id (D3)', () => {
    const r = run({ ours: [txn('o-1')], theirs: [txn('t-2', { amount: '100.01' }), txn('t-1', { amount: '100.01' })] });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-1']]);
    expect(unmatched(r)).toEqual({ ours: [], theirs: ['t-2'] });
  });

  it('rule-based: two ours competing for one theirs, the closer one wins (D3)', () => {
    const r = run({ ours: [txn('o-1', { amount: '99.99' }), txn('o-2', { amount: '100.00', timestamp: at('00.500') })], theirs: [txn('t-1')] });
    expect(pairs(r)).toEqual([['rule_based', 'o-2', 't-1']]);
    expect(unmatched(r)).toEqual({ ours: ['o-1'], theirs: [] });
  });

  it('rule-based: full tie between ours goes to the lower ours_id (D3)', () => {
    const r = run({ ours: [txn('o-2', { amount: '100.01' }), txn('o-1', { amount: '100.01' })], theirs: [txn('t-1')] });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-1']]);
  });

  it('rule-based: greedy closest-first does not maximize the match count (D3, documented limitation)', () => {
    // o-1 takes t-1 (diff 0.00); o-2 could only have used t-1, and t-2 is only in range of o-1.
    const r = run({
      ours: [txn('o-1'), txn('o-2', { amount: '99.99' })],
      theirs: [txn('t-1', { timestamp: at('00.500') }), txn('t-2', { amount: '100.01', timestamp: at('00.500') })],
    });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-1']]);
    expect(unmatched(r)).toEqual({ ours: ['o-2'], theirs: ['t-2'] });
  });

  it('rule-based: extended records match when price and fx drift (D2, example 3 o-002/t-102)', () => {
    const r = run({
      ours: [ext('o-1', { amount: '10000.00', quantity: '1000', price_per_share: '10.00', currency: 'EUR' })],
      theirs: [ext('t-1', { amount: '10000.01', timestamp: at('00.500'), quantity: '1000', price_per_share: '10.00', currency: 'EUR', fx_rate: '1.000001' })],
    });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-1']]);
  });

  it.each([
    ['currency', { currency: 'EUR' }],
    ['party_email', { party_email: 'b@x.com' }],
    ['party_email case', { party_email: 'A@x.com' }],
    ['quantity', { quantity: '2' }],
  ])('rule-based: differing %s stays unmatched (D2)', (_, fields) => {
    expect(pairs(run({ ours: [ext('o-1')], theirs: [ext('t-1', { amount: '100.01', ...fields })] }))).toEqual([]);
  });

  it('rule-based: identity groups in the same time window each match within their own group (D2)', () => {
    const r = run({
      ours: [ext('o-1'), ext('o-2', { currency: 'EUR' }), txn('o-3')],
      theirs: [ext('t-1', { amount: '100.01', currency: 'EUR' }), txn('t-2', { amount: '99.99' }), ext('t-3', { amount: '100.01' })],
    });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-3'], ['rule_based', 'o-2', 't-1'], ['rule_based', 'o-3', 't-2']]);
  });

  it('rule-based: a simple and an extended record never match rule-based (D2 mixed shapes)', () => {
    const r = run({ ours: [txn('o-1')], theirs: [ext('t-1', { amount: '100.01' })] });
    expect(pairs(r)).toEqual([]);
    expect(unmatched(r)).toEqual({ ours: ['o-1'], theirs: ['t-1'] });
  });
});

describe('fuzzy (D10)', () => {
  const shop = (id: string, memo: string, amount = '100.00') => txn(id, { memo, amount });

  it('fuzzy: memo typo with a 0.03 amount diff matches (example 4 o-003/t-103)', () => {
    const r = run({ ours: [shop('o-1', 'Coffee Shop', '300.00')], theirs: [shop('t-1', 'Cofee Shop', '300.03')] });
    expect(pairs(r)).toEqual([['fuzzy', 'o-1', 't-1']]);
  });

  it('fuzzy: identical memos with an amount diff above the rule-based tolerance match', () => {
    expect(pairs(run({ ours: [shop('o-1', 'lunch')], theirs: [shop('t-1', 'lunch', '100.02')] }))).toEqual([['fuzzy', 'o-1', 't-1']]);
  });

  it('fuzzy: amount diff exactly at 0.05 matches, 0.06 stays unmatched', () => {
    expect(pairs(run({ ours: [shop('o-1', 'lunch')], theirs: [shop('t-1', 'lunch', '100.05')] }))).toEqual([['fuzzy', 'o-1', 't-1']]);
    expect(pairs(run({ ours: [shop('o-1', 'lunch')], theirs: [shop('t-1', 'lunch', '99.94')] }))).toEqual([]);
  });

  it('fuzzy: timestamp diff above the rule-based tolerance stays unmatched', () => {
    const r = run({ ours: [shop('o-1', 'lunch')], theirs: [txn('t-1', { memo: 'lunch', amount: '100.02', timestamp: '2026-01-01T10:00:01.001Z' })] });
    expect(pairs(r)).toEqual([]);
  });

  it('fuzzy: memo exactly 90% similar matches (1 edit in 10 characters)', () => {
    expect(pairs(run({ ours: [shop('o-1', 'coffee bar')], theirs: [shop('t-1', 'cofee bar', '100.02')] }))).toEqual([['fuzzy', 'o-1', 't-1']]);
  });

  it('fuzzy: memo below 90% similar stays unmatched (1 edit in 9 characters)', () => {
    expect(pairs(run({ ours: [shop('o-1', 'groceries')], theirs: [shop('t-1', 'grocerias', '100.02')] }))).toEqual([]);
  });

  it('fuzzy: an adjacent transposition counts as one edit', () => {
    expect(pairs(run({ ours: [shop('o-1', 'coffee shop')], theirs: [shop('t-1', 'cofefe shop', '100.02')] }))).toEqual([['fuzzy', 'o-1', 't-1']]);
  });

  it('fuzzy: memos compare ignoring case and repeated or surrounding whitespace', () => {
    expect(pairs(run({ ours: [shop('o-1', ' COFFEE   shop')], theirs: [shop('t-1', 'coffee shop ', '100.02')] }))).toEqual([['fuzzy', 'o-1', 't-1']]);
  });

  it('fuzzy: empty memos are no evidence and never match', () => {
    expect(pairs(run({ ours: [shop('o-1', '')], theirs: [shop('t-1', '', '100.02')] }))).toEqual([]);
    expect(pairs(run({ ours: [shop('o-1', 'lunch')], theirs: [shop('t-1', '', '100.02')] }))).toEqual([]);
  });

  it('fuzzy: an identical memo outranks a closer amount', () => {
    const r = run({ ours: [shop('o-1', 'Coffee Shop')], theirs: [shop('t-1', 'Coffee Shop', '100.04'), shop('t-2', 'Cofee Shop', '100.02')] });
    expect(pairs(r)).toEqual([['fuzzy', 'o-1', 't-1']]);
  });

  it('fuzzy: banded text distance agrees with the full edit distance', () => {
    const full = (a: string[], b: string[]) => {
      const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
        }
      }
      const distance = d[a.length]![b.length]! / Math.max(a.length, b.length);
      return a.length + b.length && distance <= 0.1 ? distance : null;
    };
    let seed = 1;
    const rand = (n: number) => ((seed = (seed * 48271) % 2147483647) % n);
    const word = () => Array.from({ length: rand(25) }, () => 'abc'[rand(3)]!);
    const typo = (w: string[]) => {
      const c = [...w];
      for (let n = rand(4); n > 0 && c.length; n--) c.splice(rand(c.length), rand(2), ...(rand(2) ? ['a'] : []));
      return c;
    };
    for (let i = 0; i < 5000; i++) {
      const a = word();
      const b = rand(2) ? typo(a) : word();
      expect(textDistance(a, b), `${a.join('')} vs ${b.join('')}`).toBe(full(a, b));
    }
  });

  it('fuzzy: only sees records the rule-based tier left', () => {
    const r = run({ ours: [shop('o-1', 'Coffee Shop')], theirs: [shop('t-1', 'refund', '100.01'), shop('t-2', 'Coffee Shop', '100.03')] });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-1']]);
    expect(unmatched(r)).toEqual({ ours: [], theirs: ['t-2'] });
  });

  describe('extended', () => {
    const alice = (id: string, fields: Parameters<typeof ext>[1] = {}) =>
      ext(id, { memo: 'first-buy', party_email: 'alice@acme.com', ...fields });

    it('fuzzy: amount tolerance widens with a larger --amount-tolerance', () => {
      const s = { ours: [alice('o-1')], theirs: [alice('t-1', { amount: '100.08', party_email: 'alice@acme.con' })] };
      expect(pairs(run(s))).toEqual([]);
      expect(pairs(run({ ...s, tolerances: { amount: '0.10' } }))).toEqual([['fuzzy', 'o-1', 't-1']]);
    });

    it('fuzzy: party_email typo with a similar memo matches', () => {
      expect(pairs(run({ ours: [alice('o-1')], theirs: [alice('t-1', { party_email: 'alice@acme.con' })] }))).toEqual([['fuzzy', 'o-1', 't-1']]);
    });

    it('fuzzy: party_email differing only in case matches fuzzy, not rule-based', () => {
      expect(pairs(run({ ours: [alice('o-1')], theirs: [alice('t-1', { party_email: 'Alice@acme.com' })] }))).toEqual([['fuzzy', 'o-1', 't-1']]);
    });

    it('fuzzy: price and fx drift are allowed as in rule-based', () => {
      const r = run({ ours: [alice('o-1')], theirs: [alice('t-1', { party_email: 'alice@acme.con', price_per_share: '100.03', fx_rate: '1.000001' })] });
      expect(pairs(r)).toEqual([['fuzzy', 'o-1', 't-1']]);
    });

    it.each([
      ['quantity', { quantity: '2' }],
      ['party_email beyond a typo', { party_email: 'carol@acme.com' }],
      ['memo below 90%', { memo: 'second-buy' }],
    ])('fuzzy: differing %s stays unmatched even when everything else is similar', (_, fields) => {
      expect(pairs(run({ ours: [alice('o-1')], theirs: [alice('t-1', { amount: '100.02', ...fields })] }))).toEqual([]);
    });

    it('fuzzy: example 3 o-003/t-103 stays unmatched (currency and party differ)', () => {
      const r = run({
        ours: [ext('o-1', { memo: 'USD-buy', currency: 'USD', party_email: 'alice@acme.com' })],
        theirs: [ext('t-1', { memo: 'euro-side', currency: 'EUR', party_email: 'carol@acme.com' })],
      });
      expect(pairs(r)).toEqual([]);
    });

    it('fuzzy: a closer party_email outranks a closer memo', () => {
      const r = run({
        ours: [alice('o-1', { memo: 'coffee shop' })],
        theirs: [
          alice('t-1', { memo: 'coffee shop', party_email: 'alice@acme.con' }),
          alice('t-2', { memo: 'cofee shop', amount: '100.02' }),
        ],
      });
      expect(pairs(r)).toEqual([['fuzzy', 'o-1', 't-2']]);
    });

    it('fuzzy: a simple and an extended record never match fuzzy (mixed shapes)', () => {
      expect(pairs(run({ ours: [shop('o-1', 'first-buy')], theirs: [alice('t-1', { amount: '100.02' })] }))).toEqual([]);
    });

    describe('different currencies', () => {
      // ours: USD 1 × 100.00 at fx 1.000000 = 100.00, i.e. base value 100.00.
      const eur = (fields: Parameters<typeof ext>[1]) => alice('t-1', { currency: 'EUR', ...fields });

      it('fuzzy: same base value (amount ÷ fx_rate) matches although amounts differ by more than 0.05', () => {
        expect(pairs(run({ ours: [alice('o-1')], theirs: [eur({ amount: '92.00', fx_rate: '0.920000' })] }))).toEqual([['fuzzy', 'o-1', 't-1']]);
      });

      it('fuzzy: base value diff exactly at 0.05 matches, 0.06 stays unmatched', () => {
        expect(pairs(run({ ours: [alice('o-1')], theirs: [eur({ amount: '200.10', fx_rate: '2.000000' })] }))).toEqual([['fuzzy', 'o-1', 't-1']]);
        expect(pairs(run({ ours: [alice('o-1')], theirs: [eur({ amount: '200.12', fx_rate: '2.000000' })] }))).toEqual([]);
      });

      it('fuzzy: equal amounts with different fx rates are different base values', () => {
        expect(pairs(run({ ours: [alice('o-1')], theirs: [eur({ fx_rate: '0.920000' })] }))).toEqual([]);
      });

      it.each([
        ['a party_email typo', { party_email: 'alice@acme.con' }],
        ['a different quantity', { quantity: '2', price_per_share: '50.00' }],
        ['memo below 90%', { memo: 'second-buy' }],
      ])('fuzzy: %s stays unmatched', (_, fields) => {
        expect(pairs(run({ ours: [alice('o-1')], theirs: [eur(fields)] }))).toEqual([]);
      });

      it('fuzzy: example 3 o-004/t-104 without its pin stays unmatched (quantity differs)', () => {
        const r = run({
          ours: [ext('o-1', { amount: '1000.00', currency: 'EUR', quantity: '200', price_per_share: '5.00', memo: 'buy' })],
          theirs: [ext('t-1', { amount: '1000.00', currency: 'USD', quantity: '250', price_per_share: '4.00', memo: 'buy' })],
        });
        expect(pairs(r)).toEqual([]);
      });

      it('fuzzy: a same-currency candidate outranks a closer cross-currency one', () => {
        const r = run({ ours: [alice('o-1')], theirs: [eur({}), alice('t-2', { amount: '100.03' })] });
        expect(pairs(r)).toEqual([['fuzzy', 'o-1', 't-2']]);
      });
    });
  });
});

describe('time / cutoff', () => {
  const asOf = '2026-01-01T12:00:00.000Z';

  it('cutoff: records before and exactly at as_of are eligible', () => {
    const r = run({
      asOf,
      ours: [txn('o-1'), txn('o-2', { timestamp: asOf })],
      theirs: [txn('t-1'), txn('t-2', { timestamp: asOf })],
    });
    expect(pairs(r)).toEqual([['exact', 'o-1', 't-1'], ['exact', 'o-2', 't-2']]);
  });

  it('cutoff: records 1 ms after as_of are excluded on both sides', () => {
    const late = '2026-01-01T12:00:00.001Z';
    const r = run({ asOf, ours: [txn('o-1', { timestamp: late })], theirs: [txn('t-1', { timestamp: late })] });
    expect(pairs(r)).toEqual([]);
    expect(unmatched(r)).toEqual({ ours: [], theirs: [] });
  });

  it('cutoff: a record 0.1 µs after as_of is excluded (full precision)', () => {
    const r = run({ asOf, ours: [txn('o-1', { timestamp: '2026-01-01T12:00:00.0000001Z' })], theirs: [] });
    expect(unmatched(r)).toEqual({ ours: [], theirs: [] });
  });

  it('cutoff: an excluded record cannot steal an eligible partner', () => {
    // o-1 would win on both time diff and id if it were eligible.
    const r = run({
      asOf,
      ours: [txn('o-1', { timestamp: '2026-01-01T12:00:00.050Z' }), txn('o-2', { timestamp: '2026-01-01T11:59:59.900Z' })],
      theirs: [txn('t-1', { timestamp: asOf })],
    });
    expect(pairs(r)).toEqual([['rule_based', 'o-2', 't-1']]);
  });

  it('precision: timestamps differing below 1 ms are not exact', () => {
    const r = run({ ours: [txn('o-1', { timestamp: '2026-01-01T10:00:00.0001Z' })], theirs: [txn('t-1')] });
    expect(pairs(r)).toEqual([['rule_based', 'o-1', 't-1']]);
  });
});

describe('invariants', () => {
  it('invariants: no record matched twice and every eligible record appears once in a mixed scenario', () => {
    // run() asserts the invariants; this scenario exercises every tier at once.
    const r = run({
      ours: [txn('o-1'), txn('o-2', { amount: '50.00' }), txn('o-3', { amount: '20.00' }), txn('o-4', { amount: '7.00' }), txn('o-5', { timestamp: '2026-01-02T00:00:00.000Z' })],
      theirs: [txn('t-1'), txn('t-2', { amount: '50.01' }), txn('t-3', { amount: '999.00' }), txn('t-4', { amount: '100.00' })],
      manual: [['o-3', 't-3']],
    });
    expect(pairs(r)).toEqual([
      ['manual', 'o-3', 't-3'],
      ['exact', 'o-1', 't-1'],
      ['rule_based', 'o-2', 't-2'],
    ]);
    expect(unmatched(r)).toEqual({ ours: ['o-4'], theirs: ['t-4'] });
  });
});

function errorsOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationError) return e.errors;
    throw e;
  }
  throw new Error('expected a ValidationError');
}
