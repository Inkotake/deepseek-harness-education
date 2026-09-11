/**
 * The pinned worked examples from `schema.ts`: a single negative instruction must
 * not become a long-term preference (README §5.1), and a one-off must not
 * overwrite a durable value (README §6.1).
 *
 * @module @teacher-dsh/global-memory/tests/one-off
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ONE_OFF_OVERWRITE_EXAMPLE,
  TRANSIENT_NEGATION_EXAMPLE,
  type MemoryCandidate,
  type MemoryObservation,
} from '../schema.ts'
import { candidateFrom, competingCandidate, runPromotionPipeline, worthSaving } from '../src/extractor.ts'
import { makeStore } from './fakes.ts'

const NOW = '2026-09-07T01:20:00.000Z'
const SESSION = 'session-2026-09-07'

/** The observation the pinned negation example comes from. */
const negationObservation: MemoryObservation = {
  summary: '老师这一次说不要课堂活动。',
  quoted_fragment: TRANSIENT_NEGATION_EXAMPLE.utterance,
  session_ref: SESSION,
  observed_at: NOW,
  channel: 'user_message',
}

test('the forbidden extraction from one negative instruction is discarded as transient_negation', () => {
  const forbidden = candidateFrom({
    namespace: TRANSIENT_NEGATION_EXAMPLE.forbiddenExtraction.namespace,
    key: TRANSIENT_NEGATION_EXAMPLE.forbiddenExtraction.key,
    value: TRANSIENT_NEGATION_EXAMPLE.forbiddenExtraction.value,
    scope: { scope_type: 'stable' },
    confidence: TRANSIENT_NEGATION_EXAMPLE.forbiddenExtraction.confidence,
    observation: negationObservation,
    source: { source: 'strong_inference', observed_at: NOW },
  })
  const outcome = runPromotionPipeline(forbidden, { nowIso: NOW, sessionRef: SESSION })
  assert.equal(outcome.result.stage, 'discarded')
  assert.equal(
    outcome.result.stage === 'discarded' ? outcome.result.reason : '',
    TRANSIENT_NEGATION_EXAMPLE.discardReason,
  )
})

test('the negation check runs before the confidence gate, because scope is what fails', () => {
  // Same utterance, stated explicitly and at full confidence: the rung is right
  // and the write is still illegal, so the reason must not be `weak_inference`.
  const explicit = candidateFrom({
    namespace: 'preferences',
    key: 'pedagogy_preference',
    value: '用户不喜欢课堂活动',
    scope: { scope_type: 'stable' },
    confidence: 'explicit_user',
    observation: negationObservation,
    source: { source: 'explicit_user', observed_at: NOW },
  })
  assert.equal(worthSaving(explicit), 'transient_negation')
})

test('the permitted extraction lands in projects with a project scope', () => {
  const permitted = candidateFrom({
    namespace: TRANSIENT_NEGATION_EXAMPLE.permittedExtraction.namespace,
    key: TRANSIENT_NEGATION_EXAMPLE.permittedExtraction.key,
    value: TRANSIENT_NEGATION_EXAMPLE.permittedExtraction.value,
    scope: { scope_type: TRANSIENT_NEGATION_EXAMPLE.permittedExtraction.scope_type, project_id: 'atmosphere' },
    confidence: TRANSIENT_NEGATION_EXAMPLE.permittedExtraction.confidence,
    observation: negationObservation,
    source: { source: 'explicit_user', observed_at: NOW },
  })
  const outcome = runPromotionPipeline(permitted, { nowIso: NOW, sessionRef: SESSION })
  assert.equal(outcome.result.stage, 'save')
  if (outcome.result.stage !== 'save') return
  assert.equal(outcome.result.record.namespace, 'projects')
  assert.equal(outcome.result.record.key, 'project_config')
  assert.equal(outcome.result.record.scope.scope_type, 'project')
})

test('a one-off task parameter proposed for a durable namespace is discarded', () => {
  const oneOff = candidateFrom({
    namespace: 'environment',
    key: 'class_duration_minutes',
    value: '35',
    scope: { scope_type: 'session' },
    confidence: 'explicit_user',
    observation: {
      summary: '本节公开课 35 分钟。',
      quoted_fragment: '这节公开课就 35 分钟',
      session_ref: SESSION,
      observed_at: NOW,
      channel: 'user_message',
    },
    source: { source: 'explicit_user', observed_at: NOW },
  })
  assert.equal(worthSaving(oneOff), 'one_off_task_parameter')
})

