import { Decimal } from 'decimal.js';

// D5: rounding only happens when formatting the report; 40 digits keeps epoch seconds with sub-ns fractions exact.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type MatchKind = 'manual' | 'exact' | 'rule_based' | 'fuzzy';

export interface ExtendedFields {
  currency: string;
  quantity: number;
  pricePerShare: Decimal;
  fxRate: Decimal;
  partyEmail: string;
}

export interface Txn {
  id: string;
  amount: Decimal;
  /** Epoch seconds at full input precision. */
  timestamp: Decimal;
  /** Original CSV strings, echoed for unmatched records. */
  raw: Record<string, string>;
  extended?: ExtendedFields;
}

export interface ManualPair {
  oursId: string;
  theirsId: string;
  row: number;
}

export interface Match {
  kind: MatchKind;
  ours: Txn;
  theirs: Txn;
}

export interface InputError {
  file?: string;
  row?: number;
  field?: string;
  message: string;
}

export class ValidationError extends Error {
  constructor(readonly errors: InputError[]) {
    super(errors.map(formatInputError).join('\n'));
  }
}

export function formatInputError(e: InputError): string {
  const where = [e.file, e.row].filter((x) => x !== undefined).join(':');
  return [where, e.field, e.message].filter(Boolean).join(': ');
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Parses `YYYY-MM-DDTHH:MM:SS[.fraction]Z` to epoch seconds without losing precision; null if invalid. */
export function parseTimestamp(text: string): Decimal | null {
  const m = TIMESTAMP.exec(text);
  if (!m) return null;
  const whole = text.slice(0, 19);
  const ms = Date.parse(`${whole}Z`);
  // Date.parse rolls over impossible dates (e.g. Feb 30); the round trip rejects them.
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 19) !== whole) return null;
  return new Decimal(ms / 1000).plus(m[1] ? `0${m[1]}` : 0);
}
