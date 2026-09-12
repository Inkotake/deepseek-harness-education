/**
 * The recording driver's load-bearing contracts.
 *
 * Two of them matter more than the launch itself:
 *
 * 1. Without a provider credential the driver must SKIP LOUDLY. A skip that looks like a pass is
 *    worse than no driver at all, because the suite would report a clean run for cases that were
 *    never exercised.
 * 2. `--dry-run` must need no credential at all, so the command can be inspected on any machine.
 *
 * The launch path itself is exercised against a stub launcher, never a real one: running a genuine
 * session needs a provider credential this repository does not carry, so the stub proves the driver
 * reaches the launch and reads its exit, not that a model answered.
 *
 * @module @teacher-dsh/grabme-evals/tests/record
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RECORD = join(HERE, '..', 'record.mjs')
const CASES = JSON.parse(readFileSync(join(HERE, '..', 'cases.json'), 'utf8'))
const A_CASE = CASES[0].id

/** Run the driver with a scrubbed environment so a developer's own key cannot change the outcome. */
function runDriver(argv, env = {}) {
  const scrubbed = { ...process.env, ...env }
  for (const name of ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DSH_API_KEY']) {
    delete scrubbed[name]
  }
  Object.assign(scrubbed, env)
  return spawnSync(process.execPath, [RECORD, ...argv], { encoding: 'utf8', env: scrubbed })
}

test('a dry run needs no credential and prints the launch it would perform', () => {
  const result = runDriver([A_CASE, '--dry-run'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /dry run/u)
  assert.match(result.stdout, /--profile/u)
  // It must hand the operator the exact scoring command, or the recording is a dead end.
  assert.match(result.stdout, /run\.mjs/u)
  assert.match(result.stdout, /--case/u)
})

test('without a credential the driver skips loudly and does not look like a pass', () => {
  const result = runDriver([A_CASE])
  // A distinct exit code: a caller checking "did anything fail" cannot read this as success.
  assert.equal(result.status, 3)
  assert.match(result.stderr, /NOT RUN/u)
  assert.match(result.stderr, /A skip is not a pass/u)
  // It must say which case was not exercised, not just that something was skipped.
  assert.match(result.stderr, new RegExp(A_CASE, 'u'))
})

test('a configured credential changes the outcome, proving the skip is credential-driven', () => {
  // The launcher is a stub that exits immediately, so this stays fast and offline. The assertion is
  // only that the driver gets PAST the skip — which is what proves the skip was gated on the
  // credential rather than on something else.
  const stub = join(HERE, 'fixtures', 'launcher-stub.mjs')
  const result = runDriver([A_CASE, '--dsh', stub], {
    DEEPSEEK_API_KEY: 'placeholder-not-a-real-key',
  })
  assert.notEqual(result.status, 3)
  assert.doesNotMatch(result.stderr, /NOT RUN/u)
})

test('an explicit --dsh that does not exist fails instead of launching the built-in entry', () => {
  // Falling through would launch a real networked session from a caller that believes it is
  // exercising a stub — so a bad path has to be an error, not a hint.
  const result = runDriver([A_CASE, '--dsh', 'definitely/not/here.mjs'], {
    DEEPSEEK_API_KEY: 'placeholder-not-a-real-key',
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--dsh entry not found/u)
})

test('a flag with no value is rejected instead of reaching spawn as undefined', () => {
  const result = runDriver([A_CASE, '--dsh-arg'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /needs a value/u)
})

test('an unknown case id fails with a distinct code instead of running something else', () => {
  const result = runDriver(['no-such-case', '--dry-run'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /no case/u)
  assert.match(result.stderr, /no-such-case/u)
})

test('an unrecognised argument is rejected rather than ignored', () => {
  const result = runDriver([A_CASE, '--dry-run', '--nonsense'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unrecognised argument/u)
})
