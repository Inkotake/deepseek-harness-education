#!/usr/bin/env node
/**
 * GrabMe case scorer.
 *
 * Scores one recorded session against one case from `cases.json` and reports, in
 * the two directions the README requires be reported separately:
 *
 * - which `must_ask_about` entries were never asked ("该问没问");
 * - which `must_not_ask_about` entries were asked anyway ("不该问却问了");
 * - whether `max_questions_first_turn` was exceeded;
 * - whether `must_offer_choices` / `must_produce_brief` held.
 *
 * Like `run.mjs`, this reads a recorded session. It does not start one and does
 * not call a model.
 *
 * Usage:
 *
 *   node teacher/evals/grabme/score.mjs --case <caseId> <session path> [--json] [--ascii]
 *
 * Exit codes: 0 = no assertion failed, 1 = at least one assertion failed,
 * 2 = bad invocation or unreadable input.
 *
 * @module grabme/score
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { collectSessionFiles, loadSessionLog } from './lib/load.mjs'
import { loadKnownEventTypes } from './lib/known-events.mjs'
import { loadCases, associateCase } from './lib/cases.mjs'
import { computeSessionMetrics } from './lib/metrics.mjs'
import { DEFAULT_ARTIFACT_TOOLS } from './lib/artifacts.mjs'
import { escapeNonAscii } from './lib/report.mjs'
import { DEFAULT_CASES_PATH, REPO_ROOT } from './run.mjs'

/**
 * Parse `score.mjs` arguments.
 * @param argv - arguments after the script name.
 * @returns the parsed options, or `{ error }`.
 */
export function parseScoreArgs(argv) {
  const options = {
    caseId: null,
    path: null,
    casesPath: DEFAULT_CASES_PATH,
    json: false,
    ascii: false,
    artifactTools: [...DEFAULT_ARTIFACT_TOOLS],
    tolerateUnknownEvents: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--ascii') { options.ascii = true; continue }
    if (arg === '--tolerate-unknown-events') { options.tolerateUnknownEvents = true; continue }
    if (arg === '--case') { options.caseId = argv[++index] ?? null; continue }
    if (arg === '--cases') { options.casesPath = argv[++index] ?? options.casesPath; continue }
    if (arg === '--artifacts') {
      options.artifactTools = String(argv[++index] ?? '').split(',').map(name => name.trim()).filter(Boolean)
      continue
    }
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (arg.startsWith('--')) return { error: `unknown option ${arg}` }
    if (options.path === null) options.path = arg
    else return { error: `unexpected extra argument ${arg}` }
  }
  if (options.help !== true && (options.caseId === null || options.path === null)) {
    return { error: 'both --case <caseId> and a session path are required' }
  }
  return options
}

/**
 * Score one session path against one case.
 *
 * @param options - parsed options.
 * @returns `{ score, session, error }`; `score` is the `scoreCase` result.
 */
export function runScore(options) {
  const knownEvents = loadKnownEventTypes(REPO_ROOT)
  const { byId } = loadCases(options.casesPath)
  if (!byId.has(options.caseId)) {
    return { error: `case "${options.caseId}" is not in ${options.casesPath}` }
  }

  const absolute = resolve(options.path)
  if (statSync(absolute, { throwIfNoEntry: false }) === undefined) {
    return { error: `path does not exist: ${absolute}` }
  }
  const collected = collectSessionFiles(absolute)
  if (collected.files.length === 0) {
    return { error: `no session artifact found under ${absolute}` }
  }

  const results = []
  for (const file of collected.files) {
    const loaded = loadSessionLog(file, knownEvents.types, {
      tolerateUnknownEvents: options.tolerateUnknownEvents,
    })
    if (loaded.error !== undefined) {
      results.push({ file, error: loaded.error.message })
      continue
    }
    const association = associateCase(loaded.session, byId, options.caseId)
    let snapshot = null
    const memoryPath = join(dirname(file), 'memory.json')
    if (statSync(memoryPath, { throwIfNoEntry: false }) !== undefined) {
      const parsed = JSON.parse(readFileSync(memoryPath, 'utf8'))
      snapshot = Array.isArray(parsed) ? parsed : parsed.records ?? null
    }
    const metrics = computeSessionMetrics({
      session: loaded.session,
      caseEntry: association.case,
      snapshot,
      artifactTools: options.artifactTools,
    })
    results.push({ file, metrics, score: metrics.caseScore })
  }
  return { results, knownEvents }
}

