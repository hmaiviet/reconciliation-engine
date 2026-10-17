import {
  Decimal,
  ValidationError,
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
  const tiers: ((ours: Txn[], theirs: Txn[]) => Match[])[] = [
    matchExact,
    (o, t) => matchGroups(o, t, ruleIdentity, (go, gt) => matchTier('rule_based', go, gt, tolerances, () => [])),
    // D10: mixed shapes and differing quantities never match fuzzy. Cross-currency amounts are not comparable,
    // so fuzzyRank applies the amount tolerance itself.
    (o, t) =>
      matchGroups(o, t, (r) => r.extended?.quantity ?? null, (go, gt) =>
        matchTier('fuzzy', go, gt, { amount: new Decimal(Infinity), seconds: tolerances.seconds }, (a, b) => fuzzyRank(a, b, fuzzyAmount)),
      ),
  ];
  for (const tier of tiers) {
    const found = tier(restOurs, restTheirs);
    const used = new Set(found.flatMap((m) => [m.ours, m.theirs]));
    restOurs = restOurs.filter((t) => !used.has(t));
    restTheirs = restTheirs.filter((t) => !used.has(t));
    matches.push(...found);
  }

  return { matches, unmatchedOurs: restOurs, unmatchedTheirs: restTheirs, warnings };
}

// D2: exact requires every extended field to agree; a mixed-shape pair matches on amount and timestamp alone.
// Every exact candidate ranks equally, so D3 reduces to: each ours in id order takes the lowest-id compatible theirs.
// Records are hashed by value (decimal.js toString is canonical), so this is O(N log N) for the id sort instead of all pairs.
function matchExact(ours: Txn[], theirs: Txn[]): Match[] {
  const coarse = (t: Txn) => JSON.stringify([t.amount.toString(), t.timestamp.toString()]);
  const fields = ({ extended: e }: Txn) =>
    e && JSON.stringify([e.currency, e.partyEmail, e.quantity, e.pricePerShare.toString(), e.fxRate.toString()]);

  // Lists hold theirs in descending id order, so the lowest id is last and used records pop off lazily.
  const buckets = new Map<string, { all: Txn[]; simple: Txn[]; byFields: Map<string, Txn[]> }>();
  for (const t of [...theirs].sort((a, b) => compareIds(b.id, a.id))) {
    const key = coarse(t);
    const bucket = buckets.get(key) ?? { all: [], simple: [], byFields: new Map<string, Txn[]>() };
    buckets.set(key, bucket);
    bucket.all.push(t);
    const f = fields(t);
    if (!f) bucket.simple.push(t);
    else bucket.byFields.set(f, bucket.byFields.get(f) ?? []).get(f)!.push(t);
  }

  const used = new Set<Txn>();
  const lowest = (list: Txn[] | undefined) => {
    while (list?.length && used.has(list.at(-1)!)) list.pop();
    return list?.at(-1);
  };
  const matches: Match[] = [];
  for (const o of [...ours].sort((a, b) => compareIds(a.id, b.id))) {
    const bucket = buckets.get(coarse(o));
    if (!bucket) continue;
    const f = fields(o);
    const candidates = f ? [lowest(bucket.simple), lowest(bucket.byFields.get(f))] : [lowest(bucket.all)];
    const t = candidates.filter((c) => c !== undefined).sort((a, b) => compareIds(a.id, b.id))[0];
    if (!t) continue;
    used.add(t);
    matches.push({ kind: 'exact', ours: o, theirs: t });
  }
  return matches;
}

/** Matches each group on its own; valid when a tier never pairs records with different keys, since no candidate then competes across groups. */
function matchGroups(ours: Txn[], theirs: Txn[], key: (t: Txn) => unknown, match: (o: Txn[], t: Txn[]) => Match[]): Match[] {
  const groups = new Map<string, [Txn[], Txn[]]>();
  const group = (t: Txn) => {
    const k = JSON.stringify(key(t));
    return groups.get(k) ?? groups.set(k, [[], []]).get(k)!;
  };
  for (const o of ours) group(o)[0].push(o);
  for (const t of theirs) group(t)[1].push(t);
  return [...groups.values()].flatMap(([o, t]) => match(o, t));
}

