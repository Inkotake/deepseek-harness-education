/**
 * Run one eval case as a REAL Host session and hand the log to the scorer.
 *
 * The fixtures under `tests/fixtures` prove the counting rules; they prove nothing about the
 * product. This driver launches the shipped `dsh` with the `headless` profile — "answer one task,
 * print the result, and exit", which is the closest thing to what a teacher's first turn actually
 * is — and then hands the recorded session log to `run.mjs`, which reads it back through the
 * ordinary append-only session artifacts.
 *
 * Where the log lands is not a guess: `dsh-base` mounts `@deepseek-ai/dsh-session-persistence-jsonl`
 * with `root: dshHomePath('sessions')`, so a session appears under
 * `<home>/sessions/<projectKey>/<sessionId>/session[.vN].jsonl[.zstd]`. Compression defaults to
 * zstd, and the runner decompresses it.
 *
 * ## It skips loudly, on purpose
 *
 * Without a provider credential this driver CANNOT run, and it must not look like it passed. It
 * exits with a distinct code and prints a banner that says the case was not exercised, so a caller
 * that greps for failures cannot mistake the skip for a clean result. `--dry-run` prints the exact
 * command without needing a credential at all.
 *
 * @module @teacher-dsh/grabme-evals/record
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const CASES = join(HERE, 'cases.json')

/** Exit code reserved for "this case was never exercised". Distinct from every real outcome. */
export const SKIPPED_EXIT_CODE = 3

const CREDENTIAL_VARIABLES = [
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DSH_API_KEY',
]

const SKIP_BANNER = [
  '',
  '='.repeat(78),
  '  NOT RUN — no provider credential is configured.',
  '  This case was NOT exercised. A skip is not a pass.',
  `  Set one of: ${CREDENTIAL_VARIABLES.join(', ')}`,
  '  Or inspect the command without running anything: add --dry-run',
  '='.repeat(78),
  '',
].join('\n')

/** Parse the driver's own argv. */
function parseArgv(argv) {
  const options = { caseId: undefined, dryRun: false, home: undefined, dsh: undefined, profile: 'headless', timeoutSeconds: 600 }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--dry-run') options.dryRun = true
    else if (token === '--home') options.home = argv[++i]
    else if (token === '--dsh') options.dsh = argv[++i]
    else if (token === '--profile') options.profile = argv[++i]
    else if (token === '--timeout') options.timeoutSeconds = Number(argv[++i])
    else if (options.caseId === undefined && !token.startsWith('--')) options.caseId = token
    else throw new Error(`record: unrecognised argument ${JSON.stringify(token)}`)
  }
  if (options.caseId === undefined) throw new Error('record: pass a case id from cases.json')
  return options
}

/** The first configured provider credential, or undefined. */
function findCredential() {
  for (const name of CREDENTIAL_VARIABLES) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim() !== '') return name
  }
  return undefined
}

/** Locate the shipped launcher, preferring the packaged runtime over a bare source checkout. */
function findLauncher(explicit) {
  const candidates = [
    explicit,
    join(REPO, 'dsh-plugin-desktop', 'node_modules', '.bin', 'dsh'),
    join(REPO, 'node_modules', '.bin', 'dsh'),
  ].filter(candidate => typeof candidate === 'string' && candidate !== '')
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Walk a directory for session artifacts, newest first. */
function findLogs(root) {
  const found = []
  const visit = (directory, depth) => {
    if (depth > 6) return
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path, depth + 1)
      else if (/^session(?:\.[0-9]+)?(?:\.v[0-9]+)?\.jsonl(?:\.zstd)?$/u.test(entry.name)) {
        found.push({ path, mtimeMs: statSync(path).mtimeMs })
      }
    }
  }
  visit(root, 0)
  return found.sort((left, right) => right.mtimeMs - left.mtimeMs).map(entry => entry.path)
}

