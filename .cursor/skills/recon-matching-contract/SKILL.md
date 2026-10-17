---
name: recon-matching-contract
description: Records and consults agreed matching decisions (thresholds, extended-field roles, tie-breaking, manual-pin policy, precision, unmatched output fields) in docs/matching-contract.md. Use before implementing or changing any matching tier, validation policy, or report formatting, and when the user discusses an edge case or ambiguity in the assignment.
---

# Matching Contract

`docs/matching-contract.md` is the single place where matching behavior is decided. The engine, the tests, and the README all follow it.

## Rules

- Never invent a threshold or policy. If a decision is missing, present options with concrete consequences and ask the user, using `AskQuestion` when it is available.
- Every decision needs at least one concrete input/output example. Each example becomes a named test.
- When a decision changes, update the doc, the tests, and the README assumptions in the same change.

## Open decisions (from PLAN.md section 1.1)

1. Rule-based amount and timestamp thresholds: values, inclusive or exclusive boundaries, absolute or relative.
2. Roles of `currency`, `quantity`, `price_per_share`, `fx_rate`, and `party_email` in the exact and rule-based tiers.
3. Candidate selection when several records could match: tie-break order, and whether to maximize the number of matches or pick greedily.
4. Manual pins: conflicting pins, repeated identical pins, missing IDs, and pins to records after `as_of`.
5. Timestamp precision beyond milliseconds, and rounding rules for report values.
6. Unmatched echo fields: the spec says to echo input fields, but the examples omit `memo`.

## Evidence already in `examples/`

Use these facts to narrow options. They are deductions, not decisions, so confirm them with the user.

- **Unmatched records omit `memo`** in both shapes (examples 2 and 3). In example 3, `quantity` is a JSON number and the other decimals are strings.
- **Exact matching needs more than amount and timestamp for extended records.** In example 3, o-003/t-103 have equal amount and timestamp but different `currency` and `party_email`, and they stay unmatched. o-004/t-104 have the same email but different currency, quantity, and price, and they needed a manual pin.
- **`fx_rate` tolerates small drift in the rule-based tier.** o-002/t-102 match rule-based with fx 1.000000 vs 1.000001, amount diff -0.01, and time diff -0.500 s.
- **The amount threshold is bounded above.** In example 4, o-003/t-103 differ by 0.03 with the same timestamp, and the expected report matches them only as `fuzzy`. If the rule-based amount threshold were 0.03 or more, they would match rule-based instead. With an absolute threshold, this means 0.01 <= threshold < 0.03.
- A manual pin wins even when amount and timestamp are far apart (example 2: -949.99 and -14400 s).

## Doc template

Create `docs/matching-contract.md` with this structure:

```markdown
# Matching contract

## D1: <short title>
**Status:** agreed | open
**Decision:** <one or two sentences>
**Why:** <reasoning, cite ASSIGNMENT.md / examples>
**Examples:**
| ours | theirs | as_of | expected |
| --- | --- | --- | --- |
| o-1 100.00 @10:00:00.000Z | t-1 100.02 @10:00:00.000Z | ... | rule_based, amount_diff -0.02 |
**Tests:** `test/unit/rule-based.test.ts` > "<test name>"
```

Number decisions (D1, D2, ...) so tests and code comments can refer to them.
