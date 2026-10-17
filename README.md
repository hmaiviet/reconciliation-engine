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

## GUI and API

```sh
npm run dev
```

This builds once, then runs the TypeScript compiler in watch mode, the API on <http://127.0.0.1:3001> (restarted on change), and the GUI on <http://127.0.0.1:5173> (Vite, which proxies `/reconcile` to the API). Open the GUI URL. Ctrl+C stops all three; if one fails to start (e.g. a port is taken), the others stop too. Change ports with `WEB_PORT` and `API_PORT`, e.g. `WEB_PORT=5174 npm run dev`. Both servers bind to localhost only and are meant for local development.

In the GUI: choose the CSV files, enter the UTC cutoff, and run. Results show the summary, matches per tier, and every eligible record, including `memo` (shown in the GUI only; `report.json` omits it). Select one record per side to pin them, remove pins, and run again. "Download manual.csv" saves the current pins; running the CLI with that file reproduces the GUI's report. Nothing is saved on reload. Details: [D9](docs/matching-contract.md#d9-gui-behavior).

The API has one endpoint, `POST /reconcile`, taking JSON with the CSV contents as strings:

```sh
curl -s http://127.0.0.1:3001/reconcile -H 'content-type: application/json' -d '{
  "ours": "id,amount,timestamp\no-1,10.00,2026-04-01T10:00:00Z\n",
  "theirs": "id,amount,timestamp\nt-1,10.00,2026-04-01T10:00:00Z\n",
  "manual": "",
  "as_of": "2026-04-01T23:59:59Z",
  "tolerances": { "amount": "0.01", "seconds": "1" }
}'
```

It returns `200 { report, warnings, tolerances, records, pins }`, where `report` is exactly the CLI's `report.json`, or `400 { errors: [{ file, row, field, message }] }`. Contract: [D8](docs/matching-contract.md#d8-api-contract).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Start the API and GUI with live reload (see above) |
| `npm run typecheck` | Type-check `src/`, `test/`, `e2e/`, and `web/` without emitting |
| `npm test` | Build, then run all unit, CLI, and API integration tests once |
| `npm run test:watch` | Re-run tests on change (integration tests use the last build) |
| `npm run test:coverage` | Build, test, and print a coverage report |
| `npm run check:examples` | Build, then run every scenario in `examples/` from a fresh temp directory and compare to `expected_report.json` (`scripts/check-scenarios.mjs`) |
| `npm run test:e2e` | Run the Playwright browser tests (starts its own API and GUI) |
| `npm run verify` | Everything: typecheck, build, unit and integration tests, examples check, browser tests |

## Tests

```text
test/
  unit/          engine, CSV parsing, timestamps, report formatting; pure, no processes
  integration/   run the built dist/cli/main.js as a child process in temp directories;
                 call the API in-process with Fastify inject, including CLI/API report equality
  helpers/       transaction builders, invariant checks, CLI runner
  fixtures/      CSV files for parsing and CLI tests
e2e/             Playwright tests driving the real GUI, API, and engine in Chromium
```

Run one area with `npx vitest run test/unit` or one test by name with `npx vitest run -t "rule-based"`. Test names cite the contract decision they cover, e.g. `(D1)`. Every engine test also checks the invariants: each eligible record appears exactly once, and nothing after `as_of` appears. Coverage for `src/cli` reads 0% because it only runs in child processes; the integration tests cover it.

### Browser tests

One-time setup after `npm ci`:

```sh
npx playwright install chromium
```

`npm run test:e2e` builds the project, starts the API on 127.0.0.1:3101 and the GUI on 127.0.0.1:5273 (separate from `npm run dev`, so both can run at once), runs the tests in Chromium, and stops both servers. If either port is busy the run fails with "is already used" instead of testing a stale server. The tests use the supplied examples with explicit cutoffs: loading and displaying a report, a pin overriding an exact match, removing a pin, an earlier cutoff, invalid input, and exporting `manual.csv` and reusing it through the CLI. They also check that the GUI's downloaded `report.json` equals the CLI's for examples 1–3.

