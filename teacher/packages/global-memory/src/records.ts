/**
 * Durable record schemas: the zod projection of `schema.ts`'s record types that
 * `storageDomain` validates every stored row against (README §12).
 *
 * `schema.ts` stays the authoritative contract; these schemas only restate it in
 * the form the durable boundary accepts (zod, per `storage-domain/src/spec.ts`).
 * Two declared fields need a durable spelling a zod schema can express, so the
 * stored types below widen exactly those and nothing else:
 *
 * - `MemoryRecord.id` and `QuestionLedgerEntry.promoted_memory_id` are branded
 *   strings in `schema.ts`; the medium stores plain strings.
 * - `StoredMemory.evidence` is the one field this package adds. `memory_set`,
 *   `memory_update`, and `memory_feedback` each require an `evidence` sentence
 *   (README §10.3: "every durable write is justifiable after the fact"), but
 *   `MemoryRecord` declares no field to hold one. The sentence is therefore kept
 *   on the durable row and never projected to the model. `MOUNT.md` records this
 *   as a known gap in `schema.ts`.
 *
 * @module @teacher-dsh/global-memory/src/records
 */

import { z } from 'zod'
import {
  MEMORY_NAMESPACES,
  type MemoryConfidence,
  type MemoryRecord,
  type MemoryScopeType,
  type MemorySource,
  type QuestionAnswerSource,
  type QuestionLedgerEntry,
} from '../schema.ts'

/** Refuse a widening helper whose inferred type does not match the declared one. */
type Extends<Inferred extends Declared, Declared> = true

const SCOPE_TYPES = [
  'stable',
  'school_year',
  'term',
  'project',
  'class',
  'session',
] as const satisfies readonly MemoryScopeType[]

const CONFIDENCE_RUNGS = [
  'explicit_user',
  'explicit_correction',
  'repeated_behavior',
  'strong_inference',
  'weak_inference',
] as const satisfies readonly MemoryConfidence[]

const MEMORY_SOURCES = [
  'explicit_user',
  'explicit_correction',
  'repeated_behavior',
  'strong_inference',
  'project_config',
  'school_year_config',
  'migrated',
] as const satisfies readonly MemorySource[]

const ANSWER_SOURCES = [
  'user_explicit',
  'user_choice',
  'user_skipped',
  'memory_hit',
  'safe_default',
] as const satisfies readonly QuestionAnswerSource[]

/** Lifetime declaration of one stored value. */
export const memoryScopeSchema = z.object({
  scope_type: z.enum(SCOPE_TYPES),
  valid_for: z.string().optional(),
  project_id: z.string().optional(),
  class_id: z.string().optional(),
})

/** Provenance of one stored value, including the evidence locator. */
export const memorySourceRefSchema = z.object({
  source: z.enum(MEMORY_SOURCES),
  session_ref: z.string().optional(),
  observed_at: z.string(),
  quoted_fragment: z.string().optional(),
})

/**
 * One durable memory row.
 *
 * `weak_inference` is accepted here on purpose. The schema describes the stored
 * form of the declared record type, and rejecting a rung at the durable boundary
 * would turn one bad row into a failing domain open (`storage-domain` rejects the
 * whole open on an invalid record). The promotion gate is enforced where the
 * decision is made instead — `MemoryStore.set` refuses the rung outright.
 */
export const memoryRecordSchema = z.object({
  id: z.string(),
  namespace: z.enum(MEMORY_NAMESPACES),
  key: z.string(),
  value: z.string(),
  details: z.json().optional(),
  scope: memoryScopeSchema,
  source: memorySourceRefSchema,
  confidence: z.enum(CONFIDENCE_RUNGS),
  updated_at: z.string(),
  expires_at: z.string().nullable(),
  last_confirmed_at: z.string().optional(),
  user_pinned: z.boolean().optional(),
  suppressed_for_session: z.string().optional(),
  tags: z.array(z.string()).optional(),
  evidence: z.string().optional(),
})

/** One durable Question Ledger row. */
export const questionLedgerEntrySchema = z.object({
  id: z.string(),
  question_key: z.string(),
  asked: z.string(),
  answer: z.string().optional(),
  answer_source: z.enum(ANSWER_SOURCES),
  last_confirmed: z.string(),
  scope: memoryScopeSchema,
  valid_until: z.string().optional(),
  asked_count: z.number().int(),
  promoted_memory_id: z.string().optional(),
})

/**
 * The domain global. `storageDomain` requires a non-nullable global schema
 * (README §12), so this is a real record rather than an optional slot.
 */
export const memoryMetaSchema = z.object({
  /** Domain format version this store was written by. */
  version: z.number().int(),
  /** ISO-8601 instant of the first write to this domain. */
  initialized_at: z.string(),
  /** ISO-8601 instant of the last write to this domain. */
  updated_at: z.string(),
})

/** The value stored in the domain global before the first write. */
export const INITIAL_MEMORY_META: MemoryMeta = {
  version: 0,
  initialized_at: '1970-01-01T00:00:00.000Z',
  updated_at: '1970-01-01T00:00:00.000Z',
}

/** Stored form of one `MemoryRecord`. */
export type StoredMemory = Omit<MemoryRecord, 'id'> & {
  readonly id: string
  /** The justification sentence the writing tool was required to supply. */
  readonly evidence?: string
}

/** Stored form of one `QuestionLedgerEntry`. */
export type StoredLedgerEntry = Omit<QuestionLedgerEntry, 'promoted_memory_id'> & {
  readonly promoted_memory_id?: string
}

/** Typed view of the domain global. */
export type MemoryMeta = z.infer<typeof memoryMetaSchema>

/* Compile-time proof that each durable schema describes the declared record type. */
const _memoryRecordSchemaMatchesDeclaredRecord: Extends<z.infer<typeof memoryRecordSchema>, StoredMemory> = true
const _ledgerEntrySchemaMatchesDeclaredEntry: Extends<z.infer<typeof questionLedgerEntrySchema>, StoredLedgerEntry> = true
const _metaSchemaMatchesDeclaredMeta: Extends<z.infer<typeof memoryMetaSchema>, MemoryMeta> = true

/* Compile-time proof that each enum tuple covers its declared union exhaustively. */
type Covers<Union extends Member, Member> = true
const _scopeTypesCoverDeclaredUnion: Covers<MemoryScopeType, (typeof SCOPE_TYPES)[number]> = true
const _confidenceRungsCoverDeclaredUnion: Covers<MemoryConfidence, (typeof CONFIDENCE_RUNGS)[number]> = true
const _sourcesCoverDeclaredUnion: Covers<MemorySource, (typeof MEMORY_SOURCES)[number]> = true
const _answerSourcesCoverDeclaredUnion: Covers<QuestionAnswerSource, (typeof ANSWER_SOURCES)[number]> = true
