/**
 * Retrieval policy (README §8): what is injected unconditionally, what is
 * retrieved per task type, and what is deliberately withheld.
 *
 * @module @teacher-dsh/global-memory/tests/retrieval
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { STANDING_PROFILE_MAX_CHARS } from '../schema.ts'
import {
  GENERAL_TASK_TYPE,
  deriveTaskType,
  provenanceLabel,
  renderMemoryContext,
  renderStandingProfile,
  retrievalRuleFor,
  selectForTask,
} from '../src/retrieval.ts'
import { makeStore, type FakeStore } from './fakes.ts'

const NOW = '2026-09-07T01:20:00.000Z'

/** A populated store: preferences, corrections, and two environment rows. */
async function populated(): Promise<FakeStore> {
  const fake = makeStore(() => NOW)
  const { store } = fake
  await store.set({
    namespace: 'preferences',
    key: 'output_format_preference',
    value: 'PPT 每页不超过 6 行字',
    scope: { scope_type: 'stable' },
    confidence: 'explicit_user',
    evidence: '老师明确说过。',
  })
  await store.set({
    namespace: 'corrections',
    key: 'rejected_behavior',
    value: '不要用 PPT 讲整节课',
    scope: { scope_type: 'stable' },
    confidence: 'explicit_correction',
    evidence: '老师纠正过。',
  })
  await store.set({
    namespace: 'environment',
    key: 'class_profile',
    value: '8 班偏理科、讨论活跃',
    scope: { scope_type: 'class', class_id: '2026-2027/高一(8)班' },
    confidence: 'explicit_user',
    evidence: '老师介绍班级情况。',
  })
  await store.set({
    namespace: 'environment',
    key: 'available_equipment',
    value: '教室有投影、没有学生平板',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    evidence: '老师说明教室设备。',
  })
  return fake
}

test('task routing matches the declared task types', () => {
  assert.equal(deriveTaskType('设计一节大气受热过程的 PPT'), 'ppt_design')
  assert.equal(deriveTaskType('我要做一份期中试卷'), 'assessment_design')
  assert.equal(deriveTaskType('帮我写一份大气受热过程的教案'), 'lesson_design')
  assert.equal(deriveTaskType('你好'), GENERAL_TASK_TYPE)
  assert.equal(retrievalRuleFor('ppt_design').maxRecords, 8)
  assert.equal(retrievalRuleFor('unknown-task').task_type, GENERAL_TASK_TYPE)
})

test('a ppt_design retrieval never returns class logistics, and names the exclusion', async () => {
  const { store } = await populated()
  const outcome = selectForTask({
    taskText: '设计一节大气受热过程的 PPT',
    rows: store.all(),
    nowIso: NOW,
  })
  assert.equal(outcome.task_type, 'ppt_design')
  const fields = outcome.records.map(record => `${record.namespace}.${record.key}`)
  assert.ok(fields.includes('preferences.output_format_preference'))
  assert.ok(fields.includes('corrections.rejected_behavior'))
  assert.equal(fields.some(field => field.startsWith('environment.')), false)
  assert.deepEqual([...outcome.excluded], [
    'environment.class_profile',
    'environment.available_equipment',
  ])
})

test('a lesson_design retrieval includes the fields the rule requires', async () => {
  const { store } = await populated()
  await store.set({
    namespace: 'environment',
    key: 'curriculum_standard',
    value: '2017 版 2020 修订',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    evidence: '老师说明课标口径。',
  })
  const outcome = selectForTask({
    taskText: '帮我写一份大气受热过程的教案',
    rows: store.all(),
    nowIso: NOW,
    limit: 3,
  })
  assert.equal(outcome.task_type, 'lesson_design')
  assert.equal(outcome.truncated, true)
  assert.equal(outcome.records[0]?.key, 'curriculum_standard', 'mustInclude rows are never cut by the cap')
})

test('a suppressed memory is hidden for its session only', async () => {
  const { store } = await populated()
  const target = store.all().find(row => row.key === 'output_format_preference')
  assert.ok(target !== undefined)
  const suppressed = await store.feedback({
    record_id: target.id,
    signal: 'dont_use_this_time',
    evidence: '老师说明本次 PPT 版式另说。',
    session_ref: 'session-a',
  })
  assert.equal(suppressed.action, 'suppressed_for_session')
  assert.equal(suppressed.record?.value, 'PPT 每页不超过 6 行字', 'the stored value is untouched')

  const forSessionA = store.search({ query: '', nowIso: NOW, session_ref: 'session-a' })
  assert.equal(forSessionA.records.some(record => record.key === 'output_format_preference'), false)
  const forSessionB = store.search({ query: '', nowIso: NOW, session_ref: 'session-b' })
  assert.equal(forSessionB.records.some(record => record.key === 'output_format_preference'), true)
})

