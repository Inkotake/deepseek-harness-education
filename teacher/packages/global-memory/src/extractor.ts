/**
 * The Memory Promotion pipeline (README §11), in the plan's order:
 *
 * ```
 * Session Observation → Memory Candidate → Worth saving?
 *    ├── NO  → discard
 *    └── YES → Deduplication → Conflict Check → Scope Selection → Save
 * ```
 *
 * `MemoryObservation` is the only shape that leaves a session (README §11): raw
 * chat logs are never persisted, and the observation carries a session locator
 * plus, when explicit, a short verbatim fragment.
 *
 * The pipeline is pure. It returns the record to save and never writes; the
 * caller persists through `MemoryStore.savePromoted` (README §11.5), which keeps
 * the discard rules testable without a storage backend.
 *
 * @module @teacher-dsh/global-memory/src/extractor
 */

import {
  MEMORY_NAMESPACE_DECLARATIONS,
  confidenceValue,
  isLongTermEligible,
  memoryTtlFor,
  type MemoryCandidate,
  type MemoryConflictCandidate,
  type MemoryConflictResolution,
  type MemoryDiscardReason,
  type MemoryFieldDeclaration,
  type MemoryNamespace,
  type MemoryObservation,
  type MemoryPromotionResult,
  type MemoryRecord,
  type MemoryScope,
  type MemorySourceRef,
} from '../schema.ts'
import { candidateOfRecord, rankOf, resolveConflict } from './conflict.ts'
import { newCandidateId, newMemoryId } from './ids.ts'
import { assertScopeAllowed, requireField, scopeKey, type DurableRow } from './store.ts'

/** Bound on a verbatim fragment kept inside an extracted record (README §1). */
export const QUOTED_FRAGMENT_MAX_CHARS = 200

/** Markers that make one statement a negative instruction. */
const NEGATION_MARKERS = [
  '不要',
  '不用',
  '不需要',
  '别',
  '不想',
  '不能',
  '无需',
  'not ',
  'do not',
  'don\'t',
]

/**
 * Named teaching methods. These belong to a Skill (README §2, plan §三.3: 技术词
 * 不得出现在给老师的选择里), so an extractor that proposes one as a durable
 * preference is discarded rather than stored.
 */
const METHOD_VOCABULARY = [
  'pbl',
  '项目式学习',
  'ubd',
  '逆向设计',
  '5e教学法',
  '建构主义',
  '布鲁姆',
  'bloom',
  '翻转课堂',
  'boppps',
  'addie',
  '探究式教学法',
]

/** Markers that make one observation a statement about the assistant rather than the teacher. */
const ASSISTANT_MARKERS = ['模型', '助手', 'ai', 'assistant']

/**
 * Whether one statement is a negative instruction.
 * @param statement - the text to test.
 * @returns true when a negation marker is present.
 */
export function isNegation(statement: string): boolean {
  const text = statement.toLocaleLowerCase()
  return NEGATION_MARKERS.some(marker => text.includes(marker))
}

/**
 * Whether one value names a teaching method.
 * @param text - the candidate text to test.
 * @returns true when a named method appears.
 */
export function namesTeachingMethod(text: string): boolean {
  const lowered = text.toLocaleLowerCase()
  return METHOD_VOCABULARY.some(marker => lowered.includes(marker))
}

/**
 * Whether one observation is about the assistant.
 * @param text - the observation summary.
 * @returns true when the text names the model or the assistant.
 */
export function referencesAssistant(text: string): boolean {
  const lowered = text.toLocaleLowerCase()
  return ASSISTANT_MARKERS.some(marker => lowered.includes(marker))
}

/**
 * The `Worth saving?` stage (README §11.1).
 *
 * The checks run in a deliberate order. The transient-negation check comes FIRST,
 * before the confidence gate, because README §5.1 states that what makes a
 * long-term write from one negative instruction illegal is the scope and not the
 * confidence: reporting `weak_inference` for "这次不要课堂活动" would name the
 * wrong cause (and the same utterance at `explicit_user` would then slip
 * through).
 * @param candidate - the candidate to judge.
 * @returns the discard reason, or `undefined` when the candidate may be saved.
 */
