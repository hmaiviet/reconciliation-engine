# Matching contract

Agreed matching behavior. The engine, tests, and README follow this document. Each example row becomes a named test in milestone 2.

Notation: `o-1 100.00 @10:00:00.000Z` is an `ours` record with amount and timestamp; all times are on the same day.

## D1: Rule-based thresholds
**Status:** agreed
**Decision:** Absolute, inclusive tolerances: `|amount diff| <= 0.01` and `|timestamp diff| <= 1.000` s. Both are configurable per run with `--amount-tolerance` and `--time-tolerance-seconds`; the graded command uses the defaults.
**Why:** Examples 3 and 4 require a 0.01 amount and 0.500 s drift to match rule-based; example 4 requires 0.03 not to. 0.01 is the tightest amount the examples justify; 1 s covers the observed drift with headroom.
**Examples:**
| ours | theirs | expected |
| --- | --- | --- |
| o-1 100.00 @10:00:00.000Z | t-1 100.01 @10:00:00.000Z | rule_based, amount_diff `-0.01` |
| o-1 100.00 @10:00:00.000Z | t-1 100.02 @10:00:00.000Z | unmatched |
| o-1 100.00 @10:00:01.000Z | t-1 100.00 @10:00:00.000Z | rule_based, timestamp_diff_seconds `1.000` |
| o-1 100.00 @10:00:01.001Z | t-1 100.00 @10:00:00.000Z | unmatched |

## D2: Extended fields
**Status:** agreed
**Decision:**
- **Exact:** amount and timestamp equal, and all five extended fields equal (`currency`, `quantity`, `price_per_share`, `fx_rate`, `party_email`). Decimals compare by value; strings compare case-sensitively.
- **Rule-based:** amount and timestamp within D1, and `currency`, `party_email`, `quantity` equal. `price_per_share` and `fx_rate` may drift; the amount tolerance already bounds their effect.
- **Mixed shapes** (one record simple, the other extended): exact matches on amount and timestamp alone; rule-based never matches, because the identity fields cannot be confirmed on both sides.
**Why:** ASSIGNMENT: "any party-identity fields still line up exactly". Example 3: o-003/t-103 (same amount and time, different currency and email) stay unmatched; o-002/t-102 (fx 1.000000 vs 1.000001) match rule-based.
**Examples:**
| ours | theirs | expected |
| --- | --- | --- |
| o-1 USD 100×10.00 fx 1.000000 alice | t-1 same, same amount and time | exact |
| o-1 EUR 1000×10.00 fx 1.000000 bob, 10000.00 | t-1 EUR 1000×10.00 fx 1.000001 bob, 10000.01, +0.5 s | rule_based |
| o-1 USD … alice, 500.00 | t-1 EUR … carol, 500.00, same time | unmatched |
| o-1 USD 10×50.00 fx 1.000000 alice | t-1 USD 10×50.00 fx 1.100000 alice, same amount and time | rule_based (fx differs, so not exact) |
| o-1 simple 100.00 @10:00:00 | t-1 extended 100.00 @10:00:00 | exact |
| o-1 simple 100.00 @10:00:00 | t-1 extended 100.01 @10:00:00 | unmatched (mixed shapes never match rule-based) |

## D3: Candidate selection
**Status:** agreed
**Decision:** Within a tier, rank every qualifying pair by (`|amount diff|`, `|timestamp diff|`, `ours_id`, `theirs_id`) ascending and take pairs in that order, skipping any whose record is already consumed. No match-count maximization. IDs compare by code unit, not locale.
**Why:** Deterministic, independent of row order, and prefers the closest pair.
**Examples:**
| ours | theirs | expected |
| --- | --- | --- |
| o-1 100.00 @10:00:00, o-2 100.00 @10:00:00 | t-1 100.00 @10:00:00, t-2 100.00 @10:00:00 | exact o-1/t-1, exact o-2/t-2 |
| o-1 100.00 @10:00:00 | t-1 100.01 @10:00:00, t-2 100.00 @10:00:00.400 | rule_based o-1/t-2 (smaller amount diff wins) |

