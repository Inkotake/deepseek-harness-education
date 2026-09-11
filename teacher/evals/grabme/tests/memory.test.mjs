/**
 * Memory assembly, the TTL exemption's three conditions, and the two memory
 * metric rules.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveTaskType,
  evaluateTtlExemption,
  recordsFromPreloadedMemory,
  RETRIEVAL_RULES,
} from '../lib/memory.mjs'
import { readFileSync } from 'node:fs'
import { CASES_PATH, REPO_ROOT, fixtureMetrics } from './support.mjs'

test('deriveTaskType keys off the teacher message vocabulary', () => {
  assert.equal(deriveTaskType('我要做一份期中试卷'), 'assessment_design')
  assert.equal(deriveTaskType('帮我做个课件'), 'ppt_design')
  assert.equal(deriveTaskType('帮我设计一节大气受热过程'), 'lesson_design')
  assert.equal(deriveTaskType('直接做，别问了'), 'general')
})

test('the authored retrieval rules still exist in the global-memory schema', () => {
  const source = readFileSync(`${REPO_ROOT}/teacher/packages/global-memory/schema.ts`, 'utf8')
  for (const rule of RETRIEVAL_RULES) {
    assert.ok(source.includes(`task_type: '${rule.task_type}'`), `${rule.task_type} must still be declared`)
    for (const namespace of rule.namespaces) {
      assert.ok(source.includes(`'${namespace}'`), `${namespace} must still appear in the schema`)
    }
  }
})

test('a scalar preloaded field becomes exactly one record', () => {
  const records = recordsFromPreloadedMemory({ environment: { grade: '高一', textbook: '人教版' } })
  assert.deepEqual(records.map(record => `${record.namespace}.${record.key}`), [
    'environment.grade',
    'environment.textbook',
  ])
})

test('a list-valued namespace field expands one record per element, not per field', () => {
  const records = recordsFromPreloadedMemory({
    corrections: [{
      text: '教学目标优先控制在 2-3 项',
      scope: 'corrections.lesson_design',
      source: 'explicit_correction',
      confidence: 1.0,
      updated_at: '2025-09-18',
    }],
  })
  assert.equal(records.length, 1)
  assert.equal(records[0].key, 'corrections.lesson_design')
  assert.equal(records[0].value, '教学目标优先控制在 2-3 项')
  assert.equal(records[0].source.source, 'explicit_correction')
})

test('every case preloaded_memory block expands without inventing records', () => {
  const cases = JSON.parse(readFileSync(CASES_PATH, 'utf8'))
  for (const entry of cases) {
    for (const [namespace, fields] of Object.entries(entry.preloaded_memory)) {
      if (Array.isArray(fields)) {
        assert.equal(
          recordsFromPreloadedMemory({ [namespace]: fields }).length,
          fields.length,
          `${entry.id}: ${namespace} list`,
        )
      }
    }
  }
})

test('the TTL exemption requires all three conditions', () => {
  const question = { text: '今年还是高一吗？' }
  const session = {
    createdAt: 1767225600000,
    events: [{
      type: 'user/message',
      data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '注入 mem-grade = 高一' }] },
    }],
  }
  const record = { id: 'mem-grade', value: '高一', expires_at: '2025-08-01T00:00:00.000Z' }
  assert.deepEqual(
    (({ a, b, c, exempt }) => ({ a, b, c, exempt }))(evaluateTtlExemption({ question, record, session })),
    { a: true, b: true, c: true, exempt: true },
  )

  const noExpiry = evaluateTtlExemption({ question, record: { ...record, expires_at: null }, session })
  assert.equal(noExpiry.a, false)
  assert.equal(noExpiry.exempt, false)
  assert.match(noExpiry.reasons.join('\n'), /no memory record for this slot carries expires_at/)

  const notConfirming = evaluateTtlExemption({ question: { text: '这学期带哪个年级？' }, record, session })
  assert.equal(notConfirming.b, false)
  assert.equal(notConfirming.exempt, false)

  const noInjection = evaluateTtlExemption({ question, record, session: { createdAt: session.createdAt, events: [] } })
  assert.equal(noInjection.c, false)
  assert.equal(noInjection.exempt, false)
})

test('the TTL exemption does not fire on a record that has not expired', () => {
  const verdict = evaluateTtlExemption({
    question: { text: '今年还是高一吗？' },
    record: { id: 'r', value: '高一', expires_at: '2027-08-01T00:00:00.000Z' },
    session: { createdAt: 1767225600000, events: [] },
  })
  assert.equal(verdict.a, false)
  assert.match(verdict.reasons.join('\n'), /not earlier than this session/)
})

test('the rich fixture flags rule 1, rule 2, and rule 3 on distinct records', () => {
  const scores = fixtureMetrics('rich').memory.scores
  const byId = Object.fromEntries(scores.map(score => [score.id, score]))
  assert.equal(byId['mem-duration'].rules.conflict, true)
  assert.equal(byId['mem-textbook'].rules.expired, true)
  assert.equal(byId['mem-focus'].rules.inference, true)
  assert.equal(byId['mem-grade'].bad, false)
  assert.equal(byId['mem-project'].rel, false)
  assert.match(byId['mem-project'].reasons.join('\n'), /not retrieved for task type "assessment_design"/)
})

test('no record is scored as bad without a matching rule', () => {
  for (const name of ['direct', 'exceeds-first-turn', 'forbidden-question', 'rich']) {
    for (const score of fixtureMetrics(name).memory.scores) {
      assert.equal(score.bad, score.rules.conflict || score.rules.expired || score.rules.inference, `${name}/${score.id}`)
    }
  }
})
