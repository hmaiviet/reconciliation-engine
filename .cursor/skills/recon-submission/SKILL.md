---
name: recon-submission
description: Prepares the take-home submission - README sections required by ASSIGNMENT.md, clean-checkout smoke test of the `recon` CLI from a fresh directory, and a zip without build artifacts or node_modules. Use when the user wants to package, submit, zip, or finalize the README for the assignment.
disable-model-invocation: true
---

# Recon Submission

## README must contain (ASSIGNMENT.md section "Submission")

- [ ] How to install and run: Node version, `npm ci`, `npm run build`, and how `recon` is invoked (`npm link`, or `node dist/cli/main.js`)
- [ ] The architectural decisions and the reasons behind them (shared pure engine, decimal handling, tier pipeline, determinism)
- [ ] Matching assumptions, linking to `docs/matching-contract.md`
- [ ] Supported versus cut scope (e.g. fuzzy tier), with the reasons
- [ ] What you would do with another day
- [ ] Whether and how AI assistance was used
- [ ] The test, dev, and verify commands

## Pre-zip checks

```sh
npm run verify    # or: npm run build && npm test, if e2e tests aren't present
node .cursor/skills/recon-example-check/scripts/check-scenarios.mjs
```

## Clean-checkout smoke test

```sh
tmp=$(mktemp -d)
git archive --format=tar HEAD | tar -x -C "$tmp"
cd "$tmp" && npm ci && npm run build && npm link
work=$(mktemp -d) && cp examples/example_1_basic/*.csv "$work" && cd "$work"
recon run --ours ours.csv --theirs theirs.csv --manual manual.csv \
  --as-of 2026-04-01T23:59:59.999Z --output report.json && cat report.json
npm unlink -g reconciliation-engine   # cleanup; use the package name from package.json
```

The smoke test must pass using only what the README says.

## Zip

```sh
git archive --format=zip --prefix=reconciliation-engine/ -o ../reconciliation-engine.zip HEAD
```

This includes only committed files, so `node_modules/`, `dist/`, and test artifacts stay out. Commit everything first. Confirm with the user whether `.cursor/` should be included. It is useful as evidence of AI usage, but it is optional.
