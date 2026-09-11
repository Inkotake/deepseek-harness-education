#!/usr/bin/env node
/**
 * Builds the bundled Teacher DSH profile seed.
 *
 * The seed is a complete, already-materialised DSH home: the `desktop` profile with the
 * launcher bundles, the three pinned vendor plugins installed under
 * `profiles/desktop/node_modules`, and the Teacher Skills in place. First run only copies it
 * into the user's DSH home, so a fresh installation never touches the network to become usable.
 *
 * Output: `resources/teacher-runtime/seed/dsh-home/`
 *
 * Usage:
 *   node scripts/teacher/build-profile-seed.mjs [--inspect]
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { pruneRuntimeTree } from './build-teacher-runtime.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DESKTOP = path.join(ROOT, 'dsh-plugin-desktop')
const TEACHER_RUNTIME = path.join(ROOT, 'resources', 'teacher-runtime')
const SEED = path.join(TEACHER_RUNTIME, 'seed', 'dsh-home')
const PLUGINS_BUILT = path.join(ROOT, 'resources', 'teacher-seed', 'plugins-built')
const INSPECT = process.argv.includes('--inspect')

/**
 * Package names, in mount order, with the directory that provides each one.
 *
 * `dsh-plugin-pptkit-presentation` is deliberately absent. It registered a second provider for a
 * skill this distribution already bundles through `DSH_BUNDLED_SKILL_DIR`, and the two copies are
 * byte-identical (33 files, same SHA-256), so mounting it only duplicated the catalog entry.
 */
const VENDOR_PLUGINS = [
  { packageName: 'dsh-better-sidebar', source: 'dsh-better-sidebar' },
  { packageName: '@dsh-cowork/plugin', source: 'dsh-cowork' }
]

/**
 * The desktop-authored Host plugin the shipped profile has to be able to resolve.
 *
 * `@teacher-dsh/global-memory` is mounted by the desktop-owned Host layer
 * (`dsh-plugin-desktop/cordis.patch.yml`) rather than by a bundle layer, because the design
 * requires ONE shared memory service for every preset and a bundle or preset `isolate` realm
 * would give each preset its own. A row the Host mounts by package name still has to be
 * resolvable from the profile, so its built runtime tree — placed in
 * `resources/teacher-runtime/global-memory/` by `build-teacher-runtime.mjs` — is installed into
 * `profiles/desktop/node_modules` here, exactly where a bundle layer's packages are linked.
 *
 * It is deliberately NOT appended to `dsh.profile.bundles`: a bundle layer would contribute its
 * `dsh.bundle.patch` as a second mount of the same runtime, and the two mounts would collide on
 * the one `global-memory` row id the desktop patch already inserts.
 */
const HOST_RUNTIME_PLUGINS = [
  {
    packageName: '@teacher-dsh/global-memory',
    source: path.join(TEACHER_RUNTIME, 'global-memory'),
    role: 'shared long-term memory service (Host plane, mounted by dsh-plugin-desktop/cordis.patch.yml)'
  }
]

function log(message) {
  process.stdout.write(`[profile-seed] ${message}\n`)
}

