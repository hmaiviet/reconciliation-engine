#!/usr/bin/env node
// Runs `recon run` against scenario directories in fresh temp dirs and compares
// the output to expected_report.json (canonical JSON: key order ignored, array order checked).
//
// Usage (from repo root):
//   node .cursor/skills/recon-example-check/scripts/check-scenarios.mjs [--fuzzy] [--keep] [DIR ...]
// Env:
//   RECON_CMD  command used to invoke the CLI (default: node "<repo>/dist/cli/main.js")
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const strictFuzzy = args.includes('--fuzzy');
const keep = args.includes('--keep');
const dirArgs = args.filter((a) => !a.startsWith('--'));

const repo = process.cwd();
const cmd = process.env.RECON_CMD ?? `node "${join(repo, 'dist/cli/main.js')}"`;
const INPUTS = ['ours.csv', 'theirs.csv', 'manual.csv'];

const dirs = dirArgs.length
  ? dirArgs.map((d) => resolve(d))
  : readdirSync(join(repo, 'examples'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(repo, 'examples', e.name))
      .filter((d) => existsSync(join(d, 'expected_report.json')))
      .sort();

function firstDiff(actual, expected, path = '$') {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return `${path}: type differs`;
    const n = Math.max(actual.length, expected.length);
    for (let i = 0; i < n; i++) {
      if (i >= actual.length) return `${path}[${i}]: missing, expected ${JSON.stringify(expected[i])}`;
      if (i >= expected.length) return `${path}[${i}]: unexpected ${JSON.stringify(actual[i])}`;
      const d = firstDiff(actual[i], expected[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      if (!(k in actual)) return `${path}.${k}: missing, expected ${JSON.stringify(expected[k])}`;
      if (!(k in expected)) return `${path}.${k}: unexpected ${JSON.stringify(actual[k])}`;
      const d = firstDiff(actual[k], expected[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return Object.is(actual, expected)
    ? null
    : `${path}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
}

function runOnce(dir, asOf) {
  const work = mkdtempSync(join(tmpdir(), `recon-${basename(dir)}-`));
  for (const f of INPUTS) copyFileSync(join(dir, f), join(work, f));
  const res = spawnSync(
    `${cmd} run --ours ours.csv --theirs theirs.csv --manual manual.csv --as-of ${asOf} --output report.json`,
    { cwd: work, shell: true, encoding: 'utf8' },
  );
  const out = join(work, 'report.json');
  const raw = existsSync(out) ? readFileSync(out, 'utf8') : null;
  if (!keep) rmSync(work, { recursive: true, force: true });
  return { status: res.status, stderr: res.stderr, raw, work };
}

let failed = 0;
for (const dir of dirs) {
  const name = basename(dir);
  const asOf = readFileSync(join(dir, 'as_of.txt'), 'utf8').trim();
  const expected = JSON.parse(readFileSync(join(dir, 'expected_report.json'), 'utf8'));
  const needsFuzzy = (expected.summary?.matched_fuzzy ?? 0) > 0 && !strictFuzzy;

  const a = runOnce(dir, asOf);
  if (a.status !== 0 || a.raw === null) {
    console.log(`ERROR ${name}: exit ${a.status}${a.raw === null ? ', no report.json' : ''}\n${a.stderr.trim()}`);
    failed++;
    continue;
  }
  const b = runOnce(dir, asOf);
  if (b.raw !== a.raw) {
    console.log(`FAIL  ${name}: output differs between two identical runs (non-deterministic)`);
    failed++;
    continue;
  }

  let actual;
  try {
    actual = JSON.parse(a.raw);
  } catch (e) {
    console.log(`FAIL  ${name}: report.json is not valid JSON (${e.message})`);
    failed++;
    continue;
  }
  const diff = firstDiff(actual, expected);
  if (!diff) console.log(`${needsFuzzy ? 'XPASS' : 'PASS '} ${name}`);
  else if (needsFuzzy) console.log(`XFAIL ${name}: needs fuzzy tier (${diff})`);
  else {
    console.log(`FAIL  ${name}: ${diff}`);
    failed++;
  }
  if (keep) console.log(`      kept: ${a.work}`);
}

console.log(`\n${dirs.length} scenario(s), ${failed} failing`);
process.exitCode = failed ? 1 : 0;
