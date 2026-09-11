#!/usr/bin/env node
/**
 * Upstream bump: move this distribution to a newer DeepSeek Harness release.
 *
 * This is deliberately a *thin orchestrator over the repository's own upstream tooling*. It
 * never synthesises a runtime from published npm tarballs, because the vendor directory must be
 * an `official`-profile build produced by upstream's own `release:pack`. Everything it runs is a
 * command that already exists in this repository or in the Harness submodule.
 *
 * The sequence, and why each step exists:
 *
 *   1. resolve the target release            (the tag `dsh-v<version>` in the Harness repository)
 *   2. check out that tag in the submodule   (the pin is a commit, not a floating branch)
 *   3. yarn upstream:prepare-runtime         (install + build:official + release:pack --family dsh)
 *   4. adopt the produced vendor directory   (vendor/dsh-runtime/<version>/ with its manifest)
 *   5. rewrite upstream.json + dependency pins
 *   6. yarn sync-vendored-runtime --write    (regenerate the 484 `@deepseek-ai/dsh*` resolutions)
 *   7. yarn install                          (resolve against the new vendor tarballs)
 *   8. report what a human must still do     (version-pinned patches, source API drift)
 *
 * Steps 1-7 are mechanical. Step 8 is the honest part: the patches in `patches/` are pinned to an
 * exact upstream version, so they *will* need regeneration, and the desktop source may need
 * adapting to API changes. The script refuses to pretend otherwise — it stops and prints exactly
 * what is stale rather than leaving a half-migrated tree.
 *
 * Usage:
 *   node scripts/teacher/upstream-bump.mjs --version 0.1.5-rc.2 [--dry-run] [--skip-install] [--json]
 */

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const HARNESS = path.join(ROOT, 'deepseek-harness')
const UPSTREAM_JSON = path.join(ROOT, 'upstream.json')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const DRY_RUN = flag('--dry-run')
const SKIP_INSTALL = flag('--skip-install')
const JSON_OUTPUT = flag('--json')
const TARGET = value('--version')

const steps = []

function log(message) {
  if (!JSON_OUTPUT) process.stdout.write(`${message}\n`)
}

function fail(message) {
  process.stderr.write(`[upstream-bump] ERROR ${message}\n`)
  process.exitCode = 1
}

function record(name, status, detail) {
  steps.push({ name, status, detail })
  log(`  ${status === 'ok' ? 'OK  ' : status === 'skip' ? 'SKIP' : 'TODO'} ${name}${detail === undefined ? '' : ` - ${detail}`}`)
}

