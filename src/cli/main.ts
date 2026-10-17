#!/usr/bin/env node
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseManual, parseTransactions } from '../csv/parse.js';
import { DEFAULT_TOLERANCES, reconcile } from '../domain/reconcile.js';
import { Decimal, ValidationError, formatInputError, parseTimestamp, type InputError } from '../domain/types.js';
import { buildReport, serializeReport, type Report } from '../report/report.js';

const USAGE = `Usage: recon run --ours OURS.csv --theirs THEIRS.csv --manual MANUAL.csv \\
                --as-of YYYY-MM-DDTHH:MM:SS[.sss]Z --output REPORT.json

Options:
  --amount-tolerance N         rule-based max |amount diff| (default ${DEFAULT_TOLERANCES.amount})
  --time-tolerance-seconds N   rule-based max |timestamp diff| in seconds (default ${DEFAULT_TOLERANCES.seconds})
  -h, --help                   show this help

Exit codes: 0 report written, 1 invalid input, 2 usage error.`;

const REQUIRED = ['ours', 'theirs', 'manual', 'as-of', 'output'] as const;
const AS_OF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{3}))?Z$/;
const NON_NEGATIVE = /^\d+(\.\d+)?$/;

const EXIT_OK = 0;
const EXIT_INPUT = 1;
const EXIT_USAGE = 2;

function usageError(message: string): number {
  process.stderr.write(`error: ${message}\n\n${USAGE}\n`);
  return EXIT_USAGE;
}

function inputErrors(errors: InputError[]): number {
  for (const e of errors) process.stderr.write(`error: ${formatInputError(e)}\n`);
  return EXIT_INPUT;
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        ours: { type: 'string' },
        theirs: { type: 'string' },
        manual: { type: 'string' },
        'as-of': { type: 'string' },
        output: { type: 'string' },
        'amount-tolerance': { type: 'string' },
        'time-tolerance-seconds': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    return usageError((e as Error).message);
  }
  const { values: opts, positionals } = parsed;
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT_OK;
  }
  if (positionals.length !== 1 || positionals[0] !== 'run') {
    return usageError(positionals.length ? `unknown command '${positionals.join(' ')}'` : "missing command 'run'");
  }
  const missing = REQUIRED.filter((f) => opts[f] === undefined);
  if (missing.length) return usageError(`missing ${missing.map((f) => `--${f}`).join(', ')}`);
  const { ours: oursPath, theirs: theirsPath, manual: manualPath, output } = opts as Record<(typeof REQUIRED)[number], string>;

  const asOfText = opts['as-of'] ?? '';
  const asOfMatch = AS_OF.exec(asOfText);
  const asOf = asOfMatch && parseTimestamp(asOfText);
  if (!asOfMatch || !asOf) return usageError(`--as-of '${asOfText}' is not a valid YYYY-MM-DDTHH:MM:SS[.sss]Z timestamp`);
  const asOfNormalized = `${asOfText.slice(0, 19)}.${asOfMatch[1] ?? '000'}Z`;

  const tolerances = { ...DEFAULT_TOLERANCES };
  for (const [flag, key] of [['amount-tolerance', 'amount'], ['time-tolerance-seconds', 'seconds']] as const) {
    const v = opts[flag];
    if (v === undefined) continue;
    if (!NON_NEGATIVE.test(v)) return usageError(`--${flag} '${v}' must be a non-negative decimal`);
    tolerances[key] = new Decimal(v);
  }

  const read = async (path: string) => readFile(resolve(process.cwd(), path), 'utf8');
  let texts: string[];
  try {
    texts = await Promise.all([oursPath, theirsPath, manualPath].map(read));
  } catch (e) {
    return inputErrors([{ message: `cannot read input: ${(e as Error).message}` }]);
  }
  const [oursText = '', theirsText = '', manualText = ''] = texts;

  const errors: InputError[] = [];
  const attempt = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      errors.push(...e.errors);
      return undefined;
    }
  };
  const ours = attempt(() => parseTransactions(oursText, oursPath));
  const theirs = attempt(() => parseTransactions(theirsText, theirsPath));
  const manual = attempt(() => parseManual(manualText, manualPath));
  if (!ours || !theirs || !manual) return inputErrors(errors);

  const result = attempt(() => reconcile({ ours, theirs, manual, asOf, tolerances }));
  if (!result) return inputErrors(errors.map((e) => ({ file: manualPath, ...e })));
  for (const w of result.warnings) process.stderr.write(`warning: ${formatInputError({ file: manualPath, ...w })}\n`);

  const report = buildReport(result, asOfNormalized);
  const outPath = resolve(process.cwd(), output);
  try {
    await writeAtomically(outPath, serializeReport(report));
  } catch (e) {
    return inputErrors([{ message: `cannot write report: ${(e as Error).message}` }]);
  }
  printSummary(report, outPath);
  return EXIT_OK;
}

/** Writes via a sibling temp file and rename, so a failed run never leaves a partial or clobbered report. */
async function writeAtomically(path: string, contents: string): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    await writeFile(tmp, contents, 'utf8');
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

function printSummary({ as_of, summary: s }: Report, outPath: string): void {
  const rows: [string, number][] = [
    ['matched manual', s.matched_manual],
    ['matched exact', s.matched_exact],
    ['matched rule_based', s.matched_rule_based],
    ['matched fuzzy', s.matched_fuzzy],
    ['unmatched ours', s.unmatched_ours],
    ['unmatched theirs', s.unmatched_theirs],
  ];
  const lines = rows.map(([label, n]) => `  ${label.padEnd(20)}${String(n).padStart(6)}`);
  process.stdout.write(`Reconciliation as of ${as_of}\n${lines.join('\n')}\nReport written to ${outPath}\n`);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    if (process.env.RECON_DEBUG === '1' && e instanceof Error) process.stderr.write(`${e.stack}\n`);
    process.exitCode = EXIT_INPUT;
  },
);
