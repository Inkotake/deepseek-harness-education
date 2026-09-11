/**
 * End-to-end coverage of the two entry points, driven through their exported
 * functions rather than a subprocess, plus the report renderers.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBatch, parseArgs, DEFAULT_CASES_PATH, REPO_ROOT } from '../run.mjs'
import { parseScoreArgs, runScore } from '../score.mjs'
import { escapeNonAscii, renderTextReport, METRIC_ORDER } from '../lib/report.mjs'
import { fixtureDir, CASES_PATH } from './support.mjs'

test('the repository root and default case file resolve to real paths', () => {
  assert.equal(REPO_ROOT.endsWith('teacher-dsh-desktop'), true, REPO_ROOT)
  assert.equal(DEFAULT_CASES_PATH, CASES_PATH)
})

test('parseArgs rejects an empty invocation and unknown flags', () => {
  assert.equal(parseArgs([]).error, 'no session path given')
  assert.equal(parseArgs(['--nope', '.']).error, 'unknown option --nope')
  const parsed = parseArgs([fixtureDir('rich'), '--json', '--case', 'x'])
  assert.equal(parsed.json, true)
  assert.equal(parsed.caseId, 'x')
})

test('runBatch scores every fixture directory', () => {
  const report = runBatch({
    paths: [fixtureDir('rich'), fixtureDir('direct'), fixtureDir('exceeds-first-turn'), fixtureDir('forbidden-question')],
    json: false,
    ascii: false,
    casesPath: CASES_PATH,
    caseId: null,
    artifactTools: ['write', 'edit', 'present'],
    tolerateUnknownEvents: false,
  })
  assert.equal(report.sessions.length, 4)
  assert.equal(report.errors.length, 0)
  assert.equal(report.caseCount, 26)
  assert.equal(report.knownEvents.source, 'harness')
  assert.equal(report.aggregate.sessionCount, 4)
  assert.equal(report.caseScores.length, 4)
  assert.equal(report.directionTotals.shouldHaveAsked, 1)
  assert.equal(report.directionTotals.shouldNotHaveAsked, 4)
})

test('runBatch reports a missing path and a missing artifact instead of crashing', () => {
  const report = runBatch({
    paths: [`${fixtureDir('rich')}/does-not-exist`],
    casesPath: CASES_PATH,
    caseId: null,
    artifactTools: ['write', 'edit', 'present'],
  })
  assert.equal(report.sessions.length, 0)
  assert.equal(report.errors.length, 1)
  assert.match(report.errors[0].message, /does not exist/)
})

test('runBatch refuses a forced case id that is not in cases.json', () => {
  const report = runBatch({
    paths: [fixtureDir('rich')],
    casesPath: CASES_PATH,
    caseId: 'no-such-case',
    artifactTools: ['write', 'edit', 'present'],
  })
  assert.equal(report.sessions.length, 0)
  assert.match(report.errors[0].message, /is not in/)
})

test('score.mjs arguments require both a case and a path', () => {
  assert.equal(parseScoreArgs(['--case', 'x']).error, 'both --case <caseId> and a session path are required')
  assert.equal(parseScoreArgs([fixtureDir('rich')]).error, 'both --case <caseId> and a session path are required')
  const parsed = parseScoreArgs(['--case', 'x', fixtureDir('rich'), '--json'])
  assert.equal(parsed.caseId, 'x')
  assert.equal(parsed.json, true)
})

test('runScore reproduces the per-case verdicts', () => {
  const forbidden = runScore({ caseId: 'correction-lesson-objectives-cap', path: fixtureDir('forbidden-question'), casesPath: CASES_PATH, artifactTools: ['write', 'edit', 'present'] })
  assert.equal(forbidden.results.length, 1)
  assert.equal(forbidden.results[0].score.violated, true)

  const exceeds = runScore({ caseId: 'missing-exam-two-questions', path: fixtureDir('exceeds-first-turn'), casesPath: CASES_PATH, artifactTools: ['write', 'edit', 'present'] })
  assert.equal(exceeds.results[0].score.maxQuestionsFirstTurn.exceeded, true)

  const unknown = runScore({ caseId: 'no-such-case', path: fixtureDir('rich'), casesPath: CASES_PATH })
  assert.match(unknown.error, /is not in/)
})

test('the text report names all eight metrics and renders without throwing', () => {
  const report = runBatch({
    paths: [fixtureDir('rich')],
    casesPath: CASES_PATH,
    caseId: null,
    artifactTools: ['write', 'edit', 'present'],
  })
  const text = renderTextReport(report, { ascii: true })
  for (const [, label] of METRIC_ORDER) assert.ok(text.includes(label), label)
  assert.equal(/[^\u0000-\u007F]/u.test(text), false, '--ascii output must be pure ASCII')
  const unicode = renderTextReport(report, { ascii: false })
  assert.notEqual(unicode, text)
})

test('escapeNonAscii covers the characters PowerShell would mangle', () => {
  assert.equal(escapeNonAscii('高一'), '\\u9AD8\\u4E00')
  assert.equal(escapeNonAscii('ΣQ'), '\\u03A3Q')
  assert.equal(escapeNonAscii('plain'), 'plain')
})
