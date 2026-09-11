/**
 * Question counting: the `Q` rule, the two channels, answers, and the ledger that
 * decides repetition.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractQuestions, questionSentences } from '../lib/questions.mjs'
import { valueTokens } from '../lib/artifacts.mjs'
import { loadCases, associateCase } from '../lib/cases.mjs'
import { CASES_PATH, fixtureMetrics, loadFixture, FIXTURE_ORDER } from './support.mjs'

test('questionSentences counts only interrogative sentences and drops the lead-in', () => {
  assert.deepEqual(
    questionSentences('我先按高一、45 分钟来设计。这节课要留当堂练习吗？'),
    ['这节课要留当堂练习吗'],
  )
  assert.deepEqual(questionSentences('一节复习课，分两轮讲。'), [])
  assert.deepEqual(questionSentences('要 A 吗？要 B 吗？'), ['要 A 吗', '要 B 吗'])
})

test('an ask_user_question call contributes one question per array element', () => {
  const { cases, byId } = loadCases(CASES_PATH)
  assert.equal(cases.length, 26)
  const session = loadFixture('rich')
  const { case: caseEntry } = associateCase(session, byId, null)
  const questions = extractQuestions(session, {
    mustAskEntries: caseEntry.mustAskAbout,
    mustNotEntries: caseEntry.mustNotAskAbout,
  })
  assert.equal(questions.length, 5)
  assert.deepEqual(questions.map(question => question.turn), [1, 1, 2, 3, 4])
  assert.deepEqual(questions.map(question => question.kind), ['tool', 'tool', 'tool', 'natural', 'natural'])
  assert.equal(questions[0].options.length, 2)
  assert.equal(questions[2].options.length, 2)
  assert.equal(questions[3].options.length, 0)
})

test('natural-language questions are suppressed in a turn that calls the tool', () => {
  const session = loadFixture('rich')
  const questions = extractQuestions(session)
  // Turn 3 has no tool call, so its "要不要附答题卡？" counts; turn 4's does too.
  assert.deepEqual(questions.filter(question => question.kind === 'natural').map(question => question.turn), [3, 4])
})

test('answers come from the paired tool result', () => {
  const session = loadFixture('rich')
  const questions = extractQuestions(session)
  assert.equal(questions[0].answer.text, '还是高一（Recommended）')
  assert.equal(questions[1].answer.text, '第一章')
  assert.equal(questions[2].answer.text, '高中地理')
  assert.equal(questions[3].answer.text, '不要答题卡')
  assert.equal(questions[4].answer, null)
})

test('the ledger marks a memory-covered question as repeated and exempts a TTL re-confirmation', () => {
  const metrics = fixtureMetrics('rich')
  const byKind = metrics.questions
  assert.equal(byKind[0].slot, 'grade')
  assert.equal(byKind[0].repeated, false)
  assert.equal(byKind[0].ttlExemption.exempt, true)
  assert.deepEqual(
    { a: byKind[0].ttlExemption.a, b: byKind[0].ttlExemption.b, c: byKind[0].ttlExemption.c },
    { a: true, b: true, c: true },
  )
  assert.equal(byKind[2].slot, 'subject')
  assert.equal(byKind[2].repeated, true)
  assert.equal(byKind[2].ttlExemption.exempt, false)
  assert.match(byKind[2].ttlExemption.reasons.join('\n'), /\(a\)/)
})

test('per-session question counts match the authored fixtures', () => {
  const expected = {
    direct: { questions: 0, repeated: 0, exempt: 0, unclassified: 0 },
    'exceeds-first-turn': { questions: 4, repeated: 1, exempt: 0, unclassified: 0 },
    'forbidden-question': { questions: 1, repeated: 1, exempt: 0, unclassified: 0 },
    rich: { questions: 5, repeated: 1, exempt: 1, unclassified: 1 },
  }
  for (const name of FIXTURE_ORDER) {
    const metrics = fixtureMetrics(name)
    assert.equal(metrics.questionCount, expected[name].questions, `${name}: Q`)
    assert.equal(metrics.questions.filter(question => question.repeated).length, expected[name].repeated, `${name}: Qmem`)
    assert.equal(
      metrics.questions.filter(question => question.ttlExemption?.exempt === true).length,
      expected[name].exempt,
      `${name}: TTL exemptions`,
    )
    assert.equal(
      metrics.questions.filter(question => question.slot === null).length,
      expected[name].unclassified,
      `${name}: unclassified`,
    )
  }
})

test('valueTokens yields CJK bigrams and whole ASCII tokens', () => {
  assert.deepEqual(valueTokens('高一'), ['高一'])
  assert.deepEqual(valueTokens('第一章ab'), ['第一', '一章', 'ab'])
  assert.deepEqual(valueTokens('是'), [])
})