function warn(message) {
  process.stderr.write(`[profile-seed] WARN ${message}\n`)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/**
 * Installation-owned Harness home settings; every other default belongs to the Harness itself.
 *
 * This is where a distribution pins what a fresh Teacher DSH installation starts from. Teacher
 * DSH 0.1 ships the compatibility shell with no ordinary-browser and no LAN web surface, so
 * `openBrowser` and `networkExposure` are written out explicitly instead of relying on the
 * launcher's absent-document fallback. Both remain user-changeable in the Desktop settings UI.
 */
const SETTINGS = [
  '# Teacher DSH defaults. Model configuration stays in the Harness settings UI.',
  'dsh-desktop:',
  '  mode: compatibility',
  '  # Teacher DSH 0.1 ships no browser/web surface: the renderer uses the loopback server only.',
  '  openBrowser: false',
  '  networkExposure: loopback',
  '# Curated sidebar for the teacher-facing default.',
  '#',
  '# `tabsEnabled: false` HIDES a tab type without deleting it: it leaves the + menu, openTab refuses',
  '# it, and the tab can be turned back on from the plugin\'s own settings or by editing this file.',
  '# The change list and the diff view are the two a teacher does not read, and version history stays',
  '# available to the agent instead (see the education preset): the file manager stays visible.',
  'dsh-better-sidebar:',
  '  tabsEnabled:',
  '    git: false',
  '    diff: false',
  ''
].join('\n')

/**
 * Trim a prebuilt plugin tree to what a Windows x64 installation actually loads.
 *
 * The plugin trees share `pruneRuntimeTree` with `build-teacher-runtime.mjs` instead of keeping
 * a second copy of the rules, so the seed plugin trees and the `artifact`/`ppt`/`deploy` trees
 * can never drift apart. Every removal is still guarded by the package manifest: a path the
 * plugin publishes is refused.
 */
function prunePluginTree(root) {
  pruneRuntimeTree(root, { label: path.basename(root), log, warn })
}

/**
 * Payload that only a bundled vendor plugin carries, and that static recon proved dead.
 *
 * Every entry removes a bundled dependency whose code the plugin's own client bundle already
 * inlines (`lib/*.js` is what the Host serves), or an empty scope directory. The removal is
 * guarded, never assumed: it happens only when no shipped JavaScript file of the plugin
 * resolves the package with a bare specifier — static (`from 'x'`, `require('x')`,
 * `import('x')`) or dynamic (`createRequire(...).resolve('x')`). A future plugin build that
 * starts importing the package again therefore keeps its copy.
 */
const PLUGIN_DEAD_PAYLOAD = new Map([
  ['dsh-better-sidebar', [
    {
      path: 'node_modules/react-icons',
      specifier: 'react-icons',
      reason: 'inlined into lib/client.js and lib/client-registry.js'
    },
    {
      path: 'node_modules/mermaid',
      specifier: 'mermaid',
      reason: 'inlined into lib/client-mermaid.js, which stays in the package'
    },
    {
      path: 'node_modules/@xterm',
      onlyIfEmpty: true,
      reason: 'empty scope directory'
    }
  ]],
  ['@dsh-cowork/plugin', [
    {
      path: 'node_modules/@napi-rs',
      specifier: '@napi-rs/canvas',
      reason:
        'optional pdf.js page-render dependency. @dsh-cowork/core only calls getDocument + '
        + 'getTextContent and never calls page.render, so the Skia canvas is loaded but its '
        + 'capability is never exercised. Verified empirically: reading a PDF through the real '
        + 'readDocument with @napi-rs/canvas made unresolvable returns byte-identical text, '
        + 'with only pdf.js "rendering may be broken" warnings.'
    }
  ]]
])

const PLUGIN_SCRIPT_EXTENSIONS = /\.(?:js|mjs|cjs)$/u

/** Plugin package names its shipped JavaScript resolves with a bare specifier. */
function bareSpecifiersIn(root, names) {
  const found = new Set()
  const patterns = [...names].map(name => [
    name,
    new RegExp(
      `(?:from|require|import|resolve)\\s*\\(?\\s*['"]`
      + `${name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:/[^'"]*)?['"]`,
      'u'
    )
  ])
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      // Only the package's own shipped files matter; node_modules is what we are pruning.
      if (entry.name === 'node_modules') continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile() || !PLUGIN_SCRIPT_EXTENSIONS.test(entry.name)) continue
      let text
      try {
        text = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      for (const [name, pattern] of patterns) {
        if (pattern.test(text)) found.add(name)
      }
    }
  }
  return found
}

/** True when `dir` holds no files at all, recursively. */
function isFileFreeTree(dir) {
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) return false
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name))
        continue
      }
      if (entry.isFile()) return false
    }
  }
  return true
}

/** Remove the plugin-only dead payload `PLUGIN_DEAD_PAYLOAD` declares for `packageName`. */
function prunePluginDeadPayload(root, packageName) {
  const candidates = PLUGIN_DEAD_PAYLOAD.get(packageName) ?? []
  if (candidates.length === 0) return
  const named = candidates.filter(entry => entry.specifier !== undefined).map(entry => entry.specifier)
  const referenced = named.length === 0 ? new Set() : bareSpecifiersIn(root, named)
  for (const candidate of candidates) {
    const target = path.join(root, candidate.path)
    if (!fs.existsSync(target)) continue
    const stat = fs.lstatSync(target)
    if (stat.isSymbolicLink()) {
      warn(`symlink/junction found, leaving it alone: ${target}`)
      continue
    }
    if (!stat.isDirectory()) continue
    if (candidate.specifier !== undefined && referenced.has(candidate.specifier)) {
      log(`SKIP (bare specifier present): ${packageName} ${candidate.path}`)
      continue
    }
    if (candidate.onlyIfEmpty === true && !isFileFreeTree(target)) {
      log(`SKIP (not empty): ${packageName} ${candidate.path}`)
      continue
    }
    const before = directorySize(target)
    fs.rmSync(target, { recursive: true, force: true })
    log(
      `removed ${packageName}/${candidate.path}: `
      + `${(before.bytes / 1024 / 1024).toFixed(1)} MB, ${before.files} files — ${candidate.reason}`
    )
  }
}

