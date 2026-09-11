/**
 * A correction retires a memory instead of deleting it (README §5, §13).
 *
 * The wrong value must leave retrieval for good, and the record that it was once
 * believed — and of the correction that withdrew it — must survive, because the
 * `corrections` namespace and the "a problem the teacher corrected should not
 * happen twice" rule both depend on that history.
 *
 * The first test is the one that would have failed under the previous
 * delete-instead-of-retire behaviour: it asserts the row still exists.
 *
 * @module @teacher-dsh/global-memory/tests/retired-memory
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { isRetired } from '../schema.ts'
import type { MemoryStore } from '../src/store.ts'
import { makeStore } from './fakes.ts'

const NOW = '2026-09-07T01:20:00.000Z'
const SESSION = 'session-2026-09-07'
const BELIEVED = '人教版'
const CORRECTED = '北师大版'

/** Write the durable memory a correction will later retire. */
async function writeTextbook(store: MemoryStore): Promise<void> {
  await store.set({
    namespace: 'environment',
    key: 'textbook_edition',
    value: BELIEVED,
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    evidence: '老师说明使用人教版。',
  })
}

/** Retire that memory through the `incorrect` signal. */
async function retireTextbook(store: MemoryStore): Promise<void> {
  await writeTextbook(store)
  await store.feedback({
    namespace: 'environment',
    key: 'textbook_edition',
    signal: 'incorrect',
    corrected_value: CORRECTED,
    evidence: '老师纠正：用的是北师大版。',
  })
}

test('a correction retires the row rather than deleting it', async () => {
  const { store } = makeStore(() => NOW)
  await writeTextbook(store)
  const believed = store.all().find(row => row.key === 'textbook_edition')
  assert.ok(believed !== undefined, 'precondition: the memory was written')

  const result = await store.feedback({
    namespace: 'environment',
    key: 'textbook_edition',
    signal: 'incorrect',
    corrected_value: CORRECTED,
    evidence: '老师纠正：用的是北师大版。',
  })
  assert.equal(result.action, 'invalidated')

  // This is the assertion the old behaviour fails: it deleted the row outright, so
  // nothing below could be observed at all.
  const retired = store.all().find(row => row.id === believed.id)
  assert.ok(retired !== undefined, 'the retired row must survive as an audit record')
  assert.equal(retired.value, BELIEVED, 'the audit record keeps the value that was believed')
  assert.equal(retired.retired_at, NOW)
  assert.equal(isRetired(retired), true)
})

test('a retired value is no longer served by get, not even as an expired candidate', async () => {
  const { store } = makeStore(() => NOW)
  await retireTextbook(store)

  const plain = store.get({ namespace: 'environment', key: 'textbook_edition', nowIso: NOW })
  assert.equal(plain.found, false, 'a retired value must not be returned as live')

  // `include_expired` is how a possibly-stale value comes back for re-confirmation.
  // A corrected value was wrong rather than stale, so it must not come back here
  // either — offering it would re-ask a question the teacher already answered.
  const withExpired = store.get({
    namespace: 'environment',
    key: 'textbook_edition',
    nowIso: NOW,
    include_expired: true,
  })
  assert.equal(withExpired.found, false, 'retirement is not expiry; it is never re-confirmed')
})

test('a retired value is absent from the listing behind 查看 AI 记住了什么', async () => {
  const { store } = makeStore(() => NOW)
  await retireTextbook(store)

  // An empty query is not a filter; it lists everything the session may see, which
  // is what backs the control surface (README §13.1). A retired row must not appear,
  // or the teacher would be shown a memory that was already corrected away.
  const listing = store.search({ query: '', nowIso: NOW })
  assert.equal(
    listing.records.some(record => record.key === 'textbook_edition'),
    false,
    'the ordinary listing must exclude the retired row',
  )
  const visible = store.visible({ nowIso: NOW })
  assert.equal(visible.some(row => isRetired(row)), false, 'no read path may surface a retired row')
})

test('the audit trail survives the retirement', async () => {
  const { store } = makeStore(() => NOW)
  await retireTextbook(store)

  const rejected = store.all().find(row => row.namespace === 'corrections' && row.key === 'rejected_behavior')
  assert.ok(rejected !== undefined, 'what was rejected must be recorded')
  assert.equal(rejected.value, BELIEVED, 'the rejected value is quoted verbatim, not paraphrased')

  const corrected = store.all().find(row => row.namespace === 'corrections' && row.key === 'corrected_value')
  assert.ok(corrected !== undefined, 'what replaced it must be recorded too')
  assert.equal(corrected.value, CORRECTED)
})

test('a corrected field can be written again and the new value is the one served', async () => {
  const { store } = makeStore(() => NOW)
  await retireTextbook(store)

  // Retirement must not poison the field: the teacher's correction has to be able to
  // become the live value again, or the fix would be worse than the bug.
  await store.set({
    namespace: 'environment',
    key: 'textbook_edition',
    value: CORRECTED,
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_correction',
    evidence: '老师纠正：用的是北师大版。',
  })

  const served = store.get({ namespace: 'environment', key: 'textbook_edition', nowIso: NOW })
  assert.ok(served.record !== undefined, 'the corrected value must be served again')
  assert.equal(served.record.value, CORRECTED)
  // The durable row must be live too, not merely served: a withered `retired_at` would keep the
  // field invisible to every later read even though this one happened to return it.
  const restated = store.all().find(row => row.namespace === 'environment' && row.value === CORRECTED)
  assert.ok(restated !== undefined, 'the restated row exists')
  assert.equal(isRetired(restated), false, 'the restated row is live again, not still retired')
  // The store keeps ONE row per (namespace, key, scope), so a restatement revives the retired row
  // instead of adding a second one. The withdrawn value is not lost by that: it lives in the
  // corrections audit, which is the whole reason retirement may reuse the row.
  const rows = store.all().filter(row => row.namespace === 'environment')
  assert.equal(rows.length, 1, 'one row per field, revived rather than duplicated')
  assert.equal(rows[0] === undefined ? true : isRetired(rows[0]), false, 'that row is live')
  const rejected = store.all().find(row => row.namespace === 'corrections' && row.key === 'rejected_behavior')
  assert.equal(rejected?.value, BELIEVED, 'the audit still holds the value that was withdrawn')
})
