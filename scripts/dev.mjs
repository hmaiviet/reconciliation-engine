#!/usr/bin/env node
// Starts the API (127.0.0.1:3001, rebuilt by tsc --watch) and the Vite GUI (127.0.0.1:5173).
// Ctrl+C stops everything; if any process exits, the others are stopped too.
import { spawn, spawnSync } from 'node:child_process';

const first = spawnSync('tsc', ['-p', 'tsconfig.json'], { stdio: 'inherit' });
if (first.status !== 0) process.exit(first.status ?? 1);

const children = [
  spawn('tsc', ['-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'], { stdio: 'inherit' }),
  spawn('node', ['--watch', 'dist/api/server.js'], { stdio: 'inherit' }),
  spawn('vite', ['web'], { stdio: 'inherit' }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const c of children) c.kill('SIGTERM');
}

for (const c of children) c.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
