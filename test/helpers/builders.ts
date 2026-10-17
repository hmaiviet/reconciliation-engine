import { expect } from 'vitest';
import { DEFAULT_TOLERANCES, reconcile, type ReconResult, type Tolerances } from '../../src/domain/reconcile.js';
import { Decimal, parseTimestamp, type MatchKind, type Txn } from '../../src/domain/types.js';

export const T0 = '2026-01-01T10:00:00.000Z';
export const AS_OF = '2026-01-01T23:59:59.999Z';

interface SimpleFields {
  amount: string;
  timestamp: string;
  memo: string;
}

interface ExtendedInput extends SimpleFields {
  currency: string;
  quantity: string;
  price_per_share: string;
  fx_rate: string;
  party_email: string;
}

function instant(text: string) {
  const ts = parseTimestamp(text);
  if (!ts) throw new Error(`bad test timestamp ${text}`);
  return ts;
}

/** A simple-shape record; decimals and timestamps are strings, as in CSV. */
export function txn(id: string, fields: Partial<SimpleFields> = {}): Txn {
  const raw = { id, amount: '100.00', timestamp: T0, memo: '', ...fields };
  return { id, amount: new Decimal(raw.amount), timestamp: instant(raw.timestamp), raw };
}

/** An extended-shape record with defaults USD, 1 × 100.00, fx 1.000000, a@x.com. */
export function ext(id: string, fields: Partial<ExtendedInput> = {}): Txn {
  const raw = {
    id,
    amount: '100.00',
    timestamp: T0,
    memo: '',
    currency: 'USD',
    quantity: '1',
    price_per_share: '100.00',
    fx_rate: '1.000000',
    party_email: 'a@x.com',
    ...fields,
  };
  return {
    id,
    amount: new Decimal(raw.amount),
    timestamp: instant(raw.timestamp),
    raw,
    extended: {
      currency: raw.currency,
      quantity: Number(raw.quantity),
      pricePerShare: new Decimal(raw.price_per_share),
      fxRate: new Decimal(raw.fx_rate),
      partyEmail: raw.party_email,
    },
  };
}

export interface Scenario {
  ours: Txn[];
  theirs: Txn[];
  manual?: [string, string][];
  asOf?: string;
  tolerances?: Partial<{ amount: string; seconds: string }>;
}

/** Runs the engine and checks the invariants on every call. */
export function run(s: Scenario): ReconResult {
  const asOf = instant(s.asOf ?? AS_OF);
  const tolerances: Tolerances = {
    amount: s.tolerances?.amount ? new Decimal(s.tolerances.amount) : DEFAULT_TOLERANCES.amount,
    seconds: s.tolerances?.seconds ? new Decimal(s.tolerances.seconds) : DEFAULT_TOLERANCES.seconds,
  };
  const manual = (s.manual ?? []).map(([oursId, theirsId], i) => ({ oursId, theirsId, row: i + 2 }));
  const result = reconcile({ ours: s.ours, theirs: s.theirs, manual, asOf, tolerances });
  expectInvariants(s, result);
  return result;
}

const KIND_RANK: MatchKind[] = ['manual', 'exact', 'rule_based', 'fuzzy'];

/** Matches as [kind, ours_id, theirs_id], in report order. */
export function pairs(result: ReconResult): [MatchKind, string, string][] {
  return result.matches
    .map((m): [MatchKind, string, string] => [m.kind, m.ours.id, m.theirs.id])
    .sort((a, b) => KIND_RANK.indexOf(a[0]) - KIND_RANK.indexOf(b[0]) || (a[1] < b[1] ? -1 : 1));
}

export function unmatched(result: ReconResult): { ours: string[]; theirs: string[] } {
  return {
    ours: result.unmatchedOurs.map((t) => t.id).sort(),
    theirs: result.unmatchedTheirs.map((t) => t.id).sort(),
  };
}

/** Every eligible record appears exactly once; nothing after as_of appears at all. */
export function expectInvariants(s: Scenario, result: ReconResult): void {
  const asOf = instant(s.asOf ?? AS_OF);
  for (const side of ['ours', 'theirs'] as const) {
    const seen = [
      ...result.matches.map((m) => m[side].id),
      ...(side === 'ours' ? result.unmatchedOurs : result.unmatchedTheirs).map((t) => t.id),
    ].sort();
    const eligible = s[side].filter((t) => t.timestamp.lte(asOf)).map((t) => t.id).sort();
    expect(seen, `${side}: every eligible record exactly once`).toEqual(eligible);
  }
}
