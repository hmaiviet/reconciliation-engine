import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

export const REPO = resolve(import.meta.dirname, '../..');
const BIN = join(REPO, 'dist/cli/main.js');

const created: string[] = [];

/** Removes every directory made by `workdir`; register with `afterEach`. */
export async function removeWorkdirs(): Promise<void> {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

/** A fresh temp working directory with `files` copied in: `{ 'ours.csv': 'examples/example_1_basic/ours.csv' }`. */
export async function workdir(files: Record<string, string> = {}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'recon-it-'));
  created.push(cwd);
  for (const [dest, src] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, dest)), { recursive: true });
    await copyFile(join(REPO, src), join(cwd, dest));
  }
  return cwd;
}

export const example = (name: string) => ({
  'ours.csv': `examples/${name}/ours.csv`,
  'theirs.csv': `examples/${name}/theirs.csv`,
  'manual.csv': `examples/${name}/manual.csv`,
});

export async function exampleAsOf(name: string): Promise<string> {
  return (await readFile(join(REPO, 'examples', name, 'as_of.txt'), 'utf8')).trim();
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the built CLI (never a globally linked `recon`) in `cwd`. */
export async function runCli(cwd: string, args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await promisify(execFile)('node', [BIN, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code: number; stdout: string; stderr: string };
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

/** The standard `recon run` argument list, with overrides. */
export function runArgs(o: Partial<Record<'ours' | 'theirs' | 'manual' | 'as-of' | 'output', string>> = {}, extra: string[] = []): string[] {
  const f = { ours: 'ours.csv', theirs: 'theirs.csv', manual: 'manual.csv', 'as-of': '2026-04-01T23:59:59.999Z', output: 'report.json', ...o };
  return ['run', ...Object.entries(f).flatMap(([k, v]) => [`--${k}`, v]), ...extra];
}

export const readText = (cwd: string, name = 'report.json') => readFile(join(cwd, name), 'utf8');
export const readJson = async (cwd: string, name = 'report.json') => JSON.parse(await readText(cwd, name));
export const listFiles = async (cwd: string) => (await readdir(cwd)).sort();
