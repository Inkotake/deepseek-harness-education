/**
 * Conflict priority (README §6): the plan's precedence ladder, verbatim
 * 当前用户明确表达 > 当前项目配置 > 本学年配置 > 长期用户画像 > 行为推断 > 模型默认.
 *
 * Two things this module refuses to do:
 *
 * - It never merges two ranks into one number. `MEMORY_CONFLICT_PRIORITY` is the
 *   only ordering, and `rankOf` maps a durable record onto one of its rows.
 * - It never lets a resolution imply a write. `durableRecordPreserved` is the
 *   flag the caller must honour by *not* calling `memory_update` on the durable
 *   row; the ephemeral winner reaches the model through the step injection
 *   (README §6.1, §8).
 *
 * @module @teacher-dsh/global-memory/src/conflict
 */

import {
  MEMORY_CONFLICT_PRIORITY,
  type MemoryConflictCandidate,
  type MemoryConflictResolution,
  type MemoryConfidence,
  type MemoryNamespace,
  type MemoryPriorityRank,
  type MemoryRecord,
  type MemoryScope,
  type MemoryScopeType,
  type MemorySource,
} from '../schema.ts'

/** A record-like input to ranking; both durable rows and candidates provide this. */
export interface Rankable {
  /** Namespace the value belongs to. */
  readonly namespace: MemoryNamespace
  /** Ladder rung the value was written with. */
  readonly confidence: MemoryConfidence
  /** Where the value came from, when the provenance is known. */
  readonly source?: MemorySource
  /** Lifetime declaration of the value. */
  readonly scope: MemoryScope
}

/** Scope types that describe the school year in progress rather than a durable trait. */
const SCHOOL_YEAR_SCOPES: readonly MemoryScopeType[] = ['school_year', 'term', 'class']

/** Rungs that are a behaviour inference rather than a stated fact. */
const INFERRED_RUNGS: readonly MemoryConfidence[] = ['repeated_behavior', 'strong_inference']

/**
 * Position of one rank in the precedence ladder.
 * @param rank - the rank to locate.
 * @returns the index in `MEMORY_CONFLICT_PRIORITY`; 0 wins.
 */
export function priorityIndex(rank: MemoryPriorityRank): number {
  return MEMORY_CONFLICT_PRIORITY.indexOf(rank)
}

/**
 * The plan's rank for one recorded value.
 *
 * A correction outranks everything durable, including a school-year or project
 * configuration: README §3 makes `corrections` "a promise" and the plan requires
 * that 用户纠正过一次的问题，不应再发生第二次.
 *
 * An inferred rung is ranked before the scope is consulted, so an inferred value
 * can never claim 当前项目配置 or 本学年配置 — those two ranks belong to what the
 * teacher stated, and the ladder puts 行为推断 below both. Everything else follows
 * the ladder literally: project scope is 当前项目配置, school-year/term/class scope
 * is 本学年配置, and a stable value about the teacher is 长期用户画像.
 * @param value - the record or candidate to rank.
 * @returns the plan's rank for that value.
 */
export function rankOf(value: Rankable): MemoryPriorityRank {
  if (value.namespace === 'corrections' || value.source === 'explicit_correction'
    || value.confidence === 'explicit_correction') {
    return 'current_explicit_user'
  }
  if (INFERRED_RUNGS.includes(value.confidence)) return 'behavior_inference'
  if (value.scope.scope_type === 'project') return 'current_project_config'
  if (SCHOOL_YEAR_SCOPES.includes(value.scope.scope_type)) return 'current_school_year_config'
  if (value.namespace === 'profile' || value.namespace === 'environment' || value.namespace === 'preferences') {
    return 'long_term_user_profile'
  }
  return 'model_default'
}

/**
 * Project one durable record onto the ladder.
 * @param record - the durable record.
 * @returns a candidate carrying the record's rank, value, and id.
 */
export function candidateOfRecord(record: MemoryRecord): MemoryConflictCandidate {
  return {
    rank: rankOf({
      namespace: record.namespace,
      confidence: record.confidence,
      source: record.source.source,
      scope: record.scope,
    }),
    value: record.value,
    record_id: record.id,
  }
}

/**
 * Rank candidates and pick the winner.
 *
 * Ties keep the caller's order: a higher-priority *instruction* ("this lesson is
 * 35 minutes") and the durable value it overrides can share a rank, and the
 * caller supplies the current statement first. `durableRecordPreserved` is true
 * exactly when the winner is ephemeral and some durable candidate carries a
 * different value — the case where the durable row must be left alone.
 * @param candidates - every value that bears on one decision, current statement first.
 * @returns the winner, the full ranked list, and whether a durable row is preserved.
 * @throws when no candidate is supplied, because an empty resolution has no winner.
 */
export function resolveConflict(
  candidates: readonly MemoryConflictCandidate[],
): MemoryConflictResolution {
  const first = candidates[0]
  if (first === undefined) {
    throw new Error('memory: a conflict resolution needs at least one candidate')
  }
  const ranked = [...candidates].sort(
    (left, right) => priorityIndex(left.rank) - priorityIndex(right.rank),
  )
  const winner = ranked[0] ?? first
  const durableRecordPreserved = winner.ephemeral === true
    && ranked.some(candidate => candidate.ephemeral !== true && candidate.value !== winner.value)
  return {
    winner: winner.rank,
    value: winner.value,
    ranked,
    durableRecordPreserved,
  }
}

/**
 * Rank one candidate the caller supplies as an ephemeral, current-task value.
 * @param rank - the rank the caller claims.
 * @param value - the value that holds for this task only.
 * @returns an ephemeral candidate.
 */
export function ephemeralCandidate(rank: MemoryPriorityRank, value: string): MemoryConflictCandidate {
  return { rank, value, ephemeral: true }
}
