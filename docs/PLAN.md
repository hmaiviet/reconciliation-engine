# Reconciliation Engine — Implementation Plan

## Scope and expectations

Build a local reconciliation tool in Node.js and TypeScript, starting with a dependable CLI and extending it with a local API and a small React GUI.

- Implement Manual, Exact, and Rule-based matching, in that priority order.
- Support the simple and extended transaction record shapes.
- Produce deterministic reports that follow `ASSIGNMENT.md`.
- Run the CLI, API, GUI, and all tests locally.
- Keep the project in one repository with one shared matching engine.
- Add small correctness tests during CLI implementation; expand them into a comprehensive test system in milestone 2.
- Defer fuzzy matching until all four milestones are complete.
- Deployment, cloud services, database persistence, and hosted CI are outside the current scope.

The assignment budgets approximately one working day. All four milestones may exceed that budget, so each milestone should leave a working, defensible deliverable. Matching correctness and the tested CLI take priority.

## Technology choices

| Area | Choice |
| --- | --- |
| Runtime and language | Node.js and TypeScript with strict type checking |
| Dependency management | npm with a committed lockfile and documented Node version |
| CLI argument parsing | Node's built-in `util.parseArgs` |
| CSV input | `csv-parse` |
| Decimal arithmetic | `decimal.js` |
| Unit and integration testing | Vitest |
| Local API | Fastify |
| Web GUI | React and TypeScript |
| Browser end-to-end testing | Playwright, initially Chromium |
| Initial storage | CSV inputs, JSON reports, and in-memory GUI session state |

## 1. Build the CLI

**Goal:** run the assignment's command and produce a correct, deterministic `report.json`.

### 1.1 Settle the matching contract

Agree on each behavior before implementing the corresponding rule. Record decisions with concrete input/output examples.

- Rule-based amount and timestamp thresholds, including boundary inclusivity and absolute versus relative tolerances.
- The roles of currency, quantity, price per share, FX rate, and party email in both automatic matching tiers.
- Deterministic candidate selection when multiple records could match, including whether maximizing the number of matches is required.
- Conflicting manual pins, repeated identical pins, references to missing IDs, and pins involving records excluded by the cutoff.
- Supported timestamp precision and report rounding without rounding before matching.
- Unmatched output fields: the specification says to echo input fields, while the supplied examples omit `memo`.

The examples allow a `0.01` amount difference and a `0.500` second timestamp difference, but do not establish the maximum rule thresholds. Example 3 also demonstrates that equal amount and timestamp alone are insufficient for some extended records.

### 1.2 Set up the TypeScript project

- Enable strict type checking.
- Document the supported Node version and commit the npm lockfile when version control is established.
- Compile TypeScript to JavaScript and expose a `recon` executable through a `bin` entry in `package.json`, with a `#!/usr/bin/env node` line at the top of the CLI entry file.
- Install the command on `PATH` with `npm link` after building, so `recon` runs directly from any directory and picks up rebuilds without reinstalling.
- Keep the project structure small, separating domain logic, CSV input, reporting, and the CLI.

### 1.3 Define domain types

Define transactions, manual pairs, matches, unmatched records, and report summaries. The engine must not depend on filesystem access, HTTP, React, or the current clock.

Parse decimal values directly from strings. Do not pass money or FX values through `Number` or `parseFloat`. Define decimal precision and rounding explicitly.

### 1.4 Implement CSV parsing and validation

- Support simple and extended records and header-only manual files.
- Handle quoted commas and multiline fields correctly.
- Validate required fields, unique IDs within each side, finite decimal values, timestamps, and complete extended fields.
- Identify the file, row, and field in errors where possible.

### 1.5 Implement the matching pipeline

1. Apply the agreed validation and manual-reference policy.
2. Select records with `timestamp <= as_of`.
3. Apply all manual matches.
4. Apply all exact matches among remaining records.
5. Apply all rule-based matches among remaining records.
6. Classify remaining eligible records as unmatched.

Complete each tier globally before moving to the next. Consume each record at most once and use an explicit candidate-selection policy. Ignore memos in automatic matching for this release.

