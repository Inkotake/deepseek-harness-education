#!/usr/bin/env node
/**
 * Reproducible builder for the three prebuilt vendor plugin trees in
 * `resources/teacher-seed/plugins-built/`.
 *
 * Every producer follows one recipe: copy the pinned input into a scratch directory under
 * `os.tmpdir()`, install and build there, assemble a self-contained installable tree, prove the
 * tree contains no symlink or junction (a Portable install must survive a naive copy), and only
 * then swap it into the repository. The vendored checkouts under
 * `resources/teacher-seed/plugins/` are never built in place and never modified.
 *
 * Usage:
 *   node scripts/teacher/build-vendor-plugins.mjs [--only=<id>[,<id>]] [--force] [--help]
 *
 * Options:
 *   --only=<id>[,<id>]  Build only the named producers
 *                       (dsh-better-sidebar, dsh-cowork, pptkit-presentation).
 *   --force             Rebuild even when SOURCE.json already records the expected version.
 *   --help              Print this message.
 *
 * Idempotence: a producer is skipped when its tree already carries a SOURCE.json whose `version`
 * and `source` match the pin, so a second run is a no-op.
 *
 * Toolchain: the bundled runtime is preferred (`resources/dsh-runtime/node/node.exe`, its npm
 * CLI, and `resources/dsh-runtime/pnpm/bin/pnpm.mjs`); ambient `node`/`npm`/`pnpm` are the
 * fallback. Nothing is installed globally and PATH is never modified.
 *
 * Exit code: 0 when every selected producer was built or skipped, 1 otherwise.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SEED_PLUGINS = path.join(ROOT, 'resources', 'teacher-seed', 'plugins')
const BUILT_PLUGINS = path.join(ROOT, 'resources', 'teacher-seed', 'plugins-built')
const RUNTIME = path.join(ROOT, 'resources', 'dsh-runtime')

const BUNDLED_NODE = path.join(RUNTIME, 'node', 'node.exe')
const BUNDLED_NPM_CLI = path.join(RUNTIME, 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js')
const BUNDLED_PNPM = path.join(RUNTIME, 'pnpm', 'bin', 'pnpm.mjs')

const SIDEBAR_ID = 'dsh-better-sidebar'
const SIDEBAR_VERSION = '0.18.1'
const SIDEBAR_SPEC = `${SIDEBAR_ID}@${SIDEBAR_VERSION}`

/** Directories that must never travel from a vendored checkout into a scratch build. */
const COPY_SKIP = new Set(['.git', 'node_modules'])

const HELP = `Reproducible builder for the prebuilt vendor plugin trees.

Usage:
  node scripts/teacher/build-vendor-plugins.mjs [--only=<id>[,<id>]] [--force] [--help]

Producers:
  ${SIDEBAR_ID}   npm pack ${SIDEBAR_SPEC}, extracted and installed as published
  dsh-cowork           source build from resources/teacher-seed/plugins/dsh-cowork
  pptkit-presentation  source build from resources/teacher-seed/plugins/pptkit-presentation

Options:
  --only=<id>[,<id>]  Build only the listed producers.
  --force             Rebuild even when SOURCE.json already records the expected version.
  --help              Print this message.

Output: resources/teacher-seed/plugins-built/<id>/ with a SOURCE.json
({ id, source, version, license, builtAt }).

Exit code: 0 when every selected producer was built or skipped, 1 otherwise.
`

const NODE = fs.existsSync(BUNDLED_NODE) ? BUNDLED_NODE : process.execPath
const NPM_CLI = fs.existsSync(BUNDLED_NPM_CLI) ? BUNDLED_NPM_CLI : null
const PNPM_ENTRY = fs.existsSync(BUNDLED_PNPM) ? BUNDLED_PNPM : null

const failures = []

function log(message) {
  process.stdout.write(`[build-vendor-plugins] ${message}\n`)
}

function warn(message) {
  process.stderr.write(`[build-vendor-plugins] WARN ${message}\n`)
}

function fail(id, detail) {
  failures.push(`${id}: ${detail}`)
  process.stderr.write(`[build-vendor-plugins] FAIL ${id} - ${detail}\n`)
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

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/** Quote one argument for a cmd.exe command line (ambient-tool fallback only). */
function quoteCmdArg(value) {
  return `"${String(value).replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\*)$/u, '$1$1')}"`
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: options.capture === true ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: false,
  })
  if (result.error !== undefined) {
    throw new Error(`cannot run ${command}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const tail = options.capture === true ? String(result.stderr ?? '').trim().split(/\r?\n/u).pop() : ''
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}${tail ? `: ${tail}` : ''}`)
  }
  return result
}

