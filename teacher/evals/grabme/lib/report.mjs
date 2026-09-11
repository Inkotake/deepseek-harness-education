/**
 * Human-readable and JSON report rendering.
 *
 * The text report is the operator view: it names each metric, its value, its
 * denominator, and its target, then lists the two failure directions separately
 * because the README's pass condition requires both.
 *
 * `--ascii` escapes every non-ASCII character as `\uXXXX`. The PowerShell console
 * mangles UTF-8 Chinese, so an ASCII rendering is the only text form that survives
 * being copied out of a terminal; `--json` is the machine form and keeps real
 * characters.
 *
 * @module grabme/lib/report.mjs
 */

/** Metric identifiers in `metrics.md` order, with their display names. */
export const METRIC_ORDER = Object.freeze([
  ['askRate', 'Ask Rate'],
  ['repeatedQuestionRate', 'Repeated Question Rate'],
  ['usefulQuestionRate', 'Useful Question Rate'],
  ['timeToFirstUsefulArtifact', 'Time to First Useful Artifact'],
  ['memoryPrecision', 'Memory Precision'],
  ['wrongMemoryUsageRate', 'Wrong Memory Usage Rate'],
  ['directExecutionRate', 'Direct Execution Rate'],
  ['medianClarificationRounds', 'Median clarification rounds'],
])