## D4: Manual pins
**Status:** agreed
**Decision:**
- Pins are applied first and win regardless of amount, timestamp, or extended fields.
- Identical repeated pins are de-duplicated.
- Conflicting pins (one ID pinned to two different partners) fail the run with exit 1, naming the rows.
- A pin whose ID does not exist, or whose record is after `as_of`, is skipped with a stderr warning; its partner competes in automatic tiers normally.
**Why:** ASSIGNMENT: manual "always wins". Conflicts have no correct answer, so the operator must fix them; stale pins should not block a daily run.
**Examples:**
| manual.csv | expected |
| --- | --- |
| `o-2,t-2` where o-2/t-2 differ by 949.99 and 4 h | manual, amount_diff `-949.99` |
| `o-1,t-1` twice | one manual match |
| `o-1,t-1` and `o-1,t-2` | exit 1, conflict error |
| `o-1,t-9` (t-9 missing), o-1 exactly equals t-1 | warning; exact o-1/t-1 |
| `o-1,t-1` with t-1 after `as_of` | warning; o-1 competes automatically, t-1 absent from report |

## D5: Precision and rounding
**Status:** agreed
**Decision:** Amounts and timestamps are compared at full input precision (timestamps may have any number of fractional-second digits). Only the report rounds: `amount_diff` to 2 dp, `timestamp_diff_seconds` to 3 dp, half-up (away from zero). Zero is never printed as negative. `as_of` is normalized to millisecond form (`...:SS.sssZ`).
**Examples:**
| input | report |
| --- | --- |
| `--as-of 2026-04-01T23:59:59Z` | `"as_of": "2026-04-01T23:59:59.000Z"` |
| o @10:00:00.0005Z, t @10:00:00.000Z | `timestamp_diff_seconds: "0.001"` |
| o @10:00:00.0004Z, t @10:00:00.000Z | `"0.000"`, not `"-0.000"` or `"0.0004"` |

## D6: Unmatched record echo
**Status:** agreed
**Decision:** Echo every input field except `memo`, using the original strings. Simple shape: `id`, `amount`, `timestamp`. Extended shape adds `currency`, `quantity` (JSON number), `price_per_share`, `fx_rate`, `party_email`, in that order.
**Why:** Examples 2 and 3 omit `memo` and emit `quantity` as a number.

## D7: Input validation
**Status:** agreed
**Decision:**
- Transaction files need a header with `id`, `amount`, `timestamp`; `memo` is optional. Extended columns are all-or-nothing. Unknown columns are ignored. A header-only file has zero records; an empty file is an error.
- `amount` and `price_per_share`: exactly 2 decimal places; `fx_rate`: exactly 6 (`-?digits.digits`, as ASSIGNMENT specifies). Checked during parsing, before any matching. `quantity`: integer. Extended string fields: non-empty. `id`: non-empty and unique per file.
- `timestamp`: `YYYY-MM-DDTHH:MM:SS[.fraction]Z`, a real calendar date. `--as-of`: exactly the ASSIGNMENT format `YYYY-MM-DDTHH:MM:SS[.sss]Z` (fraction absent or exactly 3 digits); anything else is a usage error, exit 2.
- `memo` is optional and ignored by exact and rule-based matching; it is reserved for the fuzzy tier.
- Unknown columns are ignored.
- `manual.csv`: header `ours_id,theirs_id`; header-only means no pins.
- All errors are collected and reported as `file:row: field: message`, exit 1. `row` is the physical line where the record starts, even when it spans several lines.
**Examples:**
| field value | result |
| --- | --- |
| `amount` `100.00`, `-5.10` | valid |
| `amount` `100`, `100.0`, `100.000` | `ours.csv:2: amount: '100' is not a decimal with exactly 2 decimal places` |
| `fx_rate` `1.000000` | valid |
| `fx_rate` `1.0` | error, exactly 6 decimal places required |