/**
 * Run a global tool. The bundled toolchain is invoked as `node <entry>`; only the ambient
 * fallback goes through cmd.exe, because `npm`/`pnpm` are `.cmd` shims that CreateProcess cannot
 * launch directly on Windows.
 */
function runTool(tool, args, cwd, options = {}) {
  if (tool === 'npm' && NPM_CLI !== null) return run(NODE, [NPM_CLI, ...args], cwd, options)
  if (tool === 'pnpm' && PNPM_ENTRY !== null) return run(NODE, [PNPM_ENTRY, ...args], cwd, options)
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec ?? 'cmd.exe'
    const line = [tool, ...args].map(quoteCmdArg).join(' ')
    return run(comspec, ['/d', '/s', '/c', line], cwd, options)
  }
  return run(tool, args, cwd, options)
}

function runNpm(args, cwd, options) {
  return runTool('npm', args, cwd, options)
}

function runPnpm(args, cwd, options) {
  return runTool('pnpm', args, cwd, options)
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function copyCheckout(id, scratch) {
  const from = path.join(SEED_PLUGINS, id)
  if (!fs.existsSync(from)) {
    throw new Error(`vendored checkout not found: ${rel(from)} (run scripts/teacher/vendor-plugins.mjs first)`)
  }
  const to = path.join(scratch, 'src')
  fs.cpSync(from, to, {
    recursive: true,
    filter: source => !COPY_SKIP.has(path.basename(source)),
  })
  return to
}

/** Copy named entries out of a built package directory, keeping their relative layout. */
function copyEntries(out, packageDir, names) {
  for (const name of names) {
    const source = path.join(packageDir, name)
    if (!fs.existsSync(source)) throw new Error(`built output missing: ${name} in ${packageDir}`)
    fs.cpSync(source, path.join(out, name), { recursive: true })
  }
}

/** Copy a file when it exists; upstream LICENSE files live at the repository root. */
function copyLicense(out, ...candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      fs.copyFileSync(candidate, path.join(out, 'LICENSE'))
      return candidate
    }
  }
  return null
}

/** True for a symlink or a Windows junction: a Portable install must be plain files and dirs. */
function isLink(target) {
  if (fs.lstatSync(target).isSymbolicLink()) return true
  if (process.platform !== 'win32') return false
  try {
    return fs.realpathSync.native(target).toLowerCase() !== path.resolve(target).toLowerCase()
  } catch {
    return false
  }
}

function findLinks(root) {
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
      if (isLink(full)) {
        found.push(full)
        continue
      }
      if (entry.isDirectory()) stack.push(full)
    }
  }
  return found
}

function directorySize(root) {
  let bytes = 0
  let files = 0
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
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        try {
          bytes += fs.statSync(full).size
          files += 1
        } catch { /* ignore unreadable entries */ }
      }
    }
  }
  return { bytes, files }
}

function assertRealDirectory(target, marker) {
  const stats = fs.lstatSync(target)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`expected a real directory (not a link) at ${target}`)
  }
  if (!fs.existsSync(marker)) throw new Error(`expected ${marker} to exist after npm install`)
}