/** Escape every non-ASCII code point so the console cannot mangle the text. */
export function escapeNonAscii(text) {
  return String(text).replace(/[^\u0000-\u007F]/gu, character =>
    `\\u${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
}

/** Render one value for the text report. */
export function formatValue(value) {
  if (value === null || value === undefined) return 'n/a'
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(4)
  }
  return String(value)
}

/** Pad a cell to a fixed width. Escaping happens first so columns line up in `--ascii` mode too. */
function pad(text, width, ascii) {
  const value = ascii ? escapeNonAscii(text) : String(text)
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

/**
 * Render the whole report as text.
 *
 * @param report - the object returned by `runBatch` in `run.mjs`.
 * @param options - `{ ascii }`.
 * @returns the report text, one line per row.
 */
export function renderTextReport(report, options = {}) {
  const { ascii = false } = options
  const out = (text) => (ascii ? escapeNonAscii(text) : String(text))
  const lines = []

  lines.push(out(`GrabMe eval report`))
  lines.push(out(`generated: ${report.generatedAt}`))
  lines.push(out(`session vocabulary source: ${report.knownEvents.source} (${report.knownEvents.path})`))
  if (report.knownEvents.note !== null) lines.push(out(`  note: ${report.knownEvents.note}`))
  lines.push(out(`scored sessions: ${report.aggregate.sessionCount} of ${report.inputs.length} input(s)`))
  lines.push('')

  lines.push(out('== metrics =='))
  lines.push(out(`${pad('metric', 32, ascii)}${pad('value', 12, ascii)}${pad('target', 30, ascii)}${pad('verdict', 10, ascii)}denominators`))
  for (const [key, label] of METRIC_ORDER) {
    const value = formatValue(report.aggregate.metrics[key])
    const target = report.aggregate.targets[key].target
    const pass = report.aggregate.passes[key]
    const verdict = pass === null || pass === undefined ? 'observe' : pass ? 'PASS' : 'FAIL'
    lines.push(out(`${pad(label, 32, ascii)}${pad(value, 12, ascii)}${pad(target, 30, ascii)}${pad(verdict, 10, ascii)}${describeDenominator(key, report.aggregate)}`))
  }
  lines.push('')

  lines.push(out('== per session =='))
  lines.push(out(`${pad('session', 36, ascii)}${pad('case', 36, ascii)}${pad('Q', 5, ascii)}${pad('Qmem', 6, ascii)}${pad('r(s)', 6, ascii)}${pad('f(s)', 7, ascii)}${pad('direct', 7, ascii)}|M(s)|`))
  for (const session of report.sessions) {
    lines.push(out(
      `${pad(session.sessionId, 36, ascii)}${pad(session.caseId ?? '-', 36, ascii)}${pad(session.questionCount, 5, ascii)}`
      + `${pad(session.questions.filter(question => question.repeated).length, 6, ascii)}`
      + `${pad(session.clarificationRounds, 6, ascii)}`
      + `${pad(session.firstArtifactTurn === null ? 'inf' : session.firstArtifactTurn, 7, ascii)}`
      + `${pad(session.directExecution.value, 7, ascii)}${session.memory.recordCount}`,
    ))
  }
  lines.push('')

  lines.push(out('== questions =='))
  for (const session of report.sessions) {
    for (const question of session.questions) {
      const flags = []
      if (question.repeated) flags.push('REPEAT')
      if (question.ttlExemption?.exempt === true) flags.push('TTL-EXEMPT')
      if (question.slot === null) flags.push('UNCLASSIFIED')
      lines.push(out(
        `  t${question.turn} ${question.kind} slot=${question.slot ?? 'unclassified'}`
        + `${question.options.length > 0 ? ` options=${question.options.length}` : ''}`
        + `${flags.length > 0 ? ` [${flags.join(',')}]` : ''} :: ${question.text}`,
      ))
      if (question.ttlExemption !== null && question.ttlExemption !== undefined) {
        const { a, b, c, exempt } = question.ttlExemption
        lines.push(out(`      ttl-exemption a=${a} b=${b} c=${c} exempt=${exempt}`))
        for (const reason of question.ttlExemption.reasons) lines.push(out(`      - ${reason}`))
      }
    }
  }
  lines.push('')

  lines.push(out('== useful-question judgement (proxy, log-only) =='))
  for (const session of report.sessions) {
    for (const item of session.changed) {
      lines.push(out(
        `  t${item.turn} slot=${item.primary ?? 'unclassified'} changed=${item.changed === null ? 'undecidable' : item.changed}`
        + ` :: ${item.reason}`,
      ))
    }
  }
  lines.push('')

  lines.push(out('== memory records =='))
  for (const session of report.sessions) {
    for (const score of session.memory.scores) {
      lines.push(out(
        `  ${score.namespace}.${score.key} rel=${score.rel ? 1 : 0} bad=${score.bad ? 1 : 0}`
        + `${score.undetermined ? ' undetermined=1' : ''} origin=${score.origin} :: ${score.value}`,
      ))
      for (const reason of score.reasons) lines.push(out(`      - ${reason}`))
    }
  }
  lines.push('')

  if (report.caseScores.length > 0) {
    lines.push(out('== case assertions =='))
    for (const score of report.caseScores) {
      lines.push(out(`case ${score.caseId} (${score.category}) session ${score.sessionId}`))
      lines.push(out(`  max_questions_first_turn: limit=${formatValue(score.maxQuestionsFirstTurn.limit)} actual=${score.maxQuestionsFirstTurn.actual} exceeded=${score.maxQuestionsFirstTurn.exceeded}`))
      for (const item of score.mustAskAbout) {
        lines.push(out(`  must_ask_about "${item.entry}": ${item.satisfied ? 'satisfied' : 'MISSING (should have asked)'}`))
      }
      for (const item of score.mustNotAskAbout) {
        lines.push(out(`  must_not_ask_about "${item.entry}": ${item.violated ? 'VIOLATED (should not have asked)' : 'clean'}`))
      }
      lines.push(out(`  must_offer_choices: ${score.offeredChoices.satisfied ? 'satisfied' : 'FAILED'}`))
      lines.push(out(`  must_produce_brief: ${score.producedBrief.satisfied ? 'satisfied' : 'FAILED'} (briefDetected=null: ${score.producedBrief.briefDetectionReason})`))
      for (const failure of score.failures) {
        lines.push(out(`  FAIL [${failure.direction}] ${failure.assertion} "${failure.entry}": ${failure.detail}`))
      }
      lines.push('')
    }
  }

  if (report.errors.length > 0) {
    lines.push(out('== errors =='))
    for (const error of report.errors) lines.push(out(`  ${error.filePath}: ${error.message}`))
    lines.push('')
  }

  if (report.aggregate.caveats.length > 0) {
    lines.push(out('== caveats =='))
    for (const caveat of report.aggregate.caveats) lines.push(out(`  - ${caveat}`))
  }

  return lines.join('\n')
}

/** Describe the denominator a rate was computed over. */
function describeDenominator(key, aggregate) {
  switch (key) {
    case 'askRate':
      return `ΣQ=${aggregate.denominators.questions} |S|=${aggregate.denominators.sessions}`
    case 'repeatedQuestionRate':
      return `|Qmem|=${aggregate.counts.repeatedQuestions} |Q|=${aggregate.denominators.questions} (ttl-exempt=${aggregate.counts.exemptReconfirmations})`
    case 'usefulQuestionRate':
      return `changed=${aggregate.counts.changedQuestions} |Q|-undecidable=${aggregate.denominators.usefulQuestionDenominator} (undecidable=${aggregate.counts.changedUndecidable})`
    case 'timeToFirstUsefulArtifact':
      return `sessions with artifacts=${aggregate.denominators.firstArtifactSessions} no-artifact=${aggregate.counts.noArtifactSessions.length}`
    case 'memoryPrecision':
      return `rel=${aggregate.counts.memoryRelevant} |M|=${aggregate.denominators.memoryRecords}`
    case 'wrongMemoryUsageRate':
      return `bad=${aggregate.counts.memoryBad} |M|=${aggregate.denominators.memoryRecords} (undetermined=${aggregate.counts.memoryUndetermined})`
    case 'directExecutionRate':
      return `direct=${aggregate.counts.directExecutionSessions} |S|=${aggregate.denominators.sessions}`
    case 'medianClarificationRounds':
      return `r(s) over ${aggregate.denominators.sessions} session(s), budget violations=${aggregate.counts.clarificationBudgetViolations.length}`
    default:
      return ''
  }
}
