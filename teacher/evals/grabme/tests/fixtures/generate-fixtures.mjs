/**
 * Author the hand-written fixture sessions used by this suite's unit tests and by
 * the end-to-end verification run.
 *
 * These logs are **authored**, not recorded: no model produced them. They are
 * minimal logical-row sessions in the current (`version: 3`) framing — a
 * `type: 'session'` header followed by `{ type, data, seq, time }` event rows.
 * They are deliberately *not* run through the released v3 codec here, because
 * that codec lives in TypeScript under `deepseek-harness/packages/` and this
 * suite must not depend on a built harness checkout. The runner reads them the
 * same way it reads a recorded log; see `README.md` in this directory.
 *
 * Run with: `node teacher/evals/grabme/tests/fixtures/generate-fixtures.mjs`
 *
 * @module grabme/tests/fixtures/generate-fixtures
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dirname

/** Epoch ms for 2026-01-01T00:00:00Z — the "now" every fixture session starts at. */
const SESSION_START = 1767225600000

/** Build a `user/message` data payload for a human turn. */
function humanMessage(id, text) {
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

/** Build a `user/message` data payload for a plugin injection. */
function injectedMessage(id, plugin, text) {
  return { id, role: 'user', source: { kind: 'plugin', plugin, form: 'injection' }, content: [{ type: 'text', text }] }
}

/** Build an `assistant/message` data payload from text and optional tool calls. */
function assistantMessage(id, turn, step, text, toolCalls = []) {
  const content = []
  if (text !== '') content.push({ type: 'text', text })
  for (const call of toolCalls) content.push({ type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments })
  return {
    turn,
    step,
    message: { id, role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'authorship-only' }, content },
    stream: [],
  }
}

/** Build a `tool/call` data payload. */
function toolCall(turn, step, callId, name, argumentObject) {
  return { turn, step, callId, name, arguments: JSON.stringify(argumentObject) }
}

/** Build a `tool/result` data payload carrying compact JSON text. */
function jsonToolResult(turn, step, callId, text, isError = false) {
  return {
    turn,
    step,
    message: {
      id: `result-${callId}`,
      role: 'user',
      source: { kind: 'tool', callId },
      content: [{ type: 'text', text }],
    },
    ...isError ? { error: { name: 'FixtureError', code: 'FIXTURE' } } : {},
  }
}

/**
 * Assemble rows into a log: a header plus events, with `seq` and `time` assigned
 * in order so the fixture can be written as readable event literals.
 *
 * @param id - session id; the runner associates a session with a case by this id.
 * @param events - `[type, data, extras?]` triples in log order.
 * @returns the JSONL text, one row per line, newline-terminated.
 */
function buildLog(id, events) {
  const rows = [{
    type: 'session',
    version: 3,
    id,
    createdAt: SESSION_START,
    cwd: 'C:\\grabme-fixtures',
    isSeeded: false,
    delegationDepth: 0,
  }]
  events.forEach((event, index) => {
    const [type, data, extras] = event
    rows.push({ type, data, ...(extras ?? {}), seq: index, time: SESSION_START + 1 + index })
  })
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
}

/** The `ask_user_question` argument payload used by the rich fixture's first turn. */
const RICH_TURN_ONE_QUESTIONS = {
  questions: [
    {
      id: 'grade',
      header: '年级',
      question: '今年还是高一吗？',
      options: [
        { label: '还是高一（Recommended）', description: '沿用上学年的年级设置。' },
        { label: '换年级了', description: '本学期带了别的年级。' },
      ],
    },
    {
      id: 'scope',
      header: '考试范围',
      question: '这次考到哪里？',
      options: [
        { label: '第一章 宇宙中的地球（Recommended）', description: '按教学进度推进到第一章末。' },
        { label: '第一章加第二章', description: '覆盖两次月考范围。' },
      ],
    },
  ],
}

/** The arguments of the rich fixture's section-writing tool call. */
const RICH_PAPER_ARGUMENTS = {
  file_path: '期中试卷.md',
  content: '# 期中试卷（第一章 宇宙中的地球）\n\n命题依据：人教版；学生喜欢动手实验',
}

