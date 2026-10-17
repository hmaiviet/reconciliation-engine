# Reconciliation engine

Reconciles two CSV streams of transaction records (`ours`, `theirs`) plus operator-pinned pairs (`manual`) into a deterministic `report.json`. The brief is in [`docs/ASSIGNMENT.md`](docs/ASSIGNMENT.md), the plan in [`docs/PLAN.md`](docs/PLAN.md), and every matching decision in [`docs/matching-contract.md`](docs/matching-contract.md).

## Install and run

Requires Node.js 22 (see `.nvmrc`).

```sh
npm ci
npm run build
npm link        # installs `recon` on PATH; `npm unlink -g` removes it
```

A global link belongs to the active Node version; after switching versions with a version manager, run `npm link` again. Without linking, use `node dist/cli/main.js` in place of `recon`.

```sh
recon run \
  --ours OURS.csv \
  --theirs THEIRS.csv \
  --manual MANUAL.csv \
  --as-of YYYY-MM-DDTHH:MM:SS[.sss]Z \
  --output REPORT.json \
  [--amount-tolerance 0.01] [--time-tolerance-seconds 1]
```

Paths resolve against the current working directory. The report is written atomically (temp file + rename), so a failed run never leaves a partial report or overwrites an existing one. A summary is printed to stdout; errors and skipped-pin warnings go to stderr as `file:row: field: message`.

| Exit code | Meaning |
| --- | --- |
| 0 | Report written |
| 1 | Invalid input (CSV errors, conflicting manual pins, unreadable input, unwritable output) |
| 2 | Usage error (missing/unknown flags, malformed `--as-of` or tolerance) |

Set `RECON_DEBUG=1` to print stack traces for unexpected errors.

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check `src/` and `test/` without emitting |
| `npm test` | Build, then run all unit and CLI integration tests once |
| `npm run test:watch` | Re-run tests on change (integration tests use the last build) |
| `npm run test:coverage` | Build, test, and print a coverage report |
| `npm run check:examples` | Build, then run every scenario in `examples/` from a fresh temp directory and compare to `expected_report.json` (`scripts/check-scenarios.mjs`) |

## Tests

```text
test/
  unit/          engine, CSV parsing, timestamps, report formatting; pure, no processes
  integration/   run the built dist/cli/main.js as a child process in temp directories
  helpers/       transaction builders, invariant checks, CLI runner
  fixtures/      CSV files and the non-fuzzy expectation for example 4
```

Run one area with `npx vitest run test/unit` or one test by name with `npx vitest run -t "rule-based"`. Test names cite the contract decision they cover, e.g. `(D1)`. Every engine test also checks the invariants: each eligible record appears exactly once, and nothing after `as_of` appears. Coverage for `src/cli` reads 0% because it only runs in child processes; the integration tests cover it.

## Architecture

```text
src/
  domain/   types, exact decimal/timestamp parsing, the matching engine (pure: no I/O, no clock)
  csv/      CSV text -> validated domain types, with file/row/field errors
  report/   engine result -> report.json (diffs, rounding, ordering, echo)
  cli/      argument parsing, file I/O, atomic write, terminal summary
```

Imports point inward only (`cli -> csv, report -> domain`), so the planned API and GUI can reuse the engine unchanged.

- **Exact arithmetic.** Money, FX, and timestamps are parsed straight from strings into `decimal.js` values; nothing passes through `Number`. Timestamps are epoch seconds as decimals, so sub-millisecond input is compared exactly. Values are rounded only when the report is written.
- **Tiers run globally in order:** manual pins, then exact, then rule-based, each finishing across all records before the next starts. A consumed record cannot join a later pair.
- **Deterministic selection.** Within a tier, all qualifying pairs are ranked by (|amount diff|, |time diff|, `ours_id`, `theirs_id`) and taken greedily. Input row order never matters.
- **Candidate search** sorts `theirs` by timestamp and binary-searches the tolerance window per `ours` record, avoiding a full cross product.

## Assumptions and supported behavior

Summarised from [`docs/matching-contract.md`](docs/matching-contract.md):

- Rule-based: `|amount diff| <= 0.01` and `|timestamp diff| <= 1 s`, absolute and inclusive; both configurable per run.
- Extended records: exact requires all five extended fields equal; rule-based requires `currency`, `party_email`, and `quantity` equal while `price_per_share` and `fx_rate` may drift. A simple record and an extended record can match exactly on amount and timestamp, but never rule-based.
- Inputs are validated before matching: `amount` and `price_per_share` must have exactly 2 decimal places, `fx_rate` exactly 6; `quantity` > 0, `price_per_share` >= 0, `fx_rate` > 0. A 0-byte `manual.csv` means no pins.
- Manual pins always win. Identical duplicates are de-duplicated; pins to missing IDs or to records after `as_of` are skipped with a warning; remaining pins that pin one record to two partners fail the run.
- Unmatched records echo their input fields except `memo` (as in the examples); `quantity` is a JSON number.
- `as_of` is normalized to millisecond form in the report.

## Limitations

- No fuzzy tier yet: `examples/example_4_fuzzy_memo` reports `o-003/t-103` as unmatched instead of fuzzy. This is expected until fuzzy matching is implemented (deferred by the plan); `test/fixtures/example_4_nonfuzzy_expected.json` records the current expectation.
- Greedy selection does not maximize the number of matches when candidates compete (covered by a named test).

## AI assistance

Built with an AI coding assistant (Cursor) following `docs/PLAN.md`. Matching decisions were proposed with evidence from the examples and agreed explicitly before implementation; they are recorded in the contract document.
