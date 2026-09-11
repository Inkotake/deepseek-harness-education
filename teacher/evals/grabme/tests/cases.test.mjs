/**
 * Per-case assertion scoring, the two failure directions, and the integrity of the
 * authored `cases.json`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadCases, associateCase, scoreCase, FAILURE_DIRECTIONS } from '../lib/cases.mjs'
import { CASES_PATH, fixtureBatch, fixtureMetrics, loadFixture } from './support.mjs'

const CATEGORIES = new Set([
  'vague_request',
  'missing_key_parameter',
  'memory_should_answer',
  'correction_followup',
  'novelty_request',
  'direct_execution',
  'ambiguous_scope',
  'out_of_scope',
])

test('cases.json still holds 26 authored cases with the documented fields', () => {
  const raw = JSON.parse(readFileSync(CASES_PATH, 'utf8'))
  assert.equal(raw.length, 26)
  const ids = new Set()
  for (const entry of raw) {
    for (const field of ['id', 'category', 'teacher_message', 'preloaded_memory', 'expected', 'why']) {
      assert.ok(Object.hasOwn(entry, field), `${entry.id} lacks ${field}`)
    }
    for (const field of [
      'must_ask_about',
      'must_not_ask_about',
      'max_questions_first_turn',
      'must_offer_choices',
      'must_produce_brief',
      'notes',
    ]) {
      assert.ok(Object.hasOwn(entry.expected, field), `${entry.id}.expected lacks ${field}`)
    }
    assert.ok(CATEGORIES.has(entry.category), `${entry.id} has unknown category ${entry.category}`)
    assert.equal(ids.has(entry.id), false, `duplicate case id ${entry.id}`)
    ids.add(entry.id)
  }
})

test('loadCases rejects a case file that is not a JSON array', () => {
  assert.throws(() => loadCases(`${CASES_PATH}__missing__`), /ENOENT|no such file/)
})

test('association prefers the session id, then the directory, then the CLI flag', () => {
  const { byId } = loadCases(CASES_PATH)
  const session = loadFixture('rich')
  assert.equal(associateCase(session, byId, null).case.id, 'missing-midterm-paper-two-questions')
  assert.equal(associateCase(session, byId, null).matchedBy, 'session-id')
  const forced = associateCase(session, byId, 'direct-execution-immediate')
  assert.equal(forced.case.id, 'direct-execution-immediate')
  assert.equal(forced.matchedBy, 'cli')
  assert.equal(associateCase(session, byId, 'no-such-case').unknownCaseId, 'no-such-case')
})

test('a must_not_ask_about question is reported as a violation in one direction', () => {
  const metrics = fixtureMetrics('forbidden-question')
  const score = metrics.caseScore
  assert.equal(score.maxQuestionsFirstTurn.exceeded, false)
  const violated = score.mustNotAskAbout.filter(item => item.violated).map(item => item.entry)
  assert.ok(violated.includes('教学目标写几项'), 'the asked question must be reported as forbidden')
  assert.equal(
    score.failures.some(failure =>
      failure.direction === FAILURE_DIRECTIONS.SHOULD_NOT_HAVE_ASKED
      && failure.assertion === 'must_not_ask_about'),
    true,
  )
  assert.equal(score.mustAskAbout.length, 0)
})

test('exceeding max_questions_first_turn is reported without inventing a must_not violation', () => {
  const metrics = fixtureMetrics('exceeds-first-turn')
  const score = metrics.caseScore
  assert.equal(score.maxQuestionsFirstTurn.limit, 2)
  assert.equal(score.maxQuestionsFirstTurn.actual, 4)
  assert.equal(score.maxQuestionsFirstTurn.exceeded, true)
  assert.equal(score.mustNotAskAbout.some(item => item.violated), false)
  const failure = score.failures.find(item => item.assertion === 'max_questions_first_turn')
  assert.ok(failure !== undefined)
  assert.equal(failure.direction, FAILURE_DIRECTIONS.SHOULD_NOT_HAVE_ASKED)
  assert.match(failure.detail, /allows 2/)
})

test('a satisfied case reports no failures at all', () => {
  const score = fixtureMetrics('rich').caseScore
  assert.deepEqual(score.failures, [])
  assert.equal(score.violated, false)
  assert.equal(score.mustAskAbout.every(item => item.satisfied), true)
  assert.equal(score.mustNotAskAbout.every(item => item.violated === false), true)
})

test('must_produce_brief fails when a session produces nothing', () => {
  const score = fixtureMetrics('forbidden-question').caseScore
  assert.equal(score.producedBrief.satisfied, false)
  assert.equal(score.producedBrief.briefDetected, null)
  assert.ok(score.failures.some(failure =>
    failure.assertion === 'must_produce_brief' && failure.direction === FAILURE_DIRECTIONS.SHOULD_HAVE_ASKED))
})

test('both failure directions are reported separately across the batch', () => {
  const { sessions } = fixtureBatch()
  const directions = new Set(sessions
    .map(session => session.caseScore)
    .filter(score => score !== null)
    .flatMap(score => score.failures.map(failure => failure.direction)))
  assert.deepEqual([...directions].sort(), [
    FAILURE_DIRECTIONS.SHOULD_HAVE_ASKED,
    FAILURE_DIRECTIONS.SHOULD_NOT_HAVE_ASKED,
  ].sort())
})

test('scoreCase is stable when the case has no assertions at all', () => {
  const metrics = fixtureMetrics('direct')
  const bare = scoreCase({
    session: loadFixture('direct'),
    questions: metrics.questions,
    artifacts: [],
    caseEntry: {
      id: 'bare',
      category: 'vague_request',
      mustAskAbout: [],
      mustNotAskAbout: [],
      maxQuestionsFirstTurn: null,
      mustOfferChoices: false,
      mustProduceBrief: false,
    },
  })
  assert.deepEqual(bare.failures, [])
  assert.equal(bare.maxQuestionsFirstTurn.exceeded, null)
})