/** Replace the published tree with the freshly built one; rename first, copy as a fallback. */
function publish(out, target) {
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(target), { recursive: true })
  try {
    fs.renameSync(out, target)
    return
  } catch { /* fall through to a copy when the rename crosses a device boundary */ }
  fs.cpSync(out, target, { recursive: true })
  fs.rmSync(out, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Producers
// ---------------------------------------------------------------------------

/** Read the pin a vendored git checkout was recorded with. */
function vendoredSource(id) {
  const file = path.join(SEED_PLUGINS, id, 'SOURCE.json')
  const meta = readJson(file)
  if (meta === null) {
    throw new Error(`missing or unparsable ${rel(file)}; run scripts/teacher/vendor-plugins.mjs first`)
  }
  return meta
}

function packageVersion(dir) {
  const manifest = readJson(path.join(dir, 'package.json'))
  if (manifest === null || typeof manifest.version !== 'string') {
    throw new Error(`cannot read a version from ${rel(path.join(dir, 'package.json'))}`)
  }
  return manifest.version
}

const PRODUCERS = new Map()

PRODUCERS.set(SIDEBAR_ID, {
  id: SIDEBAR_ID,
  expected() {
    return { version: SIDEBAR_VERSION, license: 'MIT', source: `npm:${SIDEBAR_SPEC}` }
  },
  build({ scratch, out }) {
    const packDir = path.join(scratch, 'pack')
    fs.mkdirSync(packDir, { recursive: true })
    runNpm(['pack', SIDEBAR_SPEC, '--pack-destination', packDir], scratch)

    const tarballs = fs.readdirSync(packDir).filter(name => name.endsWith('.tgz'))
    if (tarballs.length !== 1) {
      throw new Error(`expected exactly one tarball in ${packDir}, found ${tarballs.length}`)
    }

    fs.mkdirSync(out, { recursive: true })
    run('tar', ['-xzf', path.join(packDir, tarballs[0]), '-C', out, '--strip-components=1'], scratch)

    // --legacy-peer-deps is required, not cosmetic: without it npm 7+ resolves this plugin's
    // peerDependencies and installs a second, complete copy of the @deepseek-ai/* harness into
    // the plugin tree, instead of leaving those peers to the host that mounts the plugin.
    runNpm(['install', '--omit=dev', '--no-audit', '--no-fund', '--legacy-peer-deps'], out)

    // Do NOT rebuild this plugin: the published lib/** is the verified artifact.
  },
})

PRODUCERS.set('dsh-cowork', {
  id: 'dsh-cowork',
  expected() {
    const meta = vendoredSource('dsh-cowork')
    const version = packageVersion(path.join(SEED_PLUGINS, 'dsh-cowork', 'packages', 'dsh'))
    return { version, license: 'MIT', source: meta.commit }
  },
  build({ scratch, out, stores }) {
    const src = copyCheckout('dsh-cowork', scratch)

    // --ignore-scripts matters: the workspace root `prepare` would otherwise build three
    // unrelated packages that this tree does not ship.
    runPnpm([
      'install',
      '--filter', 'dsh-cowork',
      '--filter', '@dsh-cowork/core',
      '--filter', '@dsh-cowork/plugin',
      '--store-dir', stores,
      '--ignore-scripts',
      '--reporter=append-only',
    ], src)
    runPnpm(['--filter', '@dsh-cowork/core', 'run', 'build'], src)
    runPnpm(['--filter', '@dsh-cowork/plugin', 'run', 'build'], src)

    const coreDir = path.join(src, 'packages', 'core')
    runNpm(['pack'], coreDir)
    const tarballs = fs.readdirSync(coreDir).filter(name => name.endsWith('.tgz'))
    if (tarballs.length !== 1) {
      throw new Error(`expected exactly one core tarball in ${coreDir}, found ${tarballs.length}`)
    }
    const coreTarball = tarballs[0]

    const pluginDir = path.join(src, 'packages', 'dsh')
    copyEntries(out, pluginDir, ['package.json', 'lib', 'cordis.patch.yml'])
    if (copyLicense(out, path.join(pluginDir, 'LICENSE'), path.join(src, 'LICENSE')) === null) {
      throw new Error('no LICENSE found for dsh-cowork')
    }

    const manifest = readJson(path.join(out, 'package.json'))
    if (manifest === null) throw new Error('assembled dsh-cowork package.json is not valid JSON')
    delete manifest.devDependencies
    manifest.dependencies = { '@dsh-cowork/core': `file:./vendor/${coreTarball}` }
    writeJson(path.join(out, 'package.json'), manifest)

    const vendorDir = path.join(out, 'vendor')
    fs.mkdirSync(vendorDir, { recursive: true })
    fs.copyFileSync(path.join(coreDir, coreTarball), path.join(vendorDir, coreTarball))

    runNpm(['install', '--omit=dev', '--no-audit', '--no-fund', '--legacy-peer-deps'], out)
    assertRealDirectory(
      path.join(out, 'node_modules', '@dsh-cowork', 'core'),
      path.join(out, 'node_modules', '@dsh-cowork', 'core', 'lib', 'index.js'),
    )
  },
})

PRODUCERS.set('pptkit-presentation', {
  id: 'pptkit-presentation',
  expected() {
    const meta = vendoredSource('pptkit-presentation')
    const version = packageVersion(
      path.join(SEED_PLUGINS, 'pptkit-presentation', 'packages', 'dsh-plugin-pptkit-presentation'),
    )
    return { version, license: 'MIT', source: meta.commit }
  },
  build({ scratch, out, stores }) {
    const src = copyCheckout('pptkit-presentation', scratch)

    runPnpm([
      'install',
      '--filter', 'pptkit-presentation',
      '--filter', 'dsh-plugin-pptkit-presentation',
      '--store-dir', stores,
      '--ignore-scripts',
      '--reporter=append-only',
    ], src)
    // Exactly: node scripts/sync-skill.mjs && tsc -p tsconfig.json
    runPnpm(['--filter', 'dsh-plugin-pptkit-presentation', 'run', 'build'], src)

    const packageDir = path.join(src, 'packages', 'dsh-plugin-pptkit-presentation')
    copyEntries(out, packageDir, ['package.json', 'dist', 'cordis.patch.yml', 'skill'])
    if (copyLicense(out, path.join(packageDir, 'LICENSE'), path.join(src, 'LICENSE')) === null) {
      throw new Error('no LICENSE found for pptkit-presentation')
    }

    const manifest = readJson(path.join(out, 'package.json'))
    if (manifest === null) throw new Error('assembled pptkit package.json is not valid JSON')
    delete manifest.devDependencies
    // A `prepare`/`prepack` script would fire on any later `npm install` in the shipped tree and
    // demand a build step (`tsc`, `scripts/sync-skill.mjs`) that does not exist there. `build`,
    // `test`, and `typecheck` stay for provenance.
    if (manifest.scripts !== undefined && manifest.scripts !== null) {
      delete manifest.scripts.prepare
      delete manifest.scripts.prepack
    }
    writeJson(path.join(out, 'package.json'), manifest)

    runNpm(['install', '--omit=dev', '--no-audit', '--no-fund', '--legacy-peer-deps'], out)
  },
})

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function parseOnly(args) {
  const inline = args.find(arg => arg.startsWith('--only='))
  if (inline !== undefined) {
    return inline.slice('--only='.length).split(',').map(value => value.trim()).filter(Boolean)
  }
  const index = args.indexOf('--only')
  if (index >= 0) {
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) return []
    return value.split(',').map(entry => entry.trim()).filter(Boolean)
  }
  return null
}

