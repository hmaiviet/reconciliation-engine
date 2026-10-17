import {
  Decimal,
  ValidationError,
  type ExtendedFields,
  type InputError,
  type ManualPair,
  type Match,
  type MatchKind,
  type Txn,
} from './types.js';

export interface Tolerances {
  amount: Decimal;
  seconds: Decimal;
}

// D1
export const DEFAULT_TOLERANCES: Tolerances = { amount: new Decimal('0.01'), seconds: new Decimal('1') };
const ZERO: Tolerances = { amount: new Decimal(0), seconds: new Decimal(0) };

export interface ReconInput {
  ours: Txn[];
  theirs: Txn[];
  manual: ManualPair[];
  asOf: Decimal;
  tolerances?: Tolerances;
}

export interface ReconResult {
  matches: Match[];
  unmatchedOurs: Txn[];
  unmatchedTheirs: Txn[];
  /** Skipped manual pins (D4); errors carry no `file`, the caller knows which file the pins came from. */
  warnings: InputError[];
}

export function reconcile({ ours, theirs, manual, asOf, tolerances = DEFAULT_TOLERANCES }: ReconInput): ReconResult {
  const warnings: InputError[] = [];
  const matches = resolvePins(manual, ours, theirs, asOf, warnings);

  const pinned = new Set(matches.flatMap((m) => [m.ours, m.theirs]));
  let restOurs = ours.filter((t) => t.timestamp.lte(asOf) && !pinned.has(t));
  let restTheirs = theirs.filter((t) => t.timestamp.lte(asOf) && !pinned.has(t));

  const tiers: [MatchKind, Tolerances, (o: Txn, t: Txn) => boolean][] = [
    ['exact', ZERO, isExactCompatible],
    ['rule_based', tolerances, isRuleCompatible],
  ];
  for (const [kind, tol, compatible] of tiers) {
    const found = matchTier(kind, restOurs, restTheirs, tol, compatible);
    const used = new Set(found.flatMap((m) => [m.ours, m.theirs]));
    restOurs = restOurs.filter((t) => !used.has(t));
    restTheirs = restTheirs.filter((t) => !used.has(t));
    matches.push(...found);
  }

  return { matches, unmatchedOurs: restOurs, unmatchedTheirs: restTheirs, warnings };
}

// D2: exact requires every extended field to agree; a mixed-shape pair matches on amount and timestamp alone.
export function isExactCompatible(o: Txn, t: Txn): boolean {
  const a = o.extended;
  const b = t.extended;
  if (!a || !b) return true;
  return sameIdentity(a, b) && a.pricePerShare.eq(b.pricePerShare) && a.fxRate.eq(b.fxRate);
}

// D2: rule-based requires identity fields to agree (price and fx may drift), so a mixed-shape pair never qualifies.
export function isRuleCompatible(o: Txn, t: Txn): boolean {
  const a = o.extended;
  const b = t.extended;
  if (!a && !b) return true;
  return !!a && !!b && sameIdentity(a, b);
}

function sameIdentity(a: ExtendedFields, b: ExtendedFields): boolean {
  return a.currency === b.currency && a.partyEmail === b.partyEmail && a.quantity === b.quantity;
}

export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// D4
function resolvePins(manual: ManualPair[], ours: Txn[], theirs: Txn[], asOf: Decimal, warnings: InputError[]): Match[] {
  const unique = new Map<string, ManualPair>();
  for (const p of manual) {
    const key = JSON.stringify([p.oursId, p.theirsId]);
    if (!unique.has(key)) unique.set(key, p);
  }

  const errors: InputError[] = [];
  const byOurs = new Map<string, ManualPair>();
  const byTheirs = new Map<string, ManualPair>();
  for (const p of unique.values()) {
    const prevOurs = byOurs.get(p.oursId);
    const prevTheirs = byTheirs.get(p.theirsId);
    if (prevOurs) {
      errors.push({ row: p.row, message: `ours_id '${p.oursId}' is also pinned to '${prevOurs.theirsId}' on row ${prevOurs.row}` });
    }
    if (prevTheirs) {
      errors.push({ row: p.row, message: `theirs_id '${p.theirsId}' is also pinned to '${prevTheirs.oursId}' on row ${prevTheirs.row}` });
    }
    byOurs.set(p.oursId, prevOurs ?? p);
    byTheirs.set(p.theirsId, prevTheirs ?? p);
  }
  if (errors.length) throw new ValidationError(errors);

  const oursById = new Map(ours.map((t) => [t.id, t]));
  const theirsById = new Map(theirs.map((t) => [t.id, t]));
  const matches: Match[] = [];
  for (const p of unique.values()) {
    const o = oursById.get(p.oursId);
    const t = theirsById.get(p.theirsId);
    const problem = !o
      ? `ours_id '${p.oursId}' not found`
      : !t
        ? `theirs_id '${p.theirsId}' not found`
        : o.timestamp.gt(asOf)
          ? `ours '${o.id}' is after as_of`
          : t.timestamp.gt(asOf)
            ? `theirs '${t.id}' is after as_of`
            : null;
    if (problem || !o || !t) warnings.push({ row: p.row, message: `${problem}; pin skipped` });
    else matches.push({ kind: 'manual', ours: o, theirs: t });
  }
  return matches;
}

interface Candidate {
  ours: Txn;
  theirs: Txn;
  amountDiff: Decimal;
  timeDiff: Decimal;
}

// D3: rank all qualifying pairs globally, then take them greedily.
function matchTier(kind: MatchKind, ours: Txn[], theirs: Txn[], tol: Tolerances, compatible: (o: Txn, t: Txn) => boolean): Match[] {
  const byTime = [...theirs].sort((a, b) => a.timestamp.cmp(b.timestamp));
  const candidates: Candidate[] = [];
  for (const o of ours) {
    const latest = o.timestamp.plus(tol.seconds);
    for (let i = firstAtOrAfter(byTime, o.timestamp.minus(tol.seconds)); i < byTime.length; i++) {
      const t = byTime[i]!;
      if (t.timestamp.gt(latest)) break;
      const amountDiff = o.amount.minus(t.amount).abs();
      if (amountDiff.lte(tol.amount) && compatible(o, t)) {
        candidates.push({ ours: o, theirs: t, amountDiff, timeDiff: o.timestamp.minus(t.timestamp).abs() });
      }
    }
  }
  candidates.sort(
    (a, b) =>
      a.amountDiff.cmp(b.amountDiff) ||
      a.timeDiff.cmp(b.timeDiff) ||
      compareIds(a.ours.id, b.ours.id) ||
      compareIds(a.theirs.id, b.theirs.id),
  );

  const used = new Set<Txn>();
  const matches: Match[] = [];
  for (const c of candidates) {
    if (used.has(c.ours) || used.has(c.theirs)) continue;
    used.add(c.ours).add(c.theirs);
    matches.push({ kind, ours: c.ours, theirs: c.theirs });
  }
  return matches;
}

function firstAtOrAfter(sorted: Txn[], time: Decimal): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.timestamp.lt(time)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
