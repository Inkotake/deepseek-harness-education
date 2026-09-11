#!/usr/bin/env node
/**
 * Packaged Teacher DSH smoke test.
 *
 * Runs exclusively against a packaged application directory and answers the only question the
 * product actually cares about: **does the installation work without a development environment?**
 *
 * Usage:
 *   node scripts/teacher/smoke-package.mjs [--app <unpacked app dir>] [--json]
 *
 * Default app directory: `dsh-plugin-desktop/dist/win-unpacked`
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const appArg = process.argv.indexOf('--app')
const APP = path.resolve(
  appArg >= 0 && process.argv[appArg + 1] !== undefined
    ? process.argv[appArg + 1]
    : path.join(ROOT, 'dsh-plugin-desktop', 'dist', 'win-unpacked'),
)
const JSON_OUTPUT = process.argv.includes('--json')

const results = []
let workRoot = null

function record(id, ok, detail) {
  results.push({ id, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  process.stdout.write(`[smoke] ${mark} ${id}${detail === undefined ? '' : ` - ${detail}`}\n`)
}

function assertPath(id, target) {
  if (fs.existsSync(target)) {
    record(id, true, target)
    return true
  }
  record(id, false, `missing: ${target}`)
  return false
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? APP,
    encoding: 'utf8',
    env: options.env ?? process.env,
    shell: false,
  })
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

function main() {
  process.stdout.write(`[smoke] application directory: ${APP}\n`)
  if (!fs.existsSync(APP)) {
    record('app-directory', false, `not found: ${APP}`)
    return finish()
  }
  record('app-directory', true, APP)

  // ------------------------------------------------------------------
  // 1. The application itself launched by Electron.
  // ------------------------------------------------------------------
  assertPath('electron-executable', path.join(APP, 'Teacher DSH.exe'))

  // ------------------------------------------------------------------
  // 2. Bundled Node.js: real interpreter, no machine Node required.
  // ------------------------------------------------------------------
  const dshRuntime = path.join(APP, 'resources', 'dsh-runtime')
  const nodeExe = path.join(dshRuntime, 'node', 'node.exe')
  if (assertPath('bundled-node', nodeExe)) {
    const version = run(nodeExe, ['--version'])
    record('bundled-node-runs', version.status === 0, (version.stdout ?? '').trim())
    const npmCli = path.join(dshRuntime, 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (assertPath('bundled-npm', npmCli)) {
      const npmVersion = run(nodeExe, [npmCli, '--version'], { cwd: os.tmpdir() })
      record('bundled-npm-runs', npmVersion.status === 0, (npmVersion.stdout ?? '').trim())
    }
  }

  // ------------------------------------------------------------------
  // 3. Bundled pnpm.
  // ------------------------------------------------------------------
  const pnpmEntry = path.join(dshRuntime, 'pnpm', 'bin', 'pnpm.mjs')
  if (assertPath('bundled-pnpm', pnpmEntry) && fs.existsSync(nodeExe)) {
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsh-smoke-pnpm-'))
    const version = run(nodeExe, [pnpmEntry, '--version'], { cwd: probe })
    fs.rmSync(probe, { recursive: true, force: true })
    record('bundled-pnpm-runs', version.status === 0, (version.stdout ?? '').trim())
  }

  // ------------------------------------------------------------------
  // 4. Teacher runtime: CLIs, artifact dependencies, deploy CLIs, skills, seed.
  // ------------------------------------------------------------------
  const teacherRuntime = path.join(APP, 'resources', 'teacher-runtime')
  const artifactCli = path.join(teacherRuntime, 'cli', 'artifact-cli', 'bin', 'teacher-artifact.mjs')
  assertPath('teacher-artifact-cli', artifactCli)
  assertPath('teacher-latex-cli', path.join(teacherRuntime, 'cli', 'artifact-cli', 'bin', 'teacher-latex.mjs'))
  assertPath('teacher-publish-cli', path.join(teacherRuntime, 'cli', 'publish-cli', 'bin', 'teacher-publish.mjs'))
  assertPath('teacher-ppt-cli', path.join(teacherRuntime, 'ppt', 'bin', 'teacher-ppt.mjs'))

  const artifactModules = path.join(teacherRuntime, 'artifact', 'node_modules')
  for (const dependency of ['vite', 'three', 'jsxgraph', 'katex', 'echarts', 'mermaid', 'matter-js', '@teacher-dsh/artifact-sdk']) {
    assertPath(`artifact-dep:${dependency}`, path.join(artifactModules, dependency))
  }
  assertPath('artifact-templates', path.join(teacherRuntime, 'artifact', 'templates', 'three', 'index.html'))
  assertPath('ppt-dependency', path.join(teacherRuntime, 'ppt', 'node_modules', 'pptxgenjs'))
  assertPath('deploy-netlify', path.join(teacherRuntime, 'deploy', 'node_modules', 'netlify-cli'))
  assertPath('deploy-wrangler', path.join(teacherRuntime, 'deploy', 'node_modules', 'wrangler'))
  assertPath('deploy-vercel', path.join(teacherRuntime, 'deploy', 'node_modules', 'vercel'))

  const skillsRoot = path.join(teacherRuntime, 'skills')
  if (fs.existsSync(skillsRoot)) {
    const skills = fs.readdirSync(skillsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md')))
      .map(entry => entry.name)
      .sort()
    const required = ['teaching-aid', 'publish-static', 'latex-authoring', 'teacher-grabme']
    const missing = required.filter(name => !skills.includes(name))
    record('bundled-skills', missing.length === 0, `${skills.length} skills: ${skills.join(', ')}`)
    if (missing.length > 0) record('bundled-skills-required', false, `missing: ${missing.join(', ')}`)
  } else {
    record('bundled-skills', false, `missing: ${skillsRoot}`)
  }

  // The education preset tells the agent to put a working directory under version control before
  // changing it, and a teacher's machine cannot be assumed to have anything installed. The packaged
  // runtime must therefore carry git rather than rely on the host.
  assertPath('bundled-git', path.join(teacherRuntime, 'git', 'cmd', 'git.exe'))

  const seedManifest = path.join(teacherRuntime, 'seed', 'dsh-home', 'TEACHER-SEED.json')
  if (assertPath('profile-seed', seedManifest)) {
    try {
      const seed = JSON.parse(fs.readFileSync(seedManifest, 'utf8'))
      const profileDir = path.join(teacherRuntime, 'seed', 'dsh-home', 'profiles', 'desktop')
      const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
      const bundles = manifest.dsh?.profile?.bundles ?? []
      // Read the expectation from the seed's own manifest rather than a second hardcoded list. A
      // plugin added or retired in the builder must not need this smoke edited in lockstep, and the
      // two drifting apart is exactly what this check exists to catch. An empty field fails rather
      // than passing vacuously.
      const vendorExpected = Array.isArray(seed.vendorPlugins) ? seed.vendorPlugins : []
      const present = vendorExpected.filter(name => fs.existsSync(path.join(profileDir, 'node_modules', ...name.split('/'))))
      record('profile-seed-bundles', bundles.includes('@deepseek-ai/dsh-web-app'), `${bundles.length} bundles`)
      record(
        'profile-seed-vendor-plugins',
        vendorExpected.length > 0 && present.length === vendorExpected.length,
        `${present.length}/${vendorExpected.length}: ${present.join(', ')}`,
      )
      record('profile-seed-manifest', Array.isArray(seed.vendorPlugins), seed.builtAt ?? '')
    } catch (cause) {
      record('profile-seed-parse', false, String(cause))
    }
  }

  // ------------------------------------------------------------------
  // 5. Produce a real artifact with the packaged toolchain, offline.
  // ------------------------------------------------------------------
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsh-smoke-artifact-'))
  const env = {
    ...process.env,
    TEACHER_ARTIFACT_HOME: path.join(teacherRuntime, 'artifact'),
    TEACHER_TEMPLATES_HOME: path.join(teacherRuntime, 'artifact', 'templates'),
    TEACHER_DSH_TEMPLATES: path.join(teacherRuntime, 'artifact', 'templates'),
    TEACHER_DSH_OFFLINE: '1',
  }

  if (fs.existsSync(artifactCli) && fs.existsSync(nodeExe)) {
    const init = run(nodeExe, [artifactCli, 'init', 'smoke-three', '--template', 'three'], { cwd: workRoot, env })
    record('artifact-init', init.status === 0, lastLine(init))
    const project = path.join(workRoot, 'smoke-three')
    if (fs.existsSync(project)) {
      const build = run(nodeExe, [artifactCli, 'build'], { cwd: project, env })
      record('artifact-build', build.status === 0, lastLine(build))
      const check = run(nodeExe, [artifactCli, 'check'], { cwd: project, env })
      record('artifact-check', check.status === 0, lastLine(check))
      const distIndex = path.join(project, 'dist', 'index.html')
      record('artifact-dist', fs.existsSync(distIndex), distIndex)
      const bundleText = fs.existsSync(distIndex)
        ? fs.readdirSync(path.join(project, 'dist', 'assets')).filter(name => name.endsWith('.js'))
        : []
      record('artifact-js-bundle', bundleText.length > 0, bundleText.join(', '))
    }
  }

  // ------------------------------------------------------------------
  // 6. Produce a real, editable .pptx with the packaged presentation CLI.
  // ------------------------------------------------------------------
  const pptCli = path.join(teacherRuntime, 'ppt', 'bin', 'teacher-ppt.mjs')
  if (fs.existsSync(pptCli) && fs.existsSync(nodeExe)) {
    const init = run(nodeExe, [pptCli, 'init', 'deck.json'], { cwd: workRoot })
    record('ppt-init', init.status === 0, lastLine(init))
    const build = run(nodeExe, [pptCli, 'build', 'deck.json', '--out', 'smoke.pptx'], { cwd: workRoot })
    record('ppt-build', build.status === 0, lastLine(build))
    const pptx = path.join(workRoot, 'smoke.pptx')
    record('ppt-file', fs.existsSync(pptx), fs.existsSync(pptx) ? `${(fs.statSync(pptx).size / 1024).toFixed(1)} KB` : '')
    if (fs.existsSync(pptx)) {
      const check = run(nodeExe, [pptCli, 'check', pptx], { cwd: workRoot })
      record('ppt-check', check.status === 0, lastLine(check))
    }
  }

  // ------------------------------------------------------------------
  // 7. Report the shipped runtime footprint.
  // ------------------------------------------------------------------
  for (const [label, dir] of [['dsh-runtime', dshRuntime], ['teacher-runtime', teacherRuntime]]) {
    if (!fs.existsSync(dir)) continue
    const size = directorySize(dir)
    record(`${label}-size`, true, `${(size.bytes / 1024 / 1024).toFixed(1)} MB, ${size.files} files`)
  }

  return finish()
}

function lastLine(result) {
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const lines = text.split(/\r?\n/u).filter(Boolean)
  return lines.length === 0 ? `exit ${String(result.status)}` : lines[lines.length - 1]
}

function finish() {
  if (workRoot !== null) fs.rmSync(workRoot, { recursive: true, force: true })
  const failed = results.filter(entry => !entry.ok)
  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify({
      app: APP,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    }, null, 2)}\n`)
  } else {
    process.stdout.write(`[smoke] ${results.length - failed.length}/${results.length} checks passed\n`)
    if (failed.length > 0) {
      process.stdout.write(`[smoke] FAILURES:\n${failed.map(entry => `  - ${entry.id}: ${entry.detail}`).join('\n')}\n`)
    }
  }
  process.exitCode = failed.length === 0 ? 0 : 1
}

main()
