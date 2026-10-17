---
name: recon-api
description: Builds and tests the local Fastify API that exposes the shared reconciliation engine (POST /reconcile), including request validation, structured errors, decimal-as-string JSON, and CLI/API report equivalence. Use when working on the backend service, API routes, request/response contracts, or API integration tests.
---

# Recon API

## Principles

- The API calls `reconcile()` and the report builder directly. **Never** spawn the CLI.
- It reuses the CSV parsers from `src/csv/`, which take CSV text and a display name.
- It binds to `127.0.0.1` only. Export `buildApp()` separately from `listen()` so tests can use `app.inject()`.

## Location

`src/api/` (`app.ts` exports `buildApp`, `server.ts` listens). Only `src/api` imports `fastify`.

## Contract

`POST /reconcile`

```jsonc
// request
{ "ours": "<csv text>", "theirs": "<csv text>", "manual": "<csv text>", "as_of": "2026-04-01T23:59:59.999Z" }
// 200: exactly the CLI report object
// 400:
{ "errors": [{ "file": "ours.csv", "row": 4, "field": "amount", "message": "..." }] }
```

- Validate the body at runtime with a Fastify JSON schema (`required`, `type: 'string'`, `additionalProperties: false`). Shared TypeScript types do not validate requests.
- Decimals stay strings in both directions.
- Map input and validation errors to 400 with the same `InputError` shape the CLI uses. Unexpected errors return 500 with a generic message and get logged.
- Set a body size limit (`bodyLimit`) suitable for the CSV sizes you expect.

## Tests (test/integration/api.test.ts)

- A valid request returns 200 with the full expected report for examples 1-3.
- Malformed CSV, a bad `as_of`, and missing fields each return 400 with specific errors.
- **Equivalence:** for each example, the parsed CLI report `toEqual`s the API response body.
