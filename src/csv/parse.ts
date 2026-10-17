import { CsvError, parse } from 'csv-parse/sync';
import { Decimal, ValidationError, parseTimestamp, type InputError, type ManualPair, type Txn } from '../domain/types.js';

const BASE = ['id', 'amount', 'timestamp'];
const EXTENDED = ['currency', 'quantity', 'price_per_share', 'fx_rate', 'party_email'];
const INTEGER = /^-?\d+$/;

// D7: decimal places are enforced as the assignment specifies.
const PLACES = { amount: 2, price_per_share: 2, fx_rate: 6 } as const;

interface Row {
  line: number;
  values: Record<string, string>;
}

/** Parses CSV text into header-keyed rows; throws ValidationError for structural problems. */
function readRows(text: string, file: string, required: string[]): { header: string[]; rows: Row[] } {
  let records: { record: string[]; info: { lines: number; empty_lines: number } }[];
  try {
    records = parse(text, { bom: true, info: true, skip_empty_lines: true, trim: true }) as unknown as typeof records;
  } catch (e) {
    if (e instanceof CsvError) {
      throw new ValidationError([{ file, row: typeof e.lines === 'number' ? e.lines : undefined, message: e.message }]);
    }
    throw e;
  }
  const [first, ...rest] = records;
  if (!first) throw new ValidationError([{ file, message: 'file is empty; expected a header row' }]);

  const header = first.record;
  const missing = required.filter((c) => !header.includes(c));
  const duplicated = header.filter((c, i) => header.indexOf(c) !== i);
  const errors: InputError[] = [
    ...missing.map((c) => ({ file, row: 1, message: `missing column '${c}'` })),
    ...duplicated.map((c) => ({ file, row: 1, message: `duplicate column '${c}'` })),
  ];
  if (errors.length) throw new ValidationError(errors);

  // info.lines is where a record ends; a multiline record starts after the previous record and any skipped blank lines.
  let prev = first.info;
  const rows = rest.map(({ record, info }) => {
    const line = prev.lines + (info.empty_lines - prev.empty_lines) + 1;
    prev = info;
    return { line, values: Object.fromEntries(header.map((c, i) => [c, record[i] ?? ''])) };
  });
  return { header, rows };
}

export function parseTransactions(text: string, file: string): Txn[] {
  const { header, rows: rawRows } = readRows(text, file, BASE);
  const present = EXTENDED.filter((c) => header.includes(c));
  if (present.length > 0 && present.length < EXTENDED.length) {
    const missing = EXTENDED.filter((c) => !header.includes(c)).join(', ');
    throw new ValidationError([{ file, row: 1, message: `extended columns must appear together; missing ${missing}` }]);
  }
  const extended = present.length > 0;

  const errors: InputError[] = [];
  const seen = new Map<string, number>();
  const txns: Txn[] = [];
  for (const { line, values } of rawRows) {
    const fail = (field: string, message: string) => errors.push({ file, row: line, field, message });
    const decimal = (field: keyof typeof PLACES) => {
      const v = values[field] ?? '';
      const places = PLACES[field];
      if (new RegExp(`^-?\\d+\\.\\d{${places}}$`).test(v)) return new Decimal(v);
      fail(field, `'${v}' is not a decimal with exactly ${places} decimal places`);
      return null;
    };
    const text = (field: string) => {
      const v = values[field] ?? '';
      if (!v) fail(field, 'must not be empty');
      return v;
    };

    const id = text('id');
    const prev = seen.get(id);
    if (id && prev !== undefined) fail('id', `'${id}' duplicates row ${prev}`);
    seen.set(id, line);

    const amount = decimal('amount');
    const timestamp = parseTimestamp(values.timestamp ?? '');
    if (!timestamp) fail('timestamp', `'${values.timestamp}' is not YYYY-MM-DDTHH:MM:SS[.fraction]Z`);

    let ext: Txn['extended'];
    if (extended) {
      const q = values.quantity ?? '';
      const quantity = INTEGER.test(q) ? Number(q) : NaN;
      if (!Number.isSafeInteger(quantity)) fail('quantity', `'${q}' is not an integer`);
      const pricePerShare = decimal('price_per_share');
      const fxRate = decimal('fx_rate');
      const currency = text('currency');
      const partyEmail = text('party_email');
      if (pricePerShare && fxRate) ext = { currency, quantity, pricePerShare, fxRate, partyEmail };
    }

    if (amount && timestamp) txns.push({ id, amount, timestamp, raw: values, ...(ext && { extended: ext }) });
  }
  if (errors.length) throw new ValidationError(errors);
  return txns;
}

export function parseManual(text: string, file: string): ManualPair[] {
  const { rows } = readRows(text, file, ['ours_id', 'theirs_id']);
  const errors: InputError[] = [];
  const pairs = rows.map(({ line, values }) => {
    for (const field of ['ours_id', 'theirs_id']) {
      if (!values[field]) errors.push({ file, row: line, field, message: 'must not be empty' });
    }
    return { oursId: values.ours_id ?? '', theirsId: values.theirs_id ?? '', row: line };
  });
  if (errors.length) throw new ValidationError(errors);
  return pairs;
}
