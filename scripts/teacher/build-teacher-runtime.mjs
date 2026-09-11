#!/usr/bin/env node
/**
 * Builds the bundled Teacher DSH runtime trees under `resources/`.
 *
 * Output (consumed by electron-builder `extraResources`):
 *
 *   resources/dsh-runtime/{node,pnpm,dsh,node_modules}
 *   resources/teacher-runtime/{cli,artifact,ppt,deploy,skills,plugins,bin,manifests}
 *
 * Every step is idempotent and can be selected with `--only=`/`--skip=`.
 *
 * Usage:
 *   node scripts/teacher/build-teacher-runtime.mjs
 *   node scripts/teacher/build-teacher-runtime.mjs --only=node,artifact
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RESOURCES = path.join(ROOT, 'resources')
const DSH_RUNTIME = path.join(RESOURCES, 'dsh-runtime')
const TEACHER_RUNTIME = path.join(RESOURCES, 'teacher-runtime')
const DOWNLOADS = path.join(ROOT, 'build', 'downloads')
const TEACHER = path.join(ROOT, 'teacher')

const NODE_VERSION = '22.23.2'
const PNPM_VERSION = '11.8.0'

/** Pinned artifact toolchain versions. Keep in sync with teacher/manifests/toolchain.lock.json. */
const ARTIFACT_DEPS = {
  vite: '8.2.2',
  three: '0.186.0',
  jsxgraph: '1.13.3',
  katex: '0.18.7',
  echarts: '6.1.0',
  mermaid: '12.0.0',
  'matter-js': '0.20.0'
}

/** Pinned deploy CLI versions. */
const DEPLOY_DEPS = {
  'netlify-cli': '27.5.2',
  wrangler: '4.130.0',
  vercel: '59.15.1'
}

/** Pinned presentation dependency. */
const PPT_DEPS = { pptxgenjs: '4.0.1' }

const args = process.argv.slice(2)
const onlyArg = args.find(a => a.startsWith('--only='))?.slice('--only='.length)
const skipArg = args.find(a => a.startsWith('--skip='))?.slice('--skip='.length)
const ONLY = onlyArg === undefined ? null : new Set(onlyArg.split(',').map(s => s.trim()).filter(Boolean))
const SKIP = new Set((skipArg ?? '').split(',').map(s => s.trim()).filter(Boolean))

function log(message) {
  process.stdout.write(`[teacher-runtime] ${message}\n`)
}

function warn(message) {
  process.stderr.write(`[teacher-runtime] WARN ${message}\n`)
}

function shouldRun(step) {
  if (SKIP.has(step)) return false
  if (ONLY !== null && !ONLY.has(step)) return false
  return true
}

