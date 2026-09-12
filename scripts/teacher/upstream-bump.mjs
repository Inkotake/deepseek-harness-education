#!/usr/bin/env node
/**
 * Upstream bump: move this distribution to a newer DeepSeek Harness release.
 *
 * This is deliberately a *thin orchestrator over the repository's own upstream tooling*. It
 * never synthesises a runtime from published npm tarballs, because the vendor directory must be
 * an `official`-profile build produced by upstream's own `release:pack`. Everything it runs is a
 * command that already exists in this repository or in the fetched Harness checkout.
 *
 * The sequence, and why each step exists:
 *
 *   1. resolve the target release            (the tag `dsh-v<version>` in the Harness repository)
 *   2. check out that tag in the upstream checkout   (the pin is a commit, not a floating branch)
 *   3. yarn upstream:prepare-runtime         (install + build:official + release:pack --family dsh)
 *   4. verify the pack output                (release:pack writes deepseek-harness/dist/npm)
 *   5. rewrite the upstream.json pin         (commit + sourceVersion)
 *   6. yarn sync-vendored-runtime --write    (adopt the tarballs into vendor/dsh-runtime/<version>/,
 *                                             write its manifest.json with sha256 sums, and
 *                                             regenerate the 484 `@deepseek-ai/dsh*` resolutions)
 *   7. validate the adopted manifest         (version, buildProfile "official", package count)
 *   8. yarn install                          (resolve against the new vendor tarballs)
 *   9. report what a human must still do     (version-pinned patches, source API drift)
 *
 * `release:pack` deliberately does NOT write the vendor directory: it emits tarballs plus a publish
 * order and nothing else. Adoption — copying, the manifest, the sha256 sums — is the job of
 * `sync-vendored-runtime.mjs --write`, which is the same tool `--check` verifies with, so the written
 * state and the verified state cannot drift apart. An earlier revision of this script assumed the
 * pack step produced the vendor directory and therefore blocked on a manifest that nothing writes.
 *
 * Steps 1-8 are mechanical. Step 9 is the honest part: the patches in `patches/` are pinned to an
 * exact upstream version, so they *will* need regeneration, and the desktop source may need
 * adapting to API changes. The script refuses to pretend otherwise — it stops and prints exactly
 * what is stale rather than leaving a half-migrated tree.
 *
 * Usage:
 *   node scripts/teacher/upstream-bump.mjs --version 0.1.5-rc.2 [--dry-run] [--skip-install]
 *     [--skip-prepare] [--channel stable,beta] [--json]
 *
 * Every declared channel moves by default, because the Teacher distribution packages the
 * `dsh-plugin-desktop` workspace (the `stable` channel's product) while `activeChannel` is `beta`.
 * Bumping one channel in isolation leaves that workspace on the old upstream version and leaves two
 * versions of every `@deepseek-ai/dsh*` package resolvable at once. Pass `--channel` to move a subset.
 *
 * `--skip-prepare` resumes after a `yarn upstream:prepare-runtime` that already ran, reusing the
 * tarballs in `deepseek-harness/dist/npm`. It exists because that build is the slow step and a
 * failure in any later step must not cost the operator a second full upstream build.
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
const SKIP_PREPARE = flag('--skip-prepare')
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

/**
 * The channels one bump moves.
 *
 * The default is every declared channel, not just `activeChannel`. This repository ships the Teacher
 * distribution from the `dsh-plugin-desktop` workspace, which is the `stable` channel's `package`,
 * while `activeChannel` is `beta`. Bumping only the active channel therefore leaves the workspace we
 * actually package on the old upstream version and leaves two versions of every `@deepseek-ai/dsh*`
 * package resolvable at the same time. Move a subset deliberately with `--channel a,b`.
 * @param upstream - parsed `upstream.json`.
 * @returns Channel names to bump, in declaration order.
 */
function requestedChannels(upstream) {
  const declared = Object.keys(upstream.channels ?? {})
  const requested = value('--channel')
  if (requested === undefined) return declared
  const wanted = requested.split(',').map(name => name.trim()).filter(name => name.length > 0)
  if (wanted.length === 0) throw new Error('--channel needs at least one channel name')
  for (const name of wanted) {
    if (!declared.includes(name)) {
      throw new Error(`unknown channel ${JSON.stringify(name)}; declared: ${declared.join(', ')}`)
    }
  }
  return wanted
}