/** The arguments of the rich fixture's `present` call. */
const RICH_PRESENT_ARGUMENTS = {
  files: [{ path: '期中试卷-答案.md', description: '答案单独一页' }],
}

/**
 * Rich fixture — one session that exercises all eight metrics.
 *
 * Case: `missing-midterm-paper-two-questions`.
 *
 * Expectations encoded here:
 * - `Q = 5`: two option-bearing tool questions in turn 1, one in turn 2, one
 *   natural question in turn 3, one in turn 4.
 * - `Qmem = 1`: turn 2's `学科还是高中地理吧？` repeats `profile.subject`, which is
 *   already in memory and whose record carries no `expires_at`, so condition (a) of
 *   the TTL exemption fails.
 * - `ttl-exempt = 1`: turn 1's `今年还是高一吗？` repeats `environment.grades_taught`,
 *   whose `expires_at` (2025-08-01) predates the session, is phrased as a
 *   re-confirmation, and is evidenced by the injected `user/message` at seq 1.
 * - `changed`: `考到哪里？` → the write carries `第一章` (1); `今年还是高一吗？` →
 *   no artifact carries `高一` (0); `学科还是高中地理吧？` (0); `要不要附答题卡？` (0);
 *   the final unanswered question is undecidable.
 * - `f(s) = 3`: the first artifact is the `write` in turn 3.
 * - `r(s) = 2`: turns 1 and 2 ask and produce nothing; turns 3 and 4 produce.
 * - `direct(s) = 0`: `Q > 0`.
 * - memory: 6 records, 4 relevant, 3 flagged (rule 2 twice, rule 3 once, rule 1 once).
 *
 * @returns the JSONL text.
 */