### 1.6 Implement report generation

- Calculate signed differences as `ours - theirs`.
- Preserve precision during matching and format values only when generating the report.
- Include every eligible record exactly once as matched or unmatched.
- Sort matches by the explicit tier order and then `ours_id`; sort unmatched records by `id`.
- Include every required summary field, including `matched_fuzzy: 0`.

### 1.7 Connect the CLI

Support the required signature:

```sh
recon run \
  --ours OURS.csv \
  --theirs THEIRS.csv \
  --manual MANUAL.csv \
  --as-of YYYY-MM-DDTHH:MM:SS[.sss]Z \
  --output REPORT.json
```

- Write reports safely so a failed run does not leave partial output or corrupt an existing report.
- Show a readable terminal summary.
- Return exit code zero on success and meaningful nonzero failures with actionable stderr messages.
- Support execution from a fresh working directory, resolving all input and output paths against the current working directory rather than the project directory.

### 1.8 Document local usage

Document installation, build/run commands, architectural decisions, assumptions, supported behavior, limitations, and AI assistance.

Installation should be documented as:

```sh
npm ci
npm run build
npm link        # installs `recon` on PATH; `npm unlink -g` removes it
```

Note that a global link belongs to the active Node version; switching versions with a version manager requires linking again.

**Completion checks**

- Examples 1–3 produce the agreed expected reports.
- Repeated runs produce identical reports.
- Invalid input fails clearly.
- Failed runs preserve an existing report.
- After `npm link`, `recon run ...` works directly from a fresh working directory.

## 2. Build the CLI's unit and integration test system

**Goal:** make matching behavior explicit and catch regressions quickly.

### 2.1 Set up Vitest

Provide commands for a single run, watch mode, and coverage. Separate pure unit tests from integration tests that execute the CLI.

### 2.2 Create small, readable fixtures

- Use transaction builders for focused unit tests.
- Use actual CSV files for parsing and CLI tests.
- Preserve the supplied examples unchanged.
- Use explicit expected pairs and report values, rather than checking only counts.

### 2.3 Review edge cases together

Turn each agreed behavior into a named test. Start with this matrix:

| Area | Initial cases |
| --- | --- |
| Manual | Overrides automatic matches, conflicting pins, duplicates, missing IDs |
| Exact | Equal values, differing memos, duplicate candidates, extended-field constraints |
| Rule-based | Just below, exactly at, and just above thresholds; competing candidates |
| Time | Before/at/after cutoff, fractional precision, excluded manual partners |
| Money | Negative amounts, zero, large values, signed differences, rounding |
| CSV | Empty files, header-only files, malformed rows, quoted commas/newlines |
| Reports | Ordering, summary counts, unmatched fields, deterministic output |
| Invariants | No double matching; every eligible record appears exactly once |

Example 4 requires a separately named, documented non-fuzzy expectation until fuzzy matching is implemented. Do not modify its supplied expected report.

### 2.4 Test the engine and reporting functions directly

Keep these tests fast and independent of a running server. Verify validation, filtering, matching, consumption, and serialization separately where useful.

### 2.5 Test the CLI as a process

Run the compiled executable in temporary directories. Verify arguments, exit codes, stderr, output files, and complete parsed report contents.

Invoke the built entry file from the project rather than the globally linked `recon`, so tests do not depend on local installation state or exercise a stale link.

### 2.6 Establish regression discipline

Add a failing test for each discovered matching bug before fixing it. Review uncovered branches; a coverage percentage alone is not proof of correctness.

**Completion checks**

- One local command runs all unit and CLI integration tests.
- Failures identify the violated rule clearly.
- Supplied examples and agreed edge cases have explicit assertions.
- Tests use isolated temporary outputs and leave input fixtures unchanged.

## 3. Expose the engine to a local React GUI

**Goal:** use the same reconciliation behavior through a browser.

```text
CLI ──────────────┐
                 ├── shared matching engine ── report
React → local API┘
```

The API calls the engine directly; it does not launch the CLI as a subprocess. The engine owns all matching behavior.

### 3.1 Add a small Fastify API

