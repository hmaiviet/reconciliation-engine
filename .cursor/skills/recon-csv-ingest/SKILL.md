---
name: recon-csv-ingest
description: Parses and validates ours.csv, theirs.csv, and manual.csv with csv-parse into domain types, producing file/row/field-specific errors. Use when implementing or debugging CSV parsing, header/shape detection, field validation, duplicate IDs, quoted commas, multiline fields, or header-only manual files.
---

# Recon CSV Ingest

Parsing functions accept **CSV text** plus a display name (for example `ours.csv`) and do not read files. The CLI reads the files, and the API passes uploaded text to the same functions.

## Parsing

```ts
import { parse } from 'csv-parse/sync';

const rows = parse(text, {
  columns: true,        // objects keyed by header
  bom: true,
  skip_empty_lines: true,
  relax_column_count: false,
  info: true,           // gives info.lines for error locations
}) as { record: Record<string, string>; info: { lines: number } }[];
```

csv-parse handles quoted commas and multiline quoted fields. Do not split lines manually.

## Shapes

| Shape | Required header columns |
| --- | --- |
| Simple | `id,amount,timestamp,memo` |
| Extended | simple + `currency,quantity,price_per_share,fx_rate,party_email` |
| Manual | `ours_id,theirs_id` |

- Detect the shape from the header. A header with only some of the extended columns is an error.
- `ours` and `theirs` may use different shapes. How a simple record and an extended record match each other is a contract decision.
- A manual file with only a header, or with a header followed by blank lines, is valid and means there are no pins.
- An empty transaction file (no header) is an error. A header-only transaction file is valid and has zero records.

## Validation (collect all errors and report them together)

- `id`: non-empty and unique within its own file.
- `amount`, `price_per_share`: decimal strings (`^-?\d+(\.\d+)?$`). Whether to enforce exactly 2 decimal places is a contract decision.
- `fx_rate`: decimal. Whether to enforce 6 decimal places is a contract decision.
- `quantity`: integer string, kept within safe integer range.
- `timestamp`: strict ISO UTC (see `recon-domain-types`).
- `memo` may be empty. Extended string fields must be non-empty.
- Manual pins referring to missing IDs, duplicate pins, and conflicting pins are handled by the engine's manual-pin policy, not here. CSV parsing only checks structure.

## Error format

```ts
interface InputError { file: string; row?: number; field?: string; message: string }
// rendered: "ours.csv:4: amount: '12,5' is not a decimal"
```

`row` is the 1-based physical line from `info.lines`, so it still points at the right line when a record contains multiline fields. Throw one error that carries all collected `InputError`s.
