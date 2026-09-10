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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DESKTOP = path.join(ROOT, 'dsh-plugin-desktop')
const TEACHER_RUNTIME = path.join(ROOT, 'resources', 'teacher-runtime')
const SEED = path.join(TEACHER_RUNTIME, 'seed', 'dsh-home')
const PLUGINS_BUILT = path.join(ROOT, 'resources', 'teacher-seed', 'plugins-built')
const INSPECT = process.argv.includes('--inspect')

/** Package names, in mount order, with the directory that provides each one. */
const VENDOR_PLUGINS = [
  { packageName: 'dsh-better-sidebar', source: 'dsh-better-sidebar' },
  { packageName: '@dsh-cowork/plugin', source: 'dsh-cowork' },
  { packageName: 'dsh-plugin-pptkit-presentation', source: 'pptkit-presentation' }
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

/** Minimal Harness home settings; every other default belongs to the Harness itself. */
const SETTINGS = [
  '# Teacher DSH defaults. Model configuration stays in the Harness settings UI.',
  'dsh-desktop:',
  '  mode: compatibility',
  ''
].join('\n')

/**
 * Trim a prebuilt plugin tree to what a Windows x64 installation actually loads.
 *
 * Everything removed here is either a build artifact (source maps, debug symbols), a type-only
 * declaration for an editor, or a native binary for a platform this distribution does not ship.
 * No runtime JavaScript entry point is touched.
 */
function prunePluginTree(root) {
  const before = directorySize(root)
  /** Directory names that only ever hold another platform's native payload. */
  const foreignPlatform = /^(darwin|linux|freebsd|openbsd|netbsd|sunos|android|win32-arm64|win32-ia32|wasm32)/u
  let removed = 0
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    const inPrebuilds = /[\\/]prebuilds$/u.test(current)
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) {
        warn(`unexpected symlink in plugin tree: ${full}`)
        continue
      }
      if (entry.isDirectory()) {
        if (inPrebuilds && foreignPlatform.test(entry.name)) {
          fs.rmSync(full, { recursive: true, force: true })
          removed += 1
          continue
        }
        stack.push(full)
        continue
      }
      if (/\.(map|pdb)$/iu.test(entry.name)) {
        fs.rmSync(full, { force: true })
        removed += 1
      }
    }
  }
  const after = directorySize(root)
  log(
    `pruned ${path.basename(root)}: ${removed} entries, `
    + `${(before.bytes / 1024 / 1024).toFixed(1)} MB -> ${(after.bytes / 1024 / 1024).toFixed(1)} MB`,
  )
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
    const entry = readJson(path.join(target, 'package.json'))
    const main = path.join(target, entry.main ?? 'index.js')
    if (!fs.existsSync(main)) {
      warn(`${plugin.packageName} main entry does not exist: ${main}`)
    }
    installed.push(plugin.packageName)
    log(`installed ${plugin.packageName}@${entry.version}`)
  }

  // Reconcile `dsh.profile.bundles`: launcher bundles first, then vendor plugins in pin order.
  const bundles = [...requiredBundles.filter((name) => !installed.includes(name)), ...installed]
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
