import type { PinRow } from './csv/format.js';
import { parseManual, parseTransactions } from './csv/parse.js';
import { DEFAULT_TOLERANCES, reconcile } from './domain/reconcile.js';
import { Decimal, ValidationError, parseTimestamp, type InputError } from './domain/types.js';
import { buildReport, echoAll, type Echo, type Report } from './report/report.js';

const AS_OF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{3}))?Z$/;
const NON_NEGATIVE = /^\d+(\.\d+)?$/;

/** D7: exactly `YYYY-MM-DDTHH:MM:SS[.sss]Z`; also returns the millisecond form used in the report (D5). */
export function parseAsOf(text: string): { instant: Decimal; normalized: string } | null {
  const m = AS_OF.exec(text);
  const instant = m && parseTimestamp(text);
  return instant ? { instant, normalized: `${text.slice(0, 19)}.${m[1] ?? '000'}Z` } : null;
}

export function parseTolerance(text: string): Decimal | null {
  return NON_NEGATIVE.test(text) ? new Decimal(text) : null;
}

export interface CsvInput {
  /** Shown in error locations, e.g. `ours.csv:4: amount: ...`. */
  name: string;
  text: string;
}

export interface ReconcileRequest {
  ours: CsvInput;
  theirs: CsvInput;
  manual: CsvInput;
  asOf: string;
  tolerances?: { amount?: string; seconds?: string };
}

export interface ReconcileOutput {
  /** Identical to the CLI's report.json. */
  report: Report;
  /** Skipped manual pins (D4). */
  warnings: InputError[];
  tolerances: { amount: string; seconds: string };
  /** Every eligible record, echoed per D6 plus `memo` when present, sorted by id. */
  records: { ours: Echo[]; theirs: Echo[] };
  /** The pins read from `manual`, without identical duplicates. */
  pins: PinRow[];
}

/** CSV text in, report out; throws ValidationError listing every input problem. Shared by the CLI and the API. */
export function runReconciliation(req: ReconcileRequest): ReconcileOutput {
  const errors: InputError[] = [];
  const asOf = parseAsOf(req.asOf);
  if (!asOf) errors.push({ field: 'as_of', message: `'${req.asOf}' is not a valid YYYY-MM-DDTHH:MM:SS[.sss]Z timestamp` });

  const tolText = {
    amount: req.tolerances?.amount ?? DEFAULT_TOLERANCES.amount.toString(),
    seconds: req.tolerances?.seconds ?? DEFAULT_TOLERANCES.seconds.toString(),
  };
  const amount = parseTolerance(tolText.amount);
  const seconds = parseTolerance(tolText.seconds);
  if (!amount) errors.push({ field: 'tolerances.amount', message: `'${tolText.amount}' must be a non-negative decimal` });
  if (!seconds) errors.push({ field: 'tolerances.seconds', message: `'${tolText.seconds}' must be a non-negative decimal` });

  const attempt = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      errors.push(...e.errors);
      return undefined;
    }
  };
  const ours = attempt(() => parseTransactions(req.ours.text, req.ours.name));
  const theirs = attempt(() => parseTransactions(req.theirs.text, req.theirs.name));
  const manual = attempt(() => parseManual(req.manual.text, req.manual.name));
  if (!asOf || !amount || !seconds || !ours || !theirs || !manual) throw new ValidationError(errors);

  const result = attempt(() => reconcile({ ours, theirs, manual, asOf: asOf.instant, tolerances: { amount, seconds } }));
  const withFile = (e: InputError) => ({ file: req.manual.name, ...e });
  if (!result) throw new ValidationError(errors.map(withFile));

  const pins = [...new Map(manual.map((p) => [JSON.stringify([p.oursId, p.theirsId]), { ours_id: p.oursId, theirs_id: p.theirsId }])).values()];

  return {
    report: buildReport(result, asOf.normalized),
    warnings: result.warnings.map(withFile),
    tolerances: tolText,
    records: {
      ours: echoAll([...result.matches.map((m) => m.ours), ...result.unmatchedOurs], true),
      theirs: echoAll([...result.matches.map((m) => m.theirs), ...result.unmatchedTheirs], true),
    },
    pins,
  };
}