function run(command, argv, options = {}) {
  log(`$ ${command} ${argv.join(' ')}`)
  const result = spawnSync(command, argv, {
    cwd: options.cwd ?? ROOT,
    stdio: options.stdio ?? 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
    shell: false
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${argv.join(' ')} exited with ${result.status}`)
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function emptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

function copyDir(from, to, filter = () => true) {
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (source) => filter(source, path.relative(from, source))
  })
}

function writeJson(file, value) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** SHA-256 of one file, used to detect repacked local artifacts. */
function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function directorySize(dir) {
  let total = 0
  let count = 0
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
          total += fs.statSync(full).size
          count += 1
        } catch { /* ignore */ }
      }
    }
  }
  return { bytes: total, files: count }
}

function reportSize(label, dir) {
  const { bytes, files } = directorySize(dir)
  log(`${label}: ${(bytes / 1024 / 1024).toFixed(1)} MB, ${files} files`)
}

// ---------------------------------------------------------------------------
// pruning
// ---------------------------------------------------------------------------

/**
 * Platform suffixes npm gives prebuilt native packages. Every flavour except the Windows x64
 * one is dead weight in this distribution, which only ever runs on win32-x64.
 */
const FOREIGN_PLATFORM_SUFFIXES = [
  '-darwin-x64', '-darwin-arm64', '-linux-x64', '-linux-arm', '-linux-arm64', '-linux-ia32',
  '-linux-ppc64', '-linux-riscv64', '-linux-s390x', '-linuxmusl-x64', '-linuxmusl-arm64',
  '-linux-x64-gnu', '-linux-arm64-gnu', '-freebsd-x64', '-freebsd-ia32', '-freebsd-arm64',
  '-openbsd-x64', '-openbsd-ia32', '-android-arm64', '-wasm32', '-win32-ia32', '-win32-arm64',
  '-webcontainers-wasm32'
]

/** The only `prebuilds/<platform>` directory a Windows x64 distribution can load. */
const NATIVE_PLATFORM_DIRECTORY = 'win32-x64'

const TEST_DIRECTORY_NAMES = new Set(['test', 'tests', '__tests__', 'spec', '__snapshots__'])
const DOCUMENTATION_EXTENSIONS = new Set(['.md', '.markdown', '.rst', '.txt', '.pdf'])
/** Legal files are never pruned; THIRD_PARTY_NOTICES depends on them surviving. */
const LEGAL_FILE_NAME = /^(?:licen[cs]e|copying|notice)(?:\..*)?$/iu
const BUILT_OUTPUT_DIRECTORY_NAMES = ['dist', 'lib', 'build']
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const MEBIBYTE = 1024 * 1024

/**
 * Packages whose payload is functionality rather than bloat. No bulk rule may remove anything
 * from them, and nothing nested inside them either.
 */
const PROTECTED_PACKAGES = new Set([
  '@cloudflare/workerd-windows-64',
  'miniflare',
  'wrangler',
  '@electric-sql/pglite',
  'typescript',
  'tsx',
  'ts-morph',
  '@img/sharp-win32-x64',
  'lightningcss',
  'esbuild',
  '@esbuild/win32-x64',
  'rollup',
  'rolldown',
  '@rolldown/binding-win32-x64-msvc',
  'node-pty',
  '@napi-rs/canvas-win32-x64-msvc'
])
const PROTECTED_PACKAGE_PATTERNS = [
  /^@vercel\/(?:go|rust|python|python-analysis|node|next|static-build|remix-builder|redwood|hydrogen|gatsby-plugin-vercel-builder)$/u,
  /^@img\/sharp-libvips-/u,
  /^@rollup\//u,
  /^@esbuild\//u,
  /^lightningcss-/u,
  /^@napi-rs\/.*win32-x64-msvc$/u
]

function isProtectedPackage(name) {
  if (name === null) return false
  return PROTECTED_PACKAGES.has(name) || PROTECTED_PACKAGE_PATTERNS.some(pattern => pattern.test(name))
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target)
  } catch {
    return null
  }
}

/** npm package name declared by `<dir>/package.json`, or null when there is none. */
function packageNameAt(dir) {
  const file = path.join(dir, 'package.json')
  const stat = lstatOrNull(file)
  if (stat === null || !stat.isFile()) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof parsed?.name === 'string' && parsed.name !== '' ? parsed.name : null
  } catch {
    return null
  }
}

/** package.json fields whose values name a shipped file or directory. */
const MANIFEST_PATH_FIELDS = ['main', 'module', 'browser', 'types', 'typings', 'bin', 'files']

/**
 * Normalise a package-relative path for prefix comparison: strip the leading `./`, drop the
 * trailing wildcard and trailing slashes. `./examples/jsm/*` becomes `examples/jsm`.
 */
function normalizeManifestPath(value) {
  return String(value)
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/\/\*$/u, '')
    .replace(/\/+$/u, '')
}

/**
 * Every path a package.json publishes: entry points, `bin` targets, `files` entries, and the
 * keys and values of `exports` (including nested condition objects and subpath patterns).
 */
function manifestPaths(manifest) {
  const found = []
  const visit = (value) => {
    if (typeof value === 'string') {
      found.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      // Condition names (`import`, `require`, ...) are not paths; subpath patterns start with `./`.
      if (key.startsWith('./')) found.push(key)
      visit(item)
    }
  }
  for (const field of MANIFEST_PATH_FIELDS) visit(manifest[field])
  visit(manifest.exports)
  return found
}

/**
 * The package.json reference that keeps `relativeTarget` published, or null when the manifest
 * does not mention it. This is the guard that makes every directory rule safe: a path the
 * package itself resolves or ships is never removed.
 */
function manifestReferenceInside(packageDir, relativeTarget) {
  const target = normalizeManifestPath(relativeTarget)
  if (target === '' || target === '*') return null
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
  for (const reference of manifestPaths(manifest)) {
    const normalized = normalizeManifestPath(reference)
    if (normalized === '') continue
    if (normalized === '*') return `${reference} publishes the package root`
    if (normalized === target || normalized.startsWith(`${target}/`)) return reference
  }
  return null
}

function hasForeignPlatformSuffix(name) {
  const lower = name.toLowerCase()
  return FOREIGN_PLATFORM_SUFFIXES.some(suffix => lower.endsWith(suffix))
}

/**
 * True when every file under `dir` (recursively) is a TypeScript source. Any JavaScript, any
 * declaration-free asset, or any symlink makes this false, which keeps the directory.
 */
function isTypeScriptOnlyTree(dir) {
  let files = 0
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
      if (!entry.isFile()) return false
      if (!TYPESCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) return false
      files += 1
    }
  }
  return files > 0
}

/**
 * Conservatively prune a built runtime tree in place.
 *
 * Every rule removes payload no runtime code path can reach: JavaScript source maps, Windows
 * debug symbols, package-local test directories, native packages for platforms this
 * distribution never runs on, TypeScript sources that already have a built counterpart, and
 * bulky documentation. Every directory removal is first checked against the owning package's
 * `package.json` and refused when the manifest publishes the path. `LICENSE`/`LICENCE`/
 * `COPYING`/`NOTICE` files always survive.
 *
 * `options.mapsOnly` restricts the tree to rules 1 and 2 (source maps and debug symbols), which
 * is what the deploy CLIs require: their functionality must stay byte-for-byte complete.
 *
 * Symlinks and junctions are reported and never followed or deleted. The function is
 * idempotent: a second run removes nothing and reports zero removals.
 *
 * @param {string} dir Tree to prune.
 * @param {object} [options]
 * @param {string} [options.label] Name used in log lines, defaults to the directory basename.
 * @param {boolean} [options.mapsOnly] Only remove `*.map`/`*.pdb`; skip every other rule.
 * @param {number} [options.largeDocBytes] Documentation size limit for package roots.
 * @param {(message: string) => void} [options.log]
 * @param {(message: string) => void} [options.warn]
 * @returns {{label: string, removed: number, removedByRule: Record<string, number>,
 *   refusals: number, before: {bytes: number, files: number},
 *   after: {bytes: number, files: number}, symlinks: number}}
 */
function pruneRuntimeTree(dir, options = {}) {
  const label = options.label ?? path.basename(dir)
  const logStep = options.log ?? log
  const warnStep = options.warn ?? warn
  const mapsOnly = options.mapsOnly === true
  const largeDocBytes = options.largeDocBytes ?? 5 * MEBIBYTE
  const removedByRule = new Map()
  let refusals = 0
  let symlinks = 0

  const rootStat = lstatOrNull(dir)
  if (rootStat === null || (!rootStat.isDirectory() && !rootStat.isSymbolicLink())) {
    warnStep(`prune ${label}: ${dir} is missing; nothing to prune`)
    const empty = { bytes: 0, files: 0 }
    return { label, removed: 0, removedByRule: {}, refusals: 0, before: empty, after: empty, symlinks: 0 }
  }
  if (rootStat.isSymbolicLink()) {
    const size = directorySize(dir)
    warnStep(`prune ${label}: ${dir} is a symlink/junction; leaving it alone`)
    return { label, removed: 0, removedByRule: {}, refusals: 0, before: size, after: size, symlinks: 1 }
  }

  const before = directorySize(dir)

  /** Report and skip a symlink; used for the paths package-level rules look at by name. */
  const isRealDirectory = (target) => {
    const stat = lstatOrNull(target)
    if (stat === null) return false
    if (stat.isSymbolicLink()) {
      symlinks += 1
      warnStep(`prune ${label}: symlink/junction encountered, leaving it alone: ${target}`)
      return false
    }
    return stat.isDirectory()
  }

  const remove = (target, rule) => {
    try {
      fs.rmSync(target, { recursive: true, force: true })
    } catch (cause) {
      warnStep(`prune ${label}: could not remove ${target}: ${cause.message}`)
      return
    }
    removedByRule.set(rule, (removedByRule.get(rule) ?? 0) + 1)
  }

  /**
   * Guarded removal. The owning package's manifest wins: when any entry point, `bin` target,
   * `exports` subpath, or `files` entry resolves inside `target`, nothing is removed.
   */
  const removeGuarded = (packageDir, packageLabel, target, rule) => {
    const relativeTarget = path.relative(packageDir, target).split(path.sep).join('/')
    const reference = manifestReferenceInside(packageDir, relativeTarget)
    if (reference !== null) {
      refusals += 1
      logStep(
        `SKIP (exports-referenced): ${packageLabel} ${path.relative(dir, target)} `
        + `(manifest reference: ${reference})`
      )
      return
    }
    remove(target, rule)
  }

  const stack = [{ dir, inheritedProtected: false }]
  while (stack.length > 0) {
    const current = stack.pop()
    const currentDir = current.dir
    const isTreeRoot = currentDir === dir
    const currentName = path.basename(currentDir)
    const isPrebuildsDirectory = currentName.toLowerCase() === 'prebuilds'
    const isScopeDirectory = currentName.startsWith('@')
    const packageName = mapsOnly ? null : packageNameAt(currentDir)
    const isPackageRoot = packageName !== null
    const isProtected = current.inheritedProtected || isProtectedPackage(packageName)

    // `three` rule: the package resolves through its `exports` map to build output for the
    // documented entry points, so its ES sources and demo pages are candidates — but only when
    // the manifest does not publish them. `removeGuarded` decides that per path.
    if (!mapsOnly && packageName === 'three') {
      const sources = path.join(currentDir, 'src')
      if (isRealDirectory(sources)) removeGuarded(currentDir, packageName, sources, 'three-src')
      const examples = path.join(currentDir, 'examples')
      if (isRealDirectory(examples)) {
        for (const entry of fs.readdirSync(examples, { withFileTypes: true })) {
          if (entry.name === 'jsm') continue
          const candidate = path.join(examples, entry.name)
          if (entry.isSymbolicLink()) {
            symlinks += 1
            warnStep(`prune ${label}: symlink/junction encountered, leaving it alone: ${candidate}`)
            continue
          }
          removeGuarded(currentDir, packageName, candidate, 'three-examples')
        }
      }
    }

    // TypeScript-source rule: a package that ships built output plus TypeScript-only sources can
    // lose the sources, unless the manifest publishes them.
    if (!mapsOnly && isPackageRoot && !isProtected) {
      const hasBuiltOutput = BUILT_OUTPUT_DIRECTORY_NAMES
        .some(name => isRealDirectory(path.join(currentDir, name)))
      const sources = path.join(currentDir, 'src')
      if (hasBuiltOutput && isRealDirectory(sources) && isTypeScriptOnlyTree(sources)) {
        removeGuarded(currentDir, packageName, sources, 'typescript-src')
      }
    }

    let entries
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch (cause) {
      warnStep(`prune ${label}: cannot read ${currentDir}: ${cause.message}`)
      continue
    }

    for (const entry of entries) {
      const full = path.join(currentDir, entry.name)
      if (entry.isSymbolicLink()) {
        symlinks += 1
        warnStep(`prune ${label}: symlink/junction encountered, leaving it alone: ${full}`)
        continue
      }

      if (entry.isDirectory()) {
        // `prebuilds/<platform>` payloads for other platforms.
        if (!mapsOnly && isPrebuildsDirectory && entry.name.toLowerCase() !== NATIVE_PLATFORM_DIRECTORY) {
          remove(full, 'foreign-platform-prebuilds')
          continue
        }
        // `@scope/<pkg>-<platform>` native packages for other platforms.
        if (!mapsOnly && isScopeDirectory && !isProtected && hasForeignPlatformSuffix(entry.name)
          && !isProtectedPackage(`${currentName}/${entry.name}`)) {
          remove(full, 'foreign-platform-package')
          continue
        }
        // Package-local test directories, never one at the top of the tree.
        if (!mapsOnly && isPackageRoot && !isTreeRoot && TEST_DIRECTORY_NAMES.has(entry.name)) {
          removeGuarded(currentDir, packageName, full, 'test-directory')
          continue
        }
        stack.push({ dir: full, inheritedProtected: isProtected })
        continue
      }

      if (!entry.isFile()) continue
      const lower = entry.name.toLowerCase()

      // JavaScript source maps and Windows debug symbols.
      if (lower.endsWith('.map')) {
        remove(full, 'source-map')
        continue
      }
      if (lower.endsWith('.pdb')) {
        remove(full, 'debug-symbols')
        continue
      }

      // Bulky documentation at a package root; never a legal file.
      if (!mapsOnly && isPackageRoot && !isProtected
        && DOCUMENTATION_EXTENSIONS.has(path.extname(lower)) && !LEGAL_FILE_NAME.test(entry.name)) {
        const stat = lstatOrNull(full)
        if (stat !== null && stat.size > largeDocBytes) {
          removeGuarded(currentDir, packageName, full, 'documentation-file')
        }
      }
    }
  }

  const after = directorySize(dir)
  const removed = [...removedByRule.values()].reduce((total, count) => total + count, 0)
  logStep(
    `prune ${label}: ${removed} entries removed, `
    + `${(before.bytes / MEBIBYTE).toFixed(1)} MB -> ${(after.bytes / MEBIBYTE).toFixed(1)} MB `
    + `(${before.files} -> ${after.files} files)`
    + `${refusals === 0 ? '' : `, ${refusals} refused by the package manifest guard`}`
  )
  for (const [rule, count] of [...removedByRule].sort((a, b) => b[1] - a[1])) {
    logStep(`prune ${label}:   ${rule}: ${count}`)
  }
  if (symlinks > 0) warnStep(`prune ${label}: ${symlinks} symlink(s)/junction(s) left untouched`)
  return {
    label,
    removed,
    removedByRule: Object.fromEntries(removedByRule),
    refusals,
    before,
    after,
    symlinks
  }
}

