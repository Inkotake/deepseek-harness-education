/**
 * Artifact events, fingerprints, and the `changed(x)` judgement.
 *
 * `metrics.md` §4 defines a useful artifact as either a `deliverables/presented`
 * event or a `tool/result` that produced deliverable content. §3 defines
 * `changed(x)` from whether the artifact was actually rewritten after an answer.
 * Both are read here from log structure only.
 *
 * Grounded event/field names:
 *
 * - `deliverables/presented` — `{ turn, callId, files: [{ path, description? }] }`,
 *   declared in `deepseek-harness/packages/fs/tool-present/src/types.ts`.
 * - `tool/call` — `{ turn, step, callId, name, arguments }` and the paired
 *   `tool/result`, declared in `deepseek-harness/packages/core/session/src/types.ts`.
 * - `present`, `write`, `edit` are the registered tool names in
 *   `deepseek-harness/packages/fs/tool-present/src/index.ts` and
 *   `deepseek-harness/packages/fs/tool-fs/src/{write,edit}.ts`.
 *
 * @module grabme/lib/artifacts.mjs
 */

import { createHash } from 'node:crypto'
import { normalizeText } from './slots.mjs'
import { isErrorResult, toolResultText } from './questions.mjs'

/** Tool names whose successful result counts as deliverable content. */
export const DEFAULT_ARTIFACT_TOOLS = Object.freeze(['write', 'edit', 'present'])

/** Event type that declares finished deliverables. */
export const DELIVERABLES_EVENT = 'deliverables/presented'

/**
 * Collect every artifact event in a session.
 *
 * @param session - the session model.
 * @param artifactTools - tool names whose results count as deliverables.
 * @returns artifact events as `{ kind, turn, seq, tool, callId, fingerprint, text }`,
 *   in log order, where `text` is normalized for value lookup and `fingerprint`
 *   identifies the produced content.
 */
export function collectArtifacts(session, artifactTools = DEFAULT_ARTIFACT_TOOLS) {
  const callsById = new Map()
  for (const event of session.events) {
    if (event.type === 'tool/call' && typeof event.data?.callId === 'string') {
      callsById.set(event.data.callId, event)
    }
  }

  const artifacts = []
  for (const event of session.events) {
    if (event.type === DELIVERABLES_EVENT) {
      const files = Array.isArray(event.data?.files) ? event.data.files : []
      const described = files
        .filter(file => file !== null && typeof file === 'object')
        .map(file => `${String(file.path ?? '')}::${String(file.description ?? '')}`)
      artifacts.push({
        kind: DELIVERABLES_EVENT,
        turn: typeof event.data?.turn === 'number' ? event.data.turn : event.turn,
        seq: event.seq ?? 0,
        tool: 'present',
        callId: event.data?.callId ?? null,
        fingerprint: `present:${hash(described.join('|'))}`,
        text: normalizeText(described.join(' ')),
      })
      continue
    }
    if (event.type !== 'tool/result') continue
    if (isErrorResult(event)) continue
    const callId = event.data?.message?.source?.callId
    const call = typeof callId === 'string' ? callsById.get(callId) : undefined
    if (call === undefined || !artifactTools.includes(call.data?.name)) continue
    const argumentText = String(call.data?.arguments ?? '')
    const resultText = toolResultText(event)
    artifacts.push({
      kind: 'tool/result',
      turn: typeof call.data?.turn === 'number' ? call.data.turn : event.turn,
      seq: event.seq ?? 0,
      tool: call.data.name,
      callId: callId ?? null,
      fingerprint: `tool:${call.data.name}:${hash(argumentText)}`,
      text: normalizeText(`${argumentText} ${resultText}`),
    })
  }
  return artifacts
}

/** Short stable hex digest used for artifact fingerprints and chunk hashes. */
export function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

/**
 * All artifact text at or after one point in the log.
 * @param artifacts - the output of {@link collectArtifacts}.
 * @param predicate - a filter over `{ turn, seq }`, applied inclusively.
 * @returns the concatenated normalized text.
 */
