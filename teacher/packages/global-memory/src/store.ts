/**
 * The durable store: every read and write the six tools and the step listener
 * perform (README §4, §9, §12).
 *
 * Persistence is `storageDomain` and nothing else (plan §�?P0-3: 持久化走 DSH �? * `storageDomain`，不自己造库). The store takes the three handles the opened
 * domain exposes �?the `memories` table, the `question_ledger` table, and the
 * `meta` global �?and never touches the medium. Reads are synchronous from the
 * domain's in-memory state (`storage-domain/src/domain.ts:1-10`), which is what
 * lets retrieval run inside an `agent/pre-step` listener with no async hop;
 * writes queue on the domain's single write chain and are durable before memory
 * mutates.
 *
 * The store is the enforcement point for three rules the design states as rules
 * rather than conventions:
 *
 * 1. `weak_inference` never reaches long-term memory. `set()` refuses the rung
 *    instead of trusting the caller's schema (`isLongTermEligible`).
 * 2. A `stableKeys: false` field may never be written as `stable`, and no field
 *    may be written with a scope type its declaration does not allow.
 * 3. A model-facing record never carries the evidence locator, the durable
 *    evidence sentence, or the session-suppression field �?see
 *    {@link MemoryRecordWire}.
 *
 * @module @teacher-dsh/global-memory/src/store
 */

import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  MEMORY_NAMESPACE_DECLARATIONS,
  confidenceValue,
  isExpired,
  isLongTermEligible,
  isRetired,
  memoryTtlFor,
  reconfirmationFor,
  schoolYearOf,
  type MemoryFieldDeclaration,
  type MemoryForgetInput,
  type MemoryId,
  type MemoryNamespace,
  type MemoryRecord,
  type MemoryRecordView,
  type MemoryReconfirmation,
  type MemoryScope,
  type MemoryScopeType,
  type MemorySetInput,
  type MemorySource,
  type MemoryUpdateInput,
  type QuestionLedgerEntry,
} from '../schema.ts'
import { newMemoryId } from './ids.ts'
import { INITIAL_MEMORY_META, type MemoryMeta, type StoredLedgerEntry, type StoredMemory } from './records.ts'

/**
 * The model-facing record.
 *
 * `MemoryRecordView` cannot ride the declared output schema unchanged, so the
 * canonical wire value drops exactly what that schema does not carry:
 *
 * - `expires_at` is typed `string` in the declared output schema, so a stable
 *   record's `null` is emitted as an absent property rather than a null.
 * - `suppressed_for_session` is absent from the declared properties and that
 *   schema is `additionalProperties: false`, so a suppression is observable only
 *   through `memory_feedback`'s `action`.
 * - the durable-only `evidence` sentence is never model-visible.
 *
 * `MOUNT.md` records both as gaps between `schema.ts`'s types and its own wire
 * schema.
 */
export type MemoryRecordWire = Omit<MemoryRecordView, 'expires_at' | 'suppressed_for_session'> & {
  readonly expires_at?: string
}

/**
 * One durable row as this store writes it: the declared record plus the
 * durable-only evidence sentence the writing tool was required to supply.
 * `StoredMemory` in `records.ts` is the same row seen through the zod schema.
 */
export type DurableRow = MemoryRecord & {
  /** Why the write was justified; durable and never model-visible. */
  readonly evidence?: string
}

/** Handle set of one opened memory domain. */
export interface MemoryStoreTables {
  /** One row per `(namespace, key, scope)`, keyed by `MemoryRecord.id`. */
  readonly memories: KvTable<string, StoredMemory>
  /** One row per asked question, keyed by `QuestionLedgerEntry.id`. */
  readonly ledger: KvTable<string, StoredLedgerEntry>
  /** The domain global holding the format-version marker. */
  readonly meta: DomainGlobal<MemoryMeta>
}

/** Construction options. */
export interface MemoryStoreOptions {
  /** Instant source; injected so TTL, re-confirmation, and ledger tests are deterministic. */
  readonly clock?: () => string
}

/** One `memory_set` call, plus the session the write is attributed to. */
export interface MemorySetRequest extends MemorySetInput {
  /** Session id recorded as evidence (`MemorySourceRef.session_ref`), never model-visible. */
  readonly session_ref?: string
}

