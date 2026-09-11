/**
 * Shared helpers for this suite's unit tests.
 *
 * @module grabme/tests/support
 */

import { resolve } from 'node:path'
import { loadKnownEventTypes } from '../lib/known-events.mjs'
import { loadSessionLog } from '../lib/load.mjs'
import { loadCases, associateCase } from '../lib/cases.mjs'
import { computeSessionMetrics, aggregateMetrics } from '../lib/metrics.mjs'
import { readFileSync } from 'node:fs'

const HERE = import.meta.dirname

/** Repository root, derived from this file's location. */
export const REPO_ROOT = resolve(HERE, '..', '..', '..', '..')
/** The authored case file. */
export const CASES_PATH = resolve(HERE, '..', 'cases.json')
/** Absolute path of one fixture directory. */
export function fixtureDir(name) {
  return resolve(HERE, 'fixtures', name)
}
/** Absolute path of one fixture's session artifact. */
export function fixtureLog(name) {
  return resolve(fixtureDir(name), 'session.jsonl')
}

/** Names of the fixture sessions, in the order the runner discovers them. */
export const FIXTURE_ORDER = Object.freeze(['direct', 'exceeds-first-turn', 'forbidden-question', 'rich'])

/** Load one fixture session, failing loudly when it cannot be read. */
export function loadFixture(name, options = {}) {
  const known = loadKnownEventTypes(REPO_ROOT)
  const loaded = loadSessionLog(fixtureLog(name), known.types, options)
  if (loaded.error !== undefined) throw new Error(`fixture ${name} failed to load: ${loaded.error.message}`)
  return loaded.session
}

/** Read a fixture's `memory.json`, or `null` when it has none. */
export function fixtureMemory(name) {
  try {
    return JSON.parse(readFileSync(resolve(fixtureDir(name), 'memory.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Compute metrics for one fixture with its associated case and memory snapshot. */
export function fixtureMetrics(name, options = {}) {
  const session = loadFixture(name, options)
  const { byId } = loadCases(CASES_PATH)
  const { case: caseEntry } = associateCase(session, byId, null)
  return computeSessionMetrics({ session, caseEntry, snapshot: fixtureMemory(name) })
}

/** Compute metrics for every fixture and the batch aggregate. */
export function fixtureBatch(options = {}) {
  const sessions = FIXTURE_ORDER.map(name => fixtureMetrics(name, options))
  return { sessions, aggregate: aggregateMetrics(sessions) }
}