function richSession() {
  const log = buildLog('missing-midterm-paper-two-questions', [
    ['turn/start', { turn: 1 }],
    // Condition (c) of the TTL exemption: the memory entry's own injection record.
    ['user/message', injectedMessage(
      'inject-memory-1',
      '@teacher/dsh-global-memory',
      '长期记忆注入：mem-grade = 高一（environment.grades_taught，scope school_year 2025-2026，expires_at 2025-08-01，已过期，本次需确认）。',
    ), { surfaceOp: 'append' }],
    ['user/message', humanMessage('u1', '我要做一份期中试卷'), { surfaceOp: 'append' }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/message', assistantMessage('a1', 1, 1, '', [
      { id: 'call-ask-1', name: 'ask_user_question', arguments: JSON.stringify(RICH_TURN_ONE_QUESTIONS) },
    ]), { surfaceOp: 'append' }],
    ['tool/call', toolCall(1, 1, 'call-ask-1', 'ask_user_question', RICH_TURN_ONE_QUESTIONS)],
    ['tool/result', jsonToolResult(1, 1, 'call-ask-1', JSON.stringify({
      answers: [
        { id: 'grade', selected: ['还是高一（Recommended）'] },
        { id: 'scope', custom: '第一章' },
      ],
    })), { surfaceOp: 'append' }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],

    ['turn/start', { turn: 2 }],
    ['user/message', humanMessage('u2', '第一章，从宇宙中的地球开始，一节课的时长改成 40 分钟'), { surfaceOp: 'append' }],
    ['step/start', { turn: 2, step: 1 }],
    ['assistant/message', assistantMessage('a2', 2, 1, '好，我按第一章出题。'), { surfaceOp: 'append' }],
    ['step/end', { turn: 2, step: 1 }],
    ['step/start', { turn: 2, step: 2 }],
    ['assistant/message', assistantMessage('a3', 2, 2, '', [
      {
        id: 'call-ask-2',
        name: 'ask_user_question',
        arguments: JSON.stringify({
          questions: [{
            id: 'subject',
            header: '学科',
            question: '学科还是高中地理吧？',
            options: [{ label: '对，高中地理（Recommended）' }, { label: '换学科了' }],
          }],
        }),
      },
    ]), { surfaceOp: 'append' }],
    ['tool/call', toolCall(2, 2, 'call-ask-2', 'ask_user_question', {
      questions: [{
        id: 'subject',
        header: '学科',
        question: '学科还是高中地理吧？',
        options: [{ label: '对，高中地理（Recommended）' }, { label: '换学科了' }],
      }],
    })],
    ['tool/result', jsonToolResult(2, 2, 'call-ask-2', JSON.stringify({
      answers: [{ id: 'subject', custom: '高中地理' }],
    })), { surfaceOp: 'append' }],
    ['step/end', { turn: 2, step: 2 }],
    ['turn/end', { turn: 2, reason: { kind: 'completed' } }],

    ['turn/start', { turn: 3 }],
    ['user/message', humanMessage('u3', '嗯，可以'), { surfaceOp: 'append' }],
    ['step/start', { turn: 3, step: 1 }],
    ['assistant/message', assistantMessage('a4', 3, 1, '试卷初稿写好了。要不要附答题卡？', [
      { id: 'call-write-1', name: 'write', arguments: JSON.stringify(RICH_PAPER_ARGUMENTS) },
    ]), { surfaceOp: 'append' }],
    ['tool/call', toolCall(3, 1, 'call-write-1', 'write', RICH_PAPER_ARGUMENTS)],
    ['tool/result', jsonToolResult(3, 1, 'call-write-1', 'Wrote 期中试卷.md (3 lines).'), { surfaceOp: 'append' }],
    ['step/end', { turn: 3, step: 1 }],
    ['turn/end', { turn: 3, reason: { kind: 'completed' } }],

    ['turn/start', { turn: 4 }],
    ['user/message', humanMessage('u4', '不要答题卡'), { surfaceOp: 'append' }],
    ['step/start', { turn: 4, step: 1 }],
    ['assistant/message', assistantMessage('a5', 4, 1, '好，答案单独一页。', [
      { id: 'call-present-1', name: 'present', arguments: JSON.stringify(RICH_PRESENT_ARGUMENTS) },
    ]), { surfaceOp: 'append' }],
    ['tool/call', toolCall(4, 1, 'call-present-1', 'present', RICH_PRESENT_ARGUMENTS)],
    ['deliverables/presented', {
      turn: 4,
      callId: 'call-present-1',
      files: [{ path: '期中试卷-答案.md', description: '答案单独一页' }],
    }],
    ['tool/result', jsonToolResult(4, 1, 'call-present-1', 'Presented 1 file.'), { surfaceOp: 'append' }],
    ['assistant/message', assistantMessage('a6', 4, 1, '还需要再出一套变式题吗？'), { surfaceOp: 'append' }],
    ['step/end', { turn: 4, step: 1 }],
    ['turn/end', { turn: 4, reason: { kind: 'completed' } }],
  ])
  return log
}

/**
 * The rich fixture's memory snapshot: `MemoryRecord` rows in the shape declared by
 * `teacher/packages/global-memory/schema.ts` (subset of fields the log can carry).
 */
