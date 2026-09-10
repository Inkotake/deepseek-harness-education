#!/usr/bin/env node
/**
 * Verifies that the bundled Teacher DSH profile seed composes and boots.
 *
 * The seed produced by `scripts/teacher/build-profile-seed.mjs` is a complete, already
 * materialised Harness home. This script proves that the shipped artefact is not just a pile
 * of directories: it copies the seed into a fresh temporary Harness home (the shipped seed is
 * never mutated), prepares the `desktop` profile over that copy, and boots it headlessly with
 * the same Host wiring the Electron launcher uses. It then reports, as separate checks, whether
 * the three bundled vendor plugins — `dsh-better-sidebar`, `@dsh-cowork/plugin`, and
 * `dsh-plugin-pptkit-presentation` — actually mount with no network access.
 *
 * A plugin that fails to mount is reported as a FAIL together with the real error text; this
 * script never reports a mount it did not observe.
 *
 * Usage:
 *   node scripts/teacher/verify-profile-seed.mjs [--json] [--help]
 *
 * Exit code: 0 only when every check passed.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DESKTOP = path.join(ROOT, 'dsh-plugin-desktop')
const SEED = path.join(ROOT, 'resources', 'teacher-runtime', 'seed', 'dsh-home')
const SEED_MARKER = path.join(SEED, 'TEACHER-SEED.json')
const BUILD_CMD = 'node scripts/teacher/build-profile-seed.mjs'
const DESKTOP_LIB = path.join(DESKTOP, 'lib')
const BIN_NAME = 'dsh-plugin-desktop-teacher-seed-verify'

/** Package names this verification exists for, in the seed's mount order. */
const VENDOR_PLUGINS = [
  'dsh-better-sidebar',
  '@dsh-cowork/plugin',
  'dsh-plugin-pptkit-presentation',
]

const AS_JSON = process.argv.includes('--json')
const WANT_HELP = process.argv.includes('--help') || process.argv.includes('-h')

const HELP = `Verify that the bundled Teacher profile seed composes and boots.

Usage:
  node scripts/teacher/verify-profile-seed.mjs [--json] [--help]

Copies resources/teacher-runtime/seed/dsh-home into a temporary Harness home, prepares the
desktop profile over that copy, boots it headlessly, and checks that ${VENDOR_PLUGINS.join(', ')}
mount with no network access. The shipped seed is never modified.

Options:
  --json   Print exactly one JSON object on stdout (diagnostics go to stderr).
  --help   Print this message.

Prerequisite:
  ${BUILD_CMD}   (when ${path.relative(ROOT, SEED_MARKER)} is missing)

Exit code: 0 only when every check passed.
`

/** Log progress on stderr so `--json` keeps stdout to exactly one JSON object. */
function log(message) {
  process.stderr.write(`[verify-profile-seed] ${message}\n`)
}

/** Minimal collection of PASS/FAIL lines plus a human-readable summary. */
class Report {
  constructor() {
    this.checks = []
  }

  /** Record one observed check result. */
  add(name, passed, detail) {
    const check = { name, status: passed ? 'PASS' : 'FAIL', detail: String(detail) }
    this.checks.push(check)
    if (!AS_JSON) log(`${check.status} ${name}${check.detail ? ` — ${check.detail}` : ''}`)
    return passed
  }

  /**
   * Record one check whose evidence comes from a running Host service.
   * @param name - check name.
   * @param outcome - `observed`, `missing` (a real failure), or `unobservable` (not this
   * script's to judge, so it is reported without failing the run).
   * @param detail - evidence text.
   */
  observe(name, outcome, detail) {
    if (outcome === 'unobservable') {
      log(`SKIP ${name} — ${detail}`)
      return false
    }
    return this.add(name, outcome === 'observed', detail)
  }

  get failed() {
    return this.checks.filter(check => check.status === 'FAIL')
  }

  get passedCount() {
    return this.checks.length - this.failed.length
  }
}

/** Read and parse one JSON file, failing with a path-qualified message. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (cause) {
    throw new Error(`cannot read ${file}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Import one desktop build artefact by absolute URL, as build-profile-seed.mjs does. */
async function importDesktopLib(basename) {
  return import(pathToFileURL(path.join(DESKTOP_LIB, basename)).href)
}

