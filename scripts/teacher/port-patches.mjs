#!/usr/bin/env node
/**
 * Regenerate the version-pinned upstream patches for the pinned Harness release.
 *
 * `patches/` holds Yarn `patch:` files that change *built* upstream code by exact text, so every
 * upstream bump invalidates them. Rewriting them by hand is how a bump turns into an afternoon of
 * diff archaeology. Each patch is therefore declared here as the edit it makes — a file pattern plus
 * ordered find/replace pairs — and this script derives the patch file from the pinned vendor tarball.
 *
 * Derivation, per patched package:
 *   1. extract `vendor/dsh-runtime/<version>/<tarball>` into a scratch directory
 *   2. commit that pristine tree to a throwaway git repository
 *   3. apply the declared edits, failing when a `find` does not match the expected number of times
 *   4. emit `git diff` as `patches/<package>@<version>.patch`
 *   5. delete that package's patches pinned to any other version
 *
 * Step 3 is the point. When upstream rewrites the code a patch targets, this script fails loudly and
 * names the pattern, instead of leaving behind a patch that silently stops matching. Yarn applies
 * `patch:` resolutions during install, so a wrong patch fails there too — two independent checks.
 *
 * Usage:
 *   node scripts/teacher/port-patches.mjs [--check] [--json]
 *
 * `--check` re-derives every patch in memory and reports which files differ, without writing
 * anything. It is the gate that keeps the declared edits and the shipped patch files in agreement.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const JSON_OUTPUT = args.includes('--json')

/**
 * One edit: the first `find` match count must equal `count`, then every match is replaced.
 * `file` selects the built file inside the extracted package by path pattern.
 */