test('a 35-minute public lesson does not overwrite the durable 45-minute value', async () => {
  const { store } = makeStore(() => NOW)
  await store.set({
    namespace: ONE_OFF_OVERWRITE_EXAMPLE.durableRecord.namespace,
    key: ONE_OFF_OVERWRITE_EXAMPLE.durableRecord.key,
    value: ONE_OFF_OVERWRITE_EXAMPLE.durableRecord.value,
    scope: {
      scope_type: ONE_OFF_OVERWRITE_EXAMPLE.durableRecord.scope_type,
      valid_for: ONE_OFF_OVERWRITE_EXAMPLE.durableRecord.valid_for,
    },
    confidence: ONE_OFF_OVERWRITE_EXAMPLE.durableRecord.confidence,
    evidence: '老师说明每节课 45 分钟。',
  })
  const durable = store.all()[0]
  assert.ok(durable !== undefined)

  const ephemeral = candidateFrom({
    namespace: ONE_OFF_OVERWRITE_EXAMPLE.ephemeralCandidate.namespace,
    key: ONE_OFF_OVERWRITE_EXAMPLE.ephemeralCandidate.key,
    value: ONE_OFF_OVERWRITE_EXAMPLE.ephemeralCandidate.value,
    scope: { scope_type: ONE_OFF_OVERWRITE_EXAMPLE.ephemeralCandidate.scope_type, project_id: 'atmosphere' },
    confidence: ONE_OFF_OVERWRITE_EXAMPLE.ephemeralCandidate.confidence,
    observation: {
      summary: '老师说明本节公开课 35 分钟。',
      session_ref: SESSION,
      observed_at: NOW,
      channel: 'project_config',
    },
    source: { source: 'explicit_user', observed_at: NOW },
  })
  const outcome = runPromotionPipeline(ephemeral, {
    nowIso: NOW,
    sessionRef: SESSION,
    ephemeral: true,
    competing: [competingCandidate(durable)],
    existing: store.all(),
  })

  assert.equal(outcome.result.stage, 'save')
  assert.equal(outcome.resolution?.winner, ONE_OFF_OVERWRITE_EXAMPLE.expectedResolution.winner)
  assert.equal(outcome.resolution?.value, ONE_OFF_OVERWRITE_EXAMPLE.expectedResolution.value)
  assert.equal(
    outcome.resolution?.durableRecordPreserved,
    ONE_OFF_OVERWRITE_EXAMPLE.expectedResolution.durableRecordPreserved,
  )
  // The rule the flag enforces: with the durable row preserved, the caller must not
  // write it, so the stored 45 is still the only class_duration_minutes row.
  const durableRows = store.all().filter(row => row.key === 'class_duration_minutes')
  assert.equal(durableRows.length, 1)
  assert.equal(durableRows[0]?.value, '45')
})

test('an inferred 35 loses to the durable school-year 45 and is not written', async () => {
  const { store } = makeStore(() => NOW)
  await store.set({
    namespace: 'environment',
    key: 'class_duration_minutes',
    value: '45',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    evidence: '老师说明每节课 45 分钟。',
  })
  const durable = store.all()[0]
  assert.ok(durable !== undefined)
  const inferred = candidateFrom({
    namespace: 'environment',
    key: 'class_duration_minutes',
    value: '35',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'strong_inference',
    observation: {
      summary: '从本节公开课的安排推断课时为 35 分钟。',
      session_ref: SESSION,
      observed_at: NOW,
      channel: 'session_log',
    },
    source: { source: 'strong_inference', observed_at: NOW },
  })
  const outcome = runPromotionPipeline(inferred, {
    nowIso: NOW,
    sessionRef: SESSION,
    competing: [competingCandidate(durable)],
    existing: store.all(),
  })
  assert.equal(outcome.result.stage, 'discarded')
  assert.equal(outcome.result.stage === 'discarded' ? outcome.result.reason : '', 'weak_inference')
  assert.equal(outcome.resolution?.winner, 'current_school_year_config')
})

test('deduplication merges an exact restatement instead of writing a second row', async () => {
  const { store } = makeStore(() => NOW)
  const candidate: MemoryCandidate = candidateFrom({
    namespace: 'environment',
    key: 'textbook_edition',
    value: '人教版必修一',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    observation: {
      summary: '老师说明使用人教版必修一。',
      quoted_fragment: '我们用的是人教版必修一',
      session_ref: SESSION,
      observed_at: NOW,
      channel: 'user_message',
    },
    source: { source: 'explicit_user', observed_at: NOW },
  })
  const first = runPromotionPipeline(candidate, { nowIso: NOW, sessionRef: SESSION })
  assert.equal(first.result.stage, 'save')
  if (first.result.stage !== 'save') return
  await store.savePromoted(first.result.record)

  const again = runPromotionPipeline(candidate, {
    nowIso: '2026-09-08T01:20:00.000Z',
    sessionRef: SESSION,
    existing: store.all(),
  })
  assert.equal(again.result.stage, 'save')
  assert.equal(again.result.stage === 'save' ? again.result.merged : false, true)
  assert.equal(store.all().length, 1)
})