Start with `POST /reconcile`, accepting input data, manual pins, and an explicit cutoff. Reuse the CLI's CSV parsing and domain validation where applicable.

### 3.2 Define the API contract

- Return the same report structure as the CLI.
- Return structured validation errors.
- Keep decimal values as strings over JSON.
- Validate runtime inputs even when TypeScript types are shared.

### 3.3 Build the React input screen

Provide file selection for the CSV inputs, an explicitly UTC cutoff field, and a run action. Include clear loading and error states.

### 3.4 Display results

Show summary counts, matches by kind, unmatched records on each side, and the fields needed to investigate each record.

### 3.5 Support manual pairing

Allow the user to select one record from each side, add or remove a manual pin, and rerun reconciliation. Surface pin conflicts clearly.

### 3.6 Support exports

Allow downloading `report.json` and the current `manual.csv` so decisions can be reused by the CLI. Keep session data in memory initially and make it clear that export is needed to preserve manual decisions across sessions.

### 3.7 Simplify local startup

Provide one development command that starts the API and frontend on loopback addresses. Document ports and shutdown behavior.

### 3.8 Add API integration tests

Verify valid requests, validation errors, and equivalent CLI/API reports.

**Completion checks**

- A user can load files, reconcile, inspect unmatched records, pin a pair, rerun, and export results.
- Equivalent CLI and GUI inputs produce equivalent reports.
- The complete application runs locally with no external service dependency.

## 4. Build a proper local end-to-end testing workflow

**Goal:** verify the real browser, API, engine, and downloadable files together.

### 4.1 Set up Playwright

Start with Chromium. Configure Playwright to start local servers, wait for readiness, and manage their lifecycle using its built-in web-server configuration.

### 4.2 Isolate test runs

- Use fresh browser contexts and temporary output directories.
- Use fixed fixtures and explicit cutoff timestamps.
- Use dedicated test ports and report collisions clearly.
- Exercise the real local API and engine in the main end-to-end flows.

### 4.3 Test the main user journeys

1. Load valid CSVs and verify the displayed report.
2. Add a manual pin, rerun, and verify its priority.
3. Remove a pin and verify automatic matching resumes.
4. Change the cutoff and verify excluded records disappear.
5. Submit invalid data and verify a useful error.
6. Download the report and manual pins, then reuse the exported pins with the original inputs through the CLI.

### 4.4 Check cross-interface consistency

Run the same fixture through the CLI and GUI. Compare parsed reports, including array ordering, rather than only comparing summary counts.

### 4.5 Make failures inspectable

Retain screenshots and traces for failed browser tests. Document how to inspect them locally and rerun a single failing scenario.

### 4.6 Provide complete local verification

Provide one command that type-checks, builds, runs unit/integration tests, and runs browser tests. Document the initial dependency and browser installation steps.

**Completion checks**

- After initial setup, one command verifies the project without manually starting servers or preparing data.
- End-to-end tests cover manual overrides, cutoff behavior, validation errors, and exports.
- Test failures leave useful local diagnostics.
- The workflow cleans up its servers and temporary outputs.

## Proposed local commands

These commands are planned interfaces, not yet implemented.

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile the project |
| `npm test` | Run unit and integration tests |
| `npm run test:watch` | Get fast development feedback |
| `npm run test:coverage` | Generate a coverage report |
| `npm run dev` | Start the local GUI and API |
| `npm run test:e2e` | Run browser workflow tests |
| `npm run verify` | Run complete local verification |

## Deferred work and risks

- Fuzzy matching is an optional bonus after the four milestones.
- Deployment, cloud services, database persistence, and hosted CI are not planned.
- Matching thresholds, extended-field semantics, ambiguity handling, and output precision remain decisions to resolve together before dependent implementation.
- The full plan may exceed the assignment's one-day budget; the tested CLI is the first deliverable.

## References

- [Assignment](ASSIGNMENT.md)
- [Worked examples](examples/)
- [Playwright web-server configuration](https://playwright.dev/docs/test-webserver)
- [Playwright trace viewer](https://playwright.dev/docs/trace-viewer)
