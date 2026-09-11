/**
 * The confidence ladder and the promotion gate (README §5, plan §四 P0-3).
 *
 * @module @teacher-dsh/global-memory/tests/confidence
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LONG_TERM_CONFIDENCE_FLOOR,
  MEMORY_CONFIDENCE_LADDER,
  MEMORY_TOOLS,
  confidenceValue,
  isLongTermEligible,
  type MemoryConfidence,
} from '../schema.ts'
import { memoryParameters } from '../src/wire.ts'
import { makeStore } from './fakes.ts'

/** The promotion gate as a rung table, so a test failure names the rung. */
const ELIGIBLE: readonly MemoryConfidence[] = [
  'explicit_user',
  'explicit_correction',
  'repeated_behavior',
  'strong_inference',
]

test('the ladder carries the plan\'s rungs at their exact values', () => {
  assert.equal(confidenceValue('explicit_user'), 1)
  assert.equal(confidenceValue('explicit_correction'), 1)
  assert.equal(confidenceValue('repeated_behavior'), 0.85)
  assert.equal(confidenceValue('strong_inference'), 0.65)
  assert.equal(MEMORY_CONFIDENCE_LADDER.weak_inference.value, 0)
  assert.equal(LONG_TERM_CONFIDENCE_FLOOR, 0.65)
})

test('only weak_inference is ineligible for long-term memory', () => {
  for (const rung of ELIGIBLE) {
    assert.equal(isLongTermEligible(rung), true, `${rung} must be long-term eligible`)
  }
  assert.equal(isLongTermEligible('weak_inference'), false)
})

test('memory_set does not offer weak_inference as a confidence value', () => {
  const confidence = memoryParameters('memory_set')['confidence']
  assert.ok(confidence !== undefined, 'memory_set must declare a confidence parameter')
  assert.ok('enum' in confidence, 'memory_set confidence must be an enum')
  assert.deepEqual(
    confidence.enum,
    ['explicit_user', 'explicit_correction', 'repeated_behavior', 'strong_inference'],
  )
})

test('schema.ts declares the same four-rung enum for memory_set', () => {
  const declaration = MEMORY_TOOLS.find(tool => tool.name === 'memory_set')
  assert.ok(declaration !== undefined)
  const input = declaration.input as { readonly properties?: { readonly confidence?: { readonly enum?: readonly string[] } } }
  assert.deepEqual(input.properties?.confidence?.enum, [
    'explicit_user',
    'explicit_correction',
    'repeated_behavior',
    'strong_inference',
  ])
})

test('the store refuses a weak_inference write even though the declared type allows it', async () => {
  const { store } = makeStore()
  await assert.rejects(
    () => store.set({
      namespace: 'preferences',
      key: 'pedagogy_preference',
      value: '用户不喜欢课堂活动',
      scope: { scope_type: 'stable' },
      confidence: 'weak_inference',
      evidence: '模型从一次否定推断的偏好。',
    }),
    /never written to long-term memory/,
  )
  assert.equal(store.all().length, 0, 'a refused write must leave no row behind')
})

test('a written rung is the strongest rung the same value has carried', async () => {
  const { store } = makeStore()
  await store.set({
    namespace: 'preferences',
    key: 'output_format_preference',
    value: 'PPT 每页不超过 6 行字',
    scope: { scope_type: 'stable' },
    confidence: 'strong_inference',
    evidence: '模型从两次产物修改中推断。',
  })
  const merged = await store.set({
    namespace: 'preferences',
    key: 'output_format_preference',
    value: 'PPT 每页不超过 6 行字',
    scope: { scope_type: 'stable' },
    confidence: 'explicit_user',
    evidence: '老师明确说：PPT 每页不超过 6 行字。',
  })
  assert.equal(merged.created, false)
  assert.equal(merged.record.confidence, 'explicit_user')
  assert.equal(store.all().length, 1, 'an exact match must not create a second row')
})
