/**
 * The Question Ledger (README §9): `Never ask twice unless the old answer may no
 * longer be valid.`
 *
 * This module owns the *decision*, not the asking. GrabMe owns the budget and the
 * wording; the ledger owns whether a question may be put at all, and what a
 * previously answered question becomes once its answer stops being valid. Three
 * rules are enforced here rather than left to the caller:
 *
 * 1. A `safe_default` answer is an answer. It is recorded, and it is not re-asked
 *    as if the teacher had never been asked (plan: 不知道，你帮我选 是正常路径).
 * 2. An expired answer produces a RE-CONFIRMATION carrying the previous value as
 *    the default — never the original open question.
 * 3. A correction the teacher made invalidates the ledger entry it contradicts, so
 *    a single re-ask is forced instead of the ledger asserting an overruled value.
 *
 * @module @teacher-dsh/global-memory/src/question-ledger
 */

import {
  memoryTtlFor,
  reconfirmationFor,
  type MemoryId,
  type MemoryNamespace,
  type MemoryReconfirmation,
  type MemoryRecord,
  type MemoryScope,
  type QuestionAnswerSource,
  type QuestionLedgerDecision,
  type QuestionLedgerEntry,
} from '../schema.ts'
import { newLedgerEntryId } from './ids.ts'

/**
 * The normalized key a question joins on (README §9: `profile.grades_taught`).
 * @param namespace - namespace the answer belongs to.
 * @param key - field name inside it.
 * @returns the normalized question key.
 */
export function questionKeyOf(namespace: MemoryNamespace, key: string): string {
  return `${namespace}.${key}`
}

/**
 * When one answer stops being valid.
 * @param scope - the scope the answer was valid for.
 * @param fromIso - instant the answer was recorded at.
 * @returns the expiry instant, or `undefined` for a scope that never expires.
 */
export function ledgerValidUntil(scope: MemoryScope, fromIso: string): string | undefined {
  return memoryTtlFor(scope, fromIso).expiresAt ?? undefined
}

/** Inputs to the "may I ask this again?" decision. */
export interface AskDecisionInput {
  /** The normalized key the question joins on. */
  readonly questionKey: string
  /** The prior ledger row for that key, when one exists. */
  readonly entry?: QuestionLedgerEntry
  /** Instant the decision is made at. */
  readonly nowIso: string
  /**
   * Instant a correction contradicting this question was recorded. Derived from
   * the store's `corrections` rows, not remembered in the ledger, so a correction
   * cannot be forgotten by a caller.
   */
  readonly correctedAt?: string
  /** The re-confirmation to offer when the prior answer expired. */
  readonly reconfirm?: MemoryReconfirmation
  /** True when the caller's ask budget for this task is spent. */
  readonly askBudgetExhausted?: boolean
}

/**
 * Decide whether one question may be asked again.
 * @param input - the prior entry, the instant, and the invalidation evidence.
 * @returns the decision, with `reconfirm` present exactly when the reason is
 * `answer_expired` and a re-confirmation was supplied.
 */
export function askDecision(input: AskDecisionInput): QuestionLedgerDecision {
  const base = baseDecision(input)
  if (base.mayAsk && input.askBudgetExhausted === true) {
    return {
      mayAsk: false,
      reason: 'ask_budget_exhausted',
      ...input.entry === undefined ? {} : { entry: input.entry },
    }
  }
  return base
}

/** The decision before the ask budget is applied. */
function baseDecision(input: AskDecisionInput): QuestionLedgerDecision {
  const entry = input.entry
  if (entry === undefined) return { mayAsk: true, reason: 'never_asked' }
  // A correction outranks expiry: the teacher overruled the answer on purpose, so
  // the reason must name that, not a clock. A correction stamped at the very same
  // instant as the answer still counts — it can only have been recorded after it —
  // while a correction from before the answer leaves the answer standing.
  if (input.correctedAt !== undefined && input.correctedAt >= entry.last_confirmed) {
    return { mayAsk: true, reason: 'answer_invalidated_by_correction', entry }
  }
  if (entry.valid_until !== undefined && Date.parse(entry.valid_until) <= Date.parse(input.nowIso)) {
    return {
      mayAsk: false,
      reason: 'answer_expired',
      entry,
      ...input.reconfirm === undefined ? {} : { reconfirm: input.reconfirm },
    }
  }
  if (entry.answer_source === 'safe_default') {
    return { mayAsk: false, reason: 'answered_by_safe_default', entry }
  }
  return { mayAsk: false, reason: 'already_answered_and_still_valid', entry }
}

/**
 * The plan's pre-question checklist: ① current message ② Session State ③ Memory
 * ④ Question Ledger (plan §四 P0-2, `TEACHER-MODE-PLAN.md:79`).
 *
 * The order is the whole point: a question the current message already answers is
 * never asked, and the ledger is consulted last, only for what none of the first
 * three checks settled.
 */