function main() {
  if (TARGET === undefined) {
    fail('usage: node scripts/teacher/upstream-bump.mjs --version <version> [--dry-run] [--skip-install] [--skip-prepare] [--channel a,b]')
    return
  }
  assertSemverLike(TARGET)

  const upstream = readJson(UPSTREAM_JSON)
  const channels = requestedChannels(upstream)
  const stale = channels.filter(name => upstream.channels?.[name]?.sourceVersion !== TARGET)
  log(`[upstream-bump] channels ${channels.join(', ')} -> ${TARGET}${DRY_RUN ? ' (dry run)' : ''}`)
  for (const name of channels) {
    const from = upstream.channels?.[name]?.sourceVersion
    log(`  ${name}: ${String(from)}${from === TARGET ? ' (already pinned)' : ''}`)
  }
  if (stale.length === 0) {
    log('[upstream-bump] every selected channel is already pinned to that version; nothing to do')
    return
  }

  // --- 1. the target commit, from upstream itself -------------------------------------------------
  const tag = `dsh-v${TARGET}`
  let commit
  try {
    // The fetched checkout's origin is the Harness repository, so its tags are the authority.
    const transport = fetchUpstreamTags()
    commit = git(['-C', HARNESS, 'rev-list', '-n', '1', tag])
    record('resolve upstream tag', 'ok', `${tag} -> ${commit.slice(0, 12)} (${transport})`)
  } catch (cause) {
    record('resolve upstream tag', 'blocked', `cannot resolve ${tag}: ${String(cause).split('\n')[0]}`)
    fail(`the Harness repository has no tag ${tag}; check the release exists upstream`)
    return
  }

  // --- 2. check the pin out (a commit, never a floating branch) -----------------------------------
  if (run('git', ['-C', HARNESS, 'checkout', '--detach', commit], { label: 'checkout upstream' }) !== 0) {
    record('checkout upstream', 'blocked', `could not check out ${commit.slice(0, 12)}`)
    fail('upstream checkout failed')
    return
  }
  record('checkout upstream', DRY_RUN ? 'skip' : 'ok', commit.slice(0, 12))

  // --- 3. produce the runtime with upstream's own tooling -----------------------------------------
  //    build:official matters: the vendor manifest must carry buildProfile "official".
  if (SKIP_PREPARE) {
    record('yarn upstream:prepare-runtime', 'skip', '--skip-prepare: reusing deepseek-harness/dist/npm')
  } else {
    const prepare = run('corepack', ['yarn', 'upstream:prepare-runtime'], { label: 'yarn upstream:prepare-runtime' })
    if (prepare !== 0) {
      record('yarn upstream:prepare-runtime', 'blocked', `exit ${prepare}`)
      fail('the upstream runtime build failed; the tree is left at the new commit for inspection')
      return
    }
    record('yarn upstream:prepare-runtime', DRY_RUN ? 'skip' : 'ok', 'install + build:official + release:pack --family dsh')
  }

  // --- 4. verify the pack output -------------------------------------------------------------------
  //    `release:pack` writes tarballs and a publish order. Nothing else. The vendor directory is
  //    assembled by sync-vendored-runtime --write in step 6, from exactly this publish order.
  const packedDirectory = path.join(HARNESS, 'dist', 'npm')
  const orderPath = path.join(packedDirectory, 'publish-order.txt')
  const packedTarballs = fs.existsSync(orderPath)
    ? fs.readFileSync(orderPath, 'utf8').trim().split(/\r?\n/u).filter(line => line.length > 0)
    : []
  if (!DRY_RUN && packedTarballs.length === 0) {
    record(
      'verify pack output',
      'blocked',
      `release:pack left no publish order at ${path.relative(ROOT, orderPath)}`,
    )
    fail('release:pack produced no tarball list; run yarn upstream:prepare-runtime before bumping')
    return
  }
  record(
    'verify pack output',
    DRY_RUN ? 'skip' : 'ok',
    `${packedTarballs.length} tarball(s) in ${path.relative(ROOT, packedDirectory)}`,
  )

  // --- 5. move the pins ---------------------------------------------------------------------------
  const nextChannels = { ...upstream.channels }
  for (const name of stale) {
    const entry = { ...(nextChannels[name] ?? {}) }
    entry.commit = commit
    entry.sourceVersion = TARGET
    entry.runtimePackageVersion = TARGET
    entry.runtimeSource = `vendor/dsh-runtime/${TARGET}/manifest.json`
    nextChannels[name] = entry
  }
  if (!DRY_RUN) {
    writeJson(UPSTREAM_JSON, { ...upstream, channels: nextChannels })
  }
  record(
    'update upstream.json',
    DRY_RUN ? 'skip' : 'ok',
    `${stale.join(', ')} -> commit ${commit.slice(0, 12)}, runtimeSource vendor/dsh-runtime/${TARGET}`,
  )

  // The plugin manifests pin the Harness explicitly; sync-vendored-runtime validates those too.
  // Each channel owns one product workspace; `dsh-community-market` is shared and syncs with beta.
  const productManifests = new Set(['dsh-community-market/package.json'])
  for (const name of channels) {
    const product = upstream.channels?.[name]?.package
    if (typeof product === 'string') productManifests.add(`${product}/package.json`)
  }
  for (const manifestRelative of productManifests) {
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

  // --- 6. re-derive the version-pinned patches ------------------------------------------------------
  //    This MUST run before sync-vendored-runtime. That tool decides whether a package gets a
  //    `patch:` resolution by checking whether `patches/<package>@<version>.patch` exists, so
  //    regenerating the patches afterwards would leave every resolution pointing at an unpatched
  //    tarball — installing cleanly and silently losing all four fixes.
  const ported = run('node', ['scripts/teacher/port-patches.mjs'], { label: 'port-patches' })
  if (ported !== 0) {
    record('port-patches', 'blocked', `exit ${ported}`)
    fail(
      'a declared patch no longer matches the upstream code. Re-derive the edit that failed — the'
      + ' message names the pattern — in scripts/teacher/port-patches.mjs, then bump again.',
    )
    return
  }
  record('port-patches', DRY_RUN ? 'skip' : 'ok', `version-pinned patches re-derived for ${TARGET}`)

  // --- 7. regenerate the resolutions with the repository's own tool ---------------------------------
  //    One run per selected channel. Each run rewrites that channel's product manifest dependencies and
  //    its own share of the shared resolutions map; the previous version's entries are dropped only
  //    because the channel that owned them no longer names them. A partial set leaves two versions of
  //    the same package resolvable at once.
  for (const name of channels) {
    const sync = run('node', ['scripts/sync-vendored-runtime.mjs', '--write', '--channel', name], {
      label: `sync-vendored-runtime --write --channel ${name}`,
    })
    if (sync !== 0) {
      record(`sync-vendored-runtime --write (${name})`, 'blocked', `exit ${sync}`)
      fail(`the resolutions could not be rewritten against the new manifest for channel ${name}`)
      return
    }
  }
  record(
    'sync-vendored-runtime --write',
    DRY_RUN ? 'skip' : 'ok',
    `resolutions regenerated for ${channels.join(', ')}`,
  )

  // --- 8. validate the manifest sync just adopted ---------------------------------------------------
  //    Adoption computing a manifest is not the same as the manifest being right. These four fields
  //    are the ones the runtime, the resolutions, and every downstream pin must agree on.
  if (DRY_RUN) {
    record('validate adopted manifest', 'skip', 'dry run')
  } else {
    const manifest = readJson(path.join(ROOT, 'vendor', 'dsh-runtime', TARGET, 'manifest.json'))
    const problems = []
    if (manifest.version !== TARGET) problems.push(`version ${String(manifest.version)}`)
    if (manifest.buildProfile !== 'official') problems.push(`buildProfile ${String(manifest.buildProfile)}`)
    if (manifest.commit !== commit) problems.push(`commit ${String(manifest.commit)}`)
    if (manifest.packages.length !== packedTarballs.length) {
      problems.push(`${String(manifest.packages.length)} packages for ${String(packedTarballs.length)} packed tarballs`)
    }
    if (problems.length > 0) {
      record('validate adopted manifest', 'blocked', problems.join('; '))
      fail('the adopted vendor manifest does not describe the build that was just packed')
      return
    }
    record('validate adopted manifest', 'ok', `${String(manifest.packages.length)} tarballs, profile ${manifest.buildProfile}`)
  }

  // --- 9. resolve ---------------------------------------------------------------------------------
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

  // --- 10. what a human must still do ---------------------------------------------------------------
  //    The patches are not listed here: step 6 re-derives them mechanically, and a patch whose target
  //    code moved fails the bump instead of becoming a TODO.
  record('adopt vendored plugins', 'todo', 're-check every vendored plugin against the new peer ranges (scripts/teacher/vendor-plugins.mjs)')
  record('adapt desktop source', 'todo', 'run yarn workspace dsh-plugin-desktop build and fix API drift')
  record('rebuild teacher runtime', 'todo', 'node scripts/teacher/build-teacher-runtime.mjs && node scripts/teacher/build-profile-seed.mjs')
  record('verify', 'todo', 'node scripts/teacher/verify-*.mjs && node scripts/teacher/smoke-package.mjs')

  if (JSON_OUTPUT) {
    const from = Object.fromEntries(
      channels.map(name => [name, upstream.channels?.[name]?.sourceVersion ?? null]),
    )
    process.stdout.write(`${JSON.stringify({ channels, from, to: TARGET, commit, dryRun: DRY_RUN, steps }, null, 2)}\n`)
  }
  const blocked = steps.filter(step => step.status === 'blocked')
  if (blocked.length > 0) {
    fail(`${blocked.length} step(s) blocked`)
    return
  }
  log('')
  log('[upstream-bump] mechanical steps complete. Remaining work is listed above as TODO.')
}

main()
