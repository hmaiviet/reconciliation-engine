# Matching algorithm decisions

How the engine (`src/domain/reconcile.ts`) finds matches quickly. `docs/matching-contract.md` defines *what* must match; this document records *how* it is computed and which speedups were chosen or deferred. Every decision here must produce exactly the report the contract describes. The unit tests and `npm run check:examples` confirm it.

Notation: `n` and `m` are the eligible `ours` and `theirs` counts, `N = n + m`, and `C` is the number of pairs that qualify for a tier.

## A1: Exact tier uses a hash join
**Status:** implemented (`matchExact`)
**Decision:**
- Every exact candidate has amount diff 0 and timestamp diff 0, so D3's ranking reduces to IDs: taking `ours` in ID order, each takes the lowest-ID compatible `theirs` that is still free.
- `theirs` is sorted by ID once, then filed into buckets keyed by `amount|timestamp`, and within a bucket into a list of simple records and one list per full extended key (`currency`, `party_email`, `quantity`, `price_per_share`, `fx_rate`). Lists come out in ID order because they are filled in sorted order.
- An extended `ours` looks only at the simple list and the list for its own extended key; a simple `ours` looks at every record in the bucket (D2 mixed shapes). It takes the lowest ID among those. The field filter therefore decides who may match, and ID order only picks among records that pass it.
- Keys use decimal.js `toString()`, which gives one string per value (`10.00`, `1e1` and `10` all give `10`; `-0` gives `0`), so equal-by-value decimals share a key.
- Records already used are popped off the end of each list (lists are stored in descending ID order), so each record is skipped at most once.

**Why:** Comparing pairs one by one costs about `n × m` when many records share a timestamp. Grouping by value costs `O(N log N)` (dominated by the ID sort) and gives the same matches.
**Cost:** `O(N log N)` time, `O(N)` memory.

## A2: Rule-based tier groups by identity, then scans a time window
**Status:** implemented (`matchGroups` with `ruleIdentity`, `matchTier`)
**Decision:**
- Records are grouped by identity: all simple records form one group, and extended records group by (`currency`, `party_email`, `quantity`). Under D2 a rule-based pair is two simple records or two extended records with equal identity, and mixed shapes never match, so every qualifying pair lies inside one group.
- Each group is matched on its own with `matchTier`: `theirs` sorted by timestamp, a binary search to each `ours` record's `±time tolerance` window, the amount tolerance checked inside the window, then D3's ranking.
- Matching each group separately gives exactly D3's global greedy result: a record only ever competes with candidates in its own group, so whether a candidate is taken depends only on candidates in that group.

**Why:** Identity fields must be equal, which is an exact key, so they can be hashed like A1. The tolerances make amount and timestamp "close enough" checks, and closeness does not chain (100.00 is close to 100.01, and 100.01 to 100.02, but 100.00 is not close to 100.02), so those two cannot be hashed. The time window handles the timestamp; see A4 for the amount.
**Cost:** `O(N log N + W + C log C)`, where `W` is the number of same-group pairs inside each other's time window.

