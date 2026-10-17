---
name: recon-report-output
description: Builds report.json from engine results - summary counts, signed amount/timestamp diffs, decimal formatting, unmatched record echo, and required sort order - with deterministic serialization. Use when generating or changing report JSON, formatting diffs, ordering matches/unmatched lists, or when a report differs from expected_report.json.
---

# Recon Report Output

## Schema (from ASSIGNMENT.md)

```jsonc
{
  "as_of": "<--as-of normalized to YYYY-MM-DDTHH:MM:SS.sssZ>",
  "summary": { "matched_manual": 0, "matched_exact": 0, "matched_rule_based": 0,
               "matched_fuzzy": 0, "unmatched_ours": 0, "unmatched_theirs": 0 },
  "matches": [{ "kind": "...", "ours_id": "...", "theirs_id": "...",
                "amount_diff": "0.00", "timestamp_diff_seconds": "0.000" }],
  "unmatched_ours": [ /* echo */ ],
  "unmatched_theirs": [ /* echo */ ]
}
```

- Always include all six summary keys, even when a count is `0`.
- Normalize `as_of` to millisecond form, as in the ASSIGNMENT.md schema example (`2026-04-28T14:00:00.000Z`): `--as-of` has either no fraction or exactly 3 digits, so append `.000` when it is absent (contract D5, D7). Build the string from the input; do not re-serialize it through `Date`.

## Values

- `amount_diff = ours.amount - theirs.amount`, formatted with `toFixed(2)`.
- `timestamp_diff_seconds = ours.ts - theirs.ts` in seconds, formatted with `toFixed(3)`.
- Normalize negative zero so the output is `"0.00"`, never `"-0.00"`.
- Take the rounding mode for values with extra precision from the contract.

## Unmatched echo

Based on examples 2 and 3 (confirm in `docs/matching-contract.md`):

- Simple shape: `id`, `amount`, `timestamp`, and no `memo`.
- Extended shape adds `currency`, `quantity` (JSON **number**), `price_per_share`, `fx_rate`, and `party_email`.
- Echo the original CSV strings for `amount`, `price_per_share`, `fx_rate`, and `timestamp`. Do not reformat them.

## Ordering

- `matches`: by kind rank (`manual` < `exact` < `rule_based` < `fuzzy`), then `ours_id`.
- `unmatched_ours` and `unmatched_theirs`: by `id`.
- Compare IDs with plain code-unit order (`a < b ? -1 : a > b ? 1 : 0`). **Do not** use `localeCompare`, because its result depends on the locale.

## Serialization

Build objects with a fixed key insertion order and use `JSON.stringify(report, null, 2) + '\n'`. Output must be byte-identical across repeated runs.