/** One `memory_update` call, plus the session the restatement is attributed to. */
export interface MemoryUpdateRequest extends MemoryUpdateInput {
  /** Session id recorded as evidence, never model-visible. */
  readonly session_ref?: string
}

/** Optional view filters shared by every read. */
export interface MemoryViewFilter {
  /** Instant the read is evaluated at. */
  readonly nowIso: string
  /** Session whose 本次不要�?marks are hidden. */
  readonly session_ref?: string
  /** Include records whose value may no longer hold, with a re-confirmation. */
  readonly include_expired?: boolean
}

/** Result of `memory_get`. */
export interface MemoryGetResult {
  readonly found: boolean
  readonly record?: MemoryRecordWire
  readonly reconfirm?: MemoryReconfirmation
}

/** Result of `memory_search`. */
export interface MemorySearchResult {
  readonly records: readonly MemoryRecordWire[]
  readonly truncated: boolean
}

/** Result of `memory_set`. */
export interface MemorySetResult {
  readonly record: MemoryRecordWire
  readonly created: boolean
  readonly merged_with?: MemoryId
}

/** Result of `memory_update`. */
export interface MemoryUpdateResult {
  readonly record: MemoryRecordWire
  readonly previous_value: string
}

/** Result of `memory_forget`. */
export interface MemoryForgetResult {
  readonly deleted: number
  readonly deleted_ids: readonly MemoryId[]
}

/** One `memory_feedback` call, plus the session it applies to. */
export interface MemoryFeedbackRequest {
  readonly record_id?: MemoryId
  readonly namespace?: MemoryNamespace
  readonly key?: string
  readonly signal: 'correct' | 'incorrect' | 'outdated' | 'dont_use_this_time'
  readonly corrected_value?: string
  readonly evidence: string
  /** Session the `dont_use_this_time` suppression is scoped to. */
  readonly session_ref?: string
}

/** Result of `memory_feedback`. */
export interface MemoryFeedbackResult {
  readonly action: 'corrected' | 'invalidated' | 'suppressed_for_session' | 'no_op'
  readonly record?: MemoryRecordWire
  /** True when the feedback produced a `corrections` record. */
  readonly correction_recorded: boolean
}

/** Provenance route implied by a confidence rung. */
const SOURCE_FOR_RUNG: Readonly<Record<string, MemorySource>> = {
  explicit_user: 'explicit_user',
  explicit_correction: 'explicit_correction',
  repeated_behavior: 'repeated_behavior',
  strong_inference: 'strong_inference',
}

/**
 * Namespaces whose values are long-lived claims about the teacher. `projects` is
 * deliberately absent: it is where a task-scoped value belongs (README §7.3).
 */
export const LONG_LIVED_NAMESPACES: readonly MemoryNamespace[] = [
  'profile',
  'environment',
  'preferences',
  'corrections',
]

/**
 * Identity of one scope instance. `(namespace, key, scope)` is the store's
 * uniqueness key, so two rows for one field are two scopes, never a conflict.
 * @param scope - the scope declaration to key.
 * @returns a stable string key for that scope instance.
 */
export function scopeKey(scope: MemoryScope): string {
  return [
    scope.scope_type,
    scope.valid_for ?? '',
    scope.project_id ?? '',
    scope.class_id ?? '',
  ].join('|')
}

/**
 * The declared field a candidate writes to.
 * @param namespace - the namespace to look in.
 * @param key - the field name inside it.
 * @returns the field declaration.
 * @throws when the field is not declared, because an undeclared field has no
 * scope rules, no default scope, and no re-confirmation prompt.
 */
export function requireField(namespace: MemoryNamespace, key: string): MemoryFieldDeclaration {
  const declared = MEMORY_NAMESPACE_DECLARATIONS[namespace].fields.find(field => field.name === key)
  if (declared === undefined) {
    throw new Error(
      `memory: '${namespace}.${key}' is not a declared memory field; declared fields are `
      + MEMORY_NAMESPACE_DECLARATIONS[namespace].fields.map(field => field.name).join(', '),
    )
  }
  return declared
}

/**
 * Validate one proposed scope against its field declaration (README §7.1, §11.4).
 * @param declaration - the field's declaration.
 * @param scope - the proposed scope.
 * @param nowIso - instant used to stamp a missing school-year label.
 * @returns the accepted scope, with `valid_for` stamped for school-year records.
 * @throws when a `stableKeys: false` field is proposed as `stable`, or when the
 * scope type is not allowed for the field.
 */