export function worthSaving(candidate: MemoryCandidate): MemoryDiscardReason | undefined {
  const observation = candidate.observation
  const quoted = observation.quoted_fragment ?? ''
  const text = `${candidate.value}\n${observation.summary}\n${quoted}`
  const taskScoped = candidate.scope.scope_type === 'project' || candidate.scope.scope_type === 'session'
  const isCorrection = candidate.namespace === 'corrections'
    || candidate.source.source === 'explicit_correction'
    || candidate.confidence === 'explicit_correction'

  if (!taskScoped && candidate.namespace !== 'projects' && !isCorrection
    && observation.channel === 'user_message'
    && (isNegation(observation.summary) || isNegation(quoted))) {
    return 'transient_negation'
  }
  if (taskScoped && candidate.namespace !== 'projects') {
    return 'one_off_task_parameter'
  }
  if (!isCorrection && namesTeachingMethod(text)) {
    return 'already_covered_by_skill'
  }
  if (candidate.namespace !== 'corrections' && candidate.namespace !== 'projects'
    && (candidate.value.length > QUOTED_FRAGMENT_MAX_CHARS
      || (quoted !== '' && candidate.value === quoted))) {
    return 'raw_chat_text'
  }
  if (!isCorrection && observation.channel === 'session_log' && referencesAssistant(observation.summary)) {
    return 'not_about_the_teacher'
  }
  if (!isLongTermEligible(candidate.confidence)) {
    return 'weak_inference'
  }
  return undefined
}

/** The scope one candidate is written with, after scope selection. */
export interface ScopeSelection {
  /** The accepted scope, with `valid_for` stamped for school-year records. */
  readonly scope: MemoryScope
  /** True when the extractor's proposal was replaced by the field's default scope. */
  readonly revised: boolean
  /** Explicit expiry instant derived from the scope, or `null` when it never expires. */
  readonly expires_at: string | null
  /** What expiry means for this scope. */
  readonly expiry_action: 'never' | 'reconfirm'
}

/**
 * The `Scope Selection` stage (README §11.4).
 *
 * A `stableKeys: false` field proposed as `stable` is REJECTED rather than
 * silently corrected: the plan is explicit that 年级/教材版本/班级情况 expire, and a
 * silent repair would make the rejection unauditable. Any other unsupported scope
 * type falls back to the field's declared default, because "default to
 * `defaultScopeType` when the extractor is unsure" is the stated behavior.
 * @param declaration - the field's declaration.
 * @param proposed - the scope the extractor proposed.
 * @param nowIso - instant the write happens at.
 * @returns the accepted scope and the expiry it derives.
 * @throws when the field may not be `stable`, or when neither the proposal nor the
 * field's default scope is allowed.
 */
export function selectScope(
  declaration: MemoryFieldDeclaration,
  proposed: MemoryScope,
  nowIso: string,
): ScopeSelection {
  if (!declaration.stableKeys && proposed.scope_type === 'stable') {
    assertScopeAllowed(declaration, proposed, nowIso)
  }
  let scope = proposed
  let revised = false
  if (!declaration.allowedScopeTypes.includes(proposed.scope_type)) {
    scope = { ...proposed, scope_type: declaration.defaultScopeType }
    revised = true
  }
  const accepted = assertScopeAllowed(declaration, scope, nowIso)
  const ttl = memoryTtlFor(accepted, nowIso)
  return {
    scope: accepted,
    revised,
    expires_at: ttl.expiresAt,
    expiry_action: ttl.expiryAction,
  }
}

/** Everything one promotion run needs that is not in the candidate. */
export interface PromotionContext {
  /** Instant the promotion runs at. */
  readonly nowIso: string
  /** Session the promoted record is attributed to. */
  readonly sessionRef: string
  /**
   * Durable values that bear on the same decision, as candidates. Which rows
   * those are is the caller's evidence, because two different fields can settle
   * one decision — README §6.1's durable `class_duration_minutes` and ephemeral
   * `project_config` are exactly that case.
   */
  readonly competing?: readonly MemoryConflictCandidate[]
  /** True when the caller knows the value holds only for the current task. */
  readonly ephemeral?: boolean
  /** The store's current rows, for deduplication. */
  readonly existing?: readonly DurableRow[]
}

/** One promotion run, with the intermediate decisions the caller may need. */
export interface PromotionOutcome {
  /** The pipeline result, as `schema.ts` declares it. */
  readonly result: MemoryPromotionResult
  /** The conflict resolution, when the pipeline reached the conflict check. */
  readonly resolution?: MemoryConflictResolution
  /** The scope the write was accepted under, when one was selected. */
  readonly scope?: MemoryScope
}

