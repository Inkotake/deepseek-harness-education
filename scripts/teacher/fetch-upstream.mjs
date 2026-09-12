// Materialize the pinned upstream source into `deepseek-harness/` — WITHOUT a Git submodule.
//
// The directory is deliberately not tracked. A submodule put a gitlink and a `.gitmodules` entry in
// this repository, which advertises the upstream repository and lets upstream's history hang off
// ours; this fork ships its own product and does not want an upstream git relationship in it. The
// source is still needed for development (patch derivation reads the vendored tarballs, but the
// preset derivation, the licence inventory and the tests read the checkout), so it is fetched on
// demand into an ignored directory instead of being recorded in the tree.
//
// The pin is not duplicated here: `upstream.json` is the single source of truth, and this script
// refuses to guess when it cannot read a commit out of it.
//
// Usage:
//   node scripts/teacher/fetch-upstream.mjs [--channel <name>] [--force] [--check]

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const upstreamFile = path.join(root, 'upstream.json')
const directory = path.join(root, 'deepseek-harness')
const SHA_PATTERN = /^[0-9a-f]{40}$/u

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const checkOnly = argv.includes('--check')

function fail(message) {
  process.stderr.write(`[fetch-upstream] ERROR ${message}\n`)
  process.exit(1)
}

function optionValue(name) {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) fail(`${name} requires a value`)
  return value
}

/** Run git, returning trimmed stdout; throws with git's own message on failure. */
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const upstream = JSON.parse(fs.readFileSync(upstreamFile, 'utf8'))
const channel = optionValue('--channel') ?? upstream.activeChannel
const pin = upstream.channels?.[channel]
if (pin === undefined) fail(`upstream.json declares no ${channel} channel`)
if (!SHA_PATTERN.test(pin.commit ?? '')) fail(`upstream.json ${channel}.commit is not a full commit SHA`)
if (typeof upstream.repository !== 'string' || upstream.repository === '') fail('upstream.json has no repository')

/** Whether the directory is a checkout already sitting on the pinned commit. */
function currentCommit() {
  if (!fs.existsSync(path.join(directory, '.git'))) return undefined
  try {
    return git(['rev-parse', 'HEAD'], directory)
  } catch {
    return undefined
  }
}

const present = currentCommit()
if (present === pin.commit && !force) {
  console.log(`[fetch-upstream] ${path.basename(directory)}/ is already at ${pin.commit.slice(0, 10)}`)
  process.exit(0)
}

if (checkOnly) {
  fail(present === undefined
    ? `${path.basename(directory)}/ is not fetched; run this script without --check`
    : `${path.basename(directory)}/ is at ${present.slice(0, 10)}, expected ${pin.commit.slice(0, 10)}`)
}

// A plain clone into the ignored directory. `--no-checkout` keeps it cheap, and the single commit
// is fetched explicitly so a shallow clone still lands on exactly the pinned revision.
if (fs.existsSync(directory)) {
  console.log(`[fetch-upstream] replacing the existing checkout at ${present?.slice(0, 10) ?? 'unknown'}`)
  fs.rmSync(directory, { recursive: true, force: true })
}

console.log(`[fetch-upstream] cloning ${upstream.repository} -> ${path.basename(directory)}/`)
git(['clone', '--filter=blob:none', '--no-checkout', upstream.repository, directory], root)
try {
  git(['fetch', '--depth', '1', 'origin', pin.commit], directory)
} catch {
  // Some hosts refuse fetching an unreachable-by-ref commit directly; the clone already has the
  // full object graph in that case, so fall back to checking the revision out as-is.
  console.log('[fetch-upstream] direct fetch refused; using the clone object graph')
}
git(['checkout', '--detach', pin.commit], directory)

const landed = currentCommit()
if (landed !== pin.commit) fail(`checkout landed on ${String(landed)}, expected ${pin.commit}`)
console.log(`[fetch-upstream] ${path.basename(directory)}/ is at ${pin.commit.slice(0, 10)} (${pin.sourceVersion})`)
console.log('[fetch-upstream] this directory is ignored by git and is not part of this repository')
