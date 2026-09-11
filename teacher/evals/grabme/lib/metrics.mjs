/**
 * The eight GrabMe metrics, computed from one session log plus the batch
 * aggregate.
 *
 * Every formula is `metrics.md`'s, in its own notation:
 *
 * | # | metric | formula |
 * |---|---|---|
 * | 1 | Ask Rate | `Σ Q(s) / \|S\|` |
 * | 2 | Repeated Question Rate | `\|Qmem\| / \|Q\|` |
 * | 3 | Useful Question Rate | `Σ changed(x) / (\|Q\| − undecidable)` |
 * | 4 | Time to First Useful Artifact | `median({ f(s) : f(s) ≠ ∞ })` |
 * | 5 | Memory Precision | `Σ rel(m) / Σ \|M(s)\|` |
 * | 6 | Wrong Memory Usage Rate | `Σ bad(m) / Σ \|M(s)\|` |
 * | 7 | Direct Execution Rate | `Σ direct(s) / \|S\|` |
 * | 8 | Median clarification rounds | `median({ r(s) })` |
 *
 * Where a term cannot be established from the log, the report says so and names
 * the term; no term is silently dropped.
 *
 * @module grabme/lib/metrics.mjs
 */

import { collectArtifacts, artifactTextWhere, judgeChanged, DEFAULT_ARTIFACT_TOOLS } from './artifacts.mjs'
import { extractQuestions, messageText, isErrorResult } from './questions.mjs'
import {
  collectMemoryRecords,
  deriveTaskType,
  evaluateTtlExemption,
  scoreRecord,
  RETRIEVAL_RULES,
} from './memory.mjs'
import { scoreCase } from './cases.mjs'

/** The clarification budget from plan §四, quoted by `metrics.md` §8. */
export const MAX_CLARIFICATION_ROUNDS_BEFORE_DRAFT = 2

/** Targets the README states as pass conditions. */
export const METRIC_TARGETS = Object.freeze({
  repeatedQuestionRate: { target: '< 2%', comparator: 'lt', value: 0.02, direction: 'lower-is-better' },
  medianClarificationRounds: { target: '<= 1', comparator: 'lte', value: 1, direction: 'lower-is-better' },
  timeToFirstUsefulArtifact: { target: '<= 2 用户轮', comparator: 'lte', value: 2, direction: 'lower-is-better' },
  askRate: { target: 'observe', comparator: 'none', value: null, direction: 'lower-is-better' },
  usefulQuestionRate: { target: 'observe', comparator: 'none', value: null, direction: 'higher-is-better' },
  memoryPrecision: { target: 'observe', comparator: 'none', value: null, direction: 'higher-is-better' },
  wrongMemoryUsageRate: { target: 'observe', comparator: 'none', value: null, direction: 'lower-is-better' },
  directExecutionRate: { target: 'observe', comparator: 'none', value: null, direction: 'higher-is-better' },
})

/**
 * Compute every per-session quantity once, so the batch aggregate is a pure fold
 * over these results.
 *
 * @param context - `{ session, caseEntry, snapshot, artifactTools }`.
 * @returns the per-session metric record described in the README's report schema.
 */
