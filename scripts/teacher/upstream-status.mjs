#!/usr/bin/env node
/**
 * Upstream status: what Teacher DSH is pinned to, and what is available upstream.
 *
 * This is the read-only half of the upstream sync mechanism. It answers one question — "is
 * there a newer Harness release than the one this repository vendors?" — and it reports what a
 * bump would touch, so an upgrade is predictable instead of exploratory.
 *
 * Usage:
 *   node scripts/teacher/upstream-status.mjs [--json]
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const JSON_OUTPUT = process.argv.includes('--json')

/** Semver-ish ordering for `0.1.5-rc.1` style versions, sufficient for this project's own tags. */
function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(value)
    if (match === null) return null
    return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null }
  }
  const a = parse(left)
  const b = parse(right)
  if (a === null || b === null) return 0
  for (let i = 0; i < 3; i += 1) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] < b.parts[i] ? -1 : 1
  }
  if (a.pre === b.pre) return 0
  if (a.pre === null) return 1
  if (b.pre === null) return -1
  // Both prereleases: numeric segments compare numerically, and a shorter run is lower.
  const left2 = a.pre.split('.')
  const right2 = b.pre.split('.')
  for (let i = 0; i < Math.max(left2.length, right2.length); i += 1) {
    const x = left2[i]
    const y = right2[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/u.test(x)
    const ny = /^\d+$/u.test(y)
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
      continue
    }
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function log(message) {
  process.stdout.write(`${message}\n`)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Published versions of one npm package, or null when the registry cannot be reached. */
function publishedVersions(name) {
  try {
    const raw = execFileSync('npm', ['view', name, 'versions', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    })
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return null
  }
}

function main() {
  const upstream = readJson(path.join(ROOT, 'upstream.json'))
  const channel = upstream.activeChannel
  const pinned = upstream.channels?.[channel] ?? {}
  const pluginManifest = path.join(ROOT, 'dsh-plugin-desktop', 'package.json')
  const pluginPinned = readJson(pluginManifest).dependencies?.['@deepseek-ai/dsh'] ?? null

  const vendorRoot = path.join(ROOT, 'vendor', 'dsh-runtime')
  const vendorVersions = fs.existsSync(vendorRoot)
    ? fs.readdirSync(vendorRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()
    : []
  const manifestPath = path.join(vendorRoot, pinned.sourceVersion ?? '', 'manifest.json')
  let manifest = null
  if (fs.existsSync(manifestPath)) {
    manifest = readJson(manifestPath)
  }

  const versions = publishedVersions('@deepseek-ai/dsh')
  const newer = versions === null
    ? null
    : versions
      .filter(v => /-rc\.\d+$/u.test(v) || !v.includes('-'))
      .filter(v => compareVersions(v, pinned.sourceVersion ?? '0.0.0') > 0)
      .sort(compareVersions)

  // Which local artefacts a bump would invalidate.
  const patches = fs.existsSync(path.join(ROOT, 'patches'))
    ? fs.readdirSync(path.join(ROOT, 'patches')).filter(n => n.startsWith('@deepseek-ai') || n.includes('dsh-'))
    : []
  const resolutionCount = Object.keys(readJson(path.join(ROOT, 'package.json')).resolutions ?? {})
    .filter(k => k.startsWith('@deepseek-ai/dsh')).length

  const report = {
    channel,
    pinnedVersion: pinned.sourceVersion ?? null,
    pinnedCommit: pinned.commit ?? null,
    pluginDependency: pluginPinned,
    vendorDirectory: path.relative(ROOT, path.join(vendorRoot, pinned.sourceVersion ?? '')).replaceAll('\\', '/'),
    vendorTarballs: manifest === null ? null : manifest.packages.length,
    vendorBuildProfile: manifest === null ? null : manifest.buildProfile,
    registryReachable: versions !== null,
    newerReleases: newer,
    latestAvailable: versions === null ? null : versions[versions.length - 1],
    bumpWouldTouch: {
      dshResolutions: resolutionCount,
      patches: patches,
      regeneratedByScripts: [
        'vendor/dsh-runtime/<version>/** (yarn upstream:prepare-runtime)',
        'package.json resolutions (scripts/sync-vendored-runtime.mjs --write)',
        'resources/teacher-runtime/{manifests,seed} (scripts/teacher/build-*)',
      ],
    },
    submodulePinnedAt: submoduleCommit(),
  }

  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }

  log('Teacher DSH upstream status')
  log(`  channel            : ${channel}`)
  log(`  pinned Harness     : ${String(report.pinnedVersion)} (${String(report.pinnedCommit).slice(0, 12)})`)
  log(`  plugin dependency  : ${String(report.pluginDependency)}`)
  log(`  submodule checkout : ${String(report.submodulePinnedAt).slice(0, 12)}`)
  log(`  vendor directory   : ${report.vendorDirectory}`)
  log(`  vendor tarballs    : ${String(report.vendorTarballs)} (build profile ${String(report.vendorBuildProfile)})`)
  log('')
  if (!report.registryReachable) {
    log('  registry           : unreachable, cannot check for newer releases')
  } else if (newer === null || newer.length === 0) {
    log(`  upstream           : up to date (latest published ${String(report.latestAvailable)})`)
  } else {
    log(`  upstream           : ${newer.length} newer release(s) available`)
    log(`  newest available   : ${newer[newer.length - 1]}`)
    log(`  all newer          : ${newer.join(', ')}`)
    log('')
    log('  a bump would touch:')
    log(`    ${resolutionCount} dsh resolutions in package.json`)
    log(`    ${patches.length} version-pinned patch(es): ${patches.join(', ')}`)
    log('  run: node scripts/teacher/upstream-bump.mjs --version <version>')
  }
}

/** The Harness commit the submodule is currently checked out at. */
function submoduleCommit() {
  try {
    return execFileSync('git', ['-C', path.join(ROOT, 'deepseek-harness'), 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
}

main()
