#!/usr/bin/env node
/**
 * GrabMe eval runner.
 *
 * Turns one or more **recorded** DSH sessions into the eight metrics defined by
 * `teacher/evals/grabme/metrics.md`, plus the per-case assertions from
 * `cases.json`.
 *
 * This runner does not call a model and does not drive a session. It scores what
 * a session already recorded in the append-only log: every number is counted from
 * `user/message`, `turn/start`, `turn/end`, `assistant/message`, `tool/call`,
 * `tool/result`, and `deliverables/presented` events, never from the assistant's
 * prose.
 *
 * Usage:
 *
 *   node teacher/evals/grabme/run.mjs <path...> [options]
 *
 *   <path>    a session directory, a `session[.vN].jsonl[.zstd]` file, or a batch
 *             root directory that is walked for session directories.
 *
 * Options:
 *   --json                       print the machine-readable report instead of text
 *   --ascii                      escape non-ASCII in the text report (PowerShell-safe)
 *   --cases <path>               alternate cases.json
 *   --case <caseId>              force one case for every session in this run
 *   --artifacts <a,b>            tool names whose successful result counts as a deliverable
 *   --tolerate-unknown-events    score logs carrying unknown, non-ignorable event types
 *
 * @module grabme/run
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { collectSessionFiles, loadSessionLog } from './lib/load.mjs'
import { loadKnownEventTypes } from './lib/known-events.mjs'
import { loadCases, associateCase } from './lib/cases.mjs'
import { aggregateMetrics, computeSessionMetrics } from './lib/metrics.mjs'
import { DEFAULT_ARTIFACT_TOOLS } from './lib/artifacts.mjs'
import { renderTextReport } from './lib/report.mjs'

const HERE = import.meta.dirname
/** Repository root: `teacher/evals/grabme/lib` → up four levels. */
export const REPO_ROOT = resolve(HERE, '..', '..', '..', '..')
/** Default case file, next to this runner's parent directory. */
export const DEFAULT_CASES_PATH = join(REPO_ROOT, 'teacher', 'evals', 'grabme', 'cases.json')

/**
 * Parse `process.argv`-style arguments.
 * @param argv - arguments after the script name.
 * @returns the parsed options, or `{ error }` for an unusable invocation.
 */
export function parseArgs(argv) {
  const options = {
    paths: [],
    json: false,
    ascii: false,
    casesPath: DEFAULT_CASES_PATH,
    caseId: null,
    artifactTools: [...DEFAULT_ARTIFACT_TOOLS],
    tolerateUnknownEvents: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--json': options.json = true; break
      case '--ascii': options.ascii = true; break
      case '--tolerate-unknown-events': options.tolerateUnknownEvents = true; break
      case '--cases': options.casesPath = requireValue(argv, ++index, arg); break
      case '--case': options.caseId = requireValue(argv, ++index, arg); break
      case '--artifacts':
        options.artifactTools = requireValue(argv, ++index, arg).split(',').map(name => name.trim()).filter(Boolean)
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        if (arg.startsWith('--')) return { error: `unknown option ${arg}` }
        options.paths.push(arg)
    }
  }
  if (!options.help && options.paths.length === 0) return { error: 'no session path given' }
  return options
}

/** Read the value of a two-token option, or `undefined` when it is missing. */
function requireValue(argv, index, flag) {
  const value = argv[index]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`option ${flag} needs a value`)
  }
  return value
}

/** Read a session-adjacent `memory.json` snapshot, when present. */
function readMemorySnapshot(logPath) {
  const candidates = [join(dirname(logPath), 'memory.json')]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const parsed = JSON.parse(readFileSync(candidate, 'utf8'))
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed?.records)) return parsed.records
    throw new Error(`${candidate}: expected an array of MemoryRecord rows or { records: [...] }`)
  }
  return null
}

/**
 * Score every session reachable from the given inputs.
 *
 * @param options - the parsed options from {@link parseArgs}.
 * @returns the report object rendered by `lib/report.mjs`.
 */