// D2: rule-based requires identity fields to agree (price and fx may drift), so a mixed-shape pair never qualifies.
function ruleIdentity({ extended: e }: Txn) {
  return e ? [e.currency, e.partyEmail, e.quantity] : null;
}

/** Ranks within a tier before D3's diffs (lower first); null means the pair cannot match in that tier. */
type Rank = (o: Txn, t: Txn) => number[] | null;

// D10: memo at least 90% similar. Extended records need equal quantity; with equal currency, amounts within tolerance
// and a 90% similar party_email; with different currencies, an identical party_email and base values within tolerance.
// Same-currency pairs outrank cross-currency ones, then party_email, then memo. Mixed shapes never match.
// Cheap checks run before text distances, which dominate the tier's cost.
export function fuzzyRank(o: Txn, t: Txn, amountTol: Decimal): number[] | null {
  const a = o.extended;
  const b = t.extended;
  const amountClose = () => o.amount.minus(t.amount).abs().lte(amountTol);
  if (!a || !b) {
    const memo = !a && !b && amountClose() ? textDistance(texts(o).memo, texts(t).memo) : null;
    return memo === null ? null : [memo];
  }
  if (a.quantity !== b.quantity) return null;
  if (a.currency === b.currency) {
    if (!amountClose()) return null;
    const memo = textDistance(texts(o).memo, texts(t).memo);
    const email = memo === null ? null : textDistance(texts(o).email, texts(t).email);
    return email === null ? null : [0, email, memo!, 0];
  }
  if (a.partyEmail !== b.partyEmail) return null;
  // amount = quantity × price_per_share × fx_rate (as in every example row), so amount ÷ fx_rate is the shared base value.
  const baseDiff = o.amount.div(a.fxRate).minus(t.amount.div(b.fxRate)).abs();
  const memo = baseDiff.lte(amountTol) ? textDistance(texts(o).memo, texts(t).memo) : null;
  return memo === null ? null : [1, 0, memo, baseDiff.toNumber()];
}

const normalized = new WeakMap<Txn, { memo: string[]; email: string[] }>();

/** Memo and party_email as characters after trimming, lowercasing, and collapsing whitespace; computed once per record. */
function texts(t: Txn) {
  const clean = (s: string) => [...s.trim().replace(/\s+/g, ' ').toLowerCase()];
  let n = normalized.get(t);
  if (!n) normalized.set(t, (n = { memo: clean(t.raw.memo ?? ''), email: clean(t.extended?.partyEmail ?? '') }));
  return n;
}

/**
 * Edit distance (adjacent transpositions count as one edit) over the longer length, or null when above
 * MAX_TEXT_DISTANCE. Only cells within k of the diagonal can stay within k edits, so the rest are skipped,
 * and the scan stops once a whole row exceeds k.
 */
export function textDistance(a: string[], b: string[]): number | null {
  const longest = Math.max(a.length, b.length);
  // Two empty strings carry no evidence, so they count as fully different.
  if (!longest) return null;
  // ceil keeps the band at least as wide as needed; the exact ratio check below decides.
  const k = Math.ceil(longest * MAX_TEXT_DISTANCE);
  if (Math.abs(a.length - b.length) > k) return null;
  const far = k + 1;
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => Math.min(j, far));
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(far);
    row[0] = Math.min(i, far);
    let rowMin = row[0];
    for (let j = Math.max(1, i - k); j <= Math.min(b.length, i + k); j++) {
      let v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2]! + 1);
      row[j] = v = Math.min(v, far);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > k) return null;
    before = prev;
    prev = row;
  }
  const distance = prev[b.length]! / longest;
  return distance <= MAX_TEXT_DISTANCE ? distance : null;
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
