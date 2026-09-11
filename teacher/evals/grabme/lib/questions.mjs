/**
 * Clarification-question extraction — the single definition of `Q`.
 *
 * `metrics.md` states the counting rule this module implements verbatim:
 *
 * > 一次 `ask_user_question` 的 `tool/call` 按 `questions` 数组长度计 `k` 个问题，
 * > 不是计 1 个。以自然语言在 `assistant/message` 里写出来的问句只有在同一 `turn` 内
 * > 没有任何 `ask_user_question` 调用时才计入，并按问号分隔的疑问句逐句计。
 * > 两种提问方式不得重复计数。
 *
 * The tool name and argument fields come from the real tool registration in
 * `deepseek-harness/packages/interaction/tool-ask-user/src/index.ts`
 * (`questions[].id` / `.question` / `.header` / `.options[].label` /
 * `.multi_select`), and the answer payload from the same tool's output schema
 * (`answers[].id` / `.selected` / `.custom`), which the renderer emits as compact
 * JSON text inside the `tool/result` message. Nothing here is invented.
 *
 * @module grabme/lib/questions.mjs
 */

import { attributeQuestion } from './slots.mjs'

/** The registered tool whose calls count as clarification questions. */
export const ASK_USER_QUESTION_TOOL = 'ask_user_question'

/** Answer text that counts as the user declining to answer. */
const SKIP_ANSWERS = Object.freeze(['', 'skip', 'skipped', '跳过', '不知道'])

/**
 * Concatenate the text blocks of one model-visible message.
 * @param message - a `UserMessage` / `AssistantMessage` / `ToolResultMessage` payload.
 * @returns the joined text, or `''` when the message carries no text block.
 */
export function messageText(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block !== null && typeof block === 'object' && block.type === 'text')
    .map(block => String(block.text ?? ''))
    .join('\n')
}

/**
 * Concatenate the text blocks of an assistant message event.
 * @param event - an `assistant/message` event.
 * @returns the joined text, or `''` when the message carries no text block.
 */
export function assistantText(event) {
  return messageText(event.data?.message)
}

/**
 * Concatenate the text blocks of a tool result message.
 * @param event - a `tool/result` event.
 * @returns the joined text, or `''`.
 */
export function toolResultText(event) {
  const content = event.data?.message?.content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text') {
      parts.push(String(block.text ?? ''))
      continue
    }
    if (block.type === 'tool-result' && Array.isArray(block.content)) {
      for (const inner of block.content) {
        if (inner !== null && typeof inner === 'object' && inner.type === 'text') {
          parts.push(String(inner.text ?? ''))
        }
      }
    }
  }
  return parts.join('\n')
}

/** Whether a tool result reports an error. */
export function isErrorResult(event) {
  if (event.data?.error !== undefined) return true
  const content = event.data?.message?.content
  if (!Array.isArray(content)) return false
  return content.some(block => block !== null && typeof block === 'object' && block.isError === true)
}

/**
 * Cut a body of assistant text into the interrogative sentences it contains.
 *
 * The rule is "按问号分隔的疑问句逐句计": the text is split on `?` / `？`, the
 * trailing remainder (which has no question mark after it) is dropped, and each
 * remaining piece contributes its last clause so that a lead-in such as
 * "我先按高一、45 分钟来做。" does not contaminate the question text.
 *
 * @param text - assistant message text.
 * @returns the interrogative sentences, in order.
 */
export function questionSentences(text) {
  if (typeof text !== 'string' || !/[?？]/u.test(text)) return []
  const pieces = text.split(/[?？]/u)
  pieces.pop()
  const sentences = []
  for (const piece of pieces) {
    const clause = piece.split(/[。！!；;．.\n\r]/u).pop() ?? ''
    const trimmed = clause.trim()
    if (trimmed.length < 2) continue
    sentences.push(trimmed)
  }
  return sentences
}

/**
 * Extract every clarification question in one session, with its answer.
 *
 * @param session - the session model from `lib/load.mjs`.
 * @param options - `caseEntries` (resolved case entries) and `problems`, an array
 *   the extractor appends structural findings to (an `ask_user_question` call
 *   whose arguments are not JSON, or whose `questions` array is empty).
 * @returns the questions in log order; each is
 *   `{ kind, turn, seq, callId, questionId, text, header, options, multiSelect, answer, attribution }`.
 */
