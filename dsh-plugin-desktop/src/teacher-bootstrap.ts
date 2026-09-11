/**
 * Teacher DSH runtime bootstrap.
 *
 * A Teacher DSH installation carries its own Node.js, pnpm, teacher CLI entry
 * points, artifact toolchain, deploy toolchain, and Skills. This module owns the
 * only thing the Host needs to know about them: a generated command directory on
 * PATH plus the `TEACHER_*` environment roots.
 *
 * Everything here is process-local. The Windows machine PATH, `NODE_HOME`, and
 * any npm global prefix are deliberately never touched.
 */

import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PATH = 'PATH'
const DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const TEMPORARY_ID = /^\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Environment roots exported to the Host and every Teacher command. */
export const TEACHER_ENVIRONMENT_KEYS = [
  'TEACHER_DSH_HOME',
  'TEACHER_ARTIFACT_HOME',
  'TEACHER_TEMPLATES_HOME',
  'TEACHER_SKILLS_HOME',
  'TEACHER_DEPLOY_HOME',
  'TEACHER_PPT_HOME',
  'TEACHER_GIT_HOME',
  'TEACHER_RUNTIME_ROOT',
  'TEACHER_NODE',
  'TEACHER_DSH_TEMPLATES',
  'DSH_BUNDLED_SKILL_DIR',
  'COREPACK_ENABLE_DOWNLOAD_PROMPT',
] as const

/** Generated Teacher commands published to the Host PATH. */
export const TEACHER_COMMANDS = [
  'teacher-artifact',
  'teacher-latex',
  'teacher-publish',
  'teacher-ppt',
] as const

/** Inputs used to install the Teacher command environment. */
export interface TeacherRuntimeOptions {
  /** Directory that holds the packaged `dsh-runtime` and `teacher-runtime` trees. */
  resourcesRoot: string
  /** Staged runtime override used by development and tests. */
  runtimeRoot?: string | undefined
  /** Private application-owned directory receiving generated command files. */
  stateDir: string
  /** Electron executable reused for RunAsNode command shims. */
  appExecutable: string
  /** Parent environment whose PATH is updated; defaults to `process.env`. */
  environment?: NodeJS.ProcessEnv | undefined
}

/** Generated Teacher command environment and its reversible PATH update. */
export interface TeacherRuntimeInstallation {
  /** Public directory prepended to the Host PATH; it contains only Teacher commands. */
  pathDir: string
  /** Resolved bundled Teacher runtime root. */
  runtimeRoot: string
  /** Resolved bundled Node.js/pnpm/dsh runtime root. */
  dshRuntimeRoot: string
  /** Absolute bundled Node.js executable. */
  nodeExecutable: string
  /** Absolute bundled pnpm entry point. */
  pnpmEntry: string
  /** Remove this installation's PATH entry without deleting persistent generated files. */
  dispose(): void
}

/** Reject a value that cannot be represented in a generated command file. */
function assertScriptValue(label: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`dsh-plugin-desktop: teacher runtime ${label} must not be empty`)
  }
  if (/[\0\r\n"]/u.test(value)) {
    throw new Error(`dsh-plugin-desktop: teacher runtime ${label} must not contain quotes, NUL, or newlines`)
  }
}

/** Quote one Windows batch argv word without permitting quote injection. */
function quoteBatchWord(value: string): string {
  assertScriptValue('command argument', value)
  return `"${value.replaceAll('%', '%%')}"`
}

/** Create one owner-only real directory and reject a pre-existing alternate file type. */
function preparePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE })
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`dsh-plugin-desktop: teacher runtime path is not a private directory: ${directory}`)
  }
}

/** Return one lstat result, preserving every failure except absence. */
function lstatOptional(filename: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(filename)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
}

/** Remove one stray command entry without recursively deleting unknown data. */
function removeUnexpectedEntry(directory: string, entry: string): void {
  const filename = join(directory, entry)
  if (lstatSync(filename).isDirectory()) {
    throw new Error(`dsh-plugin-desktop: teacher runtime contains an unexpected directory: ${entry}`)
  }
  unlinkSync(filename)
}