/** Path to the bundled Node.js interpreter once `node` has been staged. */
function bundledNode() {
  return path.join(DSH_RUNTIME, 'node', 'node.exe')
}

/** Path to the bundled npm CLI entry once `node` has been staged. */
function bundledNpmCli() {
  return path.join(DSH_RUNTIME, 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js')
}

/** Install production dependencies into one runtime directory using the bundled npm. */
function installRuntimeDeps(dir, dependencies, extraArgs = []) {
  writeJson(path.join(dir, 'package.json'), {
    name: `@teacher-dsh/runtime-${path.basename(dir)}`,
    version: '0.1.0',
    private: true,
    description: `Teacher DSH bundled runtime dependencies (${path.basename(dir)})`,
    license: 'MIT',
    dependencies
  })
  fs.writeFileSync(
    path.join(dir, '.npmrc'),
    ['audit=false', 'fund=false', 'progress=false', 'loglevel=error', 'install-strategy=hoisted', ''].join('\n')
  )
  run(
    bundledNode(),
    [bundledNpmCli(), 'install', '--no-audit', '--no-fund', '--omit=dev', ...extraArgs],
    { cwd: dir }
  )
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

function stepNode() {
  const nodeDir = path.join(DSH_RUNTIME, 'node')
  const stamp = path.join(nodeDir, 'VERSION')
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === `v${NODE_VERSION}`) {
    log(`node: already staged at v${NODE_VERSION}`)
    return
  }
  emptyDir(nodeDir)
  ensureDir(DOWNLOADS)
  const archive = path.join(DOWNLOADS, `node-v${NODE_VERSION}-win-x64.zip`)
  if (!fs.existsSync(archive)) {
    run('curl.exe', ['-L', '--fail', '--retry', '3', '-o', archive,
      `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`])
  }
  const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsh-node-'))
  try {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${extractRoot}' -Force`])
    const source = path.join(extractRoot, `node-v${NODE_VERSION}-win-x64`)
    for (const entry of ['node.exe', 'npm', 'npm.cmd', 'npx', 'npx.cmd', 'LICENSE', 'README.md']) {
      const from = path.join(source, entry)
      if (fs.existsSync(from)) fs.cpSync(from, path.join(nodeDir, entry), { recursive: true })
    }
    // corepack ships inside the node_modules payload and is required for pnpm shims.
    for (const entry of ['npm', 'corepack']) {
      const from = path.join(source, 'node_modules', entry)
      if (fs.existsSync(from)) fs.cpSync(from, path.join(nodeDir, 'node_modules', entry), { recursive: true })
    }
    // npm and corepack resolve their own dependencies from the shared node_modules root.
    const shared = path.join(source, 'node_modules')
    for (const entry of fs.readdirSync(shared)) {
      if (entry === 'npm' || entry === 'corepack') continue
      const from = path.join(shared, entry)
      const to = path.join(nodeDir, 'node_modules', entry)
      if (!fs.existsSync(to)) fs.cpSync(from, to, { recursive: true })
    }
  } finally {
    fs.rmSync(extractRoot, { recursive: true, force: true })
  }
  fs.writeFileSync(stamp, `v${NODE_VERSION}\n`)
  run(bundledNode(), ['--version'])
  reportSize('node', nodeDir)
}

function stepPnpm() {
  const pnpmDir = path.join(DSH_RUNTIME, 'pnpm')
  const source = path.join(ROOT, 'dsh-plugin-desktop', 'node_modules', 'pnpm')
  if (!fs.existsSync(source)) {
    throw new Error(`pnpm ${PNPM_VERSION} is not installed; run "corepack yarn install" first`)
  }
  const version = readJson(path.join(source, 'package.json')).version
  if (version !== PNPM_VERSION) warn(`pnpm package version ${version} differs from pinned ${PNPM_VERSION}`)
  emptyDir(pnpmDir)
  copyDir(source, pnpmDir, (_source, relative) => !relative.startsWith('node_modules/.cache'))
  reportSize('pnpm', pnpmDir)
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsh-pnpm-'))
  try {
    run(bundledNode(), [path.join(pnpmDir, 'bin', 'pnpm.mjs'), '--version'], { cwd: probe })
  } finally {
    fs.rmSync(probe, { recursive: true, force: true })
  }
}

function stepDsh() {
  const dshDir = path.join(DSH_RUNTIME, 'dsh')
  const nodeModules = path.join(DSH_RUNTIME, 'node_modules')
  emptyDir(dshDir)
  ensureDir(nodeModules)

  const upstream = readJson(path.join(ROOT, 'upstream.json'))
  const channel = upstream.channels?.[upstream.activeChannel] ?? {}
  writeJson(path.join(dshDir, 'RUNTIME.json'), {
    name: 'teacher-dsh.dsh-runtime',
    version: '0.1.0',
    harness: {
      repository: upstream.repository,
      channel: upstream.activeChannel,
      commit: channel.commit ?? null,
      packageVersion: channel.runtimePackageVersion ?? null,
      runtimeSource: channel.runtimeSource ?? null
    },
    resolution:
      'The pinned Harness bundle ships inside the application payload (node_modules/@deepseek-ai/*). '
      + 'This directory only exposes the stable command entry point and the pinned identity.',
    node: `v${NODE_VERSION}`,
    pnpm: PNPM_VERSION
  })

  fs.writeFileSync(path.join(dshDir, 'dsh.mjs'), [
    '#!/usr/bin/env node',
    '/**',
    ' * Teacher DSH bundled Harness command.',
    ' *',
    ' * The Harness bundle itself is part of the application payload. The Host exports',
    ' * TEACHER_DSH_BOOTSTRAP pointing at the launcher-owned desktop CLI entry; this shim only',
    ' * keeps `dsh` on the Teacher PATH so Agent shell commands resolve locally.',
    ' */',
    "const entry = process.env.TEACHER_DSH_BOOTSTRAP",
    'if (entry === undefined || entry === "") {',
    '  process.stderr.write(',
    "    'teacher-dsh: the bundled Harness entry is unavailable in this process.\\n'",
    "    + 'Open Teacher DSH and use its terminal, or run `dsh` from the DSH Desktop terminal.\\n',",
    '  )',
    '  process.exit(1)',
    '}',
    "const { pathToFileURL } = await import('node:url')",
    'await import(pathToFileURL(entry).href)',
    ''
  ].join('\n'))

  writeJson(path.join(nodeModules, 'package.json'), {
    name: '@teacher-dsh/dsh-runtime-node-modules',
    version: '0.1.0',
    private: true,
    description: 'Placeholder root documenting where the pinned Harness bundle resolves from.',
    license: 'MIT'
  })
  fs.writeFileSync(path.join(nodeModules, 'README.md'), [
    '# dsh-runtime/node_modules',
    '',
    'The pinned DeepSeek Harness bundle is a first-class dependency of the Teacher DSH',
    'application payload, so it is already installed under `node_modules/@deepseek-ai/*`',
    'inside the packaged application. Duplicating it here would double the installer size for',
    'no functional gain, so this directory only carries the resolution contract.',
    '',
    'The profile resolver used by the launcher (`installProfilePackageResolver`) resolves bare',
    'Harness package names from the profile first and then from this application payload, which',
    'is what keeps every Harness plugin working with zero network access.',
    ''
  ].join('\n'))
  log('dsh: wrote runtime identity and command shim')
}

function stepCli() {
  const cliRoot = path.join(TEACHER_RUNTIME, 'cli')
  emptyDir(cliRoot)

  const artifactCli = path.join(TEACHER, 'packages', 'artifact-cli')
  copyDir(path.join(artifactCli, 'bin'), path.join(cliRoot, 'artifact-cli', 'bin'))
  copyDir(path.join(artifactCli, 'src'), path.join(cliRoot, 'artifact-cli', 'src'))
  fs.copyFileSync(path.join(artifactCli, 'package.json'), path.join(cliRoot, 'artifact-cli', 'package.json'))
  const sdkTarball = path.join(artifactCli, 'vendor', 'artifact-sdk.tgz')
  if (!fs.existsSync(sdkTarball)) {
    run(process.execPath, [path.join(TEACHER, 'scripts', 'build-toolchain.mjs')])
  }
  ensureDir(path.join(cliRoot, 'artifact-cli', 'vendor'))
  fs.copyFileSync(sdkTarball, path.join(cliRoot, 'artifact-cli', 'vendor', 'artifact-sdk.tgz'))

  const publishCli = path.join(TEACHER, 'packages', 'publish-cli')
  copyDir(path.join(publishCli, 'bin'), path.join(cliRoot, 'publish-cli', 'bin'))
  copyDir(path.join(publishCli, 'src'), path.join(cliRoot, 'publish-cli', 'src'))
  fs.copyFileSync(path.join(publishCli, 'package.json'), path.join(cliRoot, 'publish-cli', 'package.json'))
  const publishConfig = path.join(publishCli, 'config')
  if (fs.existsSync(publishConfig)) copyDir(publishConfig, path.join(cliRoot, 'publish-cli', 'config'))

  const sdk = path.join(TEACHER, 'packages', 'artifact-sdk')
  copyDir(path.join(sdk, 'src'), path.join(cliRoot, 'artifact-sdk', 'src'))
  fs.copyFileSync(path.join(sdk, 'package.json'), path.join(cliRoot, 'artifact-sdk', 'package.json'))

  reportSize('cli', cliRoot)
}

function stepArtifact() {
  const artifactDir = path.join(TEACHER_RUNTIME, 'artifact')
  const templates = path.join(artifactDir, 'templates')
  emptyDir(templates)
  copyDir(path.join(TEACHER, 'templates'), templates)
  // template.json is a build manifest, never part of a generated project.
  for (const entry of fs.readdirSync(templates, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    fs.rmSync(path.join(templates, entry.name, 'template.json'), { force: true })
    fs.rmSync(path.join(templates, entry.name, 'pnpm-lock.yaml'), { force: true })
  }

  const sdkTarball = path.join(TEACHER_RUNTIME, 'cli', 'artifact-cli', 'vendor', 'artifact-sdk.tgz')
  if (!fs.existsSync(sdkTarball)) throw new Error('artifact SDK tarball missing; run the cli step first')
  const sdkDeps = readJson(path.join(TEACHER_RUNTIME, 'cli', 'artifact-sdk', 'package.json')).dependencies ?? {}

  // npm keys `file:` dependencies by path + lockfile integrity, so a repacked tarball at the
  // same path would keep resolving to the previous contents. Drop the lock and installed copy
  // whenever the packed SDK actually changed.
  const sdkStamp = path.join(artifactDir, '.artifact-sdk.stamp')
  const sdkHash = sha256(sdkTarball)
  const previousHash = fs.existsSync(sdkStamp) ? fs.readFileSync(sdkStamp, 'utf8').trim() : ''
  if (previousHash !== sdkHash) {
    fs.rmSync(path.join(artifactDir, 'node_modules', '.package-lock.json'), { force: true })
    fs.rmSync(path.join(artifactDir, 'package-lock.json'), { force: true })
    fs.rmSync(path.join(artifactDir, 'node_modules', '@teacher-dsh', 'artifact-sdk'), { recursive: true, force: true })
  }

  installRuntimeDeps(artifactDir, {
    ...ARTIFACT_DEPS,
    ...sdkDeps,
    '@teacher-dsh/artifact-sdk': `file:${path.relative(artifactDir, sdkTarball).replaceAll('\\', '/')}`
  })
  fs.writeFileSync(sdkStamp, `${sdkHash}\n`)
  reportSize('artifact', artifactDir)
}

function stepPpt() {
  const pptDir = path.join(TEACHER_RUNTIME, 'ppt')
  const pptKit = path.join(TEACHER, 'packages', 'ppt-kit')
  // The SDK source lives beside its own node_modules so ESM resolution is a plain parent walk
  // with no junction, which keeps `extraResources` copies byte-for-byte faithful.
  copyDir(path.join(pptKit, 'src'), path.join(pptDir, 'src'))
  copyDir(path.join(pptKit, 'bin'), path.join(pptDir, 'bin'))
  installRuntimeDeps(pptDir, { ...PPT_DEPS })
  // Restore the package identity after npm rewrote package.json, so the runtime tree keeps the
  // `@teacher-dsh/ppt-kit` name, `"type": "module"`, and the pinned dependency set.
  writeJson(path.join(pptDir, 'package.json'), {
    ...readJson(path.join(pptKit, 'package.json')),
    private: true,
    description: 'Teacher DSH bundled presentation runtime (@teacher-dsh/ppt-kit + PptxGenJS)',
    dependencies: { ...PPT_DEPS }
  })
  reportSize('ppt', pptDir)
}

function stepDeploy() {
  const deployDir = path.join(TEACHER_RUNTIME, 'deploy')
  installRuntimeDeps(deployDir, { ...DEPLOY_DEPS })
  reportSize('deploy', deployDir)
}

/**
 * Prune the freshly installed runtime trees.
 *
 * Only the installed dependency trees (`artifact`, `ppt`, `deploy`) are pruned: `cli` and
 * `plugins` carry build inputs, `skills` carries Markdown the product renders, and `seed` is
 * pruned by `build-profile-seed.mjs` while it stages its plugin trees.
 *
 * `deploy` runs in maps-only mode. The three bundled CLIs must keep 100% of their
 * functionality, so nothing but source maps and debug symbols may leave that tree.
 */
function stepPrune() {
  const targets = [
    { label: 'artifact', dir: path.join(TEACHER_RUNTIME, 'artifact') },
    { label: 'ppt', dir: path.join(TEACHER_RUNTIME, 'ppt') },
    { label: 'deploy', dir: path.join(TEACHER_RUNTIME, 'deploy'), mapsOnly: true }
  ]
  let removed = 0
  let refusals = 0
  for (const target of targets) {
    const stats = pruneRuntimeTree(target.dir, {
      label: target.label,
      mapsOnly: target.mapsOnly === true
    })
    removed += stats.removed
    refusals += stats.refusals
  }
  log(`prune: ${removed} entries removed across ${targets.length} trees (${refusals} manifest refusals)`)
}

function stepSkills() {
  const skillsRoot = path.join(TEACHER_RUNTIME, 'skills')
  emptyDir(skillsRoot)
  // DSH discovers bundled skills as `<root>/<skill-name>/SKILL.md` (or flat `<root>/<name>.md`),
  // so the shipped tree must be flat and name-unique rather than grouped by vendor.
  const own = ['teaching-aid', 'publish-static', 'latex-authoring', 'teacher-grabme']
  const installed = new Map()
  for (const skill of own) {
    const from = path.join(TEACHER, 'skills', skill)
    if (!fs.existsSync(from)) throw new Error(`missing own skill ${skill}`)
    copyDir(from, path.join(skillsRoot, skill))
    installed.set(skill, 'teacher-dsh')
  }
  const vendorSources = [
    ['education-agent-skills', path.join(TEACHER, 'vendor-skills', 'education-agent-skills', 'skills')],
    ['pptkit-presentation', path.join(TEACHER, 'vendor-skills', 'pptkit-presentation', 'skills')],
    ['vercel-web-design', path.join(TEACHER, 'vendor-skills', 'vercel-web-design', 'skills')]
  ]
  const collect = (dir, id) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = path.join(dir, entry.name)
      if (fs.existsSync(path.join(child, 'SKILL.md'))) {
        const name = entry.name
        if (installed.has(name)) {
          warn(`skill name collision on "${name}" (${installed.get(name)} vs ${id}); keeping the first`)
          continue
        }
        copyDir(child, path.join(skillsRoot, name))
        installed.set(name, id)
      } else {
        collect(child, id)
      }
    }
  }
  for (const [id, sourceRoot] of vendorSources) {
    if (!fs.existsSync(sourceRoot)) {
      warn(`vendor skills source missing: ${sourceRoot}`)
      continue
    }
    collect(sourceRoot, id)
  }
  // Only the pinned web-design-guidelines snapshot ships; the rest of the upstream repo is out of scope.
  for (const unwanted of ['react-best-practices', 'react-native-skills', 'react-view-transitions',
    'composition-patterns', 'vercel-optimize', 'deploy-to-vercel', 'writing-guidelines',
    'vercel-cli-with-tokens']) {
    fs.rmSync(path.join(skillsRoot, unwanted), { recursive: true, force: true })
    installed.delete(unwanted)
  }
  log(`skills: ${installed.size} bundled -> ${[...installed.keys()].join(', ')}`)
  reportSize('skills', skillsRoot)
}

