#!/usr/bin/env node
/**
 * Stages a packaged Teacher DSH app directory against the live runtime trees.
 *
 * `electron-builder` copies ~1.3 GB / ~74,000 files out of `resources/` into
 * `dsh-plugin-desktop/dist/win-unpacked/resources/` on every packaging run and then compresses
 * them. Electron reads `process.resourcesPath` through ordinary filesystem calls, so a Windows
 * **directory junction** is transparent: point the app-side runtime directories back at the repo
 * trees and an installed app keeps working while a runtime rebuild is immediately visible and
 * `smoke-package.mjs` exercises the live tree with no copying.
 *
 * Usage:
 *   node scripts/teacher/stage-dev.mjs [--app <dir>] [--force] [--json] [--help]
 *
 * Default app directory: `dsh-plugin-desktop/dist/win-unpacked`
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Default packaged application directory, resolved against the repository root. */
const DEFAULT_APP = path.join(ROOT, 'dsh-plugin-desktop', 'dist', 'win-unpacked')

/** The two runtime trees that get a junction. Never anything else under `resources/`. */
const RUNTIMES = [
  { name: 'teacher-runtime', repo: path.join(ROOT, 'resources', 'teacher-runtime') },
  { name: 'dsh-runtime', repo: path.join(ROOT, 'resources', 'dsh-runtime') }
]

const argv = process.argv.slice(2)
const forceArg = argv.includes('--force')
const jsonArg = argv.includes('--json')
const helpArg = argv.includes('--help') || argv.includes('-h')
const appIndex = argv.indexOf('--app')
const appValue = appIndex === -1 ? null : (argv[appIndex + 1] ?? null)

if (helpArg) {
  usage()
  process.exit(0)
}
if (appIndex !== -1 && (appValue === null || appValue.startsWith('--'))) {
  process.stderr.write('[stage-dev] ERROR --app requires a directory argument\n')
  process.exit(2)
}

const APP = path.resolve(ROOT, appValue ?? DEFAULT_APP)

/** Actions recorded for `--json` and for the human summary. */
const staged = []
const startedAt = process.hrtime.bigint()

function log(message) {
  // Under `--json` stdout is reserved for the single result object; progress goes to stderr.
  const stream = jsonArg ? process.stderr : process.stdout
  stream.write(`[stage-dev] ${message}\n`)
}

function warn(message) {
  process.stderr.write(`[stage-dev] WARN ${message}\n`)
}

function elapsedMs() {
  return Number(process.hrtime.bigint() - startedAt) / 1e6
}

function usage() {
  process.stdout.write(`Stage a packaged Teacher DSH app against the live runtime trees.

Usage:
  node scripts/teacher/stage-dev.mjs [--app <dir>] [--force] [--json] [--help]

Options:
  --app <dir>   Application directory. Default: dsh-plugin-desktop/dist/win-unpacked
  --force       Re-create the junctions even when they already look correct
  --json        Print exactly one JSON object on stdout
  --help, -h    Show this help

The app directory must already exist: run the packaging pass first. This script never builds it.
`)
}

/** The only place a removal may happen: `<appDir>/resources/<teacher-runtime|dsh-runtime>`. */
function resourcesPathFor(name) {
  const resourcesDir = path.join(APP, 'resources')
  const target = path.resolve(resourcesDir, name)
  const expectedPrefix = `${path.resolve(resourcesDir)}${path.sep}`
  if (!target.startsWith(expectedPrefix)) {
    throw new Error(`refusing to touch ${target}: outside ${expectedPrefix}`)
  }
  if (path.basename(target) !== name || !RUNTIMES.some(runtime => runtime.name === name)) {
    throw new Error(`refusing to touch ${target}: not one of ${RUNTIMES.map(r => r.name).join(', ')}`)
  }
  return target
}

/**
 * Windows junctions are reparse points and report as symbolic links from `lstatSync`.
 * `readlinkSync` returns an absolute path for a junction, but comparing real paths is the
 * robust check (short names, trailing separators, case).
 */
function samePath(left, right) {
  try {
    return fs.realpathSync.native(left) === fs.realpathSync.native(right)
  } catch {
    return false
  }
}

function requirePackagedApp() {
  if (!fs.existsSync(APP) || !fs.statSync(APP).isDirectory()) {
    throw new Error(`application directory not found: ${APP}`)
  }
  const exe = path.join(APP, 'Teacher DSH.exe')
  const asar = path.join(APP, 'resources', 'app.asar')
  const missing = [exe, asar].filter(candidate => !fs.existsSync(candidate))
  if (missing.length > 0) {
    throw new Error(
      `${APP} is not a packaged Teacher DSH app; missing:\n` +
      missing.map(entry => `  - ${entry}`).join('\n') +
      '\nRun the packaging pass first (see teacher/BUILD.md). This script never builds the app.',
    )
  }
}