export function computeSessionMetrics(context) {
  const { session, caseEntry = null, snapshot = null } = context
  const artifactTools = context.artifactTools ?? DEFAULT_ARTIFACT_TOOLS
  const problems = []

  const artifacts = collectArtifacts(session, artifactTools)

  const { records, sources, problems: memoryProblems } = collectMemoryRecords(session, {
    preloaded: caseEntry?.preloadedMemory,
    snapshot,
  })
  problems.push(...memoryProblems)

  const caseEntries = caseEntry === null
    ? []
    : [...caseEntry.mustAskAbout, ...caseEntry.mustNotAskAbout]
  const rawQuestions = extractQuestions(session, { caseEntries, problems })

  const humanMessages = collectHumanMessages(session)
  const taskType = deriveTaskType(caseEntry?.teacherMessage)
  const rule = RETRIEVAL_RULES.find(entry => entry.task_type === taskType) ?? RETRIEVAL_RULES[3]

  const questionRecords = buildQuestionLedger(rawQuestions, {
    session,
    records,
  })

  const changed = questionRecords.map(question => ({
    kind: question.kind,
    turn: question.turn,
    text: question.text,
    primary: question.attribution.primary,
    ...judgeChanged({ question, artifacts }),
  }))

  const memoryScores = records.map(record => {
    const artifactText = artifactTextWhere(
      artifacts,
      artifact => artifact.turn > record.injectionTurn
        || (artifact.turn === record.injectionTurn && artifact.seq > record.injectionSeq),
    )
    return {
      id: record.id,
      namespace: record.namespace,
      key: record.key,
      value: record.value,
      origin: record.origin,
      expires_at: record.expires_at,
      slot: record.slot,
      ...scoreRecord({
        record,
        rule,
        session,
        questions: questionRecords,
        artifactText,
        humanMessages,
      }),
    }
  })

  const clarifications = computeClarificationRounds(session, questionRecords, artifacts)
  const firstArtifactTurn = artifacts.length === 0
    ? null
    : Math.min(...artifacts.map(artifact => artifact.turn))
  const direct = computeDirectExecution(session, questionRecords, artifacts)
  const userMessages = session.events.filter(event => event.type === 'user/message')

  return {
    sessionId: session.sessionId,
    filePath: session.filePath,
    storeVersion: session.version,
    createdAt: session.createdAt,
    caseId: caseEntry?.id ?? null,
    category: caseEntry?.category ?? null,
    taskType,
    turnCount: session.events.filter(event => event.type === 'turn/start').length,
    userMessageCount: userMessages.length,
    humanMessageCount: humanMessages.length,
    questionCount: questionRecords.length,
    questions: questionRecords,
    changed,
    clarificationRounds: clarifications.rounds,
    clarificationBudgetViolated: clarifications.budgetViolated,
    clarificationDetail: clarifications.detail,
    firstArtifactTurn,
    directExecution: direct,
    artifactCount: artifacts.length,
    artifacts: artifacts.map(artifact => ({ kind: artifact.kind, turn: artifact.turn, tool: artifact.tool })),
    memory: {
      recordCount: records.length,
      sources,
      rule: { task_type: rule.task_type, namespaces: rule.namespaces, mustExclude: rule.mustExclude },
      scores: memoryScores,
    },
    warnings: session.warnings,
    unknownEventTypes: session.unknownEventTypes,
    skippedEvents: session.skippedEvents,
    problems,
    caseScore: caseEntry === null
      ? null
      : scoreCase({ session, questions: questionRecords, artifacts, caseEntry }),
  }
}

/**
 * Build the question ledger: attribution, answered-slot membership at the moment
 * of asking, and the TTL exemption.
 *
 * `A` at the moment a question is asked is the memory slot set plus the slots of
 * questions answered in strictly earlier turns — `metrics.md`'s
 * "`preloaded_memory` + 本 session 先前轮次". The ledger walks questions in turn
 * order and only promotes a turn's answered slots after that whole turn has been
 * judged, so two questions in the same turn never mark each other as answered.
 */
function buildQuestionLedger(questions, context) {
  const { session, records } = context
  const answered = new Set()
  for (const record of records) for (const slot of record.slots) answered.add(slot)

  const ledger = []
  let currentTurn = questions.length === 0 ? 0 : questions[0].turn
  let turnAnswered = []

  for (const question of questions) {
    if (question.turn !== currentTurn) {
      for (const slot of turnAnswered) answered.add(slot)
      turnAnswered = []
      currentTurn = question.turn
    }

    const slot = question.attribution.primary
    const candidateRecords = slot === null ? [] : records.filter(record => record.slots.includes(slot))
    const exemption = candidateRecords.length === 0
      ? null
      : {
        recordId: candidateRecords[0].id,
        ...evaluateTtlExemption({ question, record: candidateRecords[0], session }),
      }

    const inAnsweredSlots = slot !== null && answered.has(slot)
    ledger.push({
      ...question,
      slot,
      inAnsweredSlots,
      answeredSlotBasis: [...answered],
      ttlExemption: exemption,
      repeated: inAnsweredSlots && !(exemption?.exempt === true),
    })

    if (question.answer !== null && question.answer !== undefined && slot !== null) turnAnswered.push(slot)
  }
  return ledger
}

/** Human (non-plugin) user messages in the session. */
function collectHumanMessages(session) {
  const messages = []
  for (const event of session.events) {
    if (event.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'user') continue
    messages.push({ turn: event.turn, seq: event.seq ?? 0, text: messageText(event.data) })
  }
  return messages
}

/**
 * Count the clarification rounds `r(s)`.
 *
 * `metrics.md` §8: "一轮'追问轮'指一个 `turn/end` 已结束、且该轮助手消息包含至少一个
 * 澄清问题（`Q` 的任一计数来源）、且该轮没有产出成果的轮次". A round over the plan's
 * budget of {@link MAX_CLARIFICATION_ROUNDS_BEFORE_DRAFT} is counted separately.
 */