function run(command, argv, options = {}) {
  log(`  $ ${command} ${argv.join(' ')}`)
  if (DRY_RUN && options.mutates !== false) {
    record(options.label ?? `${command} ${argv[0]}`, 'skip', 'dry run')
    return 0
  }
  const result = spawnSync(command, argv, {
    cwd: options.cwd ?? ROOT,
    stdio: options.capture === true ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

function git(argv, options = {}) {
  return execFileSync('git', argv, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    stdio: options.inherit === true ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/**
 * Fetch tags from the Harness origin, tolerating a broken or stale HTTP proxy.
 *
 * A machine-wide `http.proxy` that no longer answers makes every git transport fail with a
 * handshake error. Retrying once with the proxy disabled for that single invocation is what a
 * human would do, and it keeps the bump working on such a machine without editing global config.
 */
function fetchUpstreamTags() {
  try {
    git(['-C', HARNESS, 'fetch', '--tags', '--force', 'origin'])
    return 'direct'
  } catch (cause) {
    const first = String(cause).split('\n').find(line => line.trim().length > 0) ?? String(cause)
    try {
      git(['-c', 'http.proxy=', '-c', 'https.proxy=', '-C', HARNESS, 'fetch', '--tags', '--force', 'origin'])
      return 'proxy-bypassed'
    } catch {
      throw new Error(first)
    }
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function assertSemverLike(version) {
  if (!/^[0-9A-Za-z][0-9A-Za-z.-]*$/u.test(version)) {
    throw new Error(`refusing unsafe version ${JSON.stringify(version)}`)
  }
}

function main() {
  if (TARGET === undefined) {
    fail('usage: node scripts/teacher/upstream-bump.mjs --version <version> [--dry-run] [--skip-install]')
    return
  }
  assertSemverLike(TARGET)

  const upstream = readJson(UPSTREAM_JSON)
  const channel = upstream.activeChannel
  const current = upstream.channels?.[channel] ?? {}
  log(`[upstream-bump] channel ${channel}: ${String(current.sourceVersion)} -> ${TARGET}${DRY_RUN ? ' (dry run)' : ''}`)
  if (current.sourceVersion === TARGET) {
    log('[upstream-bump] already pinned to that version; nothing to do')
    return
  }

  // --- 1. the target commit, from upstream itself -------------------------------------------------
  const tag = `dsh-v${TARGET}`
  let commit
  try {
    // The submodule's origin is the Harness repository, so its tags are the authority.
    const transport = fetchUpstreamTags()
    commit = git(['-C', HARNESS, 'rev-list', '-n', '1', tag])
    record('resolve upstream tag', 'ok', `${tag} -> ${commit.slice(0, 12)} (${transport})`)
  } catch (cause) {
    record('resolve upstream tag', 'blocked', `cannot resolve ${tag}: ${String(cause).split('\n')[0]}`)
    fail(`the Harness repository has no tag ${tag}; check the release exists upstream`)
    return
  }

  // --- 2. check the pin out (a commit, never a floating branch) -----------------------------------
  if (run('git', ['-C', HARNESS, 'checkout', '--detach', commit], { label: 'checkout submodule' }) !== 0) {
    record('checkout submodule', 'blocked', `could not check out ${commit.slice(0, 12)}`)
    fail('submodule checkout failed')
    return
  }
  record('checkout submodule', DRY_RUN ? 'skip' : 'ok', commit.slice(0, 12))

  // --- 3. produce the runtime with upstream's own tooling -----------------------------------------
  //    build:official matters: the vendor manifest must carry buildProfile "official".
  const prepare = run('corepack', ['yarn', 'upstream:prepare-runtime'], { label: 'yarn upstream:prepare-runtime' })
  if (prepare !== 0) {
    record('yarn upstream:prepare-runtime', 'blocked', `exit ${prepare}`)
    fail('the upstream runtime build failed; the tree is left at the new commit for inspection')
    return
  }
  record('yarn upstream:prepare-runtime', DRY_RUN ? 'skip' : 'ok', 'install + build:official + release:pack --family dsh')

  // --- 4. adopt the produced vendor directory -----------------------------------------------------
  const vendorDir = path.join(ROOT, 'vendor', 'dsh-runtime', TARGET)
  const manifestPath = path.join(vendorDir, 'manifest.json')
  if (!DRY_RUN && !fs.existsSync(manifestPath)) {
    record('adopt vendor directory', 'blocked', `release:pack did not produce ${path.relative(ROOT, manifestPath)}`)
    fail(
      'upstream:pack:dsh did not write the expected vendor directory. Inspect where release:pack'
      + ' emitted its tarballs and move them to vendor/dsh-runtime/' + TARGET + ' before continuing.',
    )
    return
  }
  let manifest = null
  if (fs.existsSync(manifestPath)) {
    manifest = readJson(manifestPath)
    if (manifest.version !== TARGET) {
      record('adopt vendor directory', 'blocked', `manifest says ${String(manifest.version)}`)
      fail('the produced manifest does not match the requested version')
      return
    }
    if (manifest.buildProfile !== 'official') {
      record('adopt vendor directory', 'blocked', `buildProfile ${String(manifest.buildProfile)}`)
      fail('the produced runtime is not an official-profile build')
      return
    }
  }
  record(
    'adopt vendor directory',
    DRY_RUN ? 'skip' : 'ok',
    manifest === null ? TARGET : `${manifest.packages.length} tarballs, profile ${manifest.buildProfile}`,
  )

  // --- 5. move the pins ---------------------------------------------------------------------------
  const nextChannels = { ...upstream.channels }
  const entry = { ...(nextChannels[channel] ?? {}) }
  entry.commit = commit
  entry.sourceVersion = TARGET
  entry.runtimePackageVersion = TARGET
  entry.runtimeSource = `vendor/dsh-runtime/${TARGET}/manifest.json`
  nextChannels[channel] = entry
  if (!DRY_RUN) {
    writeJson(UPSTREAM_JSON, { ...upstream, channels: nextChannels })
  }
  record('update upstream.json', DRY_RUN ? 'skip' : 'ok', `commit ${commit.slice(0, 12)}, runtimeSource vendor/dsh-runtime/${TARGET}`)

  // The plugin manifests pin the Harness explicitly; sync-vendored-runtime validates those too.
  for (const manifestRelative of ['dsh-plugin-desktop/package.json', 'dsh-community-market/package.json']) {
    const file = path.join(ROOT, ...manifestRelative.split('/'))
    if (!fs.existsSync(file)) continue
    const document = readJson(file)
    const dependency = document.dependencies?.['@deepseek-ai/dsh']
    if (dependency === undefined) continue
    if (!DRY_RUN) {
      document.dependencies['@deepseek-ai/dsh'] = TARGET
      writeJson(file, document)
    }
    record(`pin ${manifestRelative}`, DRY_RUN ? 'skip' : 'ok', `${dependency} -> ${TARGET}`)
  }

  // --- 6. regenerate the resolutions with the repository's own tool ---------------------------------
  const sync = run('node', ['scripts/sync-vendored-runtime.mjs', '--write', '--channel', channel], {
    label: 'sync-vendored-runtime --write',
  })
  if (sync !== 0) {
    record('sync-vendored-runtime --write', 'blocked', `exit ${sync}`)
    fail('the resolutions could not be rewritten against the new manifest')
    return
  }
  record('sync-vendored-runtime --write', DRY_RUN ? 'skip' : 'ok', 'resolutions regenerated from the new manifest')

  // --- 7. resolve ---------------------------------------------------------------------------------
  if (SKIP_INSTALL) {
    record('yarn install', 'skip', '--skip-install')
  } else {
    const install = run('corepack', ['yarn', 'install'], { label: 'yarn install' })
    record('yarn install', install === 0 ? (DRY_RUN ? 'skip' : 'ok') : 'blocked', `exit ${install}`)
    if (install !== 0) {
      fail('yarn install failed; inspect the resolution errors above')
      return
    }
  }

  // --- 8. what a human must still do ----------------------------------------------------------------
  const patches = fs.readdirSync(path.join(ROOT, 'patches'))
    .filter(name => name.includes('dsh-') || name.startsWith('@deepseek-ai'))
  const stalePatches = patches.filter(name => !name.includes(TARGET))
  for (const name of stalePatches) {
    record('regenerate patch', 'todo', `patches/${name} is pinned to a different upstream version`)
  }
  record('adapt desktop source', 'todo', 'run yarn workspace dsh-plugin-desktop build and fix API drift')
  record('rebuild teacher runtime', 'todo', 'node scripts/teacher/build-teacher-runtime.mjs && node scripts/teacher/build-profile-seed.mjs')
  record('verify', 'todo', 'node scripts/verify-desktop-variants.mjs && node scripts/teacher/verify-*.mjs && node scripts/teacher/smoke-package.mjs')

  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify({ channel, from: current.sourceVersion, to: TARGET, commit, dryRun: DRY_RUN, steps }, null, 2)}\n`)
  }
  const blocked = steps.filter(step => step.status === 'blocked')
  if (blocked.length > 0) {
    fail(`${blocked.length} step(s) blocked`)
    return
  }
  log('')
  log('[upstream-bump] mechanical steps complete. Remaining work is listed above as TODO;')
  log('[upstream-bump] the version-pinned patches in patches/ must be regenerated before the build passes.')
}

main()
