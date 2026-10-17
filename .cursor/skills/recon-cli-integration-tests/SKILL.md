---
name: recon-cli-integration-tests
description: Writes Vitest integration tests that execute the compiled `recon` CLI as a child process in temporary directories, asserting exit codes, stderr, atomic output, and full parsed reports for the supplied examples and CSV fixtures. Use when adding tests under test/integration, testing CLI arguments or error handling, or encoding the examples as tests.
---

# Recon CLI Integration Tests

These tests run `dist/cli/main.js`, so `npm test` builds first (see `recon-unit-tests`).

## Helper (test/helpers/run-cli.ts)

```ts
import { execFile } from 'node:child_process';
import { mkdtemp, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const BIN = resolve('dist/cli/main.js');

export async function runCli(args: string[], opts: { fixtureDir?: string } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'recon-it-'));
  if (opts.fixtureDir) await cp(opts.fixtureDir, cwd, { recursive: true });
  try {
    const { stdout, stderr } = await promisify(execFile)('node', [BIN, ...args], { cwd });
    return { code: 0, stdout, stderr, cwd };
  } catch (e: any) {
    return { code: e.code as number, stdout: e.stdout, stderr: e.stderr, cwd };
  }
}
export const readReport = async (cwd: string, name = 'report.json') =>
  JSON.parse(await readFile(join(cwd, name), 'utf8'));
```

Always copy fixtures into the temp dir. Never pass a path inside `examples/` or `test/fixtures/` as `--output`.

## Required tests

- **Examples 1-3:** `toEqual` against the parsed `examples/*/expected_report.json`. Array order matters, so compare whole objects.
- **Example 4:** a separate test named for its non-fuzzy expectation, for example `'example 4 without fuzzy tier: o-003/t-103 remain unmatched'`. Build the expected value inline or keep it in `test/fixtures/example_4_nonfuzzy_expected.json`. Never modify the supplied file.
- **Determinism:** two runs produce byte-identical `report.json`.
- **Usage errors:** missing flag, unknown flag, missing `run`, malformed `--as-of`. Assert exit 2 and a helpful stderr.
- **Input errors:** missing file, malformed CSV, duplicate ID, bad decimal. Assert exit 1 and that stderr names the file, row, and field.
- **Atomicity:** pre-create `report.json` with sentinel content, run with bad input, and assert the content is unchanged and no `*.tmp` file remains.
- **Fresh cwd:** relative paths resolve against the temp dir.

Keep each test independent, and don't share temp dirs between tests.