function buildOne(id, options) {
  const producer = PRODUCERS.get(id)
  const expected = producer.expected()
  const target = path.join(BUILT_PLUGINS, id)

  if (!options.force) {
    const existing = readJson(path.join(target, 'SOURCE.json'))
    if (existing !== null && existing.version === expected.version && existing.source === expected.source) {
      const size = directorySize(target)
      log(
        `OK ${id} already built at ${expected.version} (source ${expected.source}); `
        + 'skipping, use --force to rebuild',
      )
      log(`${id}: version ${expected.version}, ${(size.bytes / 1024 / 1024).toFixed(1)} MB, ${size.files} files`)
      return
    }
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `tdsh-vendor-${id}-`))
  const out = path.join(scratch, 'out')
  fs.mkdirSync(out, { recursive: true })
  log(`building ${id} in ${scratch}`)
  try {
    producer.build({ scratch, out, stores: options.stores })

    const links = findLinks(out)
    if (links.length > 0) {
      throw new Error(
        `${links.length} symlink/junction(s) found in the built tree; a Portable install would `
        + `break. First: ${rel(links[0])}`,
      )
    }

    const manifest = readJson(path.join(out, 'package.json'))
    const version = typeof manifest?.version === 'string' ? manifest.version : expected.version
    fs.writeFileSync(path.join(out, 'SOURCE.json'), `${JSON.stringify({
      id,
      source: expected.source,
      version,
      license: expected.license,
      builtAt: new Date().toISOString(),
    }, null, 2)}\n`)

    const size = directorySize(out)
    publish(out, target)
    log(`${id}: version ${version}, ${(size.bytes / 1024 / 1024).toFixed(1)} MB, ${size.files} files`)
    log(`OK ${id} -> ${rel(target)}`)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP)
    return
  }

  const known = new Set(['--force', '--only', '--help', '-h'])
  const unknown = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--only') {
      index += 1
      continue
    }
    if (known.has(arg) || arg.startsWith('--only=')) continue
    unknown.push(arg)
  }
  if (unknown.length > 0) {
    fail('arguments', `unknown argument(s): ${unknown.join(', ')}`)
    process.stderr.write(HELP)
    process.exitCode = 1
    return
  }

  const only = parseOnly(args)
  const selected = only === null ? [...PRODUCERS.keys()] : only
  const invalid = selected.filter(id => !PRODUCERS.has(id))
  if (invalid.length > 0) {
    fail('arguments', `unknown producer(s): ${invalid.join(', ')}; known: ${[...PRODUCERS.keys()].join(', ')}`)
    process.exitCode = 1
    return
  }
  if (selected.length === 0) {
    fail('arguments', '--only selected no producers')
    process.exitCode = 1
    return
  }

  log(`toolchain: node ${NODE === process.execPath ? `${NODE} (ambient)` : `${NODE} (bundled)`}`)
  if (NPM_CLI === null) warn('bundled npm not found; falling back to the ambient npm')
  if (PNPM_ENTRY === null) warn('bundled pnpm not found; falling back to the ambient pnpm')

  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsh-vendor-build-'))
  const stores = path.join(scratchRoot, 'pnpm-store')
  try {
    for (const id of selected) {
      try {
        buildOne(id, { force: args.includes('--force'), stores })
      } catch (cause) {
        fail(id, cause instanceof Error ? cause.message : String(cause))
      }
    }
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    process.stderr.write(`[build-vendor-plugins] ${failures.length} producer(s) failed\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `[build-vendor-plugins] OK ${selected.length} producer(s) up to date: ${selected.join(', ')}\n`,
  )
}

main()