/** Render one score result as text. */
function render(results, options) {
  const out = (text) => (options.ascii ? escapeNonAscii(text) : String(text))
  const lines = []
  let failures = 0
  for (const result of results) {
    if (result.error !== undefined) {
      lines.push(out(`session ${result.file}: ERROR ${result.error}`))
      failures += 1
      continue
    }
    const { score } = result
    lines.push(out(`case ${score.caseId} (${score.category}) — session ${score.sessionId}`))
    lines.push(out(`  session: ${result.file}`))
    lines.push(out(
      `  max_questions_first_turn: limit=${score.maxQuestionsFirstTurn.limit ?? 'n/a'} `
      + `actual=${score.maxQuestionsFirstTurn.actual} exceeded=${score.maxQuestionsFirstTurn.exceeded}`,
    ))
    for (const question of score.questionsInFirstTurn) {
      lines.push(out(`    turn-1 question [${question.kind}] slot=${question.primary ?? 'unclassified'} :: ${question.text}`))
    }
    lines.push(out('  must_ask_about:'))
    for (const item of score.mustAskAbout) {
      lines.push(out(`    ${item.satisfied ? 'OK      ' : 'MISSING '} "${item.entry}"`))
    }
    lines.push(out('  must_not_ask_about:'))
    for (const item of score.mustNotAskAbout) {
      lines.push(out(`    ${item.violated ? 'VIOLATED' : 'clean   '} "${item.entry}"`))
      for (const question of item.questions) lines.push(out(`        t${question.turn} :: ${question.text}`))
    }
    lines.push(out(`  must_offer_choices : ${score.offeredChoices.satisfied ? 'OK' : 'FAILED'}`))
    lines.push(out(`  must_produce_brief : ${score.producedBrief.satisfied ? 'OK' : 'FAILED'}`))
    lines.push(out(`  brief detection    : unavailable — ${score.producedBrief.briefDetectionReason}`))
    lines.push(out(`  failures: ${score.failures.length}`))
    for (const failure of score.failures) {
      lines.push(out(`    [${failure.direction}] ${failure.assertion} "${failure.entry}" — ${failure.detail}`))
    }
    failures += score.failures.length
    lines.push('')
  }
  lines.push(out(`total assertion failures: ${failures}`))
  return lines.join('\n')
}

/** CLI entry point. */
function main() {
  const options = parseScoreArgs(process.argv.slice(2))
  if (options.error !== undefined) {
    process.stderr.write(`${options.error}\n\nusage: node teacher/evals/grabme/score.mjs --case <caseId> <session path> [--json] [--ascii]\n`)
    process.exitCode = 2
    return
  }
  if (options.help === true) {
    process.stdout.write('usage: node teacher/evals/grabme/score.mjs --case <caseId> <session path> [--json] [--ascii]\n')
    return
  }

  const outcome = runScore(options)
  if (outcome.error !== undefined) {
    process.stderr.write(`${outcome.error}\n`)
    process.exitCode = 2
    return
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(outcome.results, null, 2)}\n`)
  } else {
    process.stdout.write(`${render(outcome.results, options)}\n`)
  }
  const failed = outcome.results.reduce((total, result) =>
    total + (result.error !== undefined ? 1 : result.score.failures.length), 0)
  process.exitCode = failed > 0 ? 1 : 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main()
}