export function extractQuestions(session, options = {}) {
  const caseEntries = options.caseEntries ?? []
  const problems = options.problems ?? []

  const questions = []
  const turnsWithToolAsk = new Set()
  const answersByCall = collectAnswers(session)

  for (const event of session.events) {
    if (event.type !== 'tool/call') continue
    if (event.data?.name !== ASK_USER_QUESTION_TOOL) continue
    const turn = typeof event.data.turn === 'number' ? event.data.turn : event.turn
    turnsWithToolAsk.add(turn)

    let parsed
    try {
      parsed = JSON.parse(String(event.data.arguments ?? ''))
    } catch (error) {
      problems.push({
        kind: 'unparsable-ask-user-question-arguments',
        turn,
        callId: event.data.callId ?? null,
        detail: error.message,
      })
      continue
    }
    const list = Array.isArray(parsed?.questions) ? parsed.questions : []
    if (list.length === 0) {
      problems.push({
        kind: 'empty-ask-user-question-call',
        turn,
        callId: event.data.callId ?? null,
        detail: 'ask_user_question was called with no questions; it contributes 0 to Q',
      })
      continue
    }

    const answers = answersByCall.get(String(event.data.callId ?? ''))
    const answerList = answers?.answers ?? []
    for (const entry of list) {
      const questionId = typeof entry?.id === 'string' ? entry.id : null
      const text = typeof entry?.question === 'string' ? entry.question : ''
      const answer = questionId === null
        ? undefined
        : answerList.find(candidate => candidate.id === questionId)
      questions.push({
        kind: 'tool',
        turn,
        seq: event.seq,
        callId: event.data.callId ?? null,
        questionId,
        text,
        header: typeof entry?.header === 'string' ? entry.header : null,
        options: Array.isArray(entry?.options)
          ? entry.options
            .map(option => (option !== null && typeof option === 'object' ? String(option.label ?? '') : ''))
            .filter(label => label.length > 0)
          : [],
        multiSelect: entry?.multi_select === true,
        answer: answer === undefined ? null : answerFromToolAnswer(answer, { turn: answers.turn, seq: answers.seq }),
        attribution: attributeQuestion(text, caseEntries),
      })
    }
  }

  // Natural-language questions are counted only in turns with no ask_user_question
  // call, so the two channels can never double-count (metrics.md §记法).
  for (const turn of session.turns) {
    if (turnsWithToolAsk.has(turn.turn)) continue
    for (const event of turn.events) {
      if (event.type !== 'assistant/message') continue
      for (const sentence of questionSentences(assistantText(event))) {
        questions.push({
          kind: 'natural',
          turn: turn.turn,
          seq: event.seq,
          callId: null,
          questionId: null,
          text: sentence,
          header: null,
          options: [],
          multiSelect: false,
          answer: null,
          attribution: attributeQuestion(sentence, caseEntries),
        })
      }
    }
  }

  attachNaturalAnswers(session, questions)
  questions.sort((left, right) => {
    if (left.turn !== right.turn) return left.turn - right.turn
    return (left.seq ?? 0) - (right.seq ?? 0)
  })
  return questions
}

/** Read ask_user_question answer payloads out of the session's tool results. */
function collectAnswers(session) {
  const byCall = new Map()
  for (const event of session.events) {
    if (event.type !== 'tool/result') continue
    const callId = event.data?.message?.source?.callId
    if (typeof callId !== 'string') continue
    const text = toolResultText(event)
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    if (Array.isArray(parsed?.answers)) {
      byCall.set(callId, { answers: parsed.answers, turn: event.turn, seq: event.seq ?? 0 })
    }
  }
  return byCall
}

/** Normalize one answer object from the tool payload. */
function answerFromToolAnswer(answer, at) {
  const selected = Array.isArray(answer?.selected) ? answer.selected.map(String) : []
  const custom = typeof answer?.custom === 'string' ? answer.custom : null
  const text = custom !== null && custom.trim() !== '' ? custom : selected.join('、')
  return {
    questionId: typeof answer?.id === 'string' ? answer.id : null,
    selected,
    custom,
    text,
    skipped: SKIP_ANSWERS.includes(text.trim().toLowerCase()),
    source: 'tool-result',
    turn: at.turn,
    seq: at.seq,
  }
}

/** Attach the first human reply after a natural-language question as its answer. */
function attachNaturalAnswers(session, questions) {
  const humanTurns = new Map()
  for (const event of session.events) {
    if (event.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'user') continue
    const text = messageText(event.data)
    if (!humanTurns.has(event.turn)) humanTurns.set(event.turn, { text, seq: event.seq ?? 0 })
  }
  for (const question of questions) {
    if (question.kind !== 'natural') continue
    const laterTurns = [...humanTurns.keys()].filter(turn => turn > question.turn).sort((a, b) => a - b)
    if (laterTurns.length === 0) continue
    const turn = laterTurns[0]
    const reply = humanTurns.get(turn)
    question.answer = {
      questionId: null,
      selected: [],
      custom: reply.text,
      text: reply.text,
      skipped: SKIP_ANSWERS.includes(reply.text.trim().toLowerCase()),
      source: 'user-message',
      turn,
      seq: reply.seq,
    }
  }
}