function computeClarificationRounds(session, questions, artifacts) {
  const detail = []
  let rounds = 0
  for (const turn of session.turns) {
    if (turn.turn === 0) continue
    const turnQuestions = questions.filter(question => question.turn === turn.turn)
    const turnArtifacts = artifacts.filter(artifact => artifact.turn === turn.turn)
    const counted = turn.ended && turnQuestions.length > 0 && turnArtifacts.length === 0
    if (counted) rounds += 1
    detail.push({
      turn: turn.turn,
      ended: turn.ended,
      questions: turnQuestions.length,
      artifacts: turnArtifacts.length,
      counted,
    })
  }
  return { rounds, budgetViolated: rounds > MAX_CLARIFICATION_ROUNDS_BEFORE_DRAFT, detail }
}

/**
 * Decide `direct(s)`.
 *
 * `metrics.md` §7 requires the session's first `assistant/message` to contain real
 * production (tool calls that start generating an artifact) or a structured
 * Requirement Brief, with `Q(s) = 0`. The brief half is unavailable (see
 * `lib/cases.mjs`), so the artifact half decides; `briefDetected` is reported as
 * `null` on every session rather than guessed.
 */
function computeDirectExecution(session, questions, artifacts) {
  const firstAssistant = session.events.find(event => event.type === 'assistant/message')
  const calls = new Map()
  for (const event of session.events) {
    if (event.type === 'tool/call' && typeof event.data?.callId === 'string') calls.set(event.data.callId, event.data.name)
  }
  const resultCallIds = []
  for (const event of session.events) {
    if (event.type !== 'tool/result') continue
    if (isErrorResult(event)) continue
    const callId = event.data?.message?.source?.callId
    if (typeof callId === 'string') resultCallIds.push(callId)
  }
  const firstMessageProduces = resultCallIds.some(callId => artifacts.some(artifact => artifact.callId === callId))
  const turnOneArtifact = artifacts.some(artifact => artifact.turn === 1)
  const questionCount = questions.length
  return {
    value: questionCount === 0 && (firstMessageProduces || turnOneArtifact) ? 1 : 0,
    questionCount,
    firstAssistantMessageSeq: firstAssistant?.seq ?? null,
    artifactToolCalls: [...calls.values()].filter(name => artifacts.some(artifact => artifact.tool === name)),
    turnOneArtifact,
    briefDetected: null,
    briefDetectionReason:
      'no Requirement Brief event type exists in KNOWN_SESSION_EVENT_TYPES; direct execution is decided on '
      + 'Q = 0 plus artifact-producing tool calls',
  }
}

/**
 * Aggregate per-session metrics into the eight batch metrics.
 *
 * @param sessions - the output of {@link computeSessionMetrics} for every scored session.
 * @returns `{ askRate, repeatedQuestionRate, usefulQuestionRate, timeToFirstUsefulArtifact,
 *   memoryPrecision, wrongMemoryUsageRate, directExecutionRate, medianClarificationRounds,
 *   denominators, targets, passes, caveats }`.
 */