export function runBatch(options) {
  const knownEvents = loadKnownEventTypes(REPO_ROOT)
  const errors = []
  const inputs = []

  let cases
  let byId
  try {
    const loaded = loadCases(options.casesPath)
    cases = loaded.cases
    byId = loaded.byId
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      knownEvents,
      inputs: options.paths,
      sessions: [],
      caseScores: [],
      caseCount: 0,
      aggregate: aggregateMetrics([]),
      errors: [{ filePath: options.casesPath, message: error.message }],
    }
  }

  const sessions = []
  for (const inputPath of options.paths) {
    const absolute = resolve(inputPath)
    const stat = statSync(absolute, { throwIfNoEntry: false })
    if (stat === undefined) {
      errors.push({ filePath: absolute, message: 'path does not exist' })
      continue
    }
    const collected = collectSessionFiles(absolute)
    for (const missing of collected.missing) errors.push({ filePath: missing, message: 'path does not exist' })
    if (collected.files.length === 0) {
      errors.push({ filePath: absolute, message: 'no session artifact found under this path' })
      continue
    }
    for (const file of collected.files) {
      inputs.push(file)
      const loaded = loadSessionLog(file, knownEvents.types, {
        tolerateUnknownEvents: options.tolerateUnknownEvents,
      })
      if (loaded.error !== undefined) {
        errors.push(loaded.error)
        continue
      }
      const association = associateCase(loaded.session, byId, options.caseId)
      if (association.unknownCaseId !== undefined) {
        errors.push({ filePath: file, message: `--case ${association.unknownCaseId} is not in ${basename(options.casesPath)}` })
        continue
      }
      let snapshot = null
      try {
        snapshot = readMemorySnapshot(file)
      } catch (error) {
        errors.push({ filePath: file, message: error.message })
      }
      const metrics = computeSessionMetrics({
        session: loaded.session,
        caseEntry: association.case,
        snapshot,
        artifactTools: options.artifactTools,
      })
      metrics.matchedBy = association.matchedBy
      sessions.push(metrics)
    }
  }

  const caseScores = sessions.map(session => session.caseScore).filter(score => score !== null)
  const directionTotals = {
    shouldHaveAsked: caseScores.reduce(
      (total, score) => total + score.failures.filter(failure => failure.direction === 'should-have-asked').length,
      0,
    ),
    shouldNotHaveAsked: caseScores.reduce(
      (total, score) => total + score.failures.filter(failure => failure.direction === 'should-not-have-asked').length,
      0,
    ),
  }

  return {
    generatedAt: new Date().toISOString(),
    knownEvents,
    inputs,
    sessions,
    caseScores,
    caseCount: cases.length,
    directionTotals,
    aggregate: aggregateMetrics(sessions),
    errors,
  }
}

/** CLI entry point. */
function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 2
    return
  }
  if (options.error !== undefined) {
    process.stderr.write(`${options.error}\n\n${usage()}\n`)
    process.exitCode = 2
    return
  }
  if (options.help === true) {
    process.stdout.write(`${usage()}\n`)
    return
  }

  const report = runBatch(options)
  const scored = report.sessions.length > 0
  process.stdout.write(
    options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${renderTextReport(report, { ascii: options.ascii })}\n`,
  )
  process.exitCode = scored ? 0 : 2
}

/** The usage block printed by `--help` and on a bad invocation. */
export function usage() {
  return [
    'GrabMe eval runner — scores recorded DSH sessions, it does not call a model.',
    '',
    '  node teacher/evals/grabme/run.mjs <path...> [--json] [--ascii] [--case <id>]',
    '                                        [--cases <file>] [--artifacts a,b]',
    '                                        [--tolerate-unknown-events]',
    '',
    '  <path>  a session directory, a session[.vN].jsonl[.zstd] file, or a batch root',
    '',
    'Exit codes: 0 = at least one session scored, 2 = nothing scored / bad invocation.',
  ].join('\n')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main()
}
