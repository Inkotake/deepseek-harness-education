/** Teacher DSH runtime bootstrap: expose the bundled teacher toolchain to the Host. */

import { delimiter, join, resolve } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const TEACHER_ENV_KEYS = [
  'TEACHER_DSH_HOME',
  'TEACHER_ARTIFACT_HOME',
  'TEACHER_SKILLS_HOME',
  'TEACHER_DEPLOY_HOME',
  'TEACHER_TEMPLATES_HOME',
] as const

/** Resolve the teacher runtime root from the packaged app or dev tree. */
export function teacherRuntimeRoot(importMetaUrl: string): string {
  const packaged = process.env.TEACHER_RUNTIME_ROOT
  if (packaged !== undefined && packaged !== '') return resolve(packaged)
  if (process.defaultApp ?? true
    ? process.env.NODE_ENV !== 'production'
    : false) {
    // Dev: teacher layer lives beside the desktop plugin source.
    return resolve(importMetaUrl, '..', '..', '..', 'teacher')
  }
  return resolve(process.resourcesPath ?? '', 'teacher-runtime')
}

/** Windows batch shim for a teacher command. */
function windowsTeacherShim(cliPath: string, label: string): string {
  const node = process.execPath
  const cli = cliPath.replaceAll('%', '%%')
  const escaped = (s: string): string => s.replaceAll('%', '%%').replace(/"/g, '')
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `rem Teacher DSH bundled ${label}`,
    `set "TEACHER_DSH_HOME=${escaped(process.env.TEACHER_DSH_HOME ?? '')}"`,
    `"${escaped(node)}" --import "" "${cli}" %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

/** Install teacher-runtime bin shims and prepend them to PATH. */
export function installTeacherRuntime(options: {
  importMetaUrl: string
  stateDir: string
  environment: NodeJS.ProcessEnv
}): { pathDir: string; dispose(): void } {
  const runtimeRoot = teacherRuntimeRoot(options.importMetaUrl)
  const artifactCli = join(runtimeRoot, 'packages', 'artifact-cli', 'bin', 'teacher-artifact.mjs')
  const publishCli = join(runtimeRoot, 'packages', 'publish-cli', 'bin', 'teacher-publish.mjs')
  const latexCli = join(runtimeRoot, 'packages', 'artifact-cli', 'bin', 'teacher-latex.mjs')

  const pathDir = join(options.stateDir, 'teacher-bin')
  mkdirSync(pathDir, { recursive: true })
  if (options.environment.platform !== undefined && options.environment.platform !== 'win32') {
    throw new Error('teacher-runtime bootstrap currently supports Windows only')
  }
  const isWin = process.platform === 'win32'
  const shims: Array<[string, string, string]> = [
    ['teacher-artifact.cmd', artifactCli, 'artifact CLI'],
    ['teacher-publish.cmd', publishCli, 'publish CLI'],
    ['teacher-latex.cmd', latexCli, 'latex CLI'],
  ]
  for (const [name, cli, label] of shims) {
    if (!existsSync(cli)) continue
    writeFileSync(join(pathDir, name), windowsTeacherShim(cli, label), { encoding: 'utf8' })
  }

  // Teacher environment roots
  const env = options.environment
  env.TEACHER_DSH_HOME = join(options.stateDir, 'teacher-root')
  env.TEACHER_ARTIFACT_HOME = join(runtimeRoot, 'templates')
  env.TEACHER_SKILLS_HOME = join(runtimeRoot, 'skills')
  env.TEACHER_DEPLOY_HOME = join(runtimeRoot, 'packages', 'publish-cli')
  env.TEACHER_TEMPLATES_HOME = join(runtimeRoot, 'templates')
  mkdirSync(env.TEACHER_DSH_HOME ?? join(options.stateDir, 'teacher-root'), { recursive: true })

  const inherited = env.PATH ?? env.Path ?? ''
  const sep = isWin ? ';' : ':'
  if (!inherited.split(sep).some((p) => p.toLowerCase() === pathDir.toLowerCase())) {
    env.PATH = inherited.length === 0 ? pathDir : `${pathDir}${sep}${inherited}`
  }

  let active = true
  return {
    pathDir,
    dispose() {
      if (!active) return
      active = false
      const current = env.PATH ?? env.Path ?? ''
      const without = current.split(sep).filter((p) => p.toLowerCase() !== pathDir.toLowerCase()).join(sep)
      env.PATH = without
      for (const key of TEACHER_ENV_KEYS) delete env[key]
    },
  }
}