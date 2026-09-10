#!/usr/bin/env node
/**
 * Portable ZIP smoke test.
 *
 * Unpacks a Windows `portable` archive produced by the packaging job and answers the only
 * question that matters for it: does the extracted application pass the packaged smoke?
 *
 * Usage:
 *   node scripts/teacher/smoke-portable.mjs --archive <path to .zip> [--json] [--keep]
 *
 * Behaviour:
 *   1. FAIL when --archive is missing or does not name an existing file.
 *   2. Unpack with `powershell.exe -Command Expand-Archive` (path passed as a single argument,
 *      single-quoted with internal single quotes doubled; never interpolated into a shell line).
 *   3. Locate the application root: the extraction root itself when it holds `Teacher DSH.exe`,
 *      otherwise its single directory child that does.
 *   4. Re-run `scripts/teacher/smoke-package.mjs --app <appDir>` with `process.execPath` and
 *      propagate its exit code.
 *   5. Report the archive size and FAIL when it is below 100 MB: a Portable archive that small
 *      cannot contain the bundled runtime.
 *   6. Delete the extraction directory unless --keep is given.
 *
 * --json contract: in `--json` mode the child smoke's stdout is redirected to this process's
 * stderr (`stdio: ['inherit', process.stderr, 'inherit']`), so stdout carries exactly one JSON
 * object, printed last: `{ archive, bytes, appDir, passed }`. In human mode the child inherits
 * stdio normally and the same object's fields are reported as PASS/FAIL lines.
 *
 * PASS/OK lines go to stdout, WARN/FAIL diagnostics go to stderr.
 * Exit code: 0 only when the archive checks and the child smoke both passed.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SMOKE_PACKAGE = path.join(ROOT, 'scripts', 'teacher', 'smoke-package.mjs')

const APP_EXECUTABLE = 'Teacher DSH.exe'
const MIN_ARCHIVE_BYTES = 100 * 1024 * 1024

const argv = process.argv.slice(2)
const AS_JSON = argv.includes('--json')
const KEEP = argv.includes('--keep')
const WANT_HELP = argv.includes('--help') || argv.includes('-h')

const HELP = `Smoke-test a Portable ZIP archive of Teacher DSH.

Usage:
  node scripts/teacher/smoke-portable.mjs --archive <path to .zip> [--json] [--keep]

Options:
  --archive <path>  Portable .zip produced by the packaging job (required).
  --json            Print exactly one JSON object on stdout at the end; the child smoke's
                    stdout is redirected to stderr.
  --keep            Keep the temporary extraction directory.
  --help            Print this message.

Exit code: 0 only when the archive checks and the packaged smoke both passed.
`

const failures = []

function pass(id, detail) {
  if (AS_JSON) process.stderr.write(`[smoke-portable] PASS ${id}${detail === undefined ? '' : ` - ${detail}`}\n`)
  else process.stdout.write(`[smoke-portable] PASS ${id}${detail === undefined ? '' : ` - ${detail}`}\n`)
}

function fail(id, detail) {
  failures.push(`${id}: ${detail}`)
  process.stderr.write(`[smoke-portable] FAIL ${id} - ${detail}\n`)
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Quote a value for a PowerShell single-quoted string literal. */
function quotePwsh(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function findAppDir(root) {
  if (fs.existsSync(path.join(root, APP_EXECUTABLE))) return { dir: root, how: 'archive root' }
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return { dir: null, how: `unreadable extraction root: ${root}` }
  }
  const candidates = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => fs.existsSync(path.join(root, name, APP_EXECUTABLE)))
  if (candidates.length === 1) {
    return { dir: path.join(root, candidates[0]), how: `top-level directory "${candidates[0]}"` }
  }
  if (candidates.length === 0) {
    return { dir: null, how: `no directory containing ${APP_EXECUTABLE} below the extraction root` }
  }
  return { dir: null, how: `ambiguous: ${candidates.length} top-level directories contain ${APP_EXECUTABLE}` }
}

/** In `--json` mode every child's stdout is folded into our stderr so stdout stays machine-readable. */
function childStdio() {
  return AS_JSON ? ['inherit', process.stderr, 'inherit'] : 'inherit'
}

function extract(archive, destination) {
  // The path is passed as a single -Command argument, never interpolated into a shell line.
  const command = `$ProgressPreference='SilentlyContinue'; `
    + `Expand-Archive -LiteralPath ${quotePwsh(archive)} -DestinationPath `
    + `${quotePwsh(destination)} -Force`
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    stdio: childStdio(),
  })
}

function runPackagedSmoke(appDir) {
  return spawnSync(process.execPath, [SMOKE_PACKAGE, '--app', appDir], { stdio: childStdio() })
}

function report(result) {
  if (AS_JSON) {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return
  }
  process.stdout.write(
    `[smoke-portable] archive: ${result.archive}\n`
    + `[smoke-portable] size: ${mb(result.bytes)} (${result.bytes} bytes)\n`
    + `[smoke-portable] app: ${result.appDir ?? '(not found)'}\n`,
  )
}

function main() {
  if (WANT_HELP) {
    process.stdout.write(HELP)
    return
  }

  const archiveArg = argv.indexOf('--archive')
  const archiveValue = archiveArg >= 0 ? argv[archiveArg + 1] : undefined
  const result = { archive: null, bytes: 0, appDir: null, passed: false }

  if (archiveValue === undefined || archiveValue.startsWith('--')) {
    fail('archive', 'missing --archive <path to .zip>\n' + HELP.trimEnd())
    report(result)
    process.exitCode = 1
    return
  }

  const archive = path.resolve(archiveValue)
  result.archive = archive

  if (!fs.existsSync(archive) || !fs.statSync(archive).isFile()) {
    fail('archive', `not found: ${archive}`)
    report(result)
    process.exitCode = 1
    return
  }

  result.bytes = fs.statSync(archive).size
  if (result.bytes < MIN_ARCHIVE_BYTES) {
    fail(
      'archive-size',
      `${mb(result.bytes)} is below the ${mb(MIN_ARCHIVE_BYTES)} floor; `
      + 'a Portable archive this small cannot contain the bundled runtime',
    )
    report(result)
    process.exitCode = 1
    return
  }
  pass('archive-size', `${mb(result.bytes)} (${result.bytes} bytes)`)

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsh-smoke-portable-'))
  process.stderr.write(`[smoke-portable] extracting ${archive} -> ${workRoot}\n`)
  let exitCode = 1
  try {
    const extraction = extract(archive, workRoot)
    if (extraction.status !== 0) {
      fail('archive-extract', `Expand-Archive exited with ${String(extraction.status)}`)
      report(result)
      process.exitCode = 1
      return
    }

    const found = findAppDir(workRoot)
    if (found.dir === null) {
      fail('app-directory', found.how)
      report(result)
      process.exitCode = 1
      return
    }
    result.appDir = found.dir
    pass('app-directory', `${found.how}: ${found.dir}`)

    const smoke = runPackagedSmoke(found.dir)
    const status = smoke.status ?? 1
    if (status === 0) pass('smoke-package', 'exited 0')
    else fail('smoke-package', `exited with ${String(status)}`)

    result.passed = failures.length === 0
    exitCode = result.passed ? 0 : 1
    report(result)
    process.exitCode = exitCode
  } finally {
    if (KEEP) process.stderr.write(`[smoke-portable] kept extraction directory: ${workRoot}\n`)
    else fs.rmSync(workRoot, { recursive: true, force: true })
  }
}

main()
