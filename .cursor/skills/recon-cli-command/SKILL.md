---
name: recon-cli-command
description: Implements the `recon run` command - util.parseArgs flags, --as-of validation, reading inputs, atomic report writing, terminal summary, exit codes, and stderr messages. Use when working on src/cli, argument handling, error messages, exit codes, output file writing, or the pretty-printed terminal summary.
---

# Recon CLI Command

## Contract

```sh
recon run --ours OURS.csv --theirs THEIRS.csv --manual MANUAL.csv \
  --as-of YYYY-MM-DDTHH:MM:SS[.sss]Z --output REPORT.json
```

The evaluators run this command in a fresh working directory for each scenario. Resolve paths relative to `process.cwd()`.

## Structure

`src/cli/main.ts` should stay thin. Put the logic in a testable function:

```ts
export async function runCli(argv: string[], io: { stdout; stderr; cwd: string }): Promise<number>
// main.ts: process.exitCode = await runCli(process.argv.slice(2), {...})
```

Set `process.exitCode` instead of calling `process.exit()`, so pending output still gets flushed.

## Arguments

- `parseArgs({ args, options: {...}, allowPositionals: true, strict: true })`. The first positional must be `run`.
- All five flags are required. A missing or unknown flag is a usage error and prints the usage text.
- Support `--help`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Report written |
| 1 | Input or validation error (bad CSV, invalid pins under the contract, unreadable file) |
| 2 | Usage error (bad or missing flags, bad `--as-of` format) |

stderr gets one line per problem, in the form `file:row: field: message`, with no stack traces. Print a stack only when the `RECON_DEBUG=1` environment variable is set, and treat unexpected exceptions as exit 1.

## Atomic write

1. Build the full report string in memory before touching the filesystem.
2. Write `${output}.${process.pid}.tmp` in the **same directory** as the output.
3. `fs.rename(tmp, output)`. If anything fails, unlink the temp file and leave any existing report untouched.

## Terminal summary (stdout)

Print a short, readable summary: the as-of time, counts per kind, unmatched counts per side, and the output path. stdout content is never parsed, so it can change freely. The report file is the contract.