export function assertScopeAllowed(
  declaration: MemoryFieldDeclaration,
  scope: MemoryScope,
  nowIso: string,
): MemoryScope {
  if (!declaration.stableKeys && scope.scope_type === 'stable') {
    throw new Error(
      `memory: field '${declaration.name}' is tied to a school year, a class, or a project and `
      + 'may never be written as stable',
    )
  }
  if (!declaration.allowedScopeTypes.includes(scope.scope_type)) {
    throw new Error(
      `memory: field '${declaration.name}' does not allow scope_type '${scope.scope_type}'; allowed: `
      + declaration.allowedScopeTypes.join(', '),
    )
  }
  if (scope.scope_type === 'school_year' && scope.valid_for === undefined) {
    return { ...scope, valid_for: schoolYearOf(nowIso) }
  }
  return scope
}

/**
 * Build the model-facing projection of one record.
 * @param record - the durable record.
 * @returns the canonical wire value, without `session_ref`, `evidence`, or `suppressed_for_session`.
 */
export function toRecordView(record: MemoryRecord): MemoryRecordWire {
  return {
    id: record.id,
    namespace: record.namespace,
    key: record.key,
    value: record.value,
    ...record.details === undefined ? {} : { details: record.details },
    scope: record.scope,
    source: {
      source: record.source.source,
      observed_at: record.source.observed_at,
      ...record.source.quoted_fragment === undefined
        ? {}
        : { quoted_fragment: record.source.quoted_fragment },
    },
    confidence: record.confidence,
    updated_at: record.updated_at,
    ...record.expires_at === null ? {} : { expires_at: record.expires_at },
    ...record.last_confirmed_at === undefined ? {} : { last_confirmed_at: record.last_confirmed_at },
    ...record.user_pinned === undefined ? {} : { user_pinned: record.user_pinned },
    ...record.tags === undefined ? {} : { tags: record.tags },
  }
}

/** Recover the declared record type from the stored row. */
function asRow(row: StoredMemory): DurableRow {
  return { ...row, id: row.id as MemoryId }
}

/** Whether one record is hidden from a session's view. */
function isSuppressedFor(row: DurableRow, sessionRef: string | undefined): boolean {
  return sessionRef !== undefined && row.suppressed_for_session === sessionRef
}

/** Whether one record mentions every query word, case-insensitively. */
function mentions(row: DurableRow, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(word => word !== '')
  if (words.length === 0) return true
  const haystack = [row.key, row.value, row.source.quoted_fragment ?? '']
    .join('\n')
    .toLocaleLowerCase()
  return words.some(word => haystack.includes(word))
}

/**
 * The durable memory store over one opened domain.
 *
 * Every method that writes returns after the domain's write chain has made the
 * record durable; every method that reads answers from the domain's in-memory
 * state.
 */
export class MemoryStore {
  private readonly tables: MemoryStoreTables
  private readonly clock: () => string

  /**
   * @param tables - the opened domain's two tables and its global.
   * @param options - optional injected clock.
   */
  constructor(tables: MemoryStoreTables, options: MemoryStoreOptions = {}) {
    this.tables = tables
    this.clock = options.clock ?? ((): string => new Date().toISOString())
  }

  /**
   * The instant this store stamps on writes.
   * @returns an ISO-8601 instant.
   */
  now(): string {
    return this.clock()
  }

  /**
   * Every stored row, in durable key order, including expired, suppressed and
   * retired rows. Retired rows are kept here precisely so the audit trail is
   * reachable; every model-facing read path filters them out.
   * @returns all durable records.
   */
  all(): readonly DurableRow[] {
    return [...this.tables.memories.entries()].map(([, row]) => asRow(row))
  }

  /**
   * Records a session may see at one instant.
   * @param filter - instant, session, and expiry filters.
   * @returns visible records, expired ones only when `include_expired`.
   */
  visible(filter: MemoryViewFilter): readonly DurableRow[] {
    return this.all().filter(row =>
      // Retired first and unconditionally: no filter may bring a corrected-away value back, because
      // offering it again would re-ask a question the teacher already answered.
      !isRetired(row)
      && !isSuppressedFor(row, filter.session_ref)
      && (filter.include_expired === true || !isExpired(row, filter.nowIso)))
  }

