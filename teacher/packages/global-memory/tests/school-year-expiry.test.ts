/**
 * TTL and expiry (README §7, plan §四 P0-3): 学科可长期；年级/教材版本/班级情况按学年
 * 失效，到期是"重新确认"，不是重新盘问.
 *
 * @module @teacher-dsh/global-memory/tests/school-year-expiry
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MEMORY_NAMESPACE_DECLARATIONS,
  MEMORY_TTL_POLICY,
  isExpired,
  reconfirmationFor,
  schoolYearOf,
  type MemoryId,
} from '../schema.ts'
import { askDecision, runPreQuestionChecklist } from '../src/question-ledger.ts'
import { makeStore, movableClock } from './fakes.ts'

const WRITTEN_AT = '2026-09-07T01:20:00.000Z'
const AFTER_EXPIRY = '2027-10-01T00:00:00.000Z'

test('the school year starts on 1 August', () => {
  assert.equal(schoolYearOf('2027-01-15T00:00:00.000Z'), '2026-2027')
  assert.equal(schoolYearOf('2026-08-01T00:00:00.000Z'), '2026-2027')
  assert.equal(schoolYearOf('2026-07-31T23:59:59.000Z'), '2025-2026')
})

test('only the stable scope never expires, and every expiring scope re-confirms', () => {
  assert.equal(MEMORY_TTL_POLICY.stable.expires, false)
  for (const scope of ['school_year', 'term', 'project', 'class'] as const) {
    assert.equal(MEMORY_TTL_POLICY[scope].expires, true)
    assert.equal(MEMORY_TTL_POLICY[scope].onExpiry, 'reconfirm')
  }
  assert.equal(MEMORY_TTL_POLICY.session.onExpiry, 'never')
})

test('a school-year record carries its valid_for label and a 365-day expiry', async () => {
  const { store } = makeStore(() => WRITTEN_AT)
  const written = await store.set({
    namespace: 'profile',
    key: 'grades_taught',
    value: '高一',
    scope: { scope_type: 'school_year' },
    confidence: 'explicit_user',
    evidence: '老师说明今年主要带高一。',
  })
  assert.equal(written.record.scope.valid_for, '2026-2027', 'valid_for is stamped from the write instant')
  assert.equal(written.record.expires_at, '2027-09-07T01:20:00.000Z')
})

test('an expired record is neither silently used nor silently dropped', async () => {
  const clock = movableClock(WRITTEN_AT)
  const { store } = makeStore(clock.now)
  await store.set({
    namespace: 'profile',
    key: 'grades_taught',
    value: '高一',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    evidence: '老师说明今年主要带高一。',
  })
  clock.set(AFTER_EXPIRY)

  const current = store.get({ namespace: 'profile', key: 'grades_taught', nowIso: AFTER_EXPIRY })
  assert.equal(current.found, false, 'an expired record is never offered as current')

  const including = store.get({
    namespace: 'profile',
    key: 'grades_taught',
    nowIso: AFTER_EXPIRY,
    include_expired: true,
  })
  assert.equal(including.found, true)
  assert.equal(including.record?.value, '高一')
  assert.equal(including.reconfirm?.previous_value, '高一')
})

test('expiry produces the field\'s re-confirmation, not a fresh question', async () => {
  const clock = movableClock(WRITTEN_AT)
  const { store } = makeStore(clock.now)
  await store.set({
    namespace: 'profile',
    key: 'grades_taught',
    value: '高一',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    evidence: '老师说明今年主要带高一。',
  })
  const record = store.all()[0]
  assert.ok(record !== undefined)
  clock.set(AFTER_EXPIRY)
  assert.equal(isExpired(record, AFTER_EXPIRY), true)

  const declared = MEMORY_NAMESPACE_DECLARATIONS.profile.fields.find(field => field.name === 'grades_taught')
  const reconfirm = reconfirmationFor(record, AFTER_EXPIRY)
  assert.equal(
    reconfirm?.prompt,
    declared?.reconfirmPrompt,
    'the prompt is the field\'s own reconfirmPrompt, not a generated template',
  )
  assert.equal(reconfirm?.prompt, '我记得上学年你主要带高一，今年还是高一吗？')
  assert.equal(reconfirm?.previous_value, '高一')
  assert.equal(reconfirm?.expired_on, '2027-09-07')
})

test('the checklist offers the expired memory back as a default instead of asking again', () => {
  const memory = {
    record: {
      id: 'mem_expired' as MemoryId,
      namespace: 'profile' as const,
      key: 'grades_taught',
      value: '高一',
      scope: { scope_type: 'school_year' as const, valid_for: '2026-2027' },
      source: { source: 'explicit_user' as const, observed_at: WRITTEN_AT },
      confidence: 'explicit_user' as const,
      updated_at: WRITTEN_AT,
      expires_at: '2027-09-07T01:20:00.000Z',
    },
    expired: true,
  }
  const outcome = runPreQuestionChecklist({ nowIso: AFTER_EXPIRY, memory })
  assert.equal(outcome.settled_by, 'memory')
  assert.equal(outcome.decision.mayAsk, false)
  assert.equal(outcome.decision.reason, 'answer_expired')
  assert.equal(outcome.decision.reconfirm?.previous_value, '高一')
})

test('an expired ledger answer re-confirms rather than re-asking the open question', () => {
  const decision = askDecision({
    questionKey: 'profile.grades_taught',
    nowIso: AFTER_EXPIRY,
    entry: {
      id: 'ql_1',
      question_key: 'profile.grades_taught',
      asked: '今年主要带哪个年级？',
      answer: '高一',
      answer_source: 'user_explicit',
      last_confirmed: WRITTEN_AT,
      scope: { scope_type: 'school_year', valid_for: '2026-2027' },
      valid_until: '2027-09-07T01:20:00.000Z',
      asked_count: 1,
    },
    reconfirm: {
      record_id: 'mem_expired' as MemoryId,
      prompt: '我记得上学年你主要带高一，今年还是高一吗？',
      previous_value: '高一',
      expired_on: '2027-09-07',
    },
  })
  assert.equal(decision.mayAsk, false, 'the original question is not asked a second time')
  assert.equal(decision.reason, 'answer_expired')
  assert.equal(decision.reconfirm?.previous_value, '高一')
})

test('a still-valid ledger answer is not re-asked at all', () => {
  const decision = askDecision({
    questionKey: 'profile.grades_taught',
    nowIso: '2027-01-15T00:00:00.000Z',
    entry: {
      id: 'ql_1',
      question_key: 'profile.grades_taught',
      asked: '今年主要带哪个年级？',
      answer: '高一',
      answer_source: 'user_explicit',
      last_confirmed: WRITTEN_AT,
      scope: { scope_type: 'school_year', valid_for: '2026-2027' },
      valid_until: '2027-09-07T01:20:00.000Z',
      asked_count: 1,
    },
  })
  assert.equal(decision.mayAsk, false)
  assert.equal(decision.reason, 'already_answered_and_still_valid')
  assert.equal(decision.reconfirm, undefined)
})
