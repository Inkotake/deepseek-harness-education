#!/usr/bin/env node
/**
 * Vendor plugin consistency gate.
 *
 * Proves that the three pinned vendor plugins agree with themselves across the three places the
 * distribution records them:
 *
 *   1. `teacher/manifests/plugins.lock.json`                 the pin (id, repo, license)
 *   2. `resources/teacher-seed/plugins/<id>/SOURCE.json`     the vendored git checkout
 *   3. `resources/teacher-seed/plugins-built/<id>/`          the prebuilt installable tree
 *
 * A missing prebuilt tree is a WARN rather than a FAIL: a fresh checkout legitimately has none,
 * and `scripts/teacher/build-vendor-plugins.mjs` produces them.
 *
 * Usage:
 *   node scripts/teacher/verify-plugins.mjs [--help]
 *
 * PASS/OK lines go to stdout, WARN/FAIL diagnostics go to stderr.
 * Exit code: 0 when no check failed, 1 otherwise.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOCK_FILE = path.join(ROOT, 'teacher', 'manifests', 'plugins.lock.json')
const SEED_PLUGINS = path.join(ROOT, 'resources', 'teacher-seed', 'plugins')
const BUILT_PLUGINS = path.join(ROOT, 'resources', 'teacher-seed', 'plugins-built')
const RUNTIME_LOCK = path.join(ROOT, 'resources', 'teacher-runtime', 'plugins', 'plugins.lock.json')

const SIDEBAR_ID = 'dsh-better-sidebar'
const SIDEBAR_PINNED_VERSION = '0.18.1'
const SIDEBAR_VERSION_NOTE =
  `${SIDEBAR_ID} is pinned to ${SIDEBAR_PINNED_VERSION}: 0.19.x requires `
  + '@deepseek-ai/dsh-client-ui-sidebar-right@^0.1.5-rc.1, which the pinned Harness '
  + '0.1.2-rc.1 does not provide, so the 0.19.x sidebar cannot mount.'

const GIT_SHA = /^[0-9a-f]{40}$/iu

const HELP = `Verify that the pinned vendor plugins are present and internally consistent.

Usage:
  node scripts/teacher/verify-plugins.mjs [--help]

Cross-checks teacher/manifests/plugins.lock.json against the vendored checkouts in
resources/teacher-seed/plugins/<id>/SOURCE.json and the prebuilt trees in
resources/teacher-seed/plugins-built/<id>/.

Fails on: a core id without SOURCE.json, a SOURCE.json without a repo / 40-hex commit / license,
a SOURCE.json repo that disagrees with the lock, a duplicate id in the lock, or a prebuilt tree
whose package.json "main" does not resolve.
Warns on: a missing prebuilt tree, a missing runtime plugin lock, and a ${SIDEBAR_ID} prebuilt
version other than ${SIDEBAR_PINNED_VERSION}.

Exit code: 0 when no check failed, 1 otherwise.
`

const failures = []
const warnings = []

function pass(id, detail) {
  process.stdout.write(`[verify-plugins] PASS ${id}${detail === undefined ? '' : ` - ${detail}`}\n`)
}

function fail(id, detail) {
  failures.push(`${id}: ${detail}`)
  process.stderr.write(`[verify-plugins] FAIL ${id} - ${detail}\n`)
}

function warn(message) {
  warnings.push(message)
  process.stderr.write(`[verify-plugins] WARN ${message}\n`)
}

function rel(target) {
  return path.relative(ROOT, target).split(path.sep).join('/')
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Compare repository URLs without letting a trailing `.git` or slash look like a mismatch. */
function normaliseRepo(value) {
  return value.trim().replace(/\.git$/iu, '').replace(/\/+$/u, '')
}

function pad(value, width) {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function printTable(rows) {
  const headers = ['id', 'commit', 'license', 'prebuilt']
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map(row => String(row[index]).length),
  ))
  const line = values => values.map((value, index) => pad(String(value), widths[index])).join('  ')
  process.stdout.write(`${line(headers)}\n`)
  process.stdout.write(`${widths.map(width => '-'.repeat(width)).join('  ')}\n`)
  for (const row of rows) process.stdout.write(`${line(row)}\n`)
}

