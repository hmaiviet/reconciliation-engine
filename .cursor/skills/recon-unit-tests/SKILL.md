---
name: recon-unit-tests
description: Writes fast Vitest unit tests for the reconciliation engine, CSV parsing, and report formatting using transaction builders and full-value assertions, following the PLAN.md edge-case matrix. Use when adding or editing tests under test/unit, setting up Vitest, adding builders, or covering a matching rule or edge case.
---

# Recon Unit Tests

## Setup

- Install `vitest` and `@vitest/coverage-v8`.
- npm scripts: `"test": "npm run build && vitest run"`, `"test:watch": "vitest"`, `"test:coverage": "vitest run --coverage"`.
- `vitest.config.ts`: `include: ['test/**/*.test.ts']`, coverage `include: ['src/**']`.
- Unit tests import from `src/` and never spawn processes or touch the filesystem. Exception: CSV tests may read files from `test/fixtures/csv/`.

## Builders (test/helpers/builders.ts)

```ts
let seq = 0;
export const ours = (o: Partial<TxnInput> = {}) => txn('ours', { id: `o-${++seq}`, ...o });
export const theirs = (o: Partial<TxnInput> = {}) => txn('theirs', { id: `t-${++seq}`, ...o });
// defaults: amount '100.00', timestamp '2026-01-01T10:00:00.000Z', memo ''
// extended(o) adds currency 'USD', quantity 1, price_per_share '100.00', fx_rate '1.000000', party_email 'a@x.com'
```

Builders take **strings** for decimals and timestamps, mirroring CSV input. Give records explicit IDs whenever an assertion refers to them.

## Assertion style

- Assert the full result: `expect(pairs(result)).toEqual([['exact', 'o-1', 't-1']])`, not just `toHaveLength(1)`.
- Assert formatted report values as exact strings (`'-0.01'`, `'-0.500'`).
- Use one rule per test. Name the test as tier, then condition, then outcome, with the contract ID: `it('rule-based: amount diff just above threshold stays unmatched (D1)')`.
- Use `describe` blocks per tier and area (matching the matrix below).

## Edge-case matrix (from PLAN.md section 2.3)

| Area | Cases |
| --- | --- |
| Manual | overrides automatic, conflicting pins, duplicates, missing IDs |
| Exact | equal values, differing memos, duplicate candidates, extended-field constraints |
| Rule-based | just below / at / just above thresholds; competing candidates |
| Time | before / at / after cutoff, fractional precision, excluded manual partners |
| Money | negative, zero, large values, signed diffs, rounding, negative zero |
| CSV | empty, header-only, malformed rows, quoted commas/newlines, partial extended headers |
| Reports | ordering, summary counts, unmatched fields, deterministic output |
| Invariants | no double matching; each eligible record exactly once |

Add a reusable `expectInvariants(input, result)` helper and call it in every engine test.

## Regression discipline

For every bug: write the failing test first and watch it fail, then fix. Coverage is a prompt to look at uncovered branches, not a target number.
