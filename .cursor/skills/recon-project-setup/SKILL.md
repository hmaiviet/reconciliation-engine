---
name: recon-project-setup
description: Scaffolds and maintains the Node.js/TypeScript project for the reconciliation engine - package.json, tsconfig, folder layout, the `recon` bin, and npm scripts. Use when initializing the project, adding dependencies or npm scripts, changing build output, or when the `recon` executable fails to run.
---

# Recon Project Setup

## Stack

From the PLAN.md section "Technology choices":

- Node.js + TypeScript (strict), npm with a committed `package-lock.json`
- Runtime dependencies: `csv-parse`, `decimal.js`. The API milestone adds `fastify`.
- Dev dependencies: `typescript`, `@types/node`, `vitest`, and later `@vitest/coverage-v8` and `@playwright/test`
- Use `util.parseArgs` for argument parsing. Do not add an argument-parsing library.

Do not add other dependencies without asking.

## Layout

```
src/
  domain/    types, decimal/time helpers, matching engine (pure, no I/O)
  csv/       CSV parsing and validation -> domain types
  report/    report building, sorting, formatting
  cli/       argument parsing, file I/O, atomic write, terminal summary
test/
  unit/ integration/ fixtures/
docs/matching-contract.md
```

Imports may only point inward: `cli -> csv, report, domain`, `report -> domain`, `csv -> domain`. Nothing may import from `cli`.

## Config essentials

`package.json`:

```json
{
  "type": "module",
  "engines": { "node": ">=20" },
  "bin": { "recon": "dist/cli/main.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

`tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"`, `"outDir": "dist"`, `"rootDir": "src"`.

- Pin the Node version in `.nvmrc` as well as `engines`, and document it in the README.
- `src/cli/main.ts` must start with `#!/usr/bin/env node`. `tsc` keeps the line in the output.
- Write ESM relative imports with the `.js` extension (`import { x } from './y.js'`).
- Add `dist/`, `node_modules/`, `coverage/`, `test-results/`, and `playwright-report/` to `.gitignore`.

## Verify the bin

```sh
npm run build
node dist/cli/main.js run --help   # direct
npm link && (cd "$(mktemp -d)" && recon run --help)   # fresh working directory
```

If `recon` is not found after `npm link`, check that `bin` points to an existing file and that the file starts with the shebang line.
