/**
 * The Question Ledger (README §9):
 * `Never ask twice unless the old answer may no longer be valid.`
 *
 * @module @teacher-dsh/global-memory/tests/question-ledger
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type { MemoryId, MemoryRecord, QuestionLedgerEntry } from '../schema.ts'
import {
  askDecision,
  ledgerValidUntil,
  nextLedgerEntry,
  questionKeyOf,
  runPreQuestionChecklist,
  withPromotedMemory,
} from '../src/question-ledger.ts'
import { makeStore, movableClock } from './fakes.ts'

const NOW = '2026-09-07T01:20:00.000Z'
const LATER = '2026-10-01T00:00:00.000Z'
const LAST_YEAR = '2025-09-07T01:20:00.000Z'

/** One live memory record for the checklist's third check. */
const memoryRecord: MemoryRecord = {
  id: 'mem_grades' as MemoryId,
  namespace: 'profile',
  key: 'grades_taught',
  value: '高一',
  scope: { scope_type: 'school_year', valid_for: '2026-2027' },
  source: { source: 'explicit_user', observed_at: NOW },
  confidence: 'explicit_user',
  updated_at: NOW,
  expires_at: '2027-09-07T01:20:00.000Z',
}

/** One prior ledger row, answered and still valid. */
const answeredEntry: QuestionLedgerEntry = {
  id: 'ql_1',
  question_key: 'profile.grades_taught',
  asked: '今年主要带哪个年级？',
  answer: '高一',
  answer_source: 'user_explicit',
  last_confirmed: NOW,
  scope: { scope_type: 'school_year', valid_for: '2026-2027' },
  valid_until: '2027-09-07T01:20:00.000Z',
  asked_count: 1,
}

test('the question key is the normalized namespace.key pair', () => {
  assert.equal(questionKeyOf('profile', 'grades_taught'), 'profile.grades_taught')
})

test('the four pre-question checks are consulted in the plan\'s order', () => {
  const all = {
    nowIso: NOW,
    currentMessage: { value: '今年带高二' },
    sessionState: { value: '高一' },
    memory: { record: memoryRecord, expired: false },
    ledger: { questionKey: 'profile.grades_taught', entry: answeredEntry, nowIso: NOW },
  }
  assert.equal(runPreQuestionChecklist(all).settled_by, 'current_message')

  const withoutMessage = { ...all, currentMessage: undefined }
  assert.equal(runPreQuestionChecklist(withoutMessage).settled_by, 'session_state')

  const withoutSession = { ...withoutMessage, sessionState: undefined }
  assert.equal(runPreQuestionChecklist(withoutSession).settled_by, 'memory')

  const withoutMemory = { ...withoutSession, memory: undefined }
  const fromLedger = runPreQuestionChecklist(withoutMemory)
  assert.equal(fromLedger.settled_by, 'question_ledger')
  assert.equal(fromLedger.decision.mayAsk, false)
  assert.equal(fromLedger.decision.reason, 'already_answered_and_still_valid')

  const nothing = { nowIso: NOW }
  const fromNothing = runPreQuestionChecklist(nothing)
  assert.equal(fromNothing.settled_by, 'none')
  assert.equal(fromNothing.decision.mayAsk, true)
  assert.equal(fromNothing.decision.reason, 'never_asked')
})

test('a question the current message answers is never asked again', () => {
  const outcome = runPreQuestionChecklist({
    nowIso: NOW,
    currentMessage: { value: '今年带高二' },
    ledger: { questionKey: 'profile.grades_taught', entry: answeredEntry, nowIso: NOW },
  })
  assert.equal(outcome.decision.mayAsk, false)
  assert.equal(outcome.answer, '今年带高二')
})

test('a safe-default answer is an answer and is not re-asked as if unknown', () => {
  const decision = askDecision({
    questionKey: 'environment.textbook_edition',
    nowIso: NOW,
    entry: {
      id: 'ql_2',
      question_key: 'environment.textbook_edition',
      asked: '今年用哪套教材？',
      answer: '人教版必修一',
      answer_source: 'safe_default',
      last_confirmed: NOW,
      scope: { scope_type: 'school_year', valid_for: '2026-2027' },
      valid_until: '2027-09-07T01:20:00.000Z',
      asked_count: 1,
    },
  })
  assert.equal(decision.mayAsk, false)
  assert.equal(decision.reason, 'answered_by_safe_default')
  assert.notEqual(decision.reason, 'never_asked')
})

