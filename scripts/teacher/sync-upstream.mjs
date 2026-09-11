// Records the *upstream* pins this fork builds on into teacher/manifests/desktop-upstream.lock.json.
//
// This script deliberately never records this fork's own HEAD. The file describes the pinned
// upstream revisions only:
//
//   harness  - the deepseek-harness commit/version the desktop pins, read from `upstream.json`
//   desktop  - the upstream anywhere-labs/dsh-desktop baseline, if an operator has pinned one
//
// This fork pins the Harness, not an upstream Desktop commit, and neither pin is derivable from
// this checkout. `desktop.commit` therefore stays null until an operator resolves a revision and
// passes `--desktop-commit <sha>`; the Desktop base version this fork derives from is recorded in
// THIRD_PARTY_NOTICES.md. An earlier revision of this script wrote `git rev-parse HEAD`, which
// recorded this fork's own commits as if they were upstream.
//
// Usage:
//   node scripts/teacher/sync-upstream.mjs [--desktop-commit <sha>] [--channel <stable|beta>]
//
// GitHub Actions runs it from `.github/workflows/upstream-watch.yml` on a schedule and on manual
// dispatch; that workflow opens a pull request on drift and never pushes the default branch.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const lockFile = path.join(root, 'teacher', 'manifests', 'desktop-upstream.lock.json')
const upstreamFile = path.join(root, 'upstream.json')

const KNOWN_CHANNELS = ['stable', 'beta']
const SHA_PATTERN = /^[0-9a-f]{40}$/u

function fail(message) {
  process.stderr.write(`[sync-upstream] ERROR ${message}\n`)
  process.exitCode = 1
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function optionValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function main() {
  const upstream = readJson(upstreamFile)
  const channel = optionValue('--channel') ?? upstream.activeChannel
  if (!KNOWN_CHANNELS.includes(channel)) {
    throw new Error(`unknown upstream channel ${JSON.stringify(channel)}`)
  }
  const pin = upstream.channels?.[channel]
  if (pin === undefined || typeof pin !== 'object') {
    throw new Error(`upstream.json has no ${channel} pin`)
  }
  if (!SHA_PATTERN.test(pin.commit ?? '')) {
    throw new Error(`upstream.json ${channel}.commit must be a full lowercase commit SHA`)
  }
  if (typeof pin.sourceVersion !== 'string' || pin.sourceVersion.length === 0) {
    throw new Error(`upstream.json ${channel}.sourceVersion must be a non-empty string`)
  }

  const requestedDesktopCommit = optionValue('--desktop-commit')
  if (requestedDesktopCommit !== undefined && !SHA_PATTERN.test(requestedDesktopCommit)) {
    throw new Error('--desktop-commit must be a full lowercase commit SHA')
  }

  const lock = {
    name: 'desktop-upstream.lock',
    version: '0.1.0',
    watches: 'upstream pins only; this fork is not the subject of this file',
    desktop: {
      repo: 'https://github.com/anywhere-labs/dsh-desktop',
      commit: requestedDesktopCommit ?? null,
      note:
        'Upstream Desktop baseline. This fork pins the Harness (see `harness`), not an upstream '
        + 'Desktop commit, so `commit` stays null until an operator resolves a revision with '
        + '--desktop-commit. The Desktop base version this fork derives from is recorded in '
        + 'THIRD_PARTY_NOTICES.md. This fork\'s own HEAD is never written here.'
    },
    harness: {
      repo: upstream.repository,
      pinned_by_desktop: true,
      channel,
      commit: pin.commit,
      version: pin.sourceVersion
    },
    policy: 'Upgrade only through PR + tests; never follow master/latest automatically.'
  }

  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n')
  console.log('Wrote', path.relative(root, lockFile).split(path.sep).join('/'))
  console.log(JSON.stringify(lock, null, 2))
}

try {
  main()
} catch (cause) {
  fail(cause instanceof Error ? cause.message : String(cause))
}
