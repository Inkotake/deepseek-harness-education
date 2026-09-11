/**
 * The eight metrics: per-session quantities, the batch aggregate, and the `changed`
 * judgement.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateMetrics, computeSessionMetrics, median, MAX_CLARIFICATION_ROUNDS_BEFORE_DRAFT } from '../lib/metrics.mjs'
import { judgeChanged, collectArtifacts, DEFAULT_ARTIFACT_TOOLS } from '../lib/artifacts.mjs'
import { FIXTURE_ORDER, fixtureBatch, fixtureMetrics, loadFixture } from './support.mjs'

test('median handles odd, even, and empty lists without mutating its input', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(median([]), null)
  const values = [3, 1, 2]
  median(values)
  assert.deepEqual(values, [3, 1, 2])
})

test('the clarification budget is the plan value quoted by metrics.md', () => {
  assert.equal(MAX_CLARIFICATION_ROUNDS_BEFORE_DRAFT, 2)
})

test('per-session quantities match the authored fixtures', () => {
  const expected = {
    direct: { r: 0, f: 1, direct: 1, memory: 3, rel: 0, bad: 0, changed: 0 },
    'exceeds-first-turn': { r: 1, f: 2, direct: 0, memory: 1, rel: 1, bad: 0, changed: 3 },
    'forbidden-question': { r: 1, f: null, direct: 0, memory: 5, rel: 1, bad: 0, changed: 0 },
    rich: { r: 2, f: 3, direct: 0, memory: 6, rel: 4, bad: 3, changed: 1 },
  }
  for (const name of FIXTURE_ORDER) {
    const metrics = fixtureMetrics(name)
    const want = expected[name]
    assert.equal(metrics.clarificationRounds, want.r, `${name}: r(s)`)
    assert.equal(metrics.firstArtifactTurn, want.f, `${name}: f(s)`)
    assert.equal(metrics.directExecution.value, want.direct, `${name}: direct(s)`)
    assert.equal(metrics.memory.recordCount, want.memory, `${name}: |M(s)|`)
    assert.equal(metrics.memory.scores.filter(score => score.rel).length, want.rel, `${name}: Σrel`)
    assert.equal(metrics.memory.scores.filter(score => score.bad).length, want.bad, `${name}: Σbad`)
    assert.equal(metrics.changed.filter(item => item.changed === 1).length, want.changed, `${name}: Σchanged`)
  }
})

test('the batch aggregate matches the authored fixtures', () => {
  const { aggregate } = fixtureBatch()
  assert.equal(aggregate.sessionCount, 4)
  assert.deepEqual(aggregate.metrics, {
    askRate: 2.5,
    repeatedQuestionRate: 0.3,
    usefulQuestionRate: 0.5,
    timeToFirstUsefulArtifact: 2,
    memoryPrecision: 0.4,
    wrongMemoryUsageRate: 0.2,
    directExecutionRate: 0.25,
    medianClarificationRounds: 1,
  })
  assert.deepEqual(aggregate.denominators, {
    sessions: 4,
    questions: 10,
    usefulQuestionDenominator: 8,
    memoryRecords: 15,
    firstArtifactSessions: 3,
  })
  assert.equal(aggregate.counts.repeatedQuestions, 3)
  assert.equal(aggregate.counts.exemptReconfirmations, 1)
  assert.equal(aggregate.counts.unclassifiedQuestions, 1)
  assert.equal(aggregate.counts.changedQuestions, 4)
  assert.equal(aggregate.counts.changedUndecidable, 2)
  assert.equal(aggregate.counts.memoryRelevant, 6)
  assert.equal(aggregate.counts.memoryBad, 3)
  assert.equal(aggregate.counts.directExecutionSessions, 1)
  assert.deepEqual(aggregate.counts.noArtifactSessions, ['correction-lesson-objectives-cap'])
  assert.deepEqual(aggregate.counts.clarificationBudgetViolations, [])
})

test('metric targets are evaluated against the README thresholds', () => {
  const { aggregate } = fixtureBatch()
  assert.equal(aggregate.passes.repeatedQuestionRate, false, '30% is not < 2%')
  assert.equal(aggregate.passes.medianClarificationRounds, true, '1 is <= 1')
  assert.equal(aggregate.passes.timeToFirstUsefulArtifact, true, '2 is <= 2')
})

test('a zero denominator yields null rather than a fabricated rate', () => {
  const empty = aggregateMetrics([])
  assert.equal(empty.metrics.askRate, null)
  assert.equal(empty.metrics.repeatedQuestionRate, null)
  assert.equal(empty.metrics.usefulQuestionRate, null)
  assert.equal(empty.metrics.timeToFirstUsefulArtifact, null)
  assert.equal(empty.metrics.memoryPrecision, null)
  assert.equal(empty.metrics.wrongMemoryUsageRate, null)
  assert.equal(empty.metrics.directExecutionRate, null)
  assert.equal(empty.metrics.medianClarificationRounds, null)
  assert.equal(empty.passes.repeatedQuestionRate, null)
})

test('a session with no artifacts has f(s) = null and is excluded from the median', () => {
  const { aggregate } = fixtureBatch()
  assert.equal(aggregate.counts.noArtifactSessions.length, 1)
  assert.equal(aggregate.denominators.firstArtifactSessions, 3)
  assert.match(aggregate.caveats.join('\n'), /f\(s\) = ∞/)
})

test('artifact collection counts deliverables and artifact-tool results only', () => {
  const session = loadFixture('rich')
  const artifacts = collectArtifacts(session, DEFAULT_ARTIFACT_TOOLS)
  assert.deepEqual(artifacts.map(artifact => [artifact.kind, artifact.turn, artifact.tool]), [
    ['tool/result', 3, 'write'],
    ['deliverables/presented', 4, 'present'],
    ['tool/result', 4, 'present'],
  ])
})

test('judgeChanged distinguishes 1, 0, and undecidable', () => {
  const session = loadFixture('rich')
  const artifacts = collectArtifacts(session)
  const verdicts = fixtureMetrics('rich').questions.map((question, index) => {
    void index
    return judgeChanged({ question, artifacts })
  })
  assert.equal(verdicts[1].changed, 1, '第一章 was carried into the artifact')
  assert.equal(verdicts[0].changed, 0, '高一 never appears in an artifact')
  assert.equal(verdicts[4].changed, null)
  assert.equal(verdicts[4].undecidable, true)
  assert.match(verdicts[4].reason, /unanswered/)
})

test('an error tool result is not an artifact', () => {
  const session = loadFixture('rich')
  const patched = structuredClone(session)
  for (const event of patched.events) {
    if (event.type === 'tool/result') event.data.error = { name: 'FixtureError', code: 'FIXTURE' }
  }
  assert.deepEqual(collectArtifacts(patched).map(artifact => artifact.kind), ['deliverables/presented'])
})

test('computeSessionMetrics records the retrieval rule it used for the memory metrics', () => {
  assert.equal(fixtureMetrics('rich').memory.rule.task_type, 'assessment_design')
  assert.equal(fixtureMetrics('rich').taskType, 'assessment_design')
  assert.equal(fixtureMetrics('direct').memory.rule.task_type, 'general')
})

test('brief detection is reported as unavailable rather than guessed', () => {
  const metrics = computeSessionMetrics({
    session: loadFixture('direct'),
    caseEntry: null,
    snapshot: null,
  })
  assert.equal(metrics.directExecution.briefDetected, null)
  assert.match(metrics.directExecution.briefDetectionReason, /no Requirement Brief event type exists/)
})