const PATCHES = [
  {
    package: '@deepseek-ai/dsh',
    why: 'The profile plugin runner spawns pnpm through a shell on Windows. Without windowsHide the '
      + 'command opens a console window over the app for every plugin operation.',
    edits: [
      {
        file: /^lib\/plugin-.*\.js$/u,
        find: /\n(\t+)shell: process\.platform === "win32"\n/u,
        replace: '\n$1shell: process.platform === "win32",\n$1windowsHide: true\n',
        count: 1,
      },
    ],
  },
  {
    package: '@deepseek-ai/dsh-web-app',
    why: 'The browser opener spawns process.execPath, which is Electron inside this desktop build. '
      + 'ELECTRON_RUN_AS_NODE makes that child behave as plain Node instead of booting a second app '
      + 'instance, and windowsHide keeps its console window off screen. The launcher program drops '
      + 'the variable again so the browser process it hands the URL to does not inherit it.',
    edits: [
      {
        file: /^lib\/index\.js$/u,
        find: /const BROWSER_OPENER_PROGRAM = `\ntry \{/u,
        replace: 'const BROWSER_OPENER_PROGRAM = `\n'
          + 'for (const name of Object.keys(process.env)) '
          + "if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete process.env[name]\n"
          + 'try {',
        count: 1,
      },
      {
        file: /^lib\/index\.js$/u,
        find: /\n(\t+)env: scrubbedParentEnv\(\),\n/u,
        replace: '\n$1windowsHide: true,\n$1env: {\n$1\t...scrubbedParentEnv(),\n'
          + '$1\tELECTRON_RUN_AS_NODE: "1"\n$1},\n',
        count: 1,
      },
    ],
  },
  {
    package: '@deepseek-ai/dsh-win32-process',
    why: 'Both CreateProcess sites pass STARTF_USESTDHANDLES without STARTF_USESHOWWINDOW, so a '
      + 'console child gets a visible window. Adding the flag with SW_HIDE starts it hidden.',
    edits: [
      {
        file: /^lib\/index\.js$/u,
        find: /\n(\t+)dwFlags: 256,\n/u,
        replace: '\n$1dwFlags: 257,\n$1wShowWindow: 0,\n',
        count: 2,
      },
    ],
  },
  {
    package: '@deepseek-ai/dsh-host-directory-picker-native',
    why: 'The Win32 folder dialog runs in a child process spawned from process.execPath, which is '
      + 'Electron inside this desktop build. Upstream assumes that path is plain node ("built consumers '
      + 'launch the bundled CJS entry under plain node"), so without ELECTRON_RUN_AS_NODE the child '
      + 'boots as a second application instance and exits before reporting a dialog result — the picker '
      + 'always fails with "worker exited before reporting a result".',
    edits: [
      {
        file: /^lib\/index\.js$/u,
        find: /\n(\t+)DSH_DIALOG_TITLE: data\.title\n/u,
        replace: '\n$1DSH_DIALOG_TITLE: data.title,\n$1ELECTRON_RUN_AS_NODE: "1"\n',
        count: 1,
      },
    ],
  },
  {
    package: '@deepseek-ai/dsh-host-directory-picker-browse',
    why: 'Windows reparse and system directories are reported as directories by the dirent but can '
      + 'fail stat. The original only probed symbolic links, so those entries stayed selectable and '
      + 'the browser offered a path it could not enter. The picker also always opened at the OS home '
      + 'directory; on Windows it now opens at the current user\'s Desktop instead. That starting '
      + 'point needs the fallback in the same edit: a Windows profile can have no Desktop directory '
      + 'at all (OneDrive redirection, enterprise policy, or a removed folder), and the listing of a '
      + 'missing directory fails with directory-unreadable, so the panel would not open. The Desktop '
      + 'is therefore used only when it stats as a directory, and the home directory remains both '
      + 'the fallback and the reported listing.home, which is the client\'s breadcrumb anchor rather '
      + 'than the starting point.',
    edits: [
      {
        file: /^lib\/index\.js$/u,
        find: /\tlet enterable = isDirectory;\n\tif \(!enterable && isSymbolicLink\) try \{/u,
        replace: '\tlet enterable = false;\n\tif (isDirectory || isSymbolicLink) try {',
        count: 1,
      },
      {
        file: /^lib\/index\.js$/u,
        find: /\t\tconst target = resolve\(path \?\? home\);\n/u,
        replace: '\t\tlet target = resolve(path ?? home);\n'
          + '\t\tif (path === void 0 && process.platform === "win32") {\n'
          + '\t\t\tconst desktop = join(home, "Desktop");\n'
          + '\t\t\ttry {\n'
          + '\t\t\t\tif ((await raceAbort(stat(desktop), signal)).isDirectory()) target = desktop;\n'
          + '\t\t\t} catch {\n'
          + '\t\t\t\t/* No Desktop directory on this profile: the home listing is the fallback. */\n'
          + '\t\t\t}\n'
          + '\t\t}\n',
        count: 1,
      },
    ],
  },
]

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const log = message => { if (!JSON_OUTPUT) process.stdout.write(`${message}\n`) }

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, { encoding: 'utf8', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${argv.join(' ')} failed (${String(result.status)}): ${String(result.stderr).trim()}`)
  }
  return String(result.stdout)
}

function git(repository, argv) {
  return run('git', ['-C', repository, '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', ...argv])
}

/** @returns the pinned release version from the active channel. */
function pinnedVersion() {
  const upstream = readJson(path.join(ROOT, 'upstream.json'))
  const channel = upstream.channels?.[upstream.activeChannel]
  if (typeof channel?.sourceVersion !== 'string') {
    throw new Error(`upstream.json has no sourceVersion for channel ${String(upstream.activeChannel)}`)
  }
  return { channel: upstream.activeChannel, version: channel.sourceVersion }
}

/** @returns every built file path in the package matching one edit's `file` pattern. */
function selectFile(packageRoot, pattern) {
  const matches = []
  const stack = [packageRoot]
  while (stack.length > 0) {
    const directory = stack.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) stack.push(absolute)
      else if (entry.isFile()) {
        const relative = path.relative(packageRoot, absolute).split(path.sep).join('/')
        if (pattern.test(relative)) matches.push({ absolute, relative })
      }
    }
  }
  matches.sort((left, right) => left.relative.localeCompare(right.relative))
  return matches
}

/**
 * Apply one package's declared edits to an extracted tree.
 * @param packageRoot - directory holding the package's built files.
 * @param spec - the declared patch.
 * @returns the relative paths that changed.
 */
function applyEdits(packageRoot, spec) {
  const changed = new Set()
  for (const edit of spec.edits) {
    const files = selectFile(packageRoot, edit.file)
    if (files.length === 0) {
      throw new Error(`${spec.package}: no file matches ${String(edit.file)}`)
    }
    let applied = 0
    for (const file of files) {
      const source = fs.readFileSync(file.absolute, 'utf8')
      // The replacement must run global, and `edit.find` deliberately carries no `g` flag so it can be
      // embedded elsewhere. Counting with a global clone while replacing with the bare pattern would
      // replace one occurrence, count them all, and pass its own check — which is exactly how a
      // two-site patch shipped with one site changed.
      const pattern = new RegExp(edit.find.source, `${edit.find.flags.replace('g', '')}g`)
      const found = source.match(pattern) ?? []
      if (found.length === 0) continue
      fs.writeFileSync(file.absolute, source.replace(pattern, edit.replace))
      applied += found.length
      changed.add(file.relative)
    }
    if (applied !== edit.count) {
      throw new Error(
        `${spec.package}: pattern ${String(edit.find)} matched ${String(applied)} time(s) in `
        + `${files.map(file => file.relative).join(', ')}, expected ${String(edit.count)}. `
        + 'Upstream changed this code: re-derive the edit in scripts/teacher/port-patches.mjs.',
      )
    }
  }
  return [...changed].sort()
}

/**
 * Derive one patch file's content.
 * @param scratch - scratch root for this run.
 * @param spec - the declared patch.
 * @param filename - vendored tarball name.
 * @returns the patch text and the files it touches.
 */
function derive(scratch, spec, filename) {
  const tarball = path.join(ROOT, 'vendor', 'dsh-runtime', pinnedVersion().version, filename)
  if (!fs.existsSync(tarball)) throw new Error(`${spec.package}: missing vendored tarball ${tarball}`)
  const directory = path.join(scratch, spec.package.replace(/[@/]/gu, '_'))
  const packageRoot = path.join(directory, 'package')
  fs.mkdirSync(directory, { recursive: true })
  run('tar', ['-xf', tarball, '-C', directory])
  if (!fs.existsSync(packageRoot)) throw new Error(`${spec.package}: tarball has no package/ directory`)
  if (!fs.existsSync(path.join(packageRoot, 'package.json'))) {
    throw new Error(`${spec.package}: extracted package has no package.json`)
  }

  git(packageRoot, ['init', '--quiet'])
  git(packageRoot, ['add', '--all'])
  git(packageRoot, [
    '-c', 'user.email=teacher-dsh@localhost', '-c', 'user.name=teacher-dsh',
    'commit', '--quiet', '--message', 'pristine',
  ])

  const changed = applyEdits(packageRoot, spec)
  const patch = git(packageRoot, ['diff', '--no-color', '--no-ext-diff'])
  if (patch.trim().length === 0) throw new Error(`${spec.package}: edits produced an empty diff`)
  return { patch, changed }
}

function main() {
  const { version } = pinnedVersion()
  const manifest = readJson(path.join(ROOT, 'vendor', 'dsh-runtime', version, 'manifest.json'))
  const filenameOf = new Map(manifest.packages.map(entry => [entry.name, entry.filename]))
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-port-patches-'))
  const results = []

  try {
    for (const spec of PATCHES) {
      const filename = filenameOf.get(spec.package)
      if (filename === undefined) {
        throw new Error(`${spec.package} is not part of the pinned runtime manifest`)
      }
      const { patch, changed } = derive(scratch, spec, filename)
      const unscoped = spec.package.slice('@deepseek-ai/'.length)
      const relative = `patches/${unscoped}@${version}.patch`
      const target = path.join(ROOT, ...relative.split('/'))
      const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
      const state = current === patch ? 'unchanged' : current === null ? 'created' : 'rewritten'
      if (!CHECK && state !== 'unchanged') fs.writeFileSync(target, patch)
      results.push({ package: spec.package, file: relative, state, changed: changed.length })
      log(`  ${CHECK ? 'CHECK' : state.toUpperCase().padEnd(9)} ${relative} (${String(changed.length)} file(s))`)
    }

    // A patch pinned to any other version can never apply and only misleads. Version-independent
    // third-party patches (app-builder-lib, open) are not named after upstream packages and stay.
    const owned = new Set(PATCHES.map(spec => spec.package.slice('@deepseek-ai/'.length)))
    for (const entry of fs.readdirSync(path.join(ROOT, 'patches'))) {
      const match = /^(.*)@([0-9][^@]*)\.patch$/u.exec(entry)
      if (match === null || !owned.has(match[1]) || match[2] === version) continue
      if (!CHECK) fs.rmSync(path.join(ROOT, 'patches', entry))
      results.push({ package: `@deepseek-ai/${match[1]}`, file: `patches/${entry}`, state: 'stale', changed: 0 })
      log(`  ${CHECK ? 'CHECK' : 'REMOVED  '} patches/${entry} (pinned to ${match[2]})`)
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }

  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify({ version, check: CHECK, results }, null, 2)}\n`)
    return
  }
  const stale = results.filter(result => result.state === 'stale')
  const drift = results.filter(result => result.state === 'created' || result.state === 'rewritten')
  log('')
  if (CHECK && (stale.length > 0 || drift.length > 0)) {
    log(`[port-patches] ${String(drift.length + stale.length)} patch file(s) differ from the declared edits`)
    process.exitCode = 1
    return
  }
  log(`[port-patches] ${String(results.length)} patch file(s) match the declared edits for ${version}`)
}

main()