export function artifactTextWhere(artifacts, predicate) {
  return artifacts
    .filter(artifact => predicate(artifact))
    .map(artifact => artifact.text)
    .join(' ')
}

/**
 * Decide `changed(x)` for one answered question, using only log structure.
 *
 * `metrics.md` §3: `1` "当且仅当该问题的回答被采用后，产物 … 与该回答不一致的版本被实际
 * 改写——判据是 `deliverables/presented` 或 brief 写入发生在回答之后，且其中出现该回答带来
 * 的取值/结构差异"; `0` when the artifact is field-for-field equivalent afterwards, or the
 * slot has no landing point; everything else is `undecidable`.
 *
 * The implementation therefore needs three facts: an artifact event strictly after
 * the answer, the artifact text before and after, and the answer's own value. The
 * value is matched as its CJK 2-grams and ASCII alphanumeric tokens, excluding
 * tokens that already appeared before the answer — a token present beforehand
 * cannot be the difference this answer brought.
 *
 * @param context - `{ question, artifacts }`.
 * @returns `{ changed, undecidable, reason, tokens, evidence }`.
 */
export function judgeChanged(context) {
  const { question, artifacts } = context
  const answer = question.answer
  if (answer === null || answer === undefined) {
    return { changed: null, undecidable: true, reason: 'unanswered: the log records no answer to this question', tokens: [], evidence: null }
  }
  if (answer.skipped) {
    return { changed: null, undecidable: true, reason: 'the recorded answer is a skip, so no value can be traced', tokens: [], evidence: null }
  }

  const answerTurn = typeof answer.turn === 'number' ? answer.turn : question.turn
  const answerSeq = typeof answer.seq === 'number' ? answer.seq : Number.MAX_SAFE_INTEGER
  const isAfterAnswer = artifact => artifact.turn > answerTurn
    || (artifact.turn === answerTurn && artifact.seq > answerSeq)

  const after = artifacts.filter(isAfterAnswer)
  if (after.length === 0) {
    return {
      changed: null,
      undecidable: true,
      reason: 'no deliverables/presented or artifact-producing tool result after the answer',
      tokens: [],
      evidence: null,
    }
  }

  const beforeText = artifactTextWhere(artifacts, artifact => !isAfterAnswer(artifact))
  const afterText = artifactTextWhere(after, () => true)
  const tokens = valueTokens(answer.text)
  const fresh = tokens.filter(token => !beforeText.includes(token))
  const matched = fresh.filter(token => afterText.includes(token))

  if (fresh.length === 0) {
    return {
      changed: null,
      undecidable: true,
      reason: 'the answer carries no value token that was absent before it; its effect cannot be isolated',
      tokens,
      evidence: null,
    }
  }
  if (matched.length > 0) {
    return { changed: 1, undecidable: false, reason: 'an artifact was written after the answer and carries the answer\'s value', tokens, evidence: matched.slice(0, 5) }
  }
  return {
    changed: 0,
    undecidable: false,
    reason: 'artifacts were written after the answer but none carries the answer\'s value, so the answer did not change the result',
    tokens,
    evidence: null,
  }
}

/**
 * Break an answer into the value tokens a rewrite could carry.
 *
 * CJK runs contribute every 2-gram; ASCII alphanumeric runs contribute the whole
 * token. Single characters are dropped because one shared character proves nothing.
 *
 * @param text - the answer text (`custom` when present, else the selected labels).
 * @returns the deduplicated tokens.
 */
export function valueTokens(text) {
  const normalized = normalizeText(text)
  const tokens = new Set()
  for (const run of normalized.matchAll(/[\u3400-\u9fff]+/gu)) {
    const value = run[0]
    if (value.length < 2) continue
    for (let index = 0; index + 2 <= value.length; index += 1) tokens.add(value.slice(index, index + 2))
  }
  for (const run of normalized.matchAll(/[a-z0-9]+/gu)) {
    if (run[0].length >= 2) tokens.add(run[0])
  }
  return [...tokens]
}