export function aggregateMetrics(sessions) {
  const sessionCount = sessions.length
  const totals = {
    questions: 0,
    repeated: 0,
    exemptReconfirmations: 0,
    unclassified: 0,
    changed: 0,
    changedUndecidable: 0,
    memoryRecords: 0,
    memoryRelevant: 0,
    memoryBad: 0,
    memoryUndetermined: 0,
    directExecution: 0,
    clarificationRounds: [],
    firstArtifactTurns: [],
    noArtifactSessions: [],
    clarificationBudgetViolations: [],
  }

  const perSession = []
  for (const session of sessions) {
    totals.questions += session.questionCount
    totals.repeated += session.questions.filter(question => question.repeated).length
    totals.exemptReconfirmations += session.questions.filter(question => question.ttlExemption?.exempt === true).length
    totals.unclassified += session.questions.filter(question => question.slot === null).length
    totals.changed += session.changed.filter(item => item.changed === 1).length
    totals.changedUndecidable += session.changed.filter(item => item.undecidable).length
    totals.memoryRecords += session.memory.recordCount
    totals.memoryRelevant += session.memory.scores.filter(score => score.rel).length
    totals.memoryBad += session.memory.scores.filter(score => score.bad).length
    totals.memoryUndetermined += session.memory.scores.filter(score => score.undetermined).length
    totals.directExecution += session.directExecution.value
    totals.clarificationRounds.push(session.clarificationRounds)
    if (session.firstArtifactTurn === null) totals.noArtifactSessions.push(session.sessionId)
    else totals.firstArtifactTurns.push(session.firstArtifactTurn)
    if (session.clarificationBudgetViolated) totals.clarificationBudgetViolations.push(session.sessionId)

    perSession.push({
      sessionId: session.sessionId,
      questions: session.questionCount,
      repeatedQuestions: session.questions.filter(question => question.repeated).length,
      clarificationRounds: session.clarificationRounds,
      firstArtifactTurn: session.firstArtifactTurn,
      directExecution: session.directExecution.value,
      memoryRecords: session.memory.recordCount,
      memoryBad: session.memory.scores.filter(score => score.bad).length,
    })
  }

  const usefulDenominator = totals.questions - totals.changedUndecidable
  const caveats = []
  if (totals.changedUndecidable > 0) {
    caveats.push(
      `${totals.changedUndecidable} question(s) were undecidable for Useful Question Rate and are excluded from both `
      + 'its numerator and its denominator, as metrics.md §3 requires.',
    )
  }
  if (totals.memoryUndetermined > 0) {
    caveats.push(
      `${totals.memoryUndetermined} memory record(s) could not be evaluated for rule 1 of Wrong Memory Usage Rate; they `
      + 'count as not-bad, so the reported rate is a lower bound.',
    )
  }
  if (totals.memoryRecords === 0) {
    caveats.push('no memory records were available for these sessions; both memory rates have a zero denominator.')
  }
  if (totals.noArtifactSessions.length > 0) {
    caveats.push(
      `${totals.noArtifactSessions.length} session(s) produced no useful artifact (f(s) = ∞) and are excluded from the `
      + 'Time to First Useful Artifact median, as metrics.md §4 requires.',
    )
  }
  if (totals.unclassified > 0) {
    caveats.push(
      `${totals.unclassified} question(s) matched no slot and are reported as unclassified; metrics.md keeps them in Q.`,
    )
  }
  if (totals.questions === 0) {
    caveats.push('no clarification questions were asked in these sessions; question-based rates have a zero denominator.')
  }

  const metrics = {
    askRate: ratio(totals.questions, sessionCount),
    repeatedQuestionRate: ratio(totals.repeated, totals.questions),
    usefulQuestionRate: ratio(totals.changed, usefulDenominator),
    timeToFirstUsefulArtifact: median(totals.firstArtifactTurns),
    memoryPrecision: ratio(totals.memoryRelevant, totals.memoryRecords),
    wrongMemoryUsageRate: ratio(totals.memoryBad, totals.memoryRecords),
    directExecutionRate: ratio(totals.directExecution, sessionCount),
    medianClarificationRounds: median(totals.clarificationRounds),
  }

  const passes = {
    repeatedQuestionRate: metrics.repeatedQuestionRate === null
      ? null
      : metrics.repeatedQuestionRate < METRIC_TARGETS.repeatedQuestionRate.value,
    medianClarificationRounds: metrics.medianClarificationRounds === null
      ? null
      : metrics.medianClarificationRounds <= METRIC_TARGETS.medianClarificationRounds.value,
    timeToFirstUsefulArtifact: metrics.timeToFirstUsefulArtifact === null
      ? null
      : metrics.timeToFirstUsefulArtifact <= METRIC_TARGETS.timeToFirstUsefulArtifact.value,
  }

  return {
    sessionCount,
    metrics,
    passes,
    targets: METRIC_TARGETS,
    denominators: {
      sessions: sessionCount,
      questions: totals.questions,
      usefulQuestionDenominator: usefulDenominator,
      memoryRecords: totals.memoryRecords,
      firstArtifactSessions: totals.firstArtifactTurns.length,
    },
    counts: {
      repeatedQuestions: totals.repeated,
      exemptReconfirmations: totals.exemptReconfirmations,
      unclassifiedQuestions: totals.unclassified,
      changedQuestions: totals.changed,
      changedUndecidable: totals.changedUndecidable,
      memoryRelevant: totals.memoryRelevant,
      memoryBad: totals.memoryBad,
      memoryUndetermined: totals.memoryUndetermined,
      directExecutionSessions: totals.directExecution,
      clarificationBudgetViolations: totals.clarificationBudgetViolations,
      noArtifactSessions: totals.noArtifactSessions,
    },
    perSession,
    caveats,
  }
}

/** Ratio that reports `null` instead of hiding a zero denominator. */
function ratio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator === 0) return null
  return numerator / denominator
}

/** Median of a numeric list; `null` for an empty list. Does not mutate its input. */
export function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}