/**
 * Import one Harness package the desktop installation pins, by absolute URL inside the desktop
 * package's own `node_modules`. The pinned Harness is not a workspace package of this repository,
 * so bare specifiers are deliberately not used here.
 */
async function importHarnessPackage(packageName, entry = 'lib/index.js') {
  const manifest = path.join(DESKTOP, 'node_modules', ...packageName.split('/'), 'package.json')
  if (!fs.existsSync(manifest)) {
    throw new Error(`dsh-plugin-desktop is not installed correctly: ${manifest} is missing`)
  }
  return import(pathToFileURL(path.join(path.dirname(manifest), entry)).href)
}

/** Resolve the declared entry of an installed package directory. */
function declaredEntry(packageDir) {
  const manifest = readJson(path.join(packageDir, 'package.json'))
  return { main: manifest.main ?? 'index.js', version: manifest.version }
}

/** Render an unknown thrown value without losing its stack. */
function describeError(cause) {
  return cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
}

/**
 * Remove the temporary Harness home.
 *
 * A vendor plugin imports a napi addon (`node-pty`), so Windows keeps the copied tree locked until
 * this process has fully exited; a `process.on('exit')` removal therefore cannot succeed. Retry
 * first — disposal usually releases everything within a second — and otherwise hand the removal to
 * a detached helper that outlives this process and retries until the handles are gone.
 * @param dir - temporary directory to remove.
 * @returns whether this process removed the directory itself.
 */
async function removeTemporaryHome(dir) {
  const { setTimeout: delay } = await import('node:timers/promises')
  let lastError
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
      return true
    } catch (cause) {
      lastError = cause
      await delay(250 * (attempt + 1))
    }
  }
  const helper = [
    'const { rmSync } = require("node:fs")',
    'const target = process.argv[1]',
    'let attempt = 0',
    'const timer = setInterval(() => {',
    '  try { rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 }); clearInterval(timer) }',
    '  catch { if (++attempt > 30) clearInterval(timer) }',
    '}, 500)',
  ].join('\n')
  try {
    const { spawn } = await import('node:child_process')
    spawn(process.execPath, ['-e', helper, dir], { detached: true, stdio: 'ignore', windowsHide: true })
      .unref()
    log(`temporary home is locked by this process; a detached helper will remove ${dir}`)
  } catch (cause) {
    log(`WARN could not remove the temporary home (${describeError(lastError)}): ${dir}`)
    log(`WARN the detached cleanup helper also failed to start: ${describeError(cause)}`)
  }
  return false
}

/** Fake ordinary-browser capability; assertions about it are out of scope here. */
const BROWSER_ACCESS = Object.freeze({
  ordinaryBrowserEnabled: false,
  rendererHeader: Object.freeze({
    name: 'x-dsh-desktop-renderer',
    value: Buffer.alloc(32, 7).toString('base64url'),
  }),
  setOrdinaryBrowserEnabled() {},
})

const LAN_HTTPS_SNAPSHOT = Object.freeze({
  state: 'inactive',
  actualPort: null,
  addresses: Object.freeze([]),
  caFingerprint: null,
  errorCode: null,
})

const LAN_HTTPS = Object.freeze({
  caCertificate: null,
  attach() {},
  snapshot() { return LAN_HTTPS_SNAPSHOT },
  async setEnabled() { return LAN_HTTPS_SNAPSHOT },
  async stop() { return LAN_HTTPS_SNAPSHOT },
})

/**
 * Minimal Electron-shell capability. The seeded profile is booted headlessly, so registering the
 * window and tray surface is enough; no native window, tray, or updater is ever exercised.
 */
function createDesktopRuntime(home) {
  return {
    platform: process.platform === 'darwin' ? 'darwin' : 'win32',
    windowsBuild: 22_631,
    locale: 'en',
    updates: {
      isPackaged: false,
      canDownload: false,
      currentVersion: '0.0.0-verify',
      statePath: path.join(home, 'update-state.json'),
      request: async () => { throw new Error('seed verification must not perform update requests') },
      confirmDownload: async () => false,
      showManualCheckResult: async () => {},
      downloadAndOpen: async () => {},
      notify: () => {},
    },
    /** Retain the shell registration; the headless boot never presents a window. */
    schedule() {
      return async () => {}
    },
    async mountScheduled() {},
    show() {},
    registerTrayItem() {
      return { refresh() {}, dispose() {} }
    },
    openTerminal() {},
    setLocalePreference(preference) { this.locale = preference ?? 'en' },
    setThemeSource() {},
    async requestRestart() {},
    prepareToQuit() {},
  }
}

