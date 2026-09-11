/**
 * The runner may only interpret the session-event vocabulary the pinned harness
 * declares. These tests prove the vocabulary it uses is that one, not a copy that
 * has drifted, and that the events the metrics read are inside it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EMBEDDED_KNOWN_EVENT_TYPES,
  KNOWN_EVENT_TYPES_RELATIVE_PATH,
  loadKnownEventTypes,
  parseKnownEventTypes,
} from '../lib/known-events.mjs'
import { REPO_ROOT } from './support.mjs'

test('parseKnownEventTypes extracts the declared names', () => {
  const source = [
    'export const KNOWN_SESSION_EVENT_TYPES: ReadonlySet<string> = new Set([',
    "  'turn/start',",
    "  'turn/end',",
    "  'user/message',",
    '])',
  ].join('\n')
  assert.deepEqual(parseKnownEventTypes(source), ['turn/start', 'turn/end', 'user/message'])
})

test('parseKnownEventTypes returns nothing when the declaration is absent', () => {
  assert.deepEqual(parseKnownEventTypes('export const OTHER = [\'a\']'), [])
})

test('the embedded vocabulary is identical to the harness declaration', () => {
  const source = readFileSync(`${REPO_ROOT}/${KNOWN_EVENT_TYPES_RELATIVE_PATH}`, 'utf8')
  const harness = parseKnownEventTypes(source)
  assert.ok(harness.length > 0, 'the harness vocabulary declaration must be parseable')
  assert.deepEqual([...EMBEDDED_KNOWN_EVENT_TYPES].sort(), [...harness].sort())
})

test('loadKnownEventTypes reads the harness file when it is present', () => {
  const loaded = loadKnownEventTypes(REPO_ROOT)
  assert.equal(loaded.source, 'harness')
  assert.equal(loaded.note, null)
  assert.ok(loaded.types.size > 0)
})

test('loadKnownEventTypes falls back to the embedded copy for a foreign root', () => {
  const loaded = loadKnownEventTypes(`${REPO_ROOT}/__not_a_repo__`)
  assert.equal(loaded.source, 'embedded')
  assert.match(loaded.note, /unreadable/)
  assert.deepEqual([...loaded.types].sort(), [...EMBEDDED_KNOWN_EVENT_TYPES].sort())
})

test('every event type the metrics read is in the harness vocabulary', () => {
  const { types } = loadKnownEventTypes(REPO_ROOT)
  for (const type of [
    'user/message',
    'turn/start',
    'turn/end',
    'step/start',
    'step/end',
    'assistant/message',
    'tool/call',
    'tool/result',
    'deliverables/presented',
  ]) {
    assert.ok(types.has(type), `${type} must be a known session event type`)
  }
})