function main() {
  const options = parseArgv(process.argv.slice(2))
  const cases = JSON.parse(readFileSync(CASES, 'utf8'))
  const testCase = cases.find(candidate => candidate.id === options.caseId)
  if (testCase === undefined) {
    throw new Error(`record: no case ${JSON.stringify(options.caseId)} in ${CASES}`)
  }

  const launcher = findLauncher(options.dsh)
  if (launcher === undefined) {
    throw new Error('record: could not find the dsh launcher; pass --dsh <path>')
  }

  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const home = resolve(options.home ?? join(HERE, '.runs', `${options.caseId}-${stamp}`, 'dsh-home'))
  const sessionRoot = join(home, 'sessions')
  mkdirSync(sessionRoot, { recursive: true })

  const command = [launcher, '--profile', options.profile, testCase.teacher_message]

  if (options.dryRun) {
    console.log('record: dry run — nothing was executed.\n')
    console.log(`  launcher     ${launcher}`)
    console.log(`  DSH_HOME     ${home}`)
    console.log(`  session root ${sessionRoot}`)
    console.log(`  case         ${testCase.id} (${testCase.category})`)
    console.log(`  argv         ${JSON.stringify(command.map(part => part === testCase.teacher_message ? '<teacher_message>' : part))}`)
    console.log(`\n  teacher_message: ${testCase.teacher_message}`)
    console.log(`\n  Then score it with:\n    node teacher/evals/grabme/run.mjs "${sessionRoot}" --case ${testCase.id}`)
    return 0
  }

  const credential = findCredential()
  if (credential === undefined) {
    console.error(SKIP_BANNER)
    console.error(`record: case ${testCase.id} was NOT exercised.`)
    console.error(`record: would have run — DSH_HOME=${home} ${launcher} --profile ${options.profile} <teacher_message>`)
    return SKIPPED_EXIT_CODE
  }

  console.log(`record: running case ${testCase.id} (${testCase.category})`)
  console.log(`record: credential from ${credential} · DSH_HOME=${home} · profile=${options.profile}`)

  const started = Date.now()
  const result = spawnSync(launcher, ['--profile', options.profile, testCase.teacher_message], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home },
    timeout: options.timeoutSeconds * 1000,
  })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  if (result.error !== undefined) {
    console.error(`record: the session could not be started: ${result.error.message}`)
    return 1
  }
  const timedOut = result.signal !== null && result.signal !== undefined
  console.log(`record: dsh exited ${String(result.status)} after ${elapsed}s${timedOut ? ` (signal ${String(result.signal)})` : ''}`)
  if (typeof result.stdout === 'string' && result.stdout.trim() !== '') {
    console.log(`\n--- final answer (tail) ---\n${result.stdout.trim().split('\n').slice(-12).join('\n')}\n`)
  }
  if (typeof result.stderr === 'string' && result.stderr.trim() !== '') {
    console.error(`--- stderr (tail) ---\n${result.stderr.trim().split('\n').slice(-12).join('\n')}\n`)
  }

  const logs = findLogs(sessionRoot)
  if (logs.length === 0) {
    // Say exactly what this means rather than reporting a silent success.
    console.error('record: no session log was written. The composition this profile booted may not')
    console.error('record: mount @deepseek-ai/dsh-session-persistence-jsonl, so there is nothing to')
    console.error('record: score. dsh-base mounts it with root=<DSH_HOME>/sessions; check that the')
    console.error(`record: profile under test still includes that layer. (looked under ${sessionRoot})`)
    return 1
  }

  console.log('record: session log(s) written:')
  for (const log of logs) console.log(`  ${log}`)
  console.log('\nrecord: score it with:')
  console.log(`  node teacher/evals/grabme/run.mjs "${logs[0]}" --case ${testCase.id}`)
  return result.status === 0 ? 0 : 1
}

try {
  process.exitCode = main()
} catch (cause) {
  // The thrown messages already name this module; only a non-Error needs the prefix added.
  console.error(cause instanceof Error ? cause.message : `record: ${String(cause)}`)
  process.exitCode = 2
}