function richMemorySnapshot() {
  return [
    {
      id: 'mem-subject',
      namespace: 'profile',
      key: 'subject',
      value: '高中地理',
      scope: { scope_type: 'stable' },
      source: { source: 'explicit_user', observed_at: '2025-09-01T00:00:00.000Z' },
      confidence: 'explicit_user',
      updated_at: '2025-09-01T00:00:00.000Z',
      expires_at: null,
    },
    {
      id: 'mem-grade',
      namespace: 'environment',
      key: 'grades_taught',
      value: '高一',
      scope: { scope_type: 'school_year', valid_for: '2025-2026' },
      source: { source: 'explicit_user', observed_at: '2024-09-01T00:00:00.000Z' },
      confidence: 'explicit_user',
      updated_at: '2024-09-01T00:00:00.000Z',
      expires_at: '2025-08-01T00:00:00.000Z',
    },
    {
      id: 'mem-textbook',
      namespace: 'environment',
      key: 'textbook_edition',
      value: '人教版',
      scope: { scope_type: 'school_year', valid_for: '2025-2026' },
      source: { source: 'explicit_user', observed_at: '2024-09-01T00:00:00.000Z' },
      confidence: 'explicit_user',
      updated_at: '2024-09-01T00:00:00.000Z',
      expires_at: '2025-08-01T00:00:00.000Z',
    },
    {
      id: 'mem-focus',
      namespace: 'preferences',
      key: 'pedagogy_preference',
      value: '学生喜欢动手实验',
      scope: { scope_type: 'stable' },
      source: { source: 'strong_inference', observed_at: '2025-10-02T00:00:00.000Z' },
      confidence: 'strong_inference',
      updated_at: '2025-10-02T00:00:00.000Z',
      expires_at: null,
    },
    {
      id: 'mem-project',
      namespace: 'projects',
      key: 'project_config',
      value: '公开课备课中',
      scope: { scope_type: 'project', project_id: 'open-lesson' },
      source: { source: 'project_config', observed_at: '2025-11-01T00:00:00.000Z' },
      confidence: 'explicit_user',
      updated_at: '2025-11-01T00:00:00.000Z',
      expires_at: null,
    },
    {
      id: 'mem-duration',
      namespace: 'environment',
      key: 'class_duration_minutes',
      value: '45',
      scope: { scope_type: 'school_year', valid_for: '2025-2026' },
      source: { source: 'explicit_user', observed_at: '2024-09-01T00:00:00.000Z' },
      confidence: 'explicit_user',
      updated_at: '2024-09-01T00:00:00.000Z',
      expires_at: null,
    },
  ]
}

/**
 * Forbidden-question fixture.
 *
 * Case: `correction-lesson-objectives-cap`. The single question asks exactly what
 * the recorded correction already answers, so it must be reported as a
 * `must_not_ask_about` violation and as a repeated question. No artifact is
 * produced, so `must_produce_brief` fails and `f(s) = ∞`.
 *
 * @returns the JSONL text.
 */
function forbiddenQuestionSession() {
  const question = {
    questions: [{
      id: 'objective-count',
      question: '您希望教学目标写几项？',
      header: '教学目标',
    }],
  }
  return buildLog('correction-lesson-objectives-cap', [
    ['turn/start', { turn: 1 }],
    ['user/message', humanMessage('u1', '再帮我写一节《热力环流》的教案，还是老规矩'), { surfaceOp: 'append' }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/message', assistantMessage('a1', 1, 1, '', [
      { id: 'call-ask-1', name: 'ask_user_question', arguments: JSON.stringify(question) },
    ]), { surfaceOp: 'append' }],
    ['tool/call', toolCall(1, 1, 'call-ask-1', 'ask_user_question', question)],
    // The teacher never answers: the session ends while the question is pending.
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }],
  ])
}

/**
 * Over-budget fixture.
 *
 * Case: `missing-exam-two-questions`. Four questions in turn 1 exceed the case's
 * `max_questions_first_turn` of 2, and `学科是初中化学吗？` repeats
 * `profile.subject`, which the case's memory already answers and whose record has
 * no `expires_at`, so condition (a) of the TTL exemption cannot hold.
 *
 * @returns the JSONL text.
 */