export interface PreQuestionChecklist {
  /** ① What the teacher just said, when it answers this question. */
  readonly currentMessage?: { readonly value: string }
  /** ② This task's parameters, when Session State already holds the answer. */
  readonly sessionState?: { readonly value: string }
  /** ③ What long-term memory holds for this question, with its expiry state. */
  readonly memory?: {
    readonly record: MemoryRecord
    readonly expired: boolean
  }
  /** ④ The ledger consultation, when a prior answer exists. */
  readonly ledger?: AskDecisionInput
  /** Instant the checklist is evaluated at. */
  readonly nowIso: string
}

/** Where a checklist consultation ended. */
export type ChecklistSettlement = 'current_message' | 'session_state' | 'memory' | 'question_ledger' | 'none'

/** Result of one pre-question checklist. */
export interface QuestionChecklistOutcome {
  /** Whether the question may be put, and why. */
  readonly decision: QuestionLedgerDecision
  /** Which check settled it, in the plan's order; `none` when nothing did. */
  readonly settled_by: ChecklistSettlement
  /** The value that answers the question, when one was found. */
  readonly answer?: string
}

/**
 * Run the checklist for one question.
 * @param checklist - what the first three checks know, plus the ledger consultation.
 * @returns the decision, which check settled it, and the answer found.
 */
export function runPreQuestionChecklist(checklist: PreQuestionChecklist): QuestionChecklistOutcome {
  if (checklist.currentMessage !== undefined) {
    return {
      decision: { mayAsk: false, reason: 'already_answered_and_still_valid' },
      settled_by: 'current_message',
      answer: checklist.currentMessage.value,
    }
  }
  if (checklist.sessionState !== undefined) {
    return {
      decision: { mayAsk: false, reason: 'already_answered_and_still_valid' },
      settled_by: 'session_state',
      answer: checklist.sessionState.value,
    }
  }
  const memory = checklist.memory
  if (memory !== undefined) {
    if (!memory.expired) {
      return {
        decision: { mayAsk: false, reason: 'already_answered_and_still_valid' },
        settled_by: 'memory',
        answer: memory.record.value,
      }
    }
    // An expired value is retrieved and offered back as a default; the question
    // itself is not re-asked (README §7.2).
    const reconfirm = reconfirmationFor(memory.record, checklist.nowIso)
    return {
      decision: {
        mayAsk: false,
        reason: 'answer_expired',
        ...reconfirm === undefined ? {} : { reconfirm },
      },
      settled_by: 'memory',
    }
  }
  if (checklist.ledger !== undefined) {
    return { decision: askDecision(checklist.ledger), settled_by: 'question_ledger' }
  }
  return { decision: { mayAsk: true, reason: 'never_asked' }, settled_by: 'none' }
}

/** What one answer write must state. */
export interface LedgerAnswerWrite {
  /** The normalized question key. */
  readonly questionKey: string
  /** What was asked, in the teacher's language. */
  readonly asked: string
  /** The answer as stored; absent only for `user_skipped`. */
  readonly answer?: string
  /** Where the answer came from. */
  readonly answerSource: QuestionAnswerSource
  /** The scope the answer is valid for. */
  readonly scope: MemoryScope
  /** Instant the answer was given. */
  readonly nowIso: string
  /** Memory record the answer produced, when it was promoted. */
  readonly promotedMemoryId?: MemoryId
}

/**
 * Build the ledger row for one answer, reusing the prior row's identity when the
 * question was asked before.
 * @param previous - the prior row for this question key, when one exists.
 * @param write - the answer.
 * @returns the row to store.
 */
export function nextLedgerEntry(
  previous: QuestionLedgerEntry | undefined,
  write: LedgerAnswerWrite,
): QuestionLedgerEntry {
  // A `memory_hit` answer was retrieved, not asked, so it must not inflate the
  // §七 Ask Rate observable.
  const asked = write.answerSource !== 'memory_hit'
  const validUntil = ledgerValidUntil(write.scope, write.nowIso)
  return {
    id: previous?.id ?? newLedgerEntryId(),
    question_key: write.questionKey,
    asked: write.asked,
    ...write.answer === undefined ? {} : { answer: write.answer },
    answer_source: write.answerSource,
    last_confirmed: write.nowIso,
    scope: write.scope,
    ...validUntil === undefined ? {} : { valid_until: validUntil },
    asked_count: (previous?.asked_count ?? 0) + (asked ? 1 : 0),
    ...write.promotedMemoryId === undefined ? {} : { promoted_memory_id: write.promotedMemoryId },
  }
}

/**
 * Attach the memory record an answer produced to its ledger row (README §11.5).
 * @param entry - the row to update.
 * @param memoryId - the promoted record's id.
 * @returns the updated row.
 */
export function withPromotedMemory(entry: QuestionLedgerEntry, memoryId: MemoryId): QuestionLedgerEntry {
  return { ...entry, promoted_memory_id: memoryId }
}