/**
 * Run one candidate through the whole pipeline.
 * @param candidate - the candidate to promote.
 * @param ctx - the instant, the session, and the competing durable values.
 * @returns the save or discard result plus the intermediate decisions.
 * @throws when the candidate names an undeclared field, or proposes a scope the
 * field's declaration refuses.
 */
export function runPromotionPipeline(
  candidate: MemoryCandidate,
  ctx: PromotionContext,
): PromotionOutcome {
  const reason = worthSaving(candidate)
  if (reason !== undefined) {
    return { result: { stage: 'discarded', reason, candidate } }
  }
  const declaration = requireField(candidate.namespace, candidate.key)
  const selection = selectScope(declaration, candidate.scope, ctx.nowIso)
  const own: MemoryConflictCandidate = {
    rank: rankOf({
      namespace: candidate.namespace,
      confidence: candidate.confidence,
      source: candidate.source.source,
      scope: selection.scope,
    }),
    value: candidate.value,
    ...ctx.ephemeral === true ? { ephemeral: true } : {},
  }
  const resolution = resolveConflict([own, ...(ctx.competing ?? [])])
  if ((resolution.ranked[0] ?? own) !== own) {
    // The durable value that bears on this decision outranks the candidate, so the
    // candidate is not written. A task-scoped candidate is the plan's one-off case
    // (README §5.1's permitted extraction is the one that DOES land in `projects`);
    // anything else is being refused as evidence against what is already known.
    const veto: MemoryDiscardReason = ctx.ephemeral === true
      || selection.scope.scope_type === 'project'
      || selection.scope.scope_type === 'session'
      ? 'one_off_task_parameter'
      : 'weak_inference'
    return { result: { stage: 'discarded', reason: veto, candidate }, resolution, scope: selection.scope }
  }

  const existing = (ctx.existing ?? []).find(row =>
    row.namespace === candidate.namespace
    && row.key === candidate.key
    && scopeKey(row.scope) === scopeKey(selection.scope))
  if (existing !== undefined && existing.value === candidate.value) {
    // Deduplication (README §11.2): an exact match refreshes confirmation and only
    // ever raises the rung; it never creates a second row.
    const merged: DurableRow = {
      ...existing,
      confidence: confidenceValue(candidate.confidence) > confidenceValue(existing.confidence)
        ? candidate.confidence
        : existing.confidence,
      updated_at: ctx.nowIso,
      last_confirmed_at: ctx.nowIso,
      evidence: candidate.observation.summary,
    }
    return {
      result: { stage: 'save', record: merged, merged: true },
      resolution,
      scope: selection.scope,
    }
  }

  const source: MemorySourceRef = {
    ...candidate.source,
    session_ref: ctx.sessionRef,
    observed_at: ctx.nowIso,
  }
  const record: DurableRow = {
    id: existing?.id ?? newMemoryId(),
    namespace: candidate.namespace,
    key: candidate.key,
    value: candidate.value,
    scope: selection.scope,
    source,
    confidence: candidate.confidence,
    updated_at: ctx.nowIso,
    expires_at: selection.expires_at,
    last_confirmed_at: ctx.nowIso,
    evidence: candidate.observation.summary,
  }
  return {
    result: { stage: 'save', record, merged: existing !== undefined },
    resolution,
    scope: selection.scope,
  }
}

/**
 * Build one candidate from an observation.
 * @param input - namespace, key, value, scope, rung, and the producing observation.
 * @returns a candidate with a fresh identity.
 */
export function candidateFrom(input: {
  readonly namespace: MemoryNamespace
  readonly key: string
  readonly value: string
  readonly scope: MemoryScope
  readonly confidence: MemoryCandidate['confidence']
  readonly observation: MemoryObservation
  readonly source: MemorySourceRef
}): MemoryCandidate {
  return {
    id: newCandidateId(),
    namespace: input.namespace,
    key: input.key,
    value: input.value,
    scope: input.scope,
    confidence: input.confidence,
    source: input.source,
    observation: input.observation,
  }
}

/**
 * Every declared field of one namespace, for callers that must offer a choice
 * rather than an open question (plan §三.3: 召回优于回忆).
 * @param namespace - the namespace to list.
 * @returns the field names.
 */
export function declaredFieldNames(namespace: MemoryNamespace): readonly string[] {
  return MEMORY_NAMESPACE_DECLARATIONS[namespace].fields.map(field => field.name)
}

/** One durable record projected as a competing candidate, for the conflict check. */
export function competingCandidate(record: MemoryRecord): MemoryConflictCandidate {
  return candidateOfRecord(record)
}