/** Removes one app-side entry without ever traversing into the repository tree. */
function removeEntry(target, name) {
  let stats
  try {
    stats = fs.lstatSync(target)
  } catch {
    return // already gone
  }

  const link = stats.isSymbolicLink()
  if (!link && !stats.isDirectory()) {
    throw new Error(`refusing to remove ${target}: it is a regular file, not a directory or junction`)
  }

  if (link) {
    // A reparse point: delete the link itself, never what it points at.
    fs.rmSync(target, { recursive: false, force: true })
  } else {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 })
  }

  if (fs.existsSync(target)) {
    throw new Error(`could not remove ${target}; it still exists, refusing to continue`)
  }
  log(`removed existing ${name} at ${target}`)
}

function stageRuntime(runtime, appPath) {
  if (!fs.existsSync(runtime.repo) || !fs.statSync(runtime.repo).isDirectory()) {
    warn(
      `missing ${runtime.repo}; skipping ${runtime.name}. ` +
      'Run `node scripts\\teacher\\build-teacher-runtime.mjs` first.',
    )
    staged.push({ name: runtime.name, action: 'skipped-missing-repo', target: runtime.repo })
    return
  }

  if (fs.existsSync(appPath)) {
    const stats = fs.lstatSync(appPath)
    const link = stats.isSymbolicLink()
    if (!link && !stats.isDirectory()) {
      throw new Error(`refusing to replace ${appPath}: it is a regular file, not a directory or junction`)
    }
    if (link && samePath(appPath, runtime.repo) && !forceArg) {
      log(`OK already staged ${runtime.name} -> ${runtime.repo}`)
      staged.push({ name: runtime.name, action: 'already-staged', target: runtime.repo })
      return
    }
    removeEntry(appPath, runtime.name)
  }

  // 'junction' is the only link type that works on Windows without elevation. Never 'dir'.
  fs.symlinkSync(runtime.repo, appPath, 'junction')

  const stats = fs.lstatSync(appPath)
  if (!stats.isSymbolicLink()) {
    throw new Error(`${appPath} was created but is not a reparse point`)
  }
  if (!samePath(appPath, runtime.repo)) {
    throw new Error(`${appPath} does not resolve to ${runtime.repo}`)
  }

  log(`staged ${runtime.name} -> ${runtime.repo}`)
  staged.push({ name: runtime.name, action: forceArg ? 're-staged' : 'staged', target: runtime.repo })
}

function printIterationGuide() {
  process.stdout.write(`
[stage-dev] how to iterate (no packaging pass needed):
  teacher CLI or Skill change  ->  node scripts\\teacher\\build-teacher-runtime.mjs --only=cli
                                   (use --only=skills for Skills)
  verify the staged app        ->  node scripts\\teacher\\smoke-package.mjs
  look at the UI               ->  ${path.join(APP, 'Teacher DSH.exe')}
  real installers              ->  the release pipeline in teacher\\BUILD.md (a real copy, ~15 min)
`)
}

function finish() {
  const elapsed = elapsedMs()
  if (jsonArg) {
    process.stdout.write(`${JSON.stringify({ appDir: APP, staged, elapsedMs: elapsed })}\n`)
  } else {
    printIterationGuide()
    log(`done in ${(elapsed / 1000).toFixed(2)}s`)
  }
}

function main() {
  try {
    requirePackagedApp()
  } catch (cause) {
    process.stderr.write(`[stage-dev] ERROR ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
    return
  }

  if (!jsonArg) log(`application directory: ${APP}`)

  let created = 0
  for (const runtime of RUNTIMES) {
    const appPath = resourcesPathFor(runtime.name)
    const before = staged.length
    try {
      stageRuntime(runtime, appPath)
    } catch (cause) {
      process.stderr.write(`[stage-dev] ERROR ${cause instanceof Error ? cause.message : String(cause)}\n`)
      process.exitCode = 1
      return
    }
    const action = staged.length > before ? staged[staged.length - 1].action : null
    if (action === 'staged' || action === 're-staged') created += 1
  }

  if (!jsonArg) {
    log(created === 0 ? 'all runtime trees were already staged' : `staged ${created} runtime tree(s)`)
  }
  finish()
}

main()
