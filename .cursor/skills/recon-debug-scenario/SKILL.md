---
name: recon-debug-scenario
description: Diagnoses a reconciliation scenario whose report differs from expectations (wrong tier, wrong pair, missing/extra record, formatting, ordering) and fixes it test-first. Use when an example or hidden-test-style scenario fails, when the user reports a wrong match, or during bug-hunt practice for the walkthrough.
---

# Recon Debug Scenario

## Workflow

```
- [ ] 1. Reproduce: run recon-example-check on the scenario dir (use --keep to inspect output)
- [ ] 2. Classify the first diff (table below)
- [ ] 3. Explain by hand which rule should apply, citing docs/matching-contract.md
- [ ] 4. Write a minimal failing test (2-4 records) that isolates the cause
- [ ] 5. Fix the smallest responsible function
- [ ] 6. Run npm test and the example check again; confirm no other scenario regressed
```

If step 3 shows the contract doesn't cover the case, stop and raise it with the user instead of patching around it.

## Classify the diff

| Symptom | Look first at |
| --- | --- |
| Count off in `summary` | as-of filter (`<=` vs `<`), consumption set, tier ordering |
| Pair in the wrong tier | Predicate of the earlier tier being too loose or too strict |
| Wrong partner chosen | Candidate comparator and iteration order (determinism) |
| Record in both a match and an unmatched list | Consumption bookkeeping |
| Diff off by one cent or one ms | Decimal parsing via `Number`, premature rounding, sign (`ours - theirs`) |
| `"-0.00"` | Negative-zero normalization |
| Ordering wrong | `localeCompare`, or sorting matches by `ours_id` before kind |
| Unmatched fields differ | Echo field list, `quantity` emitted as a string, reformatted decimals |
| Extended pair unexpectedly matched or unmatched | Identity-field rules (currency, party_email, fx_rate) |

## Building a minimal repro

Write the repro directly as a unit test with transaction builders. When CSV parsing itself is suspect, use a tiny scenario directory under `test/fixtures/scenarios/<name>/` in the same layout as `examples/`.

Name the test after the rule, not the bug: `"rule-based: amount diff exactly at threshold matches (D1 inclusive)"`.

## Explaining it

When reporting back, state the input pair, the expected tier with the rule that justifies it, the actual result, the root cause (file and function), and the test that now guards it.