/** Boot the seeded profile headlessly and return the settled Loader rows. */
async function bootSeededProfile({ home, prepared, pnpmRuntime, pnpmBinPath, electronVersion }) {
  const { boot, composeEntries } = await importHarnessPackage('@deepseek-ai/dsh-app-boot')
  const { provideCmdline } = await importHarnessPackage('@deepseek-ai/dsh-cmdline')
  const { DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot } = await importHarnessPackage(
    '@deepseek-ai/dsh-launch-environment',
  )
  const { DesktopProfileService } = await importDesktopLib('profile-service.js')

  const runtime = createDesktopRuntime(home)
  const ctx = await boot(
    BIN_NAME,
    prepared.rootConfig,
    prepared.patches,
    async (host) => {
      host.loader.internal = undefined
      host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([]))
      host.provide('desktopBrowserAccess', BROWSER_ACCESS)
      host.provide('desktopLanHttps', LAN_HTTPS)
      host.provide('desktopRuntime', runtime)
      host.provide('desktopPnpmBootstrap', {
        activeProfileName: 'desktop',
        activeProfileDir: prepared.profile.dir,
        homeDir: home,
        appExecutable: process.execPath,
        pnpmBinPath,
        electronVersion,
        nodeBinDir: pnpmRuntime.nodeBinDir,
        nodeShimPath: pnpmRuntime.nodeShimPath,
        clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
        dshBootstrapPath: path.join(DESKTOP_LIB, 'desktop-cli.js'),
      })
      await host.plugin(DesktopProfileService, {
        current: { name: 'desktop', dir: prepared.profile.dir },
        list: () => [{
          name: 'desktop',
          dir: prepared.profile.dir,
          exists: true,
          bundles: prepared.profile.layers.map(layer => layer.packageName),
          webCapable: true,
        }],
        persistSelection: () => {},
        requestRestart: () => {},
      })
      provideCmdline(host, { args: ['--host', '127.0.0.1', '--port', '0'], exit: () => {} })
    },
    prepared.bareModuleBaseUrl,
  )

  // The settled tree is the mounting evidence: one row per Loader entry, with `fiber` set only
  // after the entry's module was imported and its plugin activated.
  const rows = []
  for (const entry of ctx.loader.entries()) {
    rows.push({
      id: entry.options.id,
      name: entry.options.name,
      disabled: entry.disabled,
      mounted: entry.fiber !== undefined,
    })
  }

  // `composeEntries` is what verify-profile-boot.mjs-style tooling uses to inspect the composed
  // graph before boot; keep it as a second, boot-independent view of the same rows.
  const composed = composeEntries([prepared.patches]).map(row => ({
    id: typeof row.id === 'string' ? row.id : undefined,
    name: typeof row.name === 'string' ? row.name : undefined,
    disabled: row.disabled === true,
  }))

  return { ctx, rows, composed }
}

