---
name: recon-matching-engine
description: Implements the pure reconciliation pipeline - as_of filtering, manual pins, exact tier, rule-based tier, unmatched classification - with global tier ordering, single consumption, and deterministic candidate selection. Use when writing or changing matching logic, tier rules, tie-breaking, manual-pin handling, or when a record is matched in the wrong tier or matched twice.
---

# Recon Matching Engine

## Signature

```ts
export function reconcile(input: {
  ours: Txn[]; theirs: Txn[]; manual: ManualPair[]; asOf: Instant;
}): ReconResult; // { matches: Match[]; unmatchedOurs: Txn[]; unmatchedTheirs: Txn[] }
```

This function is pure and synchronous, and the CLI, the API, and the tests all call it. The engine does no formatting. Formatting belongs to `recon-report-output`.

## Pipeline (each step finishes globally before the next one starts)

1. Validate manual pins according to the contract policy (missing IDs, duplicates, conflicts, records after the cutoff).
2. Eligible records are those with `timestamp <= asOf`, on both sides.
3. **Manual tier:** pair each valid pin and consume both records. Do not check amount or timestamp.
4. **Exact tier:** amount equal, timestamp equal, and the identity fields required by the contract equal.
5. **Rule-based tier:** amount and timestamp within the contract thresholds, identity fields equal per the contract.
6. Everything left over becomes unmatched on its own side.

Keep a `Set` of consumed IDs for each side, and check it before a record can join any pair. Memos are ignored in the exact and rule-based tiers.

## Determinism

- Never rely on input row order or `Map` insertion order for which candidate wins, unless the contract explicitly says so.
- Iterate `ours` sorted by `id`, and rank candidates with an explicit comparator, for example: smallest |time diff|, then smallest |amount diff|, then `theirs.id`. The comparator itself is a contract decision.
- If the contract requires maximizing the number of matches instead of greedy selection, implement it as a separate, documented step. Do not change the comparator to approximate it.
- Exact-tier performance: index `theirs` by `amount|timestamp` (plus identity fields) instead of comparing every pair.

## Tier predicates

Put each tier's predicate in its own small function (`isExactMatch(o, t)`, `isRuleMatch(o, t)`) with a comment naming the contract decision, for example `// D2`. Tests call the predicates directly.

## Invariants (assert in tests, optionally in dev)

- Every eligible record appears exactly once across matches and unmatched lists.
- No ID appears in two matches.
- No record with `timestamp > asOf` appears anywhere in the output.

## Fuzzy tier

This tier is deferred until milestones 1-4 are complete. When it is added, it runs after the rule-based tier and follows the same consumption and determinism rules.