function checkSource(id, entry, rows) {
  const sourceFile = path.join(SEED_PLUGINS, id, 'SOURCE.json')
  const lockRepo = normaliseRepo(typeof entry.repo === 'string' ? entry.repo : '')
  const lockLicense = typeof entry.license === 'string' ? entry.license : ''
  const source = readJson(sourceFile)
  if (source === null) {
    fail(`source:${id}`, `missing or unparsable: ${rel(sourceFile)}`)
    rows.push([id, '-', lockLicense === '' ? '-' : lockLicense, '-'])
    return
  }
  const repo = typeof source.repo === 'string' ? source.repo.trim() : ''
  const commit = typeof source.commit === 'string' ? source.commit.trim() : ''
  const license = typeof source.license === 'string' ? source.license.trim() : ''

  if (repo === '') fail(`source-repo:${id}`, 'SOURCE.json has an empty "repo"')
  if (!GIT_SHA.test(commit)) {
    fail(`source-commit:${id}`, `SOURCE.json "commit" is not a 40-hex git SHA: ${JSON.stringify(commit)}`)
  }
  if (license === '') fail(`source-license:${id}`, 'SOURCE.json has an empty "license"')

  if (repo !== '' && lockRepo !== '' && normaliseRepo(repo) !== lockRepo) {
    fail(`source-repo-match:${id}`, `SOURCE.json repo ${repo} does not match the lock repo ${entry.repo}`)
  }

  if (repo !== '' && commit !== '' && license !== '') {
    pass(`source:${id}`, `${commit.slice(0, 12)} ${license}`)
  }

  const prebuilt = checkPrebuilt(id)
  rows.push([id, commit === '' ? '-' : commit.slice(0, 12), license === '' ? '-' : license, prebuilt])
}

function checkPrebuilt(id) {
  const builtDir = path.join(BUILT_PLUGINS, id)
  if (!fs.existsSync(builtDir)) {
    warn(
      `prebuilt tree missing for ${id}: ${rel(builtDir)} `
      + `(build it with: node scripts/teacher/build-vendor-plugins.mjs --only=${id})`,
    )
    return '-'
  }

  const manifestPath = path.join(builtDir, 'package.json')
  const manifest = readJson(manifestPath)
  if (manifest === null) {
    fail(`prebuilt-package:${id}`, `missing or unparsable: ${rel(manifestPath)}`)
    return '-'
  }

  const version = typeof manifest.version === 'string' ? manifest.version : '-'
  const main = typeof manifest.main === 'string' ? manifest.main : ''
  if (main === '') {
    fail(`prebuilt-main:${id}`, 'prebuilt package.json declares no "main" entry')
  } else {
    const resolved = path.resolve(builtDir, main)
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      pass(`prebuilt-main:${id}`, `${main} -> ${rel(resolved)}`)
    } else {
      fail(`prebuilt-main:${id}`, `"main": ${main} does not resolve to an existing file in ${rel(builtDir)}`)
    }
  }

  if (id === SIDEBAR_ID && version !== SIDEBAR_PINNED_VERSION) {
    warn(`${SIDEBAR_VERSION_NOTE} Prebuilt version on disk: ${version}.`)
  }

  return version
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(HELP)
    return
  }

  const lock = readJson(LOCK_FILE)
  if (lock === null) {
    fail('plugins-lock', `missing or unparsable: ${rel(LOCK_FILE)}`)
    return finish([])
  }
  pass('plugins-lock', rel(LOCK_FILE))

  const core = Array.isArray(lock.core) ? lock.core : []
  if (core.length === 0) {
    fail('plugins-lock-core', 'plugins.lock.json has no core[] entries')
    return finish([])
  }

  const ordered = new Map()
  for (const entry of core) {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
    if (id === '') {
      fail('plugins-lock-id', 'a core[] entry has no "id"')
      continue
    }
    if (ordered.has(id)) {
      fail(`plugin-duplicate:${id}`, 'id appears more than once in plugins.lock.json core[]')
      continue
    }
    ordered.set(id, entry)
  }

  if (!fs.existsSync(RUNTIME_LOCK)) {
    warn(`runtime plugin lock is not shipped in this checkout: ${rel(RUNTIME_LOCK)}`)
  }

  const rows = []
  for (const [id, entry] of ordered) checkSource(id, entry, rows)

  process.stdout.write(`\n[verify-plugins] plugin table (${rows.length} core plugins)\n`)
  printTable(rows)
  process.stdout.write('\n')

  return finish(rows)
}

function finish(rows) {
  if (failures.length > 0) {
    process.stderr.write(`[verify-plugins] ${failures.length} failure(s)\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `[verify-plugins] OK ${rows.length} core plugins verified`
    + `${warnings.length === 0 ? '' : ` (${warnings.length} warning(s))`}\n`,
  )
}

main()
