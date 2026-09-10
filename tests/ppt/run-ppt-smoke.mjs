#!/usr/bin/env node
/**
 * End-to-end smoke for the presentation toolkit `teacher/packages/ppt-kit`.
 *
 * Runs the real CLI exactly as a teacher would, in a fresh temporary directory:
 *
 *   teacher-ppt init deck.json
 *   teacher-ppt build deck.json --out smoke.pptx
 *   teacher-ppt check smoke.pptx
 *
 * and then independently proves the result is OOXML by opening the archive with
 * `System.IO.Compression.ZipFile` and inspecting its entries, and that the example deck spec
 * actually covers a chart slide and a table slide.
 *
 * Usage:
 *   node tests/ppt/run-ppt-smoke.mjs [--help]
 *
 * PASS/OK lines go to stdout, WARN/FAIL diagnostics go to stderr.
 * Exit code: 0 when every check passed, 1 otherwise.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CLI = path.join(ROOT, 'teacher', 'packages', 'ppt-kit', 'bin', 'teacher-ppt.mjs')

const SPEC = 'deck.json'
const PPTX = 'smoke.pptx'
const MIN_PPTX_BYTES = 10 * 1024
const REQUIRED_ENTRIES = ['[Content_Types].xml', 'ppt/presentation.xml']
const SLIDE_ENTRY = /^ppt\/slides\/slide\d+\.xml$/u
const MIN_SLIDES = 5

const HELP = `End-to-end smoke for the Teacher DSH presentation toolkit.

Usage:
  node tests/ppt/run-ppt-smoke.mjs [--help]

Runs ${path.relative(ROOT, CLI)} through init -> build -> check in a temporary directory,
asserts the produced .pptx is real OOXML with at least ${MIN_SLIDES} slides and at least
${MIN_PPTX_BYTES / 1024} KB, and asserts the example spec covers a chart and a table slide.

Exit code: 0 when every check passed, 1 otherwise.
`

const failures = []
let workRoot = null

function pass(id, detail) {
  process.stdout.write(`[ppt-smoke] PASS ${id}${detail === undefined ? '' : ` - ${detail}`}\n`)
}

function fail(id, detail) {
  failures.push(`${id}: ${detail}`)
  process.stderr.write(`[ppt-smoke] FAIL ${id} - ${detail}\n`)
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? workRoot,
    encoding: 'utf8',
    shell: false,
  })
}

function lastLine(result) {
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const lines = text.split(/\r?\n/u).filter(Boolean)
  return lines.length === 0 ? `exit ${String(result.status)}` : lines[lines.length - 1]
}

function step(id, args) {
  const result = run(args)
  if (result.status === 0) pass(id, lastLine(result))
  else fail(id, lastLine(result))
  return result.status === 0
}

/** List archive entry names with PowerShell so the assertion never trusts the CLI's own check. */
function listZipEntries(zipPath) {
  const script = 'Add-Type -AssemblyName System.IO.Compression.FileSystem; '
    + `$z=[System.IO.Compression.ZipFile]::OpenRead('${zipPath.replaceAll("'", "''")}'); `
    + '$z.Entries | ForEach-Object { $_.FullName }; $z.Dispose()'
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', shell: false },
  )
  if (result.status !== 0) {
    fail('ooxml-open', `powershell ZipFile failed: ${(result.stderr ?? '').trim() || `exit ${String(result.status)}`}`)
    return null
  }
  return String(result.stdout ?? '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
}

function checkOoxml(pptxPath) {
  const entries = listZipEntries(pptxPath)
  if (entries === null) return 0

  const missing = REQUIRED_ENTRIES.filter(entry => !entries.includes(entry))
  if (missing.length === 0) pass('ooxml-required-entries', REQUIRED_ENTRIES.join(', '))
  else fail('ooxml-required-entries', `missing ${missing.join(', ')}`)

  const slides = entries.filter(entry => SLIDE_ENTRY.test(entry))
  if (slides.length >= MIN_SLIDES) pass('ooxml-slides', `${slides.length} slide parts`)
  else fail('ooxml-slides', `expected at least ${MIN_SLIDES} ppt/slides/slideN.xml parts, found ${slides.length}`)

  return slides.length
}

function checkSpecCovers() {
  const specPath = path.join(workRoot, SPEC)
  let spec
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
  } catch (cause) {
    fail('spec-parse', `cannot parse ${SPEC}: ${cause instanceof Error ? cause.message : String(cause)}`)
    return
  }
  const slides = Array.isArray(spec.slides) ? spec.slides : []
  const types = new Set(slides.map(slide => slide?.type))
  if (types.has('chart')) pass('spec-chart-slide', 'example spec contains a chart slide')
  else fail('spec-chart-slide', 'the example deck spec has no slide with type "chart"')
  if (types.has('table')) pass('spec-table-slide', 'example spec contains a table slide')
  else fail('spec-table-slide', 'the example deck spec has no slide with type "table"')
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(HELP)
    return
  }

  if (!fs.existsSync(CLI)) {
    fail('cli', `missing presentation CLI: ${CLI}`)
    return finish(0, 0)
  }
  pass('cli', path.relative(ROOT, CLI).split(path.sep).join('/'))

  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsh-ppt-smoke-'))
  process.stderr.write(`[ppt-smoke] working directory: ${workRoot}\n`)

  try {
    step('cli-init', ['init', SPEC])
    const built = step('cli-build', ['build', SPEC, '--out', PPTX])
    const pptxPath = path.join(workRoot, PPTX)

    if (!built || !fs.existsSync(pptxPath)) {
      fail('pptx-present', `missing ${pptxPath}`)
      return finish(0, 0)
    }

    const bytes = fs.statSync(pptxPath).size
    if (bytes >= MIN_PPTX_BYTES) pass('pptx-size', `${(bytes / 1024).toFixed(1)} KB`)
    else fail('pptx-size', `${(bytes / 1024).toFixed(1)} KB is below the ${MIN_PPTX_BYTES / 1024} KB floor`)

    step('cli-check', ['check', PPTX])

    const slideCount = checkOoxml(pptxPath)
    checkSpecCovers()

    return finish(slideCount, bytes)
  } finally {
    if (workRoot !== null) fs.rmSync(workRoot, { recursive: true, force: true })
  }
}

function finish(slideCount, bytes) {
  if (failures.length > 0) {
    process.stderr.write(`[ppt-smoke] FAIL ${failures.length} check(s)\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `[ppt-smoke] PASS smoke.pptx is a valid deck: ${slideCount} slides, `
    + `${(bytes / 1024).toFixed(1)} KB, editable OOXML\n`,
  )
}

main()
