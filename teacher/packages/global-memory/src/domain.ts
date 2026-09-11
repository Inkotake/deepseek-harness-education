/**
 * The `storageDomain` declaration this service opens (README §12).
 *
 * One domain, two tables, one global: `memories` (one row per `(namespace, key,
 * scope)`), `question_ledger` (one row per asked question), and a `meta` global
 * that is required rather than optional because `storageDomain` rejects a
 * nullable global (`storage-domain/src/spec.ts:140-145`). The name and version
 * come from `MEMORY_DOMAIN`, so the domain identity lives in exactly one place.
 *
 * `defineDomain` validates the spec at module load: the domain name and both
 * table names must match `UNIT_NAME_RE` (`^[a-z][a-z0-9_]*$`), the version must
 * be a non-negative integer, and the global schema must not accept `null`.
 *
 * @module @teacher-dsh/global-memory/src/domain
 */

import { defineDomain, domainTable, type TableValueOf } from '@deepseek-ai/dsh-storage-domain'
import { MEMORY_DOMAIN } from '../schema.ts'
import {
  INITIAL_MEMORY_META,
  memoryMetaSchema,
  memoryRecordSchema,
  questionLedgerEntrySchema,
  type StoredLedgerEntry,
  type StoredMemory,
} from './records.ts'

/** Refuse a widening helper whose inferred type does not match the declared one. */
type Extends<Inferred extends Declared, Declared> = true

/**
 * The opened domain declaration. `openSpec()` hands this to
 * `ctx.storageDomain.open()`; nothing else may open a domain named
 * `MEMORY_DOMAIN.name`, because the facility refuses a second open of one name.
 */
export const memoryDomainSpec = defineDomain({
  name: MEMORY_DOMAIN.name,
  version: MEMORY_DOMAIN.version,
  global: {
    schema: memoryMetaSchema,
    initial: INITIAL_MEMORY_META,
  },
  tables: {
    [MEMORY_DOMAIN.tables.memories]: domainTable(memoryRecordSchema),
    [MEMORY_DOMAIN.tables.question_ledger]: domainTable(questionLedgerEntrySchema),
  },
})

/** The opened domain handle, as `DomainFacility.open` returns it. */
export type MemoryDomain = Domain<typeof memoryDomainSpec>

/** Value type stored in the `memories` table, recovered from the spec. */
export type MemoriesTableValue = TableValueOf<typeof memoryDomainSpec, typeof MEMORY_DOMAIN.tables.memories>

/** Value type stored in the `question_ledger` table, recovered from the spec. */
export type LedgerTableValue = TableValueOf<
  typeof memoryDomainSpec,
  typeof MEMORY_DOMAIN.tables.question_ledger
>

/* Compile-time proof that the spec's table value types are the stored record types. */
const _memoriesTableValueIsStoredMemory: Extends<MemoriesTableValue, StoredMemory> = true
const _ledgerTableValueIsStoredEntry: Extends<LedgerTableValue, StoredLedgerEntry> = true
