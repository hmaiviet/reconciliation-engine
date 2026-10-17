---
name: recon-dev-workflow
description: Day-to-day development loop for the reconciliation engine - milestone order, per-change checklist, source-of-truth documents, and local commands. Use when starting a task, picking the next piece of work, deciding whether something is done, or when unsure which other recon skill applies.
---

# Reconciliation Engine Development Workflow

## Sources of truth (in priority order)

1. `ASSIGNMENT.md` - the external contract. Never edit it.
2. `examples/` - supplied scenarios. Never edit them, including `expected_report.json`.
3. `docs/matching-contract.md` - agreed matching decisions (see the `recon-matching-contract` skill).
4. `PLAN.md` - milestones, scope, and completion checks.

If code, tests, and these documents disagree, the higher-priority document wins. Report the conflict instead of quietly choosing one.

## Milestone order

Work on milestones strictly in order. Each one must leave a working deliverable that can be defended on its own.

| Milestone | Related skills |
| --- | --- |
| 1. CLI | `recon-matching-contract`, `recon-project-setup`, `recon-domain-types`, `recon-csv-ingest`, `recon-matching-engine`, `recon-report-output`, `recon-cli-command` |
| 2. Unit and integration tests | `recon-unit-tests`, `recon-cli-integration-tests` |
| 3. Fastify API and React GUI | `recon-api`, `recon-gui` |
| 4. Playwright end-to-end tests | `recon-e2e-tests` |
| Any time | `recon-example-check`, `recon-debug-scenario` |
| Hand-in | `recon-submission` |
| Fuzzy matching (bonus) | Only after milestones 1-4 are complete |

A milestone is done only when every **Completion check** listed for it in `PLAN.md` passes. Read the checks directly from the plan instead of working from memory.

## Per-change loop

```
- [ ] 1. Does the change touch matching behavior? Confirm the rule exists in docs/matching-contract.md.
         If it is undecided, stop and ask the user. Do not guess thresholds or policies.
- [ ] 2. Write or extend a named test that fails for the right reason.
- [ ] 3. Implement the smallest change that makes the test pass.
- [ ] 4. Run: npm run build && npm test
- [ ] 5. Run the example check (recon-example-check skill).
- [ ] 6. Update the README and contract doc if behavior, commands, or assumptions changed.
```

During milestone 1, before Vitest is set up, steps 2 and 4 shrink to the example check plus small ad hoc assertions. Milestone 2 replaces those with real tests.

## Local commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile TypeScript |
| `npm test` | Unit and CLI integration tests |
| `npm run test:watch` | Fast feedback while developing |
| `npm run test:coverage` | Coverage report (review uncovered branches, not just the percentage) |
| `npm run dev` | API and GUI on loopback |
| `npm run test:e2e` | Playwright browser tests |
| `npm run verify` | Type-check, build, tests, and e2e tests together |

Commands that don't exist yet are planned. When you add one, register it in `package.json` and in the README together.

## Guardrails

- Matching correctness and the tested CLI come before UI work.
- Out of scope: deployment, cloud services, databases, and hosted CI.
- Bugs: add a failing regression test first, then fix the bug (see `recon-debug-scenario`).
- Keep the engine shared. The API and GUI must not reimplement matching logic.
