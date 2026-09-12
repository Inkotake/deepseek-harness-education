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
  const options = {
    caseId: undefined,
    dryRun: false,
    home: undefined,
    dsh: undefined,
    dshArgs: [],
    profile: 'headless',
    timeoutSeconds: 600,
  }
  /** Take the value that must follow a flag, failing loudly when it is missing. */
  let index = 0
  const valueAfter = (token) => {
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`record: ${token} needs a value`)
    index += 1
    return value
  }
  for (index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--dry-run') options.dryRun = true
    else if (token === '--home') options.home = valueAfter(token)
    else if (token === '--dsh') options.dsh = valueAfter(token)
    else if (token === '--profile') options.profile = valueAfter(token)
    else if (token === '--timeout') options.timeoutSeconds = Number(valueAfter(token))
    // Repeatable pass-through for the launcher's own flags, e.g. a `--patch` overlay that makes a
    // generic gateway accept the request. The task stays the last positional.
    else if (token === '--dsh-arg') options.dshArgs.push(valueAfter(token))
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

/**
 * Resolve the launcher's JavaScript entry.
 *
 * The package-manager bin directory holds an extensionless POSIX shim and a `.cmd` shim, and the
 * `.cmd` only forwards to `node <pkg>/lib/bin.js`. Spawning the entry directly with
 * `process.execPath` and an argv ARRAY avoids both traps: Windows cannot execute the extensionless
 * shim at all (ENOENT), and a `.cmd` needs a shell, which would hand a teacher's Chinese message —
 * quotes and all — to `cmd.exe` for re-parsing. `--dsh` takes this entry path, not a shim.
 */
function findEntry(explicit) {
  // An explicit path that does not exist must FAIL rather than fall through to the built-in
  // entry: a typo, or a fixture that was never committed, would otherwise launch a real
  // networked session from a caller that believes it is exercising a stub.
  if (typeof explicit === 'string' && explicit !== '') {
    if (!existsSync(explicit)) throw new Error(`record: --dsh entry not found: ${explicit}`)
    return explicit
  }
  const candidates = [
    join(REPO, 'dsh-plugin-desktop', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(REPO, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ]
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

  const entry = findEntry(options.dsh)
  if (entry === undefined) {
    throw new Error('record: could not find the dsh entry point; pass --dsh <path to lib/bin.js>')
  }

  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const home = resolve(options.home ?? join(HERE, '.runs', `${options.caseId}-${stamp}`, 'dsh-home'))
  const sessionRoot = join(home, 'sessions')

  const command = [entry, '--profile', options.profile, ...options.dshArgs, testCase.teacher_message]

  if (options.dryRun) {
    console.log('record: dry run — nothing was executed.\n')
    console.log(`  entry        ${entry}`)
    console.log(`  node         ${process.execPath}`)
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
    console.error(`record: would have run — DSH_HOME=${home} node ${entry} --profile ${options.profile} <teacher_message>`)
    return SKIPPED_EXIT_CODE
  }

  // Only a real run gets a home on disk; `--dry-run` promises that nothing is executed.
  mkdirSync(sessionRoot, { recursive: true })

  console.log(`record: running case ${testCase.id} (${testCase.category})`)
  console.log(`record: credential from ${credential} · DSH_HOME=${home} · profile=${options.profile}`)

  const started = Date.now()
  const result = spawnSync(process.execPath, [entry, '--profile', options.profile, ...options.dshArgs, testCase.teacher_message], {
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

  // `started` is the boundary, not the directory: with a reused `--home` the newest artifact
  // may predate this run, and reporting it would present an unexercised case as a pass.
  const logs = findLogs(sessionRoot).filter(log => statSync(log).mtimeMs >= started)
  if (logs.length === 0) {
    // Say exactly what this means rather than reporting a silent success.
    console.error('record: this run wrote no session log. The composition this profile booted may not')
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
