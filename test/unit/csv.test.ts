import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatManual } from '../../src/csv/format.js';
import { parseManual, parseTransactions } from '../../src/csv/parse.js';
import { ValidationError, parseTimestamp, type Txn } from '../../src/domain/types.js';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '../fixtures/csv', name), 'utf8');
const txns = (name: string) => parseTransactions(fixture(name), name);

function errorsOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationError) return e.errors;
    throw e;
  }
  throw new Error('expected a ValidationError');
}

const view = (t: Txn) => ({
  id: t.id,
  amount: t.amount.toFixed(2),
  timestamp: t.timestamp.eq(parseTimestamp(t.raw.timestamp ?? '')!),
  extended: t.extended && {
    ...t.extended,
    pricePerShare: t.extended.pricePerShare.toFixed(2),
    fxRate: t.extended.fxRate.toFixed(6),
  },
});

describe('CSV transactions: valid input', () => {
  it('csv: quoted commas, multiline memos, blank lines, negative and zero amounts', () => {
    const parsed = txns('simple_quoted.csv');
    expect(parsed.map(view)).toEqual([
      { id: 'o-1', amount: '100.00', timestamp: true, extended: undefined },
      { id: 'o-2', amount: '-5.10', timestamp: true, extended: undefined },
      { id: 'o-3', amount: '0.00', timestamp: true, extended: undefined },
    ]);
    expect(parsed.map((t) => t.raw.memo)).toEqual(['coffee, large', 'multi\nline memo', '']);
  });

  it('csv: extended shape parses all five fields; price 0.00 is allowed (D7)', () => {
    expect(txns('extended.csv').map(view)).toEqual([
      {
        id: 't-1',
        amount: '1000.00',
        timestamp: true,
        extended: { currency: 'USD', quantity: 100, pricePerShare: '10.00', fxRate: '1.000000', partyEmail: 'alice@acme.com' },
      },
      {
        id: 't-2',
        amount: '0.00',
        timestamp: true,
        extended: { currency: 'EUR', quantity: 1, pricePerShare: '0.00', fxRate: '0.912345', partyEmail: 'bob@acme.com' },
      },
    ]);
  });

  it('csv: header-only file has zero records', () => {
    expect(txns('header_only.csv')).toEqual([]);
  });

  it('csv: BOM, reordered columns, unknown columns, and no memo column are accepted (D7)', () => {
    const [t] = txns('bom_reordered_no_memo.csv');
    expect(view(t!)).toEqual({ id: 'x-1', amount: '12.34', timestamp: true, extended: undefined });
  });
});

describe('CSV transactions: structural errors', () => {
  it('csv: empty (0-byte) transaction file is an error (D7)', () => {
    expect(errorsOf(() => txns('empty.csv'))).toEqual([{ file: 'empty.csv', message: 'file is empty; expected a header row' }]);
  });

  it('csv: missing required column', () => {
    expect(errorsOf(() => txns('missing_column.csv'))).toEqual([{ file: 'missing_column.csv', row: 1, message: "missing column 'timestamp'" }]);
  });

  it('csv: duplicate column', () => {
    expect(errorsOf(() => txns('duplicate_column.csv'))).toEqual([{ file: 'duplicate_column.csv', row: 1, message: "duplicate column 'amount'" }]);
  });

  it('csv: partial extended header is an error (all five or none)', () => {
    expect(errorsOf(() => txns('partial_extended_header.csv'))).toEqual([
      {
        file: 'partial_extended_header.csv',
        row: 1,
        message: 'extended columns must appear together; missing quantity, price_per_share, fx_rate, party_email',
      },
    ]);
  });

  it('csv: row with the wrong number of fields (unquoted comma) is an error', () => {
    expect(errorsOf(() => txns('ragged.csv'))).toEqual([
      { file: 'ragged.csv', row: 2, message: expect.stringContaining('Invalid Record Length') },
    ]);
  });
});

