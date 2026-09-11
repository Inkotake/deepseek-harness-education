/**
 * In-memory stand-ins for the two `storageDomain` handles the store reads.
 *
 * The store is written against `KvTable` / `DomainGlobal` (both type-only
 * imports), so its logic is testable without a storage backend and without a
 * Cordis context. The fakes implement the same synchronous-read /
 * await-the-write contract the real handles do
 * (`storage-domain/src/domain.ts:42-90`).
 *
 * @module @teacher-dsh/global-memory/tests/fakes
 */

import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { MemoryStore, type MemoryStoreTables } from '../src/store.ts'
import {
  INITIAL_MEMORY_META,
  type MemoryMeta,
  type StoredLedgerEntry,
  type StoredMemory,
} from '../src/records.ts'

/** One in-memory table with the real handle's read/write contract. */
export class FakeTable<K extends string, V> implements KvTable<K, V> {
  private readonly rows = new Map<string, V>()

  get(key: K): V | undefined {
    return this.rows.get(key)
  }

  entries(): IterableIterator<[K, V]> {
    return [...this.rows.entries()].map(([key, value]): [K, V] => [key as K, value])[Symbol.iterator]()
  }

  keys(): IterableIterator<K> {
    return [...this.rows.keys()].map(key => key as K)[Symbol.iterator]()
  }

  get size(): number {
    return this.rows.size
  }

  async put(key: K, value: V): Promise<void> {
    this.rows.set(key, value)
  }

  async delete(key: K): Promise<boolean> {
    return this.rows.delete(key)
  }

  async update(key: K, fn: (current: V) => V): Promise<V> {
    const current = this.rows.get(key)
    if (current === undefined) throw new Error(`fake table has no record '${key}'`)
    const next = fn(current)
    this.rows.set(key, next)
    return next
  }
}

/** One in-memory domain global. */
export class FakeGlobal<G> implements DomainGlobal<G> {
  private value: G

  constructor(initial: G) {
    this.value = initial
  }

  get(): G {
    return this.value
  }

  async set(value: G): Promise<void> {
    this.value = value
  }
}

/** A store plus the tables it writes to. */
export interface FakeStore {
  readonly store: MemoryStore
  readonly tables: MemoryStoreTables
}

/**
 * Build one store over empty in-memory handles.
 * @param clock - instant source; defaults to a fixed 2026 instant so TTL tests are
 * deterministic.
 * @returns the store and its tables.
 */
export function makeStore(clock: () => string = () => '2026-09-07T01:20:00.000Z'): FakeStore {
  const tables: MemoryStoreTables = {
    memories: new FakeTable<string, StoredMemory>(),
    ledger: new FakeTable<string, StoredLedgerEntry>(),
    meta: new FakeGlobal<MemoryMeta>(INITIAL_MEMORY_META),
  }
  return { store: new MemoryStore(tables, { clock }), tables }
}

/**
 * A clock that advances on demand.
 * @param startIso - the instant the clock starts at.
 * @returns the clock function and a setter for the current instant.
 */
export function movableClock(startIso: string): { readonly now: () => string; readonly set: (iso: string) => void } {
  let current = startIso
  return {
    now: () => current,
    set: (iso: string) => {
      current = iso
    },
  }
}