function exceedsFirstTurnSession() {
  const question = {
    questions: [
      { id: 'grade', question: '这是哪个年级的卷子？', options: [{ label: '高一' }, { label: '高二' }] },
      { id: 'subject', question: '学科是初中化学吗？', options: [{ label: '是' }, { label: '不是' }] },
      { id: 'scope', question: '要考到哪一章？', options: [{ label: '第一章' }, { label: '第一章加第二章' }] },
      { id: 'template', question: '学校有统一的试卷模板吗？', options: [{ label: '有' }, { label: '没有' }] },
    ],
  }
  const paper = { file_path: '月考卷.md', content: '# 高一化学月考试卷\n\n第一章 物质及其变化' }
  return buildLog('missing-exam-two-questions', [
    ['turn/start', { turn: 1 }],
    ['user/message', humanMessage('u1', '要月考了，帮我弄套卷子'), { surfaceOp: 'append' }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/message', assistantMessage('a1', 1, 1, '', [
      { id: 'call-ask-1', name: 'ask_user_question', arguments: JSON.stringify(question) },
    ]), { surfaceOp: 'append' }],
    ['tool/call', toolCall(1, 1, 'call-ask-1', 'ask_user_question', question)],
    ['tool/result', jsonToolResult(1, 1, 'call-ask-1', JSON.stringify({
      answers: [
        { id: 'grade', custom: '高一' },
        { id: 'subject', custom: '对，初中化学' },
        { id: 'scope', custom: '第一章' },
        { id: 'template', custom: '没有' },
      ],
    })), { surfaceOp: 'append' }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],

    ['turn/start', { turn: 2 }],
    ['user/message', humanMessage('u2', '高一，考第一章'), { surfaceOp: 'append' }],
    ['step/start', { turn: 2, step: 1 }],
    ['assistant/message', assistantMessage('a2', 2, 1, '好，我按这个来出。', [
      { id: 'call-write-1', name: 'write', arguments: JSON.stringify(paper) },
    ]), { surfaceOp: 'append' }],
    ['tool/call', toolCall(2, 1, 'call-write-1', 'write', paper)],
    ['tool/result', jsonToolResult(2, 1, 'call-write-1', 'Wrote 月考卷.md (3 lines).'), { surfaceOp: 'append' }],
    ['step/end', { turn: 2, step: 1 }],
    ['turn/end', { turn: 2, reason: { kind: 'completed' } }],
  ])
}

/**
 * Direct-execution fixture.
 *
 * Case: `direct-execution-immediate`. The teacher says "直接做，别问了"; the
 * session asks nothing (`Q = 0`), writes the artifact in turn 1, and therefore has
 * `direct(s) = 1` and `f(s) = 1`.
 *
 * @returns the JSONL text.
 */
function directExecutionSession() {
  const lesson = { file_path: '热力环流-教案.md', content: '# 热力环流（高二）\n\n一、教学目标（2 项）' }
  return buildLog('direct-execution-immediate', [
    ['turn/start', { turn: 1 }],
    ['user/message', humanMessage('u1', '直接做，别问了'), { surfaceOp: 'append' }],
    ['step/start', { turn: 1, step: 1 }],
    ['assistant/message', assistantMessage('a1', 1, 1, '按高二、人教版直接出稿，假设课时 45 分钟。', [
      { id: 'call-write-1', name: 'write', arguments: JSON.stringify(lesson) },
    ]), { surfaceOp: 'append' }],
    ['tool/call', toolCall(1, 1, 'call-write-1', 'write', lesson)],
    ['tool/result', jsonToolResult(1, 1, 'call-write-1', 'Wrote 热力环流-教案.md (3 lines).'), { surfaceOp: 'append' }],
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ])
}

/** Fixture name → `{ log, memory? }`. */
const FIXTURES = {
  rich: { log: richSession(), memory: richMemorySnapshot() },
  'forbidden-question': { log: forbiddenQuestionSession() },
  'exceeds-first-turn': { log: exceedsFirstTurnSession() },
  direct: { log: directExecutionSession() },
}

/** Write every fixture to disk. */
export function writeFixtures() {
  const written = []
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const directory = join(HERE, name)
    mkdirSync(directory, { recursive: true })
    const logPath = join(directory, 'session.jsonl')
    writeFileSync(logPath, fixture.log, 'utf8')
    written.push(logPath)
    if (fixture.memory !== undefined) {
      const memoryPath = join(directory, 'memory.json')
      writeFileSync(memoryPath, `${JSON.stringify(fixture.memory, null, 2)}\n`, 'utf8')
      written.push(memoryPath)
    }
  }
  return written
}

/** Directory of one fixture, for tests that need to point the runner at it. */
export function fixturePath(name) {
  return join(HERE, name)
}

/** Absolute path of every fixture directory. */
export const FIXTURE_NAMES = Object.freeze(Object.keys(FIXTURES))

if (process.argv[1] !== undefined && process.argv[1].endsWith('generate-fixtures.mjs')) {
  for (const path of writeFixtures()) process.stdout.write(`${path}\n`)
}