describe('CSV transactions: field validation (D7)', () => {
  it('csv: every invalid simple field is reported with file, start row, and field', () => {
    const f = 'invalid_simple.csv';
    const ts = 'is not YYYY-MM-DDTHH:MM:SS[.fraction]Z with at most 9 fractional digits';
    const places = 'is not a decimal with exactly 2 decimal places';
    expect(errorsOf(() => txns(f))).toEqual([
      { file: f, row: 2, field: 'amount', message: `'100' ${places}` },
      { file: f, row: 3, field: 'amount', message: `'100.000' ${places}` },
      { file: f, row: 4, field: 'amount', message: `'1e2' ${places}` },
      { file: f, row: 5, field: 'timestamp', message: `'2026-01-01T10:00:00+01:00' ${ts}` },
      { file: f, row: 6, field: 'timestamp', message: `'2026-02-30T10:00:00.000Z' ${ts}` },
      { file: f, row: 7, field: 'timestamp', message: `'2026-01-01T10:00:00.000' ${ts}` },
      { file: f, row: 8, field: 'id', message: 'must not be empty' },
      { file: f, row: 9, field: 'id', message: "'a-1' duplicates row 2" },
      { file: f, row: 10, field: 'amount', message: `'12,50' ${places}` },
      { file: f, row: 12, field: 'amount', message: `'abc' ${places}` },
    ]);
  });

  it('csv: every invalid extended field is reported, including sign rules', () => {
    const f = 'invalid_extended.csv';
    expect(errorsOf(() => txns(f))).toEqual([
      { file: f, row: 2, field: 'quantity', message: "'0' must be positive" },
      { file: f, row: 3, field: 'quantity', message: "'-5' must be positive" },
      { file: f, row: 4, field: 'quantity', message: "'1.5' is not an integer" },
      { file: f, row: 5, field: 'quantity', message: "'9007199254740993' is not an integer" },
      { file: f, row: 6, field: 'price_per_share', message: "'-1.00' must not be negative" },
      { file: f, row: 7, field: 'price_per_share', message: "'10.0' is not a decimal with exactly 2 decimal places" },
      { file: f, row: 8, field: 'fx_rate', message: "'0.000000' must be positive" },
      { file: f, row: 9, field: 'fx_rate', message: "'-1.000000' must be positive" },
      { file: f, row: 10, field: 'fx_rate', message: "'1.0' is not a decimal with exactly 6 decimal places" },
      { file: f, row: 11, field: 'currency', message: 'must not be empty' },
      { file: f, row: 11, field: 'party_email', message: 'must not be empty' },
    ]);
  });
});

describe('CSV manual pins', () => {
  it('manual: pins carry their physical row numbers', () => {
    expect(parseManual(fixture('manual_pins.csv'), 'manual.csv')).toEqual([
      { oursId: 'o-1', theirsId: 't-1', row: 2 },
      { oursId: 'o-2', theirsId: 't-2', row: 4 },
    ]);
  });

  it('manual: header-only file means no pins', () => {
    expect(parseManual(fixture('manual_header_only.csv'), 'manual.csv')).toEqual([]);
  });

  it('manual: 0-byte file means no pins (D7)', () => {
    expect(parseManual(fixture('empty.csv'), 'manual.csv')).toEqual([]);
  });

  it('manual: missing column is an error', () => {
    expect(errorsOf(() => parseManual(fixture('manual_missing_column.csv'), 'manual.csv'))).toEqual([
      { file: 'manual.csv', row: 1, message: "missing column 'theirs_id'" },
    ]);
  });

  it('manual: formatManual output parses back to the same pins, including commas and quotes in ids', () => {
    const pins = [
      { ours_id: 'o-1', theirs_id: 't-1' },
      { ours_id: 'o,2', theirs_id: 't "2"' },
    ];
    const text = formatManual(pins);
    expect(text).toBe('ours_id,theirs_id\no-1,t-1\n"o,2","t ""2"""\n');
    expect(parseManual(text, 'manual.csv').map((p) => ({ ours_id: p.oursId, theirs_id: p.theirsId }))).toEqual(pins);
  });

  it('manual: formatManual with no pins writes a header-only file', () => {
    expect(formatManual([])).toBe('ours_id,theirs_id\n');
  });

  it('manual: empty ids are errors', () => {
    expect(errorsOf(() => parseManual(fixture('manual_empty_field.csv'), 'manual.csv'))).toEqual([
      { file: 'manual.csv', row: 2, field: 'theirs_id', message: 'must not be empty' },
      { file: 'manual.csv', row: 3, field: 'ours_id', message: 'must not be empty' },
    ]);
  });
});