  /**
   * Rows for one `(namespace, key)`, newest write first.
   * @param namespace - namespace to match.
   * @param key - field name to match.
   * @returns matching durable records.
   */
  rowsFor(namespace: MemoryNamespace, key: string): readonly DurableRow[] {
    return this.all()
      .filter(row => row.namespace === namespace && row.key === key)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
  }

  /**
   * Read one exact field (README §10.1).
   * @param request - namespace, key, optional scope, and the view filter.
   * @returns the newest matching record, plus a re-confirmation when the record
   * found may no longer hold.
   */
  get(request: {
    readonly namespace: MemoryNamespace
    readonly key: string
    readonly scope?: MemoryScope
    readonly nowIso: string
    readonly session_ref?: string
    readonly include_expired?: boolean
  }): MemoryGetResult {
    const rows = this.rowsFor(request.namespace, request.key)
      .filter(row => !isSuppressedFor(row, request.session_ref))
      .filter(row => request.scope === undefined || scopeKey(row.scope) === scopeKey(request.scope))
    const live = rows.find(row => !isRetired(row) && !isExpired(row, request.nowIso))
    if (live !== undefined) {
      return { found: true, record: toRecordView(live) }
    }
    const expired = rows.find(row => !isRetired(row) && isExpired(row, request.nowIso))
    if (expired === undefined || request.include_expired !== true) {
      return { found: false }
    }
    const reconfirm = reconfirmationFor(expired, request.nowIso)
    return {
      found: true,
      record: toRecordView(expired),
      ...reconfirm === undefined ? {} : { reconfirm },
    }
  }

  /**
   * Find memories relevant to a task (README §10.2). An empty query is not a
   * filter: it lists every record the session may see, which is what backs the
   * control surface's 查看 AI 记住了什�?(README §13.1).
   * @param request - query, namespace/scope/confidence filters, and the view filter.
   * @returns the retained records and whether a limit cut the result.
   */
  search(request: {
    readonly query: string
    readonly namespaces?: readonly MemoryNamespace[]
    readonly scope_type?: MemoryScopeType
    readonly min_confidence?: number
    readonly limit?: number
    readonly nowIso: string
    readonly session_ref?: string
    readonly include_expired?: boolean
  }): MemorySearchResult {
    const candidates = this.visible({
      nowIso: request.nowIso,
      ...request.session_ref === undefined ? {} : { session_ref: request.session_ref },
      ...request.include_expired === undefined ? {} : { include_expired: request.include_expired },
    })
      .filter(row => request.namespaces === undefined || request.namespaces.includes(row.namespace))
      .filter(row => request.scope_type === undefined || row.scope.scope_type === request.scope_type)
      .filter(row => request.min_confidence === undefined
        || confidenceValue(row.confidence) >= request.min_confidence)
      .filter(row => mentions(row, request.query))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    const limit = Math.max(0, request.limit ?? candidates.length)
    const retained = candidates.slice(0, limit)
    return {
      records: retained.map(toRecordView),
      truncated: retained.length < candidates.length,
    }
  }