Failed tests keep a screenshot, a trace, and an error summary under `test-results/`; passing tests leave nothing behind.

```sh
npx playwright test -g "cutoff"                    # one scenario by name
npx playwright test --headed --debug               # watch and step through
npx playwright show-trace test-results/<test>/trace.zip
npx playwright show-report                         # HTML report of the last run
```

## Architecture

```text
src/
  domain/   types, exact decimal/timestamp parsing, the matching engine (pure: no I/O, no clock)
  csv/      CSV text -> validated domain types, with file/row/field errors
  report/   engine result -> report.json (diffs, rounding, ordering, echo)
  pipeline.ts  CSV text + as_of + tolerances -> report; the one path shared by CLI and API
  cli/      argument parsing, file I/O, atomic write, terminal summary
  api/      Fastify app (POST /reconcile, schema validation, error mapping) and server entry
web/        React GUI (Vite); imports CSV/report formatting from src/ so exports match the CLI
scripts/    dev runner and the examples check
```

Imports point inward only (`cli, api -> pipeline -> csv, report -> domain`). The GUI never parses or matches records itself; it sends the files to the API.

- **Exact arithmetic.** Money, FX, and timestamps are parsed straight from strings into `decimal.js` values; nothing passes through `Number`. Timestamps are epoch seconds as decimals, so sub-millisecond input is compared exactly. Values are rounded only when the report is written.
- **Tiers run globally in order:** manual pins, then exact, then rule-based, then fuzzy, each finishing across all records before the next starts. A consumed record cannot join a later pair.
- **Deterministic selection.** Within a tier, all qualifying pairs are ranked by (|amount diff|, |time diff|, `ours_id`, `theirs_id`) and taken greedily; the fuzzy tier ranks by text distance first. Input row order never matters.
- **Candidate search** sorts `theirs` by timestamp and binary-searches the tolerance window per `ours` record, avoiding a full cross product.

## Assumptions and supported behavior

Summarised from [`docs/matching-contract.md`](docs/matching-contract.md):

- Rule-based: `|amount diff| <= 0.01` and `|timestamp diff| <= 1 s`, absolute and inclusive; both configurable per run.
- Extended records: exact requires all five extended fields equal; rule-based requires `currency`, `party_email`, and `quantity` equal while `price_per_share` and `fx_rate` may drift. A simple record and an extended record can match exactly on amount and timestamp, but never rule-based.
- Fuzzy: `|amount diff| <= 0.05` (or the rule-based tolerance if larger), timestamp within the rule-based tolerance, and memos at least 90% alike by edit distance, ignoring case and extra whitespace. Extended records also need equal `quantity`, plus either equal `currency` and a 90% alike `party_email`, or (different currencies) an identical `party_email` and base values `amount ÷ fx_rate` within 0.05 instead of the raw amount check. Same-currency pairs, then closer `party_email`, then closer memo win when candidates compete. Empty memos never match fuzzy.
- Inputs are validated before matching: `amount` and `price_per_share` must have exactly 2 decimal places, `fx_rate` exactly 6; `quantity` > 0, `price_per_share` >= 0, `fx_rate` > 0. A 0-byte `manual.csv` means no pins.
- Manual pins always win. Identical duplicates are de-duplicated; pins to missing IDs or to records after `as_of` are skipped with a warning; remaining pins that pin one record to two partners fail the run.
- Unmatched records echo their input fields except `memo` (as in the examples); `quantity` is a JSON number.
- `as_of` is normalized to millisecond form in the report.

## Limitations

- Fuzzy similarity is character-based: a one-letter email difference such as `bob@acme.com` vs `rob@acme.com` counts as a typo, so only the amount, time, and memo checks stand between them. Memos under 10 characters must be identical after normalization.
- Greedy selection does not maximize the number of matches when candidates compete (covered by a named test).

## AI assistance

Built with an AI coding assistant (Cursor) following `docs/PLAN.md`. Matching decisions were proposed with evidence from the examples and agreed explicitly before implementation; they are recorded in the contract document.