/** The machine-wide patch is intentionally empty: vendor plugins mount through their bundles. */
const MACHINE_PATCH = [
  '# Teacher DSH machine-wide patch layer.',
  '# Vendor plugins mount through `dsh.profile.bundles` and their own bundle patch, so this',
  '# layer stays empty and is reserved for the teacher.',
  '[]',
  ''
].join('\n')

async function main() {
  if (!fs.existsSync(path.join(DESKTOP, 'lib', 'profile.js'))) {
    throw new Error('dsh-plugin-desktop is not built; run "corepack yarn workspace dsh-plugin-desktop build" first')
  }

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsh-seed-'))
  log(`staging home: ${home}`)
  fs.writeFileSync(path.join(home, 'settings.yaml'), SETTINGS)
  fs.writeFileSync(path.join(home, 'cordis.yml'), MACHINE_PATCH)

  const { prepareDesktopProfile } = await import(
    pathToFileURL(path.join(DESKTOP, 'lib', 'profile.js')).href
  )
  const prepared = prepareDesktopProfile('1', home, 'win32')
  const profileDir = prepared.profile.dir
  const profileManifestPath = path.join(profileDir, 'package.json')
  const manifest = readJson(profileManifestPath)
  const requiredBundles = manifest.dsh?.profile?.bundles ?? []
  log(`profile dir: ${profileDir}`)
  log(`launcher bundles: ${requiredBundles.length}`)

  // Install the prebuilt vendor plugins as real directories inside the profile.
  const nodeModules = path.join(profileDir, 'node_modules')
  ensureDir(nodeModules)
  const installed = []
  for (const plugin of VENDOR_PLUGINS) {
    const source = path.join(PLUGINS_BUILT, plugin.source)
    if (!fs.existsSync(source)) {
      warn(`prebuilt plugin missing: ${plugin.source} (expected at ${source})`)
      continue
    }
    const target = path.join(nodeModules, ...plugin.packageName.split('/'))
    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(source, target, { recursive: true, dereference: true })
    prunePluginTree(target)
    prunePluginDeadPayload(target, plugin.packageName)
    const entry = readJson(path.join(target, 'package.json'))
    const main = path.join(target, entry.main ?? 'index.js')
    if (!fs.existsSync(main)) {
      warn(`${plugin.packageName} main entry does not exist: ${main}`)
    }
    installed.push(plugin.packageName)
    log(`installed ${plugin.packageName}@${entry.version}`)
  }

  // Reconcile `dsh.profile.bundles`: launcher bundles first, then vendor plugins in pin order.
  // `HOST_RUNTIME_PLUGINS` are deliberately absent: they are mounted by the Host layer, not by a
  // bundle layer (see the constant's own note).
  const bundles = [...requiredBundles.filter((name) => !installed.includes(name)), ...installed]

  // Install the built Host-plane runtime trees beside the vendor plugins. These are not profile
  // bundles; they only have to resolve from the profile's node_modules so the desktop-owned Host
  // layer can mount them by package name.
  const hostRuntimePlugins = []
  for (const plugin of HOST_RUNTIME_PLUGINS) {
    if (!fs.existsSync(plugin.source)) {
      throw new Error(
        `Host runtime package missing: ${plugin.source}; `
        + 'run "node scripts/teacher/build-teacher-runtime.mjs" first'
      )
    }
    if (bundles.includes(plugin.packageName)) {
      throw new Error(`${plugin.packageName} is a Host-mounted runtime and must not be a profile bundle`)
    }
    const target = path.join(nodeModules, ...plugin.packageName.split('/'))
    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(plugin.source, target, { recursive: true, dereference: true })
    prunePluginTree(target)
    const entry = readJson(path.join(target, 'package.json'))
    const main = path.join(target, entry.main ?? 'index.js')
    if (!fs.existsSync(main)) {
      throw new Error(`${plugin.packageName} main entry does not exist: ${main}`)
    }
    if (entry.dsh?.bundle !== undefined) {
      throw new Error(
        `${plugin.packageName} must not declare dsh.bundle: it is mounted by the Host layer, `
        + 'and a bundle layer would mount the same row a second time'
      )
    }
    hostRuntimePlugins.push(plugin.packageName)
    log(`installed ${plugin.packageName}@${entry.version} (${plugin.role})`)
  }

  fs.writeFileSync(profileManifestPath, `${JSON.stringify({
    ...manifest,
    dsh: {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles }
    }
  }, null, 2)}\n`)
  log(`profile bundles: ${bundles.join(', ')}`)

  fs.writeFileSync(path.join(home, 'TEACHER-SEED.json'), `${JSON.stringify({
    name: 'teacher-dsh.profile-seed',
    version: '0.1.0',
    builtAt: new Date().toISOString(),
    profile: 'desktop',
    bundles,
    vendorPlugins: installed,
    note: 'Copied verbatim into DSH_HOME on first run; never installed from the network.'
  }, null, 2)}\n`)

  if (INSPECT) {
    log('--- profile package.json ---')
    process.stdout.write(fs.readFileSync(profileManifestPath, 'utf8'))
    log('--- tree (depth 3) ---')
    printTree(home, 3)
  }

  // Verify no symlink escaped the staged home; the seed must survive a plain file copy.
  const links = findSymlinks(home)
  if (links.length > 0) {
    warn(`seed contains ${links.length} symlink(s); dereferencing on copy`)
    for (const link of links.slice(0, 10)) warn(`  ${path.relative(home, link)}`)
  }

  fs.rmSync(SEED, { recursive: true, force: true })
  ensureDir(SEED)
  fs.cpSync(home, SEED, { recursive: true, dereference: true })
  fs.rmSync(home, { recursive: true, force: true })

  const size = directorySize(SEED)
  log(`seed written: ${SEED} (${(size.bytes / 1024 / 1024).toFixed(1)} MB, ${size.files} files)`)
  verifySeed()
}