  /**
   * Save one durable fact (README §10.3, §11.2, §11.4).
   *
   * The write is deduplicated on `(namespace, key, scope)`: an exact value match
   * refreshes `last_confirmed_at` and raises the rung when the new rung is
   * stronger, and never creates a second row. A different value for the same
   * scope restates the row.
   * @param input - the write, plus the session it is attributed to.
   * @returns the stored record, whether a row was created, and the row an existing
   * write merged with.
   * @throws when the rung is not long-term eligible, the field is undeclared, or
   * the scope is not allowed for the field.
   */
  async set(input: MemorySetRequest): Promise<MemorySetResult> {
    if (!isLongTermEligible(input.confidence)) {
      throw new Error(
        `memory: confidence '${input.confidence}' is never written to long-term memory `
        + '(README §5: a single phrasing, a single task parameter, or the model\'s guess)',
      )
    }
    const observedAt = this.now()
    const declaration = requireField(input.namespace, input.key)
    const scope = assertScopeAllowed(declaration, input.scope, observedAt)
    const ttl = memoryTtlFor(scope, observedAt)
    const existing = this.rowsFor(input.namespace, input.key)
      .find(row => scopeKey(row.scope) === scopeKey(scope))
    const source: MemoryRecord['source'] = {
      source: SOURCE_FOR_RUNG[input.confidence] ?? 'explicit_user',
      ...input.session_ref === undefined ? {} : { session_ref: input.session_ref },
      observed_at: observedAt,
      ...input.quoted_fragment === undefined ? {} : { quoted_fragment: input.quoted_fragment.slice(0, 200) },
    }
    if (existing === undefined) {
      const created: DurableRow = {
        id: newMemoryId(),
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        ...input.details === undefined ? {} : { details: input.details },
        scope,
        source,
        confidence: input.confidence,
        updated_at: observedAt,
        expires_at: ttl.expiresAt,
        last_confirmed_at: observedAt,
        evidence: input.evidence,
      }
      await this.put(created)
      return { record: toRecordView(created), created: true }
    }
    const restated: DurableRow = {
      ...existing,
      value: input.value,
      ...input.details === undefined ? {} : { details: input.details },
      scope,
      source: existing.value === input.value && existing.source.quoted_fragment !== undefined
        && input.quoted_fragment === undefined
        ? existing.source
        : source,
      confidence: confidenceValue(input.confidence) > confidenceValue(existing.confidence)
        ? input.confidence
        : existing.confidence,
      updated_at: observedAt,
      expires_at: ttl.expiresAt,
      // A restatement is a new belief about the same field, so it clears a retirement: without
      // this, correcting a memory would poison the field forever, because the restated row would
      // inherit `retired_at` from the row it replaces and stay invisible to every read path.
      retired_at: null,
      last_confirmed_at: observedAt,
      evidence: input.evidence,
    }
    await this.put(restated)
    return { record: toRecordView(restated), created: false, merged_with: existing.id }
  }

  /**
   * Correct or restate one existing record (README §10.4). This is the tool
   * behind 修改, so it is also where a re-confirmation is resolved: the new value
   * becomes the confirmed one and the record's clock restarts.
   * @param input - the record id, the fields to change, and the required evidence.
   * @returns the updated record and the value it replaced.
   * @throws when the id is unknown, the new rung is not eligible, or the new scope
   * is not allowed for the field.
   */
  async update(input: MemoryUpdateRequest): Promise<MemoryUpdateResult> {
    const current = this.requireRecord(String(input.id))
    if (input.confidence !== undefined && !isLongTermEligible(input.confidence)) {
      throw new Error(`memory: confidence '${input.confidence}' is never written to long-term memory`)
    }
    const observedAt = this.now()
    const declaration = requireField(current.namespace, current.key)
    const scope = input.scope === undefined
      ? current.scope
      : assertScopeAllowed(declaration, input.scope, observedAt)
    const ttl = memoryTtlFor(scope, observedAt)
    const next: DurableRow = {
      ...current,
      ...input.value === undefined ? {} : { value: input.value },
      ...input.details === undefined ? {} : { details: input.details },
      ...input.confidence === undefined ? {} : { confidence: input.confidence },
      scope,
      source: {
        source: input.confidence === undefined
          ? current.source.source
          : SOURCE_FOR_RUNG[input.confidence] ?? current.source.source,
        ...current.source.session_ref === undefined ? {} : { session_ref: current.source.session_ref },
        observed_at: observedAt,
        ...current.source.quoted_fragment === undefined
          ? {}
          : { quoted_fragment: current.source.quoted_fragment },
      },
      updated_at: observedAt,
      expires_at: ttl.expiresAt,
      // 修改 is the teacher restating the field, so it revives a retired row for the same reason a
      // restatement does: the new value is a new belief, not an echo of the corrected-away one.
      retired_at: null,
      last_confirmed_at: observedAt,
      evidence: input.evidence,
    }
    await this.put(next)
    return { record: toRecordView(next), previous_value: current.value }
  }

  /**
   * Delete memories (README §10.5). Deletion is irreversible, so the caller must
   * pass `confirm: true`, and a call that names nothing at all is refused rather
   * than treated as "delete everything".
   * @param input - the selector: an id, or a namespace with an optional key and scope.
   * @returns how many rows were deleted and their ids.
   * @throws when `confirm` is not true, or when the call names no record.
   */
  async forget(input: MemoryForgetInput): Promise<MemoryForgetResult> {
    if (input.confirm !== true) {
      throw new Error('memory_forget requires confirm: true; deletion is durable and irreversible')
    }
    if (input.id === undefined && input.namespace === undefined) {
      throw new Error('memory_forget requires an id, or a namespace with a key or scope')
    }
    const targets = this.all().filter(row => {
      if (input.id !== undefined) return row.id === input.id
      if (row.namespace !== input.namespace) return false
      if (input.key !== undefined && row.key !== input.key) return false
      if (input.scope !== undefined && scopeKey(row.scope) !== scopeKey(input.scope)) return false
      return true
    })
    const deletedIds: MemoryId[] = []
    for (const row of targets) {
      if (await this.tables.memories.delete(row.id)) deletedIds.push(row.id)
    }
    return { deleted: deletedIds.length, deleted_ids: deletedIds }
  }