/** Verify one vendor plugin across the composition, the boot graph, and the temp profile disk. */
function checkVendorPlugin(report, pluginName, { layers, rows, composed, profileDir }) {
  const layerNames = layers.map(layer => layer.packageName)
  report.add(
    `layers include ${pluginName}`,
    layerNames.includes(pluginName),
    layerNames.includes(pluginName)
      ? `composed layer ${layerNames.indexOf(pluginName)} of ${layerNames.length}`
      : `composed layers: ${layerNames.join(', ') || '(none)'}`,
  )

  const composedRows = composed.filter(row => row.name === pluginName)
  report.add(
    `boot graph contains a row named ${pluginName}`,
    composedRows.length > 0,
    composedRows.length > 0
      ? `row id(s): ${composedRows.map(row => row.id ?? '(anonymous)').join(', ')}`
      : 'no composed Loader row uses this package name',
  )

  const bootRows = rows.filter(row => row.name === pluginName)
  const active = bootRows.filter(row => row.mounted && !row.disabled)
  const disabled = bootRows.filter(row => row.disabled)
  report.add(
    `mounted row for ${pluginName}`,
    active.length > 0,
    active.length > 0
      ? `active row id(s): ${active.map(row => row.id ?? '(anonymous)').join(', ')}`
      : bootRows.length === 0
        ? 'no Loader row reached the settled tree'
        : `row(s) ${bootRows.map(row => row.id ?? '(anonymous)').join(', ')} never activated`
          + `${disabled.length > 0 ? ' (disabled)' : ''}`,
  )

  let entryDetail = `expected ${path.join(profileDir, 'node_modules', ...pluginName.split('/'), '<main>')}`
  let entryExists = false
  try {
    const packageDir = path.join(profileDir, 'node_modules', ...pluginName.split('/'))
    if (!fs.existsSync(packageDir)) {
      entryDetail = `package directory is missing: ${packageDir}`
    } else {
      const { main, version } = declaredEntry(packageDir)
      const mainPath = path.join(packageDir, main)
      entryExists = fs.existsSync(mainPath)
      entryDetail = `${pluginName}@${version} main ${path.relative(profileDir, mainPath)}`
        + ` ${entryExists ? 'exists' : 'does not exist'}`
    }
  } catch (cause) {
    entryDetail = describeError(cause)
  }
  report.add(`resolved module entry exists for ${pluginName}`, entryExists, entryDetail)
}

/**
 * Observe the effect each vendor plugin has on the booted Host.
 *
 * An active fiber proves the entry imported and its plugin activated; these probes go one step
 * further and look for the surface the plugin claims to register. A probe that cannot see a
 * service this headless profile does not mount is reported as SKIP rather than as a failure,
 * because it is an observability gap, not evidence about the plugin.
 * @param report - the report to record checks on.
 * @param ctx - the settled boot context.
 */
async function checkVendorEffects(report, ctx) {
  const tools = ctx.get('tools')
  if (tools === undefined) {
    report.observe('effect: Cowork registers doc_read and doc_write', 'unobservable', 'no tools service in this profile')
  } else {
    const names = ['doc_read', 'doc_write']
    const found = names.filter(name => tools.get(name) !== undefined)
    report.observe(
      'effect: Cowork registers doc_read and doc_write',
      found.length === names.length ? 'observed' : 'missing',
      `ctx.tools.get: ${found.join(', ') || '(none)'} of ${names.join(', ')}`,
    )
  }

  const skills = ctx.get('skills')
  if (skills === undefined) {
    report.observe('effect: PPTKit registers its skill provider', 'unobservable', 'no skills service in this profile')
  } else {
    try {
      const listed = await skills.list()
      const ids = listed.map(skill => skill.id ?? skill.name)
      const found = ids.filter(id => typeof id === 'string' && /pptkit/iu.test(id))
      report.observe(
        'effect: PPTKit registers its skill provider',
        found.length > 0 ? 'observed' : 'missing',
        found.length > 0
          ? `skill catalog entry: ${found.join(', ')}`
          : `skill catalog has no pptkit entry: ${ids.join(', ') || '(empty)'}`,
      )
    } catch (cause) {
      report.observe('effect: PPTKit registers its skill provider', 'unobservable', describeError(cause))
    }
  }
}

