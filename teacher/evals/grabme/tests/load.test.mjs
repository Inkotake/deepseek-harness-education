/**
 * Session-log loading: generation selection, unknown-event admission, legacy
 * refusal, and zstd support.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import {
  compareGenerations,
  describeSessionFilename,
  loadSessionLog,
  parseSession,
  readSessionRows,
  selectGeneration,
} from '../lib/load.mjs'
import { loadKnownEventTypes } from '../lib/known-events.mjs'
import { REPO_ROOT } from './support.mjs'

const known = loadKnownEventTypes(REPO_ROOT).types

/** A minimal well-formed row set with one header and one event. */
function minimalRows(event) {
  return [
    { type: 'session', version: 3, id: 'tiny', createdAt: 1, cwd: 'C:\\x', isSeeded: false, delegationDepth: 0 },
    event,
  ]
}

test('describeSessionFilename recognizes only canonical artifact names', () => {
  assert.deepEqual(describeSessionFilename('session.jsonl'), { ordinal: 0, version: 0, compressed: false })
  assert.deepEqual(describeSessionFilename('session.v3.jsonl'), { ordinal: 0, version: 3, compressed: false })
  assert.deepEqual(describeSessionFilename('session.2.v3.jsonl.zstd'), { ordinal: 2, version: 3, compressed: true })
  assert.equal(describeSessionFilename('memory.json'), undefined)
  assert.equal(describeSessionFilename('session.txt'), undefined)
  assert.equal(describeSessionFilename('Session.jsonl'), undefined)
})

test('selectGeneration picks the numerically highest generation', () => {
  const entries = ['session.jsonl', 'session.v2.jsonl', 'session.v3.jsonl', 'memory.json']
  assert.equal(selectGeneration(entries), 'session.v3.jsonl')
  assert.equal(selectGeneration(['session.jsonl', 'session.1.jsonl']), 'session.1.jsonl')
  assert.equal(selectGeneration(['memory.json']), undefined)
  assert.ok(compareGenerations({ version: 2, ordinal: 0 }, { version: 3, ordinal: 0 }) < 0)
})

test('parseSession groups events into turns and attaches the enclosing turn', () => {
  const rows = [
    ...minimalRows({ type: 'turn/start', data: { turn: 1 } }),
    { type: 'user/message', data: { id: 'u', role: 'user', source: { kind: 'user' }, content: [] }, surfaceOp: 'append' },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const session = parseSession(rows, { filePath: 'x', knownEventTypes: known })
  assert.equal(session.turns.length, 1)
  assert.equal(session.turns[0].turn, 1)
  assert.equal(session.turns[0].ended, true)
  assert.equal(session.events[1].turn, 1)
})

test('parseSession warns when a turn never ends', () => {
  const rows = minimalRows({ type: 'turn/start', data: { turn: 1 } })
  const session = parseSession(rows, { filePath: 'x', knownEventTypes: known })
  assert.match(session.warnings.join('\n'), /never closed/)
})

test('an unknown event type without the ignorable marker is refused', () => {
  const rows = minimalRows({ type: 'teacher/unknown-probe', data: {} })
  assert.throws(
    () => parseSession(rows, { filePath: 'x', knownEventTypes: known }),
    /not in KNOWN_SESSION_EVENT_TYPES/,
  )
})

test('an unknown event type is skipped when it carries the ignorable marker', () => {
  const rows = minimalRows({ type: 'teacher/unknown-probe', data: {}, ignorable: true })
  const session = parseSession(rows, { filePath: 'x', knownEventTypes: known })
  assert.equal(session.events.length, 0)
  assert.equal(session.skippedEvents.length, 1)
})

test('tolerating unknown events scores the log but lists the types', () => {
  const rows = minimalRows({ type: 'teacher/unknown-probe', data: {} })
  const session = parseSession(rows, { filePath: 'x', knownEventTypes: known, tolerateUnknownEvents: true })
  assert.deepEqual(session.unknownEventTypes, ['teacher/unknown-probe'])
  assert.match(session.warnings.join('\n'), /outside KNOWN_SESSION_EVENT_TYPES/)
})

test('a legacy physical row type is refused with an explicit message', () => {
  const rows = minimalRows({ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: {} } })
  assert.throws(
    () => parseSession(rows, { filePath: 'x', knownEventTypes: known }),
    /legacy physical row type/,
  )
})

test('parseSession refuses a log whose first record is not a session header', () => {
  assert.throws(
    () => parseSession([{ type: 'turn/start', data: { turn: 1 } }], { filePath: 'x', knownEventTypes: known }),
    /not a session header/,
  )
})

test('loadSessionLog reports a failure instead of throwing', () => {
  const loaded = loadSessionLog(join(tmpdir(), 'definitely-missing-session.jsonl'), known)
  assert.ok(loaded.error !== undefined)
  assert.match(loaded.error.message, /ENOENT|no such file/)
})

test('a zstd-compressed artifact is read when this Node build supports zstd', (t) => {
  if (typeof zstdCompressSync !== 'function' || typeof zstdDecompressSync !== 'function') {
    t.skip('this Node build has no zstd support')
    return
  }
  const directory = mkdtempSync(join(tmpdir(), 'grabme-zstd-'))
  try {
    const rows = [
      { type: 'session', version: 3, id: 'zipped', createdAt: 1, cwd: 'C:\\x', isSeeded: false, delegationDepth: 0 },
      { type: 'turn/start', data: { turn: 1 }, seq: 0, time: 2 },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, seq: 1, time: 3 },
    ]
    const text = `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
    const path = join(directory, 'session.v3.jsonl.zstd')
    writeFileSync(path, zstdCompressSync(Buffer.from(text, 'utf8')))
    const read = readSessionRows(path)
    assert.equal(read.length, 3)
    const loaded = loadSessionLog(path, known)
    assert.equal(loaded.error, undefined)
    assert.equal(loaded.session.sessionId, 'zipped')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