test('an empty search lists everything the session may see', async () => {
  const { store } = await populated()
  const found = store.search({ query: '', nowIso: NOW })
  assert.equal(found.records.length, 4)
  assert.equal(found.truncated, false)
  const limited = store.search({ query: '', nowIso: NOW, limit: 2 })
  assert.equal(limited.records.length, 2)
  assert.equal(limited.truncated, true)
})

test('search tokens filter on the field name and the value', async () => {
  const { store } = await populated()
  const byKey = store.search({ query: 'available_equipment', nowIso: NOW })
  assert.equal(byKey.records.length, 1)
  const byValue = store.search({ query: '投影', nowIso: NOW })
  assert.equal(byValue.records.length, 1)
  assert.equal(byValue.records[0]?.key, 'available_equipment')
})

test('the standing profile is the three declared fields and nothing else', async () => {
  const { store } = await populated()
  await store.set({
    namespace: 'profile',
    key: 'display_name',
    value: '张老师',
    scope: { scope_type: 'stable' },
    confidence: 'explicit_user',
    evidence: '老师自我介绍。',
  })
  await store.set({
    namespace: 'profile',
    key: 'subject',
    value: '高中地理',
    scope: { scope_type: 'stable' },
    confidence: 'explicit_user',
    evidence: '老师说明任教学科。',
  })
  await store.set({
    namespace: 'profile',
    key: 'grades_taught',
    value: '高一',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    evidence: '老师说明任教年级。',
  })
  const rendered = renderStandingProfile(store.all(), NOW)
  assert.match(rendered, /张老师/u)
  assert.match(rendered, /高中地理/u)
  assert.match(rendered, /高一/u)
  assert.equal(rendered.includes('PPT 每页不超过 6 行字'), false, 'preferences are retrieved, never unconditional')
  assert.equal(rendered.includes('投影'), false)
  assert.ok(rendered.length <= STANDING_PROFILE_MAX_CHARS)
})

test('an oversized standing profile is cut to the declared budget', async () => {
  const { store } = makeStore(() => NOW)
  await store.set({
    namespace: 'profile',
    key: 'display_name',
    value: '张'.repeat(120),
    scope: { scope_type: 'stable' },
    confidence: 'explicit_user',
    evidence: '老师自我介绍。',
  })
  await store.set({
    namespace: 'profile',
    key: 'subject',
    value: '地'.repeat(120),
    scope: { scope_type: 'stable' },
    confidence: 'explicit_user',
    evidence: '老师说明任教学科。',
  })
  const rendered = renderStandingProfile(store.all(), NOW)
  assert.equal(rendered.length, STANDING_PROFILE_MAX_CHARS)
  assert.equal(rendered.endsWith('…'), true)
})

test('the injected context carries provenance words, never a session locator', async () => {
  const { store } = await populated()
  await store.set({
    namespace: 'profile',
    key: 'grades_taught',
    value: '高一',
    scope: { scope_type: 'school_year', valid_for: '2025-2026' },
    confidence: 'explicit_user',
    evidence: '老师说明任教年级。',
    session_ref: 'session-secret',
  })
  const outcome = selectForTask({
    taskText: '我要做一份期中试卷',
    rows: store.all(),
    nowIso: '2027-10-01T00:00:00.000Z',
    include_expired: true,
    taskType: 'assessment_design',
  })
  const text = renderMemoryContext(outcome)
  assert.equal(text.includes('session-secret'), false, 'session_ref is an evidence locator, never model text')
  assert.match(text, /老师明确说过/u)
  assert.match(text, /我记得上学年你主要带高一，今年还是高一吗？/u)
  assert.equal(provenanceLabel('strong_inference'), '我推断的')
})

test('an empty retrieval injects nothing at all', async () => {
  const { store } = makeStore(() => NOW)
  const outcome = selectForTask({ taskText: '你好', rows: store.all(), nowIso: NOW })
  assert.equal(renderMemoryContext(outcome), '')
})
