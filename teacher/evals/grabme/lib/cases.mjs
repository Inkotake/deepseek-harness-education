/**
 * `cases.json` loading, case↔session association, and the per-case `expected`
 * assertions.
 *
 * The assertions are exactly the ones `metrics.md` §按 case 的判定 names, plus the
 * two directions the README insists be reported separately ("该问没问" and
 * "不该问却问了").
 *
 * One written assertion cannot be computed from the log at all: "结构化
 * Requirement Brief". No Requirement Brief event type exists in
 * `KNOWN_SESSION_EVENT_TYPES`, so no log evidence can distinguish a brief from
 * ordinary assistant prose without reading that prose, which this runner refuses
 * to do. `briefDetected` is therefore reported as `null` with a reason, and
 * `must_produce_brief` is decided on the artifact criterion instead, which is the
 * other half of the same sentence in `metrics.md`.
 *
 * @module grabme/lib/cases.mjs
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { resolveCaseEntry } from './slots.mjs'

/** The two directions of failure the suite must report separately. */
export const FAILURE_DIRECTIONS = Object.freeze({
  SHOULD_HAVE_ASKED: 'should-have-asked',
  SHOULD_NOT_HAVE_ASKED: 'should-not-have-asked',
})

/**
 * Load and validate `cases.json`.
 *
 * @param filePath - absolute path of `cases.json`.
 * @returns `{ cases, byId }` with each case carrying resolved slot entries.
 * @throws when the file is not a JSON array of objects with the seven required fields.
 */
export function loadCases(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error(`${basename(filePath)}: expected a JSON array of cases`)
  const cases = parsed.map((entry, index) => {
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`${basename(filePath)}: case ${index} is not an object`)
    }
    for (const field of ['id', 'category', 'teacher_message', 'preloaded_memory', 'expected', 'why']) {
      if (!Object.hasOwn(entry, field)) {
        throw new Error(`${basename(filePath)}: case ${index} (${String(entry.id)}) lacks required field "${field}"`)
      }
    }
    const expected = entry.expected
    if (expected === null || typeof expected !== 'object') {
      throw new Error(`${basename(filePath)}: case ${entry.id} has a non-object expected block`)
    }
    return {
      raw: entry,
      id: String(entry.id),
      category: String(entry.category),
      teacherMessage: String(entry.teacher_message),
      preloadedMemory: entry.preloaded_memory,
      maxQuestionsFirstTurn: Number.isFinite(expected.max_questions_first_turn)
        ? expected.max_questions_first_turn
        : null,
      mustAskAbout: resolveEntries(expected.must_ask_about),
      mustNotAskAbout: resolveEntries(expected.must_not_ask_about),
      mustOfferChoices: expected.must_offer_choices === true,
      mustProduceBrief: expected.must_produce_brief === true,
      notes: String(expected.notes ?? ''),
    }
  })
  return { cases, byId: new Map(cases.map(entry => [entry.id, entry])) }
}

/** Resolve one slot list into canonical-slot groups plus literal patterns. */
function resolveEntries(list) {
  if (!Array.isArray(list)) return []
  return list.map(entry => resolveCaseEntry(String(entry)))
}

/**
 * Associate a session artifact with a case.
 *
 * The session id in the log header is authoritative; the containing directory name
 * is the fallback, because a recorded batch normally names each session directory
 * after its case. An explicit `--case` overrides both and is reported as such.
 *
 * @param session - the session model.
 * @param byId - the case index from {@link loadCases}.
 * @param explicitCaseId - the `--case` value, if any.
 * @returns `{ case, matchedBy }` or `{ case: null, matchedBy: null }`.
 */
export function associateCase(session, byId, explicitCaseId) {
  if (explicitCaseId !== undefined && explicitCaseId !== null) {
    const found = byId.get(explicitCaseId)
    if (found === undefined) return { case: null, matchedBy: null, unknownCaseId: explicitCaseId }
    return { case: found, matchedBy: 'cli' }
  }
  if (byId.has(session.sessionId)) return { case: byId.get(session.sessionId), matchedBy: 'session-id' }
  const directory = basename(session.filePath.replace(/[\\/][^\\/]*$/, ''))
  if (byId.has(directory)) return { case: byId.get(directory), matchedBy: 'directory' }
  return { case: null, matchedBy: null }
}

/**
 * Score one session against one case's `expected` block.
 *
 * @param context - `{ session, questions, artifacts, caseEntry }`.
 * @returns the per-assertion result:
 *   `{ caseId, maxQuestionsFirstTurn, mustAskAbout, mustNotAskAbout, offeredChoices,
 *      producedBrief, violated, failures }`, where `failures` is the two-direction list.
 */
