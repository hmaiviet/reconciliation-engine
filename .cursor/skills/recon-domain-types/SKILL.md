---
name: recon-domain-types
description: Defines the reconciliation domain model - transactions (simple and extended shapes), manual pairs, matches, unmatched records, and summaries - plus exact decimal and timestamp handling with decimal.js. Use when adding or changing domain types, parsing money/FX/timestamps, comparing amounts or times, or whenever Number/parseFloat might touch a monetary value.
---

# Recon Domain Types

## Types (src/domain/)

```ts
type Side = 'ours' | 'theirs';
type MatchKind = 'manual' | 'exact' | 'rule_based' | 'fuzzy';

interface BaseTxn {
  side: Side;
  id: string;
  amount: Decimal;          // parsed from the original string
  timestamp: Instant;       // see "Timestamps"
  memo: string;
  raw: Record<string, string>; // original CSV strings, used to echo unmatched records
}
interface ExtendedFields {
  currency: string;
  quantity: bigint | number; // integer; validate as a safe integer
  pricePerShare: Decimal;
  fxRate: Decimal;
  partyEmail: string;
}
type Txn = BaseTxn & { extended?: ExtendedFields };

interface ManualPair { oursId: string; theirsId: string; row: number }
interface Match { kind: MatchKind; ours: Txn; theirs: Txn }
```

A file is either entirely simple or entirely extended: when the extended columns are present, all five appear together. Keep `extended` all-or-nothing and never partially filled.

## Decimal rules

- Use `new Decimal(str)` on the original CSV string. **Never** pass `amount`, `price_per_share`, or `fx_rate` through `Number`, `parseFloat`, `+str`, or `JSON.parse` numbers.
- Compare with `a.eq(b)`, `a.minus(b).abs().lte(t)`, and so on. Do not use `===` or `<` on Decimals.
- Do not round anything before matching. Format values only in the report layer.
- Set precision explicitly once: `Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })`. Choose the rounding mode from `docs/matching-contract.md`.
- **Negative zero:** `new Decimal('-0').toFixed(2)` returns `"-0.00"`. Normalize zero results before formatting.

## Timestamps

- Accepted form is `YYYY-MM-DDTHH:MM:SS[.fraction]Z`. Validate it with a strict regex before parsing, and reject offsets and missing `Z` unless the contract says otherwise.
- `Date` only keeps milliseconds. If the contract allows more precision, represent an instant as integer epoch seconds plus a fractional `Decimal`, or as a bigint of nanoseconds. Never silently truncate.
- Compute time differences as Decimal seconds (`ours - theirs`). Compare against `as_of` with the same representation.

## Purity

Domain code must not import `node:fs`, `node:path`, `fastify`, or React, and must not read `Date.now()` or `process`. `as_of` is always passed in as a parameter.