test('a question never asked before may be asked', () => {
  const decision = askDecision({ questionKey: 'profile.grades_taught', nowIso: NOW })
  assert.equal(decision.mayAsk, true)
  assert.equal(decision.reason, 'never_asked')
})

test('an exhausted ask budget blocks a question that would otherwise be allowed', () => {
  const decision = askDecision({
    questionKey: 'profile.grades_taught',
    nowIso: NOW,
    askBudgetExhausted: true,
  })
  assert.equal(decision.mayAsk, false)
  assert.equal(decision.reason, 'ask_budget_exhausted')
})

test('a correction invalidates the ledger answer it contradicts, forcing one re-ask', () => {
  const decision = askDecision({
    questionKey: 'profile.grades_taught',
    nowIso: LATER,
    entry: answeredEntry,
    correctedAt: LATER,
  })
  assert.equal(decision.mayAsk, true)
  assert.equal(decision.reason, 'answer_invalidated_by_correction')
})

test('a correction recorded before the answer does not invalidate it', () => {
  const decision = askDecision({
    questionKey: 'profile.grades_taught',
    nowIso: LATER,
    entry: answeredEntry,
    correctedAt: LAST_YEAR,
  })
  assert.equal(decision.reason, 'already_answered_and_still_valid')
})

test('the correction evidence is derived from the store, not remembered by a caller', async () => {
  const clock = movableClock(NOW)
  const { store } = makeStore(clock.now)
  const correction = await store.set({
    namespace: 'corrections',
    key: 'rejected_behavior',
    value: '年级写高一，不写高中',
    details: { namespace: 'profile', key: 'grades_taught' },
    scope: { scope_type: 'stable' },
    confidence: 'explicit_correction',
    evidence: '老师纠正：年级写高一，不写高中。',
  })
  void correction
  assert.equal(store.correctionInstantFor('profile', 'grades_taught'), NOW)
  assert.equal(store.correctionInstantFor('profile', 'subject'), undefined)

  const decision = askDecision({
    questionKey: 'profile.grades_taught',
    nowIso: NOW,
    entry: answeredEntry,
    correctedAt: store.correctionInstantFor('profile', 'grades_taught'),
  })
  assert.equal(decision.reason, 'answer_invalidated_by_correction')
  assert.equal(decision.mayAsk, true)
})

test('recording an answer keeps the entry identity and counts only real asks', () => {
  const first = nextLedgerEntry(undefined, {
    questionKey: 'profile.grades_taught',
    asked: '今年主要带哪个年级？',
    answer: '高一',
    answerSource: 'user_choice',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    nowIso: NOW,
  })
  assert.equal(first.asked_count, 1)
  assert.equal(first.valid_until, '2027-09-07T01:20:00.000Z')

  const second = nextLedgerEntry(first, {
    questionKey: 'profile.grades_taught',
    asked: '今年主要带哪个年级？',
    answer: '高一',
    answerSource: 'user_explicit',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    nowIso: LATER,
  })
  assert.equal(second.id, first.id, 'one question key keeps one row')
  assert.equal(second.asked_count, 2)

  const memoryHit = nextLedgerEntry(second, {
    questionKey: 'profile.grades_taught',
    asked: '今年主要带哪个年级？',
    answer: '高一',
    answerSource: 'memory_hit',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    nowIso: LATER,
  })
  assert.equal(memoryHit.asked_count, 2, 'a retrieved answer is not an ask')
  assert.equal(memoryHit.last_confirmed, LATER)
})

test('a promoted answer is traceable through the ledger row', () => {
  const entry = nextLedgerEntry(undefined, {
    questionKey: 'profile.grades_taught',
    asked: '今年主要带哪个年级？',
    answer: '高一',
    answerSource: 'user_explicit',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    nowIso: NOW,
  })
  const promoted = withPromotedMemory(entry, 'mem_grades' as MemoryId)
  assert.equal(promoted.promoted_memory_id, 'mem_grades')
})

test('a scope that never expires leaves what was asked without a validity end', () => {
  assert.equal(ledgerValidUntil({ scope_type: 'stable' }, NOW), undefined)
  assert.equal(ledgerValidUntil({ scope_type: 'school_year' }, NOW), '2027-09-07T01:20:00.000Z')
})