/** Recover an app-owned command directory to this generation's exact contents. */
function reconcileOwnedDirectoryEntries(directory: string, allowed: readonly string[]): void {
  for (const entry of readdirSync(directory)) {
    if (!allowed.includes(entry)) removeUnexpectedEntry(directory, entry)
  }
}

/** Remove only stale atomic-write files generated for one exact target name. */
function removeStaleTemporaryFiles(directory: string, targetName: string): void {
  const prefix = `.${targetName}.`
  const suffix = '.tmp'
  for (const entry of readdirSync(directory)) {
    if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue
    if (!TEMPORARY_ID.test(entry.slice(prefix.length, -suffix.length))) continue
    const filename = join(directory, entry)
    const stat = lstatSync(filename)
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      throw new Error(`dsh-plugin-desktop: teacher runtime stale temporary path is not a file: ${filename}`)
    }
    unlinkSync(filename)
  }
}

/** Remove a temporary file while preserving every failure except absence. */
function unlinkTemporaryFile(filename: string): void {
  try {
    unlinkSync(filename)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
}

/** Atomically replace one regular app-owned file without accepting a symlink target. */
function replacePrivateFile(filename: string, contents: string, mode: number): void {
  const existing = lstatOptional(filename)
  if (existing !== undefined && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error(`dsh-plugin-desktop: teacher runtime file is not a regular file: ${filename}`)
  }
  const temporary = join(dirname(filename), `.${basename(filename)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx', mode })
    chmodSync(temporary, mode)
    renameSync(temporary, filename)
  } finally {
    unlinkTemporaryFile(temporary)
  }
}

interface PathEntry {
  key: string
  value: string | undefined
}

/** Return the environment entries addressing PATH on Windows. */
function pathEntries(environment: NodeJS.ProcessEnv): PathEntry[] {
  return Object.entries(environment)
    .filter(([key]) => key.toUpperCase() === PATH)
    .map(([key, value]) => ({ key, value }))
}

/** Remove every occurrence of one directory from a Windows PATH value. */
function withoutPathDirectory(value: string, directory: string): string {
  const target = directory.toLowerCase()
  return value
    .split(';')
    .filter(component => component.replace(/^"|"$/gu, '').toLowerCase() !== target)
    .join(';')
}

/** Prepend one directory to PATH and return an idempotent, non-clobbering disposer. */
function installPathDirectory(environment: NodeJS.ProcessEnv, directory: string): () => void {
  const original = pathEntries(environment)
  const current = original.find(entry => entry.value !== undefined)
  const currentValue = current?.value ?? ''
  if (withoutPathDirectory(currentValue, directory) !== currentValue) return () => {}

  const key = current?.key ?? PATH
  const installedValue = currentValue.length === 0 ? directory : `${directory};${currentValue}`
  for (const entry of original) delete environment[entry.key]
  environment[key] = installedValue

  let active = true
  return () => {
    if (!active) return
    active = false
    const latest = pathEntries(environment)
    if (latest.length === 1 && latest[0]?.key === key && latest[0].value === installedValue) {
      delete environment[key]
      for (const entry of original) environment[entry.key] = entry.value
      return
    }
    for (const entry of latest) {
      if (entry.value === undefined) continue
      environment[entry.key] = withoutPathDirectory(entry.value, directory)
    }
  }
}

/** Windows batch shim that runs one Node.js entry point with the bundled Node.js. */
function windowsNodeShim(nodeExecutable: string, entry: string, label: string): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `rem Teacher DSH bundled ${label}`,
    `${quoteBatchWord(nodeExecutable)} ${quoteBatchWord(entry)} %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

/** Windows batch shim that runs one Node.js entry point under Electron RunAsNode. */
function windowsElectronShim(appExecutable: string, entry: string, label: string): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `rem Teacher DSH bundled ${label}`,
    `set "${RUN_AS_NODE}=1"`,
    `${quoteBatchWord(appExecutable)} ${quoteBatchWord(entry)} %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

/** Resolve the first existing directory from an ordered candidate list. */
function firstExistingDirectory(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate.length === 0) continue
    try {
      if (statSync(candidate).isDirectory()) return resolve(candidate)
    } catch {
      continue
    }
  }
  return undefined
}

/** Resolve the bundled runtime roots from an explicit override or the application resources. */
export function resolveTeacherRuntimeRoots(options: {
  resourcesRoot: string
  runtimeRoot?: string | undefined
  importMetaUrl: string
}): { runtimeRoot: string; dshRuntimeRoot: string } {
  const devResources = resolve(fileURLToPath(new URL('../../../resources/', options.importMetaUrl)))
  const resourcesCandidates = [options.resourcesRoot, devResources]
  const teacherCandidates = [
    options.runtimeRoot,
    ...resourcesCandidates.map(root => join(root, 'teacher-runtime')),
  ].filter((value): value is string => value !== undefined)
  const dshCandidates = resourcesCandidates.map(root => join(root, 'dsh-runtime'))

  const runtimeRoot = firstExistingDirectory(teacherCandidates)
  if (runtimeRoot === undefined) {
    throw new Error(
      `dsh-plugin-desktop: bundled teacher runtime was not found; looked in ${teacherCandidates.join(', ')}`,
    )
  }
  const dshRuntimeRoot = firstExistingDirectory(dshCandidates) ?? join(runtimeRoot, '..', 'dsh-runtime')
  return { runtimeRoot, dshRuntimeRoot: resolve(dshRuntimeRoot) }
}

/**
 * Install the bundled Teacher command environment into this process.
 * @param options - resolved resources, private state, and the parent environment.
 * @returns generated file paths and an idempotent disposer.
 */
export function installTeacherRuntime(options: TeacherRuntimeOptions): TeacherRuntimeInstallation {
  if (process.platform !== 'win32') {
    throw new Error(`dsh-plugin-desktop: teacher runtime is unsupported on ${process.platform}`)
  }
  const environment = options.environment ?? process.env
  const { runtimeRoot, dshRuntimeRoot } = resolveTeacherRuntimeRoots({
    resourcesRoot: options.resourcesRoot,
    runtimeRoot: options.runtimeRoot,
    importMetaUrl: import.meta.url,
  })

  const nodeExecutable = join(dshRuntimeRoot, 'node', 'node.exe')
  if (!existsSync(nodeExecutable)) {
    throw new Error(`dsh-plugin-desktop: bundled Node.js was not found at ${nodeExecutable}`)
  }
  const pnpmEntry = join(dshRuntimeRoot, 'pnpm', 'bin', 'pnpm.mjs')
  const dshEntry = join(dshRuntimeRoot, 'dsh', 'dsh.mjs')

  const teacherHome = join(options.stateDir, 'home')
  const pathDir = join(options.stateDir, 'bin')
  preparePrivateDirectory(options.stateDir)
  preparePrivateDirectory(teacherHome)
  preparePrivateDirectory(pathDir)

  const commands: Array<[string, string, string]> = [
    ['teacher-artifact.cmd', join(runtimeRoot, 'cli', 'artifact-cli', 'bin', 'teacher-artifact.mjs'), 'artifact CLI'],
    ['teacher-latex.cmd', join(runtimeRoot, 'cli', 'artifact-cli', 'bin', 'teacher-latex.mjs'), 'LaTeX CLI'],
    ['teacher-publish.cmd', join(runtimeRoot, 'cli', 'publish-cli', 'bin', 'teacher-publish.mjs'), 'publish CLI'],
    ['teacher-ppt.cmd', join(runtimeRoot, 'ppt', 'bin', 'teacher-ppt.mjs'), 'presentation CLI'],
  ]
  const shims: Array<{ name: string; contents: string }> = commands
    .filter(([, entry]) => existsSync(entry))
    .map(([name, entry, label]) => ({
      name,
      contents: windowsNodeShim(nodeExecutable, entry, label),
    }))
  if (existsSync(pnpmEntry)) {
    shims.push({ name: 'pnpm.cmd', contents: windowsNodeShim(nodeExecutable, pnpmEntry, 'pnpm') })
  }
  if (existsSync(dshEntry)) {
    shims.push({ name: 'dsh-teacher.cmd', contents: windowsElectronShim(options.appExecutable, dshEntry, 'dsh') })
  }
  const allowed = shims.map(shim => shim.name)
  for (const shim of shims) removeStaleTemporaryFiles(pathDir, shim.name)
  reconcileOwnedDirectoryEntries(pathDir, allowed)
  for (const shim of shims) {
    replacePrivateFile(join(pathDir, shim.name), shim.contents, PRIVATE_FILE_MODE)
  }

  const roots: Record<string, string> = {
    TEACHER_DSH_HOME: teacherHome,
    TEACHER_ARTIFACT_HOME: join(runtimeRoot, 'artifact'),
    TEACHER_TEMPLATES_HOME: join(runtimeRoot, 'artifact', 'templates'),
    TEACHER_DSH_TEMPLATES: join(runtimeRoot, 'artifact', 'templates'),
    TEACHER_SKILLS_HOME: join(runtimeRoot, 'skills'),
    TEACHER_DEPLOY_HOME: join(runtimeRoot, 'deploy'),
    TEACHER_PPT_HOME: join(runtimeRoot, 'ppt'),
    TEACHER_GIT_HOME: join(runtimeRoot, 'git'),
    TEACHER_RUNTIME_ROOT: runtimeRoot,
    TEACHER_NODE: nodeExecutable,
    // The Harness filesystem skill provider scans this root with bundled-skill rank, which is
    // what makes every Teacher Skill available to a session with no user configuration.
    DSH_BUNDLED_SKILL_DIR: join(runtimeRoot, 'skills'),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  }
  for (const [key, value] of Object.entries(roots)) {
    environment[key] = value
  }
  environment.PNPM_HOME = join(options.stateDir, 'pnpm-home')
  preparePrivateDirectory(environment.PNPM_HOME)

  const releaseBin = installPathDirectory(environment, pathDir)
  const releaseNode = installPathDirectory(environment, join(dshRuntimeRoot, 'node'))
  // Embedded git, so the education preset's version-control instruction works on a machine that has
  // nothing installed. MinGit publishes `cmd/git.exe`, and that directory is what belongs on PATH.
  const gitBin = join(runtimeRoot, 'git', 'cmd')
  const releaseGit = existsSync(gitBin) ? installPathDirectory(environment, gitBin) : () => {}
  // Deploy CLIs resolve from the bundled tree; no global npm install is ever required.
  const deployBin = join(runtimeRoot, 'deploy', 'node_modules', '.bin')
  const releaseDeploy = existsSync(deployBin) ? installPathDirectory(environment, deployBin) : () => {}

  let active = true
  return {
    pathDir,
    runtimeRoot,
    dshRuntimeRoot,
    nodeExecutable,
    pnpmEntry,
    dispose() {
      if (!active) return
      active = false
      releaseDeploy()
      releaseGit()
      releaseNode()
      releaseBin()
      for (const key of TEACHER_ENVIRONMENT_KEYS) delete environment[key]
      delete environment.PNPM_HOME
    },
  }
}

/** Resolve the packaged resources root for the running Electron application. */
export function teacherResourcesRoot(
  resourcesPath: string | undefined = process.resourcesPath,
  importMetaUrl: string = import.meta.url,
): string {
  if (resourcesPath !== undefined && resourcesPath.length > 0 && existsSync(join(resourcesPath, 'teacher-runtime'))) {
    return resourcesPath
  }
  return resolve(fileURLToPath(new URL('../../../resources/', importMetaUrl)))
}
