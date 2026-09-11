/**
 * The conflict-priority ladder (README §6, plan §四 P0-3):
 * 当前用户明确表达 > 当前项目配置 > 本学年配置 > 长期用户画像 > 行为推断 > 模型默认.
 *
 * @module @teacher-dsh/global-memory/tests/conflict-priority
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MEMORY_CONFLICT_PRIORITY,
  type MemoryConflictCandidate,
  type MemoryId,
  type MemoryPriorityRank,
} from '../schema.ts'
import { priorityIndex, rankOf, resolveConflict } from '../src/conflict.ts'

test('the ladder is the plan\'s order, highest first', () => {
  assert.deepEqual([...MEMORY_CONFLICT_PRIORITY], [
    'current_explicit_user',
    'current_project_config',
    'current_school_year_config',
    'long_term_user_profile',
    'behavior_inference',
    'model_default',
  ])
})

test('every rank occupies its declared position', () => {
  MEMORY_CONFLICT_PRIORITY.forEach((rank, index) => {
    assert.equal(priorityIndex(rank), index)
  })
})

test('a stated value ranks by scope and a corrected or inferred value by its source', () => {
  assert.equal(rankOf({
    namespace: 'corrections',
    confidence: 'explicit_correction',
    source: 'explicit_correction',
    scope: { scope_type: 'stable' },
  }), 'current_explicit_user')
  assert.equal(rankOf({
    namespace: 'projects',
    confidence: 'explicit_user',
    source: 'explicit_user',
    scope: { scope_type: 'project' },
  }), 'current_project_config')
  assert.equal(rankOf({
    namespace: 'environment',
    confidence: 'explicit_user',
    source: 'explicit_user',
    scope: { scope_type: 'school_year' },
  }), 'current_school_year_config')
  assert.equal(rankOf({
    namespace: 'preferences',
    confidence: 'explicit_user',
    source: 'explicit_user',
    scope: { scope_type: 'stable' },
  }), 'long_term_user_profile')
  assert.equal(rankOf({
    namespace: 'preferences',
    confidence: 'repeated_behavior',
    source: 'repeated_behavior',
    scope: { scope_type: 'stable' },
  }), 'behavior_inference')
  assert.equal(rankOf({
    namespace: 'profile',
    confidence: 'strong_inference',
    source: 'strong_inference',
    scope: { scope_type: 'school_year' },
  }), 'behavior_inference', 'an inferred value never claims a stated-config rank')
})

test('the winner is the highest rank regardless of input order', () => {
  const candidates: readonly MemoryConflictCandidate[] = [
    { rank: 'model_default', value: '模型默认' },
    { rank: 'long_term_user_profile', value: '长期画像' },
    { rank: 'behavior_inference', value: '行为推断' },
    { rank: 'current_project_config', value: '当前项目配置' },
    { rank: 'current_school_year_config', value: '本学年配置' },
    { rank: 'current_explicit_user', value: '老师刚刚说的' },
  ]
  const resolution = resolveConflict(candidates)
  assert.equal(resolution.winner, 'current_explicit_user')
  assert.equal(resolution.value, '老师刚刚说的')
  assert.deepEqual(
    resolution.ranked.map(candidate => candidate.rank),
    [...MEMORY_CONFLICT_PRIORITY],
  )
  assert.equal(resolution.durableRecordPreserved, false, 'no ephemeral winner outranked a durable record')
})

test('an ephemeral project config outranks the durable school-year value and preserves it', () => {
  const resolution = resolveConflict([
    { rank: 'current_project_config', value: '本节公开课 35 分钟', ephemeral: true },
    { rank: 'current_school_year_config', value: '45', record_id: 'mem_durable' as MemoryId },
  ])
  assert.equal(resolution.winner, 'current_project_config')
  assert.equal(resolution.value, '本节公开课 35 分钟')
  assert.equal(resolution.durableRecordPreserved, true)
})

test('a durable winner is not reported as an ephemeral outranking', () => {
  const resolution = resolveConflict([
    { rank: 'behavior_inference', value: '35', ephemeral: true },
    { rank: 'current_school_year_config', value: '45', record_id: 'mem_durable' as MemoryId },
  ])
  assert.equal(resolution.winner, 'current_school_year_config')
  assert.equal(resolution.value, '45')
  assert.equal(
    resolution.durableRecordPreserved,
    false,
    'the flag means an ephemeral winner outranked a durable row, not that a durable row survived',
  )
})

test('a resolution without candidates fails loud', () => {
  assert.throws(() => resolveConflict([]), /at least one candidate/)
})

test('the winner type is one of the declared ranks', () => {
  const resolution = resolveConflict([{ rank: 'model_default', value: 'x' }])
  const rank: MemoryPriorityRank = resolution.winner
  assert.equal(rank, 'model_default')
})