## A3: Rule-based ranking keeps the full candidate sort
**Status:** agreed, no change planned
**Decision:** After finding candidates, the tier still sorts every qualifying pair by (`|amount diff|`, `|timestamp diff|`, `ours_id`, `theirs_id`) and takes them greedily, as D3 specifies. This step costs `O(C log C)`, and no change here is planned.
**Why:**
- Unlike exact matching, rule-based candidates differ in closeness, and D3 picks the closest pair first across all records. Which pair is closest is only known after looking at every qualifying pair, so `C` is a floor for any implementation that returns D3's result.
- Alternatives that avoid building the full candidate list (a priority queue of each record's best remaining partner, or 2-D search trees with deletion) are much harder to get exactly right with the four-level tie-break. They only help when `C` is huge, and a huge `C` means many near-identical records. That data is ambiguous anyway and needs manual pins (D4) rather than a faster guess.
- A1 and A2 already ensure that pairs which cannot qualify are never examined, so the remaining cost is spent only on real candidates.

## A4: Tolerance grid is deferred until needed
**Status:** deferred
**Decision:** Do not build a grid now. Revisit when real input files contain many same-identity records within one time tolerance whose amounts vary widely (for example, a batch file where thousands of records share one second).
**How it would work:** Within an identity group (A2), give each record a cell: `floor(timestamp ÷ time tolerance)` and `floor(amount ÷ amount tolerance)`. Use `floor`, not truncation, so negative amounts land in the right cell. Any pair within both tolerances is at most one cell apart in each direction, so each `ours` checks its own cell and its 8 neighbors and then applies the existing inclusive checks. A zero tolerance uses the exact value as the cell. Candidates and ranking are unchanged (A3), so reports stay identical.
**Why deferred:**
- It helps only one shape of data. The time window (A2) already limits comparisons to records within the time tolerance, so the grid only skips pairs that are close in time and far apart in amount. With typical bank data (timestamps spread out, the default 1 s tolerance), each window holds a few records and the tier is already close to linear.
- It adds code that has real edge cases (cell boundaries at exactly the tolerance, zero tolerances, negative amounts, decimal division), each needing tests, for no gain on the provided examples.
- A larger tolerance means bigger cells with more records each, so the benefit shrinks exactly when users widen the tolerances.
- It does not change A3's `O(C log C)` floor; it only removes `W − C`, the pairs examined but rejected.

**Trigger:** the benchmark row "1 group, distinct amounts" below taking noticeably long on a real file, or profiling showing `matchTier`'s window scan dominating.

## A5: Fuzzy tier groups by shape and quantity, runs cheap checks first, and bounds the edit distance
**Status:** implemented (`matchGroups`, `fuzzyRank`, `textDistance`)
**Decision:**
- Records are grouped by shape and quantity: all simple records form one group, and extended records group by `quantity`. D10 never pairs mixed shapes or different quantities, so as in A2 each group is matched on its own with the same result. Currency is not part of the key, because cross-currency pairs are allowed.
- `fuzzyRank` checks shape, quantity, the amount (or base value for cross-currency pairs) and, for cross-currency pairs, the identical `party_email` before computing any text distance. All conditions must hold, so the order does not change the result.
- Memo and `party_email` are normalized (trim, lowercase, collapse whitespace) once per record and cached in a `WeakMap`, not once per pair.
- `textDistance` only needs the exact distance when it is within 10% of the longer length. With `k = ceil(10% × longer length)` it rejects pairs whose lengths differ by more than `k`, computes only the cells within `k` of the diagonal (any path that stays within `k` edits stays there), and stops once a whole row exceeds `k`. Rounding `k` up only widens the band; the final ratio check is unchanged, so borderline cases (exactly 90%) behave as before.

**Why:** The edit distance cost `O(L²)` per pair (`L` = memo length) and ran on every pair in the time window, even pairs failing a one-line amount check. It is now `O(L × k)` and usually exits early, and it runs only for pairs that pass every cheap check.
**Verification:** a unit test compares `textDistance` against the full-table edit distance on 5,000 random string pairs (it fails if the band is narrowed by one). During development, 300,000 random `fuzzyRank` pairs and 5,000 random scenarios gave results identical to the previous implementation.
**Not done:** caching distances for repeated memo pairs, and a text index (split each memo into `k + 1` pieces; any memo within `k` edits contains one piece unchanged, so a hash index on pieces finds candidates without comparing every pair). Like A4, revisit only if real files show the fuzzy window scan dominating.

## Measurements

Engine-only timings (`reconcile()` from `dist/`), all records sharing one timestamp, on a local dev machine. They show orders of magnitude, not exact numbers.

| Scenario | Before | After |
| --- | --- | --- |
| Exact tier, 2,000 per side, all identical | 3.7 s | 10 ms (A1) |
| Exact tier, 20,000 per side, all identical | not run | 50 ms (A1) |
| Rule-based, 4,000 per side, 400 identity groups, amounts 0.01 apart | 3.7 s | 46 ms (A2) |
| Rule-based, 1,000 per side, 1 group, all 1,000,000 pairs qualify | 0.80 s | 0.70 s (A3: cost is ranking the qualifying pairs) |
| Rule-based, 4,000 per side, 1 group, distinct amounts (only 4,000 pairs qualify) | not run | 3.6 s (A4 would fix this) |
| Fuzzy, 1,000 per side, distinct ~25-character memos, all amounts within tolerance | 20.7 s | 3.4 s (A5: bounded edit distance) |
| Fuzzy, 1,000 per side, distinct memos, distinct amounts | 20.8 s | 0.68 s (A5: amount checked before memo) |