function stepPlugins() {
  const pluginsRoot = path.join(TEACHER_RUNTIME, 'plugins')
  emptyDir(pluginsRoot)
  const lock = readJson(path.join(TEACHER, 'manifests', 'plugins.lock.json'))
  writeJson(path.join(pluginsRoot, 'plugins.lock.json'), lock)
  // Ship provenance, not the whole vendored checkout. The full source trees live in the
  // repository under resources/teacher-seed/plugins; copying them into the installer added
  // 5.5 MB of upstream test fixtures - including deliberate fake credentials
  // (AKIAIOSFODNN7EXAMPLE, ghp_abcdefghijklmnopqrst, a dummy private key) that make virus and
  // secret scanners flag a signed installer for no reason.
  const PROVENANCE = ['SOURCE.json', 'package.json', 'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']
  for (const entry of lock.core ?? []) {
    const source = path.join(RESOURCES, 'teacher-seed', 'plugins', entry.id)
    if (!fs.existsSync(source)) {
      warn(`plugin source missing: ${entry.id}`)
      continue
    }
    const target = path.join(pluginsRoot, 'sources', entry.id)
    ensureDir(target)
    for (const name of PROVENANCE) {
      const from = path.join(source, name)
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, name))
    }
  }
  reportSize('plugins', pluginsRoot)
}