  /**
   * Report wrong, outdated, or not-for-this-task memory (README §10.6, §13).
   *
   * The four signals have distinct, deliberate effects:
   *
   * - `correct` updates the record's value at `explicit_correction` and records the
   *   corrected value as a durable correction.
   * - `incorrect` records what was rejected and then RETIRES the contradicted row:
   *   the wrong value leaves retrieval permanently while the audit record of what
   *   was believed, and of the correction that withdrew it, survives. Retirement is
   *   deliberately not `expires_at`, which withdraws a value that may still hold and
   *   invites the teacher to re-confirm it.
   * - `outdated` withdraws the row by setting `expires_at` to now: retrieval hides
   *   it, and where the field's scope re-confirms, the teacher gets the field's
   *   re-confirmation prompt instead of a fresh question.
   * - `dont_use_this_time` sets `suppressed_for_session` and never touches the
   *   value �?the one-off stays a one-off (README §6.1).
   * @param input - the target, the signal, and the required evidence.
   * @returns the action taken, the affected record, and whether a durable
   * correction was written.
   */
  async feedback(input: MemoryFeedbackRequest): Promise<MemoryFeedbackResult> {
    const target = input.record_id === undefined
      ? this.firstMatch(input.namespace, input.key)
      : this.all().find(row => row.id === input.record_id)
    if (target === undefined) return { action: 'no_op', correction_recorded: false }
    const observedAt = this.now()
    if (input.signal === 'correct') {
      if (input.corrected_value === undefined) {
        throw new Error('memory_feedback with signal "correct" requires corrected_value')
      }
      const updated = await this.update({
        id: target.id,
        value: input.corrected_value,
        confidence: 'explicit_correction',
        evidence: input.evidence,
      })
      await this.recordCorrection(target, input.corrected_value, input.evidence, observedAt)
      return { action: 'corrected', record: updated.record, correction_recorded: true }
    }
    if (input.signal === 'incorrect') {
      await this.recordCorrection(target, input.corrected_value, input.evidence, observedAt)
      // Retire, do not delete. The wrong value must never be retrieved again, but the row is the
      // only record that it was once believed and why it was withdrawn, and the corrections
      // namespace depends on exactly that history.
      const retired = {
        ...target,
        retired_at: observedAt,
        updated_at: observedAt,
        evidence: input.evidence,
      }
      await this.put(retired)
      return { action: 'invalidated', record: toRecordView(retired), correction_recorded: true }
    }
    if (input.signal === 'outdated') {
      await this.put({ ...target, expires_at: observedAt, updated_at: observedAt, evidence: input.evidence })
      return { action: 'invalidated', record: toRecordView(target), correction_recorded: false }
    }
    await this.put({
      ...target,
      suppressed_for_session: input.session_ref ?? '',
      updated_at: observedAt,
      evidence: input.evidence,
    })
    return { action: 'suppressed_for_session', record: toRecordView(target), correction_recorded: false }
  }

  /**
   * Every Question Ledger row, newest answer first.
   * @returns the ledger rows.
   */
  ledgerEntries(): readonly QuestionLedgerEntry[] {
    return [...this.tables.ledger.entries()]
      .map(([, row]) => row as QuestionLedgerEntry)
      .sort((left, right) => right.last_confirmed.localeCompare(left.last_confirmed))
  }

  /**
   * The ledger row for one normalized question key.
   * @param questionKey - the normalized key, e.g. `profile.grades_taught`.
   * @returns the newest row for that key, or `undefined`.
   */
  ledgerEntry(questionKey: string): QuestionLedgerEntry | undefined {
    return this.ledgerEntries().find(row => row.question_key === questionKey)
  }