/** Re-verify the final seed is copy-safe and self-describing. */
function verifySeed() {
  const profileDir = path.join(SEED, 'profiles', 'desktop')
  const manifestPath = path.join(profileDir, 'package.json')
  if (!fs.existsSync(manifestPath)) throw new Error('seed is missing profiles/desktop/package.json')
  const manifest = readJson(manifestPath)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  for (const plugin of VENDOR_PLUGINS) {
    const target = path.join(profileDir, 'node_modules', ...plugin.packageName.split('/'))
    if (!fs.existsSync(target)) {
      warn(`seed does not include ${plugin.packageName}`)
      continue
    }
    if (!bundles.includes(plugin.packageName)) {
      throw new Error(`seed bundles do not list ${plugin.packageName}`)
    }
    const entry = readJson(path.join(target, 'package.json'))
    const main = path.join(target, entry.main ?? 'index.js')
    if (!fs.existsSync(main)) throw new Error(`${plugin.packageName} main entry missing in seed: ${main}`)
  }
  const links = findSymlinks(SEED)
  if (links.length > 0) {
    warn(`seed still contains ${links.length} symlink(s): ${links.slice(0, 5).join(', ')}`)
  }
  log(`seed verified: ${bundles.length} bundles, ${VENDOR_PLUGINS.length} vendor plugins expected`)
}

function findSymlinks(root) {
  const found = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) {
        found.push(full)
        continue
      }
      if (entry.isDirectory()) stack.push(full)
    }
  }
  return found
}

function directorySize(dir) {
  let bytes = 0
  let files = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        try {
          bytes += fs.statSync(full).size
          files += 1
        } catch { /* ignore */ }
      }
    }
  }
  return { bytes, files }
}

function printTree(root, depth, prefix = '') {
  if (depth < 0) return
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    process.stdout.write(`[profile-seed] ${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}\n`)
    if (entry.isDirectory() && depth > 0) printTree(path.join(root, entry.name), depth - 1, `${prefix}  `)
  }
}

main().catch((cause) => {
  process.stderr.write(`[profile-seed] ERROR ${cause instanceof Error ? cause.stack : String(cause)}\n`)
  process.exitCode = 1
})
