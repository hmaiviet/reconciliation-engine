---
name: recon-example-check
description: Runs the built `recon` CLI against every scenario in examples/ (or any scenario directory) from fresh temp directories, checks determinism, and reports the first differing JSON path versus expected_report.json. Use after any engine, CSV, report, or CLI change, before declaring work done, and when the user asks whether the examples pass.
---

# Recon Example Check

## Run

```sh
npm run build
node scripts/check-scenarios.mjs   # or: npm run check:examples (builds first)
```

The script must be **executed**, not read. Options:

| Option | Effect |
| --- | --- |
| `DIR ...` | Check specific scenario dirs instead of all of `examples/*` |
| `--keep` | Keep temp working dirs and print their paths for inspection |
| `RECON_CMD="recon"` | Invoke a linked or installed binary instead of `dist/cli/main.js` |

A scenario directory contains `ours.csv`, `theirs.csv`, `manual.csv`, `as_of.txt`, and `expected_report.json`.

## What it checks

- Exit code 0, and `report.json` is written in a fresh working directory.
- Two identical runs produce byte-identical output.
- Canonical JSON equality: key order is ignored, while values, types, and array order must match. This is how the graders compare reports.

## Reading results

| Status | Meaning |
| --- | --- |
| `PASS` | Matches the expected report |
| `FAIL` | Shows the first differing path, e.g. `$.matches[1].kind: got "exact", expected "rule_based"` |
| `ERROR` | The CLI failed. Its stderr is shown |

Exit code 1 means at least one `FAIL` or `ERROR`. To investigate a failure, use the `recon-debug-scenario` skill. Never edit a supplied `expected_report.json`.
