import { compareIds, type ReconResult } from '../domain/reconcile.js';
import type { Decimal, MatchKind, Txn } from '../domain/types.js';

const KIND_ORDER: MatchKind[] = ['manual', 'exact', 'rule_based', 'fuzzy'];

export interface Report {
  as_of: string;
  summary: {
    matched_manual: number;
    matched_exact: number;
    matched_rule_based: number;
    matched_fuzzy: number;
    unmatched_ours: number;
    unmatched_theirs: number;
  };
  matches: { kind: MatchKind; ours_id: string; theirs_id: string; amount_diff: string; timestamp_diff_seconds: string }[];
  unmatched_ours: Record<string, string | number>[];
  unmatched_theirs: Record<string, string | number>[];
}

/** `asOf` must already be in normalized `...:SS.sssZ` form (D5). */
export function buildReport(result: ReconResult, asOf: string): Report {
  const count = (kind: MatchKind) => result.matches.filter((m) => m.kind === kind).length;
  const matches = [...result.matches]
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || compareIds(a.ours.id, b.ours.id))
    .map((m) => ({
      kind: m.kind,
      ours_id: m.ours.id,
      theirs_id: m.theirs.id,
      amount_diff: fixed(m.ours.amount.minus(m.theirs.amount), 2),
      timestamp_diff_seconds: fixed(m.ours.timestamp.minus(m.theirs.timestamp), 3),
    }));

  return {
    as_of: asOf,
    summary: {
      matched_manual: count('manual'),
      matched_exact: count('exact'),
      matched_rule_based: count('rule_based'),
      matched_fuzzy: count('fuzzy'),
      unmatched_ours: result.unmatchedOurs.length,
      unmatched_theirs: result.unmatchedTheirs.length,
    },
    matches,
    unmatched_ours: echoAll(result.unmatchedOurs),
    unmatched_theirs: echoAll(result.unmatchedTheirs),
  };
}

export function serializeReport(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

// D5: round half-up, never print negative zero.
function fixed(value: Decimal, places: number): string {
  const rounded = value.toDecimalPlaces(places);
  return (rounded.isZero() ? rounded.abs() : rounded).toFixed(places);
}

// D6: original strings, no memo, quantity as a number.
function echoAll(txns: Txn[]): Record<string, string | number>[] {
  return [...txns]
    .sort((a, b) => compareIds(a.id, b.id))
    .map((t) => {
      const r = t.raw;
      const base = { id: t.id, amount: r.amount ?? '', timestamp: r.timestamp ?? '' };
      if (!t.extended) return base;
      return {
        ...base,
        currency: t.extended.currency,
        quantity: t.extended.quantity,
        price_per_share: r.price_per_share ?? '',
        fx_rate: r.fx_rate ?? '',
        party_email: t.extended.partyEmail,
      };
    });
}