async function main() {
  if (WANT_HELP) {
    process.stdout.write(HELP)
    return 0
  }

  const report = new Report()
  const failure = report.add(
    'bundled Teacher seed is present',
    fs.existsSync(SEED_MARKER),
    fs.existsSync(SEED_MARKER)
      ? path.relative(ROOT, SEED_MARKER)
      : `missing ${SEED_MARKER}; build it first with: ${BUILD_CMD}`,
  )
  if (!failure) {
    log(`ERROR the bundled Teacher seed has not been built; run "${BUILD_CMD}" first`)
    return finish(report, { seed: SEED, home: null })
  }

  if (!fs.existsSync(path.join(DESKTOP_LIB, 'profile.js'))) {
    log('ERROR dsh-plugin-desktop is not built; run "corepack yarn workspace dsh-plugin-desktop build" first')
    report.add('dsh-plugin-desktop build artefact is present', false, `missing ${path.join(DESKTOP_LIB, 'profile.js')}`)
    return finish(report, { seed: SEED, home: null })
  }

  let home
  let ctx
  let releasePackageResolver
  let pnpmRuntime
  let prepared
  const detail = { seed: SEED, home: null, profileDir: null, bootError: null }

  try {
    // Work on a copy: the preparation below writes the profile root config and reconciles the
    // profile manifest, and the shipped seed must stay byte-identical.
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsh-seed-verify-'))
    detail.home = home
    log(`copying seed into temporary Harness home: ${home}`)
    fs.cpSync(SEED, home, { recursive: true, dereference: true })

    const { prepareDesktopProfile, healDesktopProfileModuleFallback } = await importDesktopLib('profile.js')
    const { installDesktopPnpmRuntime } = await importDesktopLib('desktop-runtime-environment.js')
    const { installProfilePackageResolver } = await importDesktopLib('module-resolution.js')

    prepared = prepareDesktopProfile('1', home, 'win32')
    detail.profileDir = prepared.profile.dir
    report.add(
      'profile directory is the seeded profiles/desktop',
      path.resolve(prepared.profile.dir) === path.resolve(path.join(home, 'profiles', 'desktop')),
      prepared.profile.dir,
    )

    const pnpmBinPath = path.join(DESKTOP, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
    const electronVersion = readJson(path.join(DESKTOP, 'node_modules', 'electron', 'package.json')).version
    pnpmRuntime = installDesktopPnpmRuntime({
      platform: process.platform,
      appExecutable: process.execPath,
      pnpmBinPath,
      electronVersion,
      stateDir: path.join(home, 'runtime-commands'),
      environment: process.env,
    })
    releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)

    // The launcher heals the profile module fallback before booting, so a fresh installation can
    // resolve the Harness dependency closure the seed deliberately does not duplicate. Mirroring
    // that step keeps this verification faithful to the real first run.
    await healDesktopProfileModuleFallback(home, prepared.profile)

    let bootError = null
    let rows = []
    let composed = []
    try {
      const booted = await bootSeededProfile({ home, prepared, pnpmRuntime, pnpmBinPath, electronVersion })
      ctx = booted.ctx
      rows = booted.rows
      composed = booted.composed
    } catch (cause) {
      bootError = describeError(cause)
      detail.bootError = bootError
      log(`ERROR profile boot failed:\n${bootError}`)
    }
    report.add('profile booted without throwing', bootError === null, bootError ?? `${rows.length} Loader rows settled`)

    for (const pluginName of VENDOR_PLUGINS) {
      checkVendorPlugin(report, pluginName, {
        layers: prepared.profile.layers,
        rows,
        composed,
        profileDir: prepared.profile.dir,
      })
    }

    if (ctx !== undefined) await checkVendorEffects(report, ctx)

    return finish(report, detail)
  } catch (cause) {
    log(`ERROR ${describeError(cause)}`)
    report.add('seed verification ran to completion', false, describeError(cause))
    return finish(report, detail)
  } finally {
    await ctx?.fiber.dispose()
    releasePackageResolver?.()
    pnpmRuntime?.dispose()
    if (home !== null && home !== undefined) {
      if (await removeTemporaryHome(home)) log(`removed temporary Harness home: ${home}`)
    }
  }
}

/** Print the summary (or the single JSON object) and return the process exit code. */
function finish(report, detail) {
  const failed = report.failed
  const total = report.checks.length
  const passed = report.passedCount

  if (AS_JSON) {
    process.stdout.write(`${JSON.stringify({
      name: 'teacher-dsh.verify-profile-seed',
      passed: failed.length === 0,
      summary: `${passed}/${total} checks passed`,
      passedCount: passed,
      totalCount: total,
      checks: report.checks,
      seedDir: detail.seed,
      temporaryHome: detail.home,
      profileDir: detail.profileDir,
      bootError: detail.bootError,
    }, null, 2)}\n`)
  } else {
    if (failed.length > 0) {
      process.stdout.write('\nFailed checks:\n')
      for (const check of failed) process.stdout.write(`  FAIL ${check.name} — ${check.detail}\n`)
    }
    process.stdout.write(`[verify-profile-seed] ${passed}/${total} checks passed\n`)
  }

  return failed.length === 0 ? 0 : 1
}

main().then(
  (code) => { process.exitCode = code },
  (cause) => {
    process.stderr.write(`[verify-profile-seed] ERROR ${describeError(cause)}\n`)
    process.exitCode = 1
  },
)