  /**
   * When a correction last contradicted one field.
   *
   * This is the ledger's invalidation evidence (README §9 rule 3): rather than
   * remembering a flag on the ledger row, the decision derives it from the durable
   * `corrections` rows, so a correction cannot be forgotten by a caller that skips
   * a step.
   * @param namespace - namespace the corrected value belongs to.
   * @param key - field name inside it.
   * @returns the ISO-8601 instant of the newest matching correction, or `undefined`.
   */
  correctionInstantFor(namespace: MemoryNamespace, key: string): string | undefined {
    return this.rowsFor('corrections', 'rejected_behavior')
      .filter(row => {
        const details: unknown = row.details
        if (details === null || typeof details !== 'object' || Array.isArray(details)) return false
        const fields = details as { readonly [key: string]: unknown }
        return fields['namespace'] === namespace && fields['key'] === key
      })
      .map(row => row.updated_at)
      .sort((left, right) => right.localeCompare(left))[0]
  }

  /**
   * Write one ledger row.
   * @param entry - the complete row to store.
   */
  async putLedgerEntry(entry: QuestionLedgerEntry): Promise<void> {
    await this.tables.ledger.put(entry.id, entry as StoredLedgerEntry)
  }

  /**
   * Persist one promoted record (README §11.5).
   * @param record - the record the promotion pipeline resolved.
   */
  async savePromoted(record: MemoryRecord): Promise<void> {
    await this.put(record)
  }

  /**
   * Stamp the domain global with the format version this store writes, once.
   * @param version - the domain format version, from `MEMORY_DOMAIN.version`.
   */
  async stampMeta(version: number): Promise<void> {
    const current = this.tables.meta.get()
    if (current.version === version && current.initialized_at !== INITIAL_MEMORY_META.initialized_at) return
    const now = this.now()
    await this.tables.meta.set({
      version,
      initialized_at: current.initialized_at === INITIAL_MEMORY_META.initialized_at
        ? now
        : current.initialized_at,
      updated_at: now,
    })
  }

  /** Write one record durably. */
  private async put(record: DurableRow): Promise<void> {
    await this.tables.memories.put(String(record.id), record as StoredMemory)
  }

  /** Read one record by id, failing loud when it is unknown. */
  private requireRecord(id: string): DurableRow {
    const row = this.all().find(candidate => candidate.id === id)
    if (row === undefined) throw new Error(`memory: no record '${id}'`)
    return row
  }

  /** Resolve one feedback target from a namespace/key pair, preferring the newest row. */
  private firstMatch(namespace: MemoryNamespace | undefined, key: string | undefined): DurableRow | undefined {
    if (namespace === undefined) return undefined
    return this.rowsFor(namespace, key ?? '')[0] ?? this.all()
      .filter(row => row.namespace === namespace)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]
  }

  /**
   * Write the durable correction a feedback signal implies (README §13.5).
   *
   * The rejected value keeps the record's own spelling, so the next session can
   * retrieve "不要�?PPT 讲整节课" rather than a paraphrase. A correction always
   * carries `explicit_correction` at full confidence, because the teacher is the
   * one who said the stored value was wrong.
   */
  private async recordCorrection(
    target: DurableRow,
    correctedValue: string | undefined,
    evidence: string,
    observedAt: string,
  ): Promise<void> {
    const rejected = this.rowsFor('corrections', 'rejected_behavior')[0]
    await this.put({
      id: rejected?.id ?? newMemoryId(),
      namespace: 'corrections',
      key: 'rejected_behavior',
      value: target.value,
      details: { namespace: target.namespace, key: target.key, record_id: String(target.id) },
      scope: { scope_type: 'stable' },
      source: { source: 'explicit_correction', observed_at: observedAt },
      confidence: 'explicit_correction',
      updated_at: observedAt,
      expires_at: null,
      last_confirmed_at: observedAt,
      evidence,
    })
    if (correctedValue === undefined) return
    const corrected = this.rowsFor('corrections', 'corrected_value')[0]
    await this.put({
      id: corrected?.id ?? newMemoryId(),
      namespace: 'corrections',
      key: 'corrected_value',
      value: correctedValue,
      details: { namespace: target.namespace, key: target.key },
      scope: { scope_type: 'stable' },
      source: { source: 'explicit_correction', observed_at: observedAt },
      confidence: 'explicit_correction',
      updated_at: observedAt,
      expires_at: null,
      last_confirmed_at: observedAt,
      evidence,
    })
  }
}
