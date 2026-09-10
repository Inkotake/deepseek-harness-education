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

function stepSkills() {
  const skillsRoot = path.join(TEACHER_RUNTIME, 'skills')
  emptyDir(skillsRoot)
  // DSH discovers bundled skills as `<root>/<skill-name>/SKILL.md` (or flat `<root>/<name>.md`),
  // so the shipped tree must be flat and name-unique rather than grouped by vendor.
  const own = ['teaching-aid', 'publish-static', 'latex-authoring']
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
  for (const entry of lock.core ?? []) {
    const source = path.join(RESOURCES, 'teacher-seed', 'plugins', entry.id)
    if (!fs.existsSync(source)) {
      warn(`plugin source missing: ${entry.id}`)
      continue
    }
    copyDir(source, path.join(pluginsRoot, 'sources', entry.id))
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
  ['skills', stepSkills],
  ['plugins', stepPlugins],
  ['manifests', stepManifests],
  ['bin', stepBin]
]

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

main()