function stepManifests() {
  const manifests = path.join(TEACHER_RUNTIME, 'manifests')
  emptyDir(manifests)
  for (const file of fs.readdirSync(path.join(TEACHER, 'manifests'))) {
    fs.copyFileSync(path.join(TEACHER, 'manifests', file), path.join(manifests, file))
  }
  writeJson(path.join(manifests, 'runtime.build.json'), {
    name: 'teacher-dsh.runtime.build',
    version: '0.1.0',
    builtAt: new Date().toISOString(),
    platform: process.platform,
    node: NODE_VERSION,
    pnpm: PNPM_VERSION,
    artifactDependencies: ARTIFACT_DEPS,
    pptDependencies: PPT_DEPS,
    deployDependencies: DEPLOY_DEPS
  })
  log('manifests: copied')
}

function stepBin() {
  const bin = path.join(TEACHER_RUNTIME, 'bin')
  ensureDir(bin)
  fs.writeFileSync(path.join(bin, 'README.md'), [
    '# teacher-runtime/bin',
    '',
    'The launcher generates the real `node.cmd`, `pnpm.cmd`, `teacher-artifact.cmd`,',
    '`teacher-latex.cmd`, `teacher-publish.cmd`, and `teacher-ppt.cmd` shims into the private',
    'per-user state directory at startup (`dsh-plugin-desktop/src/teacher-bootstrap.ts`).',
    '',
    'Nothing here is executed from the installation directory, which keeps the machine PATH,',
    '`NODE_HOME`, and the npm global prefix untouched.',
    ''
  ].join('\n'))
}

const STEPS = [
  ['node', stepNode],
  ['pnpm', stepPnpm],
  ['dsh', stepDsh],
  ['cli', stepCli],
  ['artifact', stepArtifact],
  ['ppt', stepPpt],
  ['deploy', stepDeploy],
  ['prune', stepPrune],
  ['skills', stepSkills],
  ['plugins', stepPlugins],
  ['manifests', stepManifests],
  ['bin', stepBin]
]

/**
 * True when this module is the process entry point. `build-profile-seed.mjs` imports
 * `pruneRuntimeTree` from here, and that import must not start a runtime build.
 */
function isMainModule() {
  const entry = process.argv[1]
  if (entry === undefined) return false
  const normalize = (value) => {
    const resolved = path.resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  try {
    return normalize(entry) === normalize(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

function main() {
  ensureDir(RESOURCES)
  const started = Date.now()
  for (const [name, runStep] of STEPS) {
    if (!shouldRun(name)) {
      log(`skip ${name}`)
      continue
    }
    log(`=== ${name} ===`)
    runStep()
  }
  log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  reportSize('dsh-runtime total', DSH_RUNTIME)
  reportSize('teacher-runtime total', TEACHER_RUNTIME)
}

export { pruneRuntimeTree }

if (isMainModule()) main()
