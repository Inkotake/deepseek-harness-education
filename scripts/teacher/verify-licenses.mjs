#!/usr/bin/env node
/**
 * License inventory gate.
 *
 * Proves that the generated license inventory is complete enough to ship:
 * `teacher/manifests/licenses.lock.json` must parse and carry a curated component list with real
 * metadata, every curated component must own a `licenses/<slug>/` directory, and
 * `THIRD_PARTY_NOTICES.md` must name every curated component and state the CC BY-SA share-alike
 * terms.
 *
 * Usage:
 *   node scripts/teacher/verify-licenses.mjs [--help]
 *
 * PASS/OK lines go to stdout, WARN/FAIL diagnostics go to stderr.
 * Exit code: 0 when no check failed, 1 otherwise.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOCK_FILE = path.join(ROOT, 'teacher', 'manifests', 'licenses.lock.json')
const NOTICES_FILE = path.join(ROOT, 'THIRD_PARTY_NOTICES.md')
const LICENSES_DIR = path.join(ROOT, 'licenses')

const MAX_LISTED = 20

const HELP = `Verify that the generated license inventory is complete enough to ship.

Usage:
  node scripts/teacher/verify-licenses.mjs [--help]

Checks teacher/manifests/licenses.lock.json, THIRD_PARTY_NOTICES.md, and licenses/:

Fails on: a missing or unparsable lock, an empty packages[], a curated entry missing any of
name/version/license/source/role, a CC BY-SA curated entry without an attribution and
copyleft === true, a curated component absent from THIRD_PARTY_NOTICES.md, notices without the
string "CC BY-SA", or a curated component without its licenses/<slug>/ directory.
Warns on: inventoried packages whose license is UNKNOWN, and packages with no licenseFile.

Exit code: 0 when no check failed, 1 otherwise.
`

const failures = []
const warnings = []

function pass(id, detail) {
  process.stdout.write(`[verify-licenses] PASS ${id}${detail === undefined ? '' : ` - ${detail}`}\n`)
}

function fail(id, detail) {
  failures.push(`${id}: ${detail}`)
  process.stderr.write(`[verify-licenses] FAIL ${id} - ${detail}\n`)
}

function warn(message) {
  warnings.push(message)
  process.stderr.write(`[verify-licenses] WARN ${message}\n`)
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

/** The exact slug `scripts/teacher/build-notices.mjs` uses for a component directory. */
function slugify(value) {
  return value.replace(/^@/u, '').replaceAll('/', '__').replace(/[^A-Za-z0-9._-]/gu, '-')
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function summarise(entries, formatter) {
  const listed = entries.slice(0, MAX_LISTED).map(formatter)
  const suffix = entries.length > MAX_LISTED ? `, ... ${entries.length - MAX_LISTED} more` : ''
  return `${listed.join(', ')}${suffix}`
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(HELP)
    return
  }

  const lock = readJson(LOCK_FILE)
  if (lock === null) {
    fail('licenses-lock', `missing or unparsable: ${rel(LOCK_FILE)}`)
    return finish(0, 0)
  }
  pass('licenses-lock', `${rel(LOCK_FILE)} parses`)

  const curated = Array.isArray(lock.curated) ? lock.curated : []
  const packages = Array.isArray(lock.packages) ? lock.packages : []

  if (packages.length === 0) {
    fail('packages-non-empty', 'licenses.lock.json has an empty packages[]')
  } else {
    pass('packages-non-empty', `${packages.length} inventoried packages`)
  }

  const notices = fs.existsSync(NOTICES_FILE) ? fs.readFileSync(NOTICES_FILE, 'utf8') : null
  if (notices === null) {
    fail('notices', `missing: ${rel(NOTICES_FILE)}`)
  } else {
    pass('notices', rel(NOTICES_FILE))
    if (!notices.includes('CC BY-SA')) {
      fail('notices-cc-by-sa', `THIRD_PARTY_NOTICES.md does not contain the string "CC BY-SA"`)
    }
  }

  for (const entry of curated) {
    const name = nonEmpty(entry?.name) ? entry.name : ''
    const label = name === '' ? '<unnamed curated entry>' : name

    if (name === '') {
      fail('curated-name', 'a curated entry has no non-empty "name"')
    }
    for (const field of ['version', 'license', 'source', 'role']) {
      if (!nonEmpty(entry?.[field])) fail(`curated-${field}:${label}`, `curated "${field}" is empty or missing`)
    }

    const license = nonEmpty(entry?.license) ? entry.license : ''
    if (license.includes('CC BY-SA')) {
      if (!nonEmpty(entry?.attribution)) {
        fail(`curated-attribution:${label}`, 'a CC BY-SA component must carry a non-empty "attribution"')
      }
      if (entry?.copyleft !== true) {
        fail(`curated-copyleft:${label}`, 'a CC BY-SA component must set "copyleft": true')
      }
    }

    if (name === '') continue

    if (notices !== null && !notices.includes(name)) {
      fail(`notices-mention:${name}`, `THIRD_PARTY_NOTICES.md does not mention "${name}"`)
    }

    const slug = slugify(name)
    const dir = path.join(LICENSES_DIR, slug)
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      pass(`licenses-dir:${name}`, `licenses/${slug}/`)
    } else {
      fail(`licenses-dir:${name}`, `missing licenses/${slug}/ for curated component "${name}"`)
    }
  }

  const unknown = packages.filter(entry => entry?.license === 'UNKNOWN')
  if (unknown.length > 0) {
    warn(
      `${unknown.length} inventoried package(s) declare no license (UNKNOWN): `
      + summarise(unknown, entry => `${entry.name}@${entry.version}`),
    )
  }

  const withoutLicenseFile = packages.filter(entry => !nonEmpty(entry?.licenseFile))
  if (withoutLicenseFile.length > 0) {
    warn(
      `${withoutLicenseFile.length} inventoried package(s) have no licenseFile: `
      + summarise(withoutLicenseFile, entry => `${entry.name}@${entry.version}`),
    )
  }

  return finish(curated.length, packages.length)
}

function finish(curatedCount, packageCount) {
  if (failures.length > 0) {
    process.stderr.write(`[verify-licenses] ${failures.length} failure(s)\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `[verify-licenses] OK ${curatedCount} curated components, ${packageCount} inventoried packages`
    + `${warnings.length === 0 ? '' : ` (${warnings.length} warning(s))`}\n`,
  )
}

main()
