/**
 * Identity helpers for durable memory records and Question Ledger entries.
 *
 * Record ids are opaque and local to this store: the durable rows are keyed by
 * them, they are the only handle the six tools accept for `memory_update`,
 * `memory_forget`, and `memory_feedback`, and they never encode the namespace,
 * the key, or the scope. `schema.ts` brands the two id types, so the minting
 * happens here and the single cast is what turns a uuid into the branded form
 * (README §15 item 5 records the local-brand decision).
 *
 * @module @teacher-dsh/global-memory/src/ids
 */

import { randomUUID } from 'node:crypto'
import type { MemoryCandidateId, MemoryId } from '../schema.ts'

/**
 * Mint a stable memory record id.
 * @returns a fresh id prefixed with `mem_`.
 */
export function newMemoryId(): MemoryId {
  return `mem_${randomUUID().replaceAll('-', '')}` as MemoryId
}

/**
 * Mint the identity of one promotion candidate.
 * @returns a fresh id prefixed with `cand_`.
 */
export function newCandidateId(): MemoryCandidateId {
  return `cand_${randomUUID().replaceAll('-', '')}` as MemoryCandidateId
}

/**
 * Mint a Question Ledger row id.
 * @returns a fresh id prefixed with `ql_`.
 */
export function newLedgerEntryId(): string {
  return `ql_${randomUUID().replaceAll('-', '')}`
}