export function scoreCase(context) {
  const { session, questions, artifacts, caseEntry } = context
  const firstTurnQuestions = questions.filter(question => question.turn === 1)

  const mustAskAbout = caseEntry.mustAskAbout.map((entry, entryIndex) => {
    const askedIn = questions
      .filter(question => question.attribution.mustAskEntries.includes(entryIndex))
    const inWindow = askedIn.filter(question => question.turn <= 2)
    return {
      entry: entry.entry,
      slots: entry.slots,
      satisfied: inWindow.length > 0,
      windowTurns: [1, 2],
      questions: askedIn.map(question => ({ turn: question.turn, text: question.text })),
    }
  })

  const mustNotAskAbout = caseEntry.mustNotAskAbout.map((entry, entryIndex) => {
    const violations = questions.filter(question => question.attribution.mustNotEntries.includes(entryIndex))
    return {
      entry: entry.entry,
      slots: entry.slots,
      violated: violations.length > 0,
      questions: violations.map(question => ({ turn: question.turn, text: question.text })),
    }
  })

  const choiceQuestions = questions.filter(question => question.options.length > 0)
  const openEndedViolations = mustNotAskAbout.filter(item => item.violated)
  const offeredChoices = {
    required: caseEntry.mustOfferChoices,
    satisfied: !caseEntry.mustOfferChoices || choiceQuestions.length > 0,
    questionsWithOptions: choiceQuestions.map(question => ({ turn: question.turn, text: question.text })),
    openEndedViolations: openEndedViolations.map(item => item.entry),
  }

  const producedBrief = {
    required: caseEntry.mustProduceBrief,
    satisfied: !caseEntry.mustProduceBrief || artifacts.length > 0,
    artifacts: artifacts.map(artifact => ({ kind: artifact.kind, turn: artifact.turn, tool: artifact.tool })),
    briefDetected: null,
    briefDetectionReason:
      'no Requirement Brief event type exists in KNOWN_SESSION_EVENT_TYPES, so a brief cannot be '
      + 'distinguished from assistant prose in the log; must_produce_brief is decided on deliverables '
      + 'and artifact-producing tool results, the other half of the metrics.md rule',
  }

  const overBudget = caseEntry.maxQuestionsFirstTurn === null
    ? null
    : firstTurnQuestions.length > caseEntry.maxQuestionsFirstTurn

  const failures = []
  for (const item of mustAskAbout) {
    if (!item.satisfied) {
      failures.push({
        direction: FAILURE_DIRECTIONS.SHOULD_HAVE_ASKED,
        assertion: 'must_ask_about',
        entry: item.entry,
        detail: `no question in turns ${item.windowTurns.join('-')} was attributed to "${item.entry}"`,
      })
    }
  }
  for (const item of mustNotAskAbout) {
    if (!item.violated) continue
    failures.push({
      direction: FAILURE_DIRECTIONS.SHOULD_NOT_HAVE_ASKED,
      assertion: 'must_not_ask_about',
      entry: item.entry,
      detail: `asked about "${item.entry}" in turn(s) ${item.questions.map(question => question.turn).join(', ')}`,
      questions: item.questions,
    })
  }
  if (overBudget === true) {
    failures.push({
      direction: FAILURE_DIRECTIONS.SHOULD_NOT_HAVE_ASKED,
      assertion: 'max_questions_first_turn',
      entry: String(caseEntry.maxQuestionsFirstTurn),
      detail: `turn 1 asked ${firstTurnQuestions.length} question(s); the case allows ${caseEntry.maxQuestionsFirstTurn}`,
      questions: firstTurnQuestions.map(question => ({ turn: question.turn, text: question.text })),
    })
  }
  if (caseEntry.mustOfferChoices && choiceQuestions.length === 0) {
    failures.push({
      direction: FAILURE_DIRECTIONS.SHOULD_NOT_HAVE_ASKED,
      assertion: 'must_offer_choices',
      entry: 'true',
      detail: 'every clarification question was open-ended; the case requires at least one question with options',
    })
  }
  if (caseEntry.mustProduceBrief && artifacts.length === 0) {
    failures.push({
      direction: FAILURE_DIRECTIONS.SHOULD_HAVE_ASKED,
      assertion: 'must_produce_brief',
      entry: 'true',
      detail: 'the session produced no deliverables/presented event and no artifact-producing tool result',
    })
  }

  return {
    caseId: caseEntry.id,
    category: caseEntry.category,
    sessionId: session.sessionId,
    questionsInFirstTurn: firstTurnQuestions.map(question => ({
      kind: question.kind,
      text: question.text,
      primary: question.attribution.primary,
      options: question.options.length,
    })),
    maxQuestionsFirstTurn: {
      limit: caseEntry.maxQuestionsFirstTurn,
      actual: firstTurnQuestions.length,
      exceeded: overBudget,
    },
    mustAskAbout,
    mustNotAskAbout,
    offeredChoices,
    producedBrief,
    failures,
    violated: failures.length > 0,
  }
}

/**
 * Index questions by a case entry so both directions can be counted in one place.
 * @param questions - extracted questions.
 * @param entries - resolved `must_ask_about` entries.
 * @param direction - which attribution list to read: `mustAskEntries` or `mustNotEntries`.
 * @returns one bucket per entry with the questions attributed to it.
 */
export function bucketQuestionsByEntry(questions, entries, direction = 'mustAskEntries') {
  return entries.map((entry, index) => ({
    entry: entry.entry,
    questions: questions.filter(question => question.attribution[direction].includes(index)),
  }))
}
