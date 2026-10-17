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
// D10: never narrower than the rule-based amount tolerance; time uses the rule-based tolerance.
const FUZZY_AMOUNT = new Decimal('0.05');
const MAX_TEXT_DISTANCE = 0.1;

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

  const fuzzyAmount = Decimal.max(FUZZY_AMOUNT, tolerances.amount);
  const tiers: [MatchKind, Tolerances, Rank][] = [
    ['exact', ZERO, (o, t) => (isExactCompatible(o, t) ? [] : null)],
    ['rule_based', tolerances, (o, t) => (isRuleCompatible(o, t) ? [] : null)],
    // Cross-currency amounts are not comparable, so fuzzyRank applies the amount tolerance itself.
    ['fuzzy', { amount: new Decimal(Infinity), seconds: tolerances.seconds }, (o, t) => fuzzyRank(o, t, fuzzyAmount)],
  ];
  for (const [kind, tol, rank] of tiers) {
    const found = matchTier(kind, restOurs, restTheirs, tol, rank);
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

/** Ranks within a tier before D3's diffs (lower first); null means the pair cannot match in that tier. */
type Rank = (o: Txn, t: Txn) => number[] | null;

// D10: memo at least 90% similar. Extended records need equal quantity; with equal currency, amounts within tolerance
// and a 90% similar party_email; with different currencies, an identical party_email and base values within tolerance.
// Same-currency pairs outrank cross-currency ones, then party_email, then memo. Mixed shapes never match.
export function fuzzyRank(o: Txn, t: Txn, amountTol: Decimal): number[] | null {
  const memo = textDistance(o.raw.memo ?? '', t.raw.memo ?? '');
  if (memo > MAX_TEXT_DISTANCE) return null;
  const amountClose = o.amount.minus(t.amount).abs().lte(amountTol);
  const a = o.extended;
  const b = t.extended;
  if (!a && !b) return amountClose ? [memo] : null;
  if (!a || !b || a.quantity !== b.quantity) return null;
  if (a.currency === b.currency) {
    const email = textDistance(a.partyEmail, b.partyEmail);
    return amountClose && email <= MAX_TEXT_DISTANCE ? [0, email, memo, 0] : null;
  }
  // amount = quantity × price_per_share × fx_rate (as in every example row), so amount ÷ fx_rate is the shared base value.
  const baseDiff = o.amount.div(a.fxRate).minus(t.amount.div(b.fxRate)).abs();
  return a.partyEmail === b.partyEmail && baseDiff.lte(amountTol) ? [1, 0, memo, baseDiff.toNumber()] : null;
}

/** Edit distance (adjacent transpositions count as one edit) over the longer length, after trimming, lowercasing, and collapsing whitespace. */
export function textDistance(x: string, y: string): number {
  const a = [...x.trim().replace(/\s+/g, ' ').toLowerCase()];
  const b = [...y.trim().replace(/\s+/g, ' ').toLowerCase()];
  // Two empty strings carry no evidence, so they count as fully different.
  if (!a.length && !b.length) return 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++) {
    const row = d[i]!;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(d[i - 1]![j]! + 1, row[j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]! / Math.max(a.length, b.length);
}

export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// D4: dedupe, skip pins that cannot apply (with warnings), then fail on conflicts among the rest.
function resolvePins(manual: ManualPair[], ours: Txn[], theirs: Txn[], asOf: Decimal, warnings: InputError[]): Match[] {
  const unique = new Map<string, ManualPair>();
  for (const p of manual) {
    const key = JSON.stringify([p.oursId, p.theirsId]);
    if (!unique.has(key)) unique.set(key, p);
  }

  const oursById = new Map(ours.map((t) => [t.id, t]));
  const theirsById = new Map(theirs.map((t) => [t.id, t]));
  const valid: { pin: ManualPair; ours: Txn; theirs: Txn }[] = [];
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
    else valid.push({ pin: p, ours: o, theirs: t });
  }

  const errors: InputError[] = [];
  const byOurs = new Map<string, ManualPair>();
  const byTheirs = new Map<string, ManualPair>();
  for (const { pin: p } of valid) {
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

  return valid.map((v) => ({ kind: 'manual', ours: v.ours, theirs: v.theirs }));
}

interface Candidate {
  ours: Txn;
  theirs: Txn;
  rank: number[];
  amountDiff: Decimal;
  timeDiff: Decimal;
}

// D3: rank all qualifying pairs globally, then take them greedily.
function matchTier(kind: MatchKind, ours: Txn[], theirs: Txn[], tol: Tolerances, rankOf: Rank): Match[] {
  const byTime = [...theirs].sort((a, b) => a.timestamp.cmp(b.timestamp));
  const candidates: Candidate[] = [];
  for (const o of ours) {
    const latest = o.timestamp.plus(tol.seconds);
    for (let i = firstAtOrAfter(byTime, o.timestamp.minus(tol.seconds)); i < byTime.length; i++) {
      const t = byTime[i]!;
      if (t.timestamp.gt(latest)) break;
      const amountDiff = o.amount.minus(t.amount).abs();
      const rank = amountDiff.lte(tol.amount) ? rankOf(o, t) : null;
      if (rank) candidates.push({ ours: o, theirs: t, rank, amountDiff, timeDiff: o.timestamp.minus(t.timestamp).abs() });
    }
  }
  candidates.sort(
    (a, b) =>
      compareRanks(a.rank, b.rank) ||
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

function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
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
