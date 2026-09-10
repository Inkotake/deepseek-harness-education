#!/usr/bin/env node
/**
 * Offline smoke test for the command surface — NOT part of the CLI.
 *
 * Checks that every command supports `--json` with exactly one JSON document on stdout, and that
 * the documented exit codes hold. It never contacts a provider: `deploy` is exercised with
 * --dry-run, and `verify` is pointed at a URL that is expected to fail.
 *
 * Usage: node tools/smoke.mjs <artifact-dir>
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'teacher-publish.mjs');
const artifact = process.argv[2];
if (!artifact) {
  process.stderr.write('usage: node tools/smoke.mjs <artifact-dir>\n');
  process.exit(2);
}
const dir = path.resolve(artifact);

const cases = [
  { name: 'detect', args: ['detect', dir, '--json'], expectExit: 0, expectJson: true },
  { name: 'inspect', args: ['inspect', dir, '--json'], expectExit: [0, 4], expectJson: true },
  { name: 'plan quick-share', args: ['plan', dir, '--mode', 'quick-share', '--json'], expectExit: [0, 6], expectJson: true },
  { name: 'plan persistent', args: ['plan', dir, '--mode', 'persistent', '--json'], expectExit: [0, 6], expectJson: true },
  { name: 'deploy dry-run', args: ['deploy', dir, '--mode', 'quick-share', '--auto', '--dry-run', '--json'], expectExit: 0, expectJson: true },
  { name: 'providers', args: ['providers', '--json'], expectExit: 0, expectJson: true },
  { name: 'tunnel detect', args: ['tunnel', 'detect', '--json'], expectExit: [0, 8], expectJson: true },
  { name: 'verify unreachable', args: ['verify', 'https://127.0.0.1:9/', dir, '--json'], expectExit: 7, expectJson: true },
  { name: 'help', args: ['help'], expectExit: 0, expectJson: false },
  { name: 'bad mode', args: ['plan', dir, '--mode', 'nope'], expectExit: 2, expectJson: false },
  { name: 'unknown command', args: ['frobnicate'], expectExit: 2, expectJson: false }
];

let failures = 0;
for (const testCase of cases) {
  const result = spawnSync(process.execPath, [bin, ...testCase.args], { encoding: 'utf8', timeout: 180000 });
  const expected = Array.isArray(testCase.expectExit) ? testCase.expectExit : [testCase.expectExit];
  const problems = [];
  if (!expected.includes(result.status)) problems.push(`exit ${result.status}, expected ${expected.join('|')}`);
  if (testCase.expectJson) {
    try {
      const parsed = JSON.parse(result.stdout);
      if (parsed === null || typeof parsed !== 'object') problems.push('stdout JSON is not an object');
    } catch (cause) {
      problems.push(`stdout is not exactly one JSON document: ${cause.message}`);
    }
  }
  if (problems.length) {
    failures += 1;
    process.stdout.write(`FAIL ${testCase.name}: ${problems.join('; ')}\n`);
    process.stdout.write(`  stderr: ${result.stderr.split('\n').slice(0, 3).join(' | ')}\n`);
  } else {
    process.stdout.write(`ok   ${testCase.name}\n`);
  }
}

process.stdout.write(failures ? `\n${failures} command(s) failed\n` : '\nall command smoke checks passed\n');
process.exit(failures ? 1 : 0);
