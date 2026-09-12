/**
 * `dsh-global-memory` — the shared long-term memory service for every
 * teacher/research/coding preset (README, plan §四 P0-3).
 *
 * The service opens one `storageDomain`, registers exactly six model-facing
 * tools, contributes the tiny standing profile through the prompt registry, and
 * injects the per-task retrieval through the `agent/pre-step` waterfall. It is a
 * Cordis `Service`, so the process holds **one** instance that every preset
 * shares (`super(ctx, 'globalMemory')`): README §12.1 requires exactly that, and a
 * realm-per-preset instance would give each preset its own memory.
 *
 * It is not mounted from this package. The host-plane row belongs in a
 * desktop-owned patch layer over `packages/bundle/base/cordis.patch.yml`, which
 * lives inside the pinned upstream submodule; `MOUNT.md` carries the exact
 * `- insert:` snippet and names applying it as the integrator's step.
 *
 * @module @teacher-dsh/global-memory
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import {
  MEMORY_DOMAIN,
  isExpired,
  isRetired,
  reconfirmationFor,
  type MemoryId,
  type MemoryNamespace,
  type MemoryScope,
  type QuestionAnswerSource,
  type QuestionLedgerEntry,
} from '../schema.ts'
import { memoryDomainSpec } from './domain.ts'
import { digestOf, memoryContextMessage, taskTextOf } from './messages.ts'
import {
  nextLedgerEntry,
  questionKeyOf,
  runPreQuestionChecklist,
  type PreQuestionChecklist,
  type QuestionChecklistOutcome,
} from './question-ledger.ts'
import { renderMemoryContext, renderStandingProfile, selectForTask, type RetrievalOutcome } from './retrieval.ts'
import { MemoryStore, type MemoryStoreTables } from './store.ts'
import { memoryToolDefinitions } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    globalMemory: GlobalMemory
  }
}

/** Name of the always-injected standing-profile prompt section. */
export const STANDING_PROFILE_SECTION = 'teacher-memory-profile'

/**
 * Default sort order of the standing-profile section.
 *
 * `SECTION_ORDERS` in `core/system-prompt/src/index.ts:121-154` allocates a
 * position for every repository section and nothing for memory; the lowest
 * allocated policy position is `PLAN_POLICY: 500`, and the persona prefix sits at
 * `0`. A memory section therefore has to choose a number, and it chooses to sit
 * directly behind the persona as deployment-provided identity rather than
 * runtime policy. Allocating a named `MEMORY_PROFILE` entry upstream is the
 * integrator's step; until then this is a validated `Config` field so a
 * deployment can move it without editing code.
 */
export const DEFAULT_STANDING_PROFILE_SECTION_ORDER = 10

/** Plugin configuration. */
export interface Config {
  /** Sort order of the standing-profile section; defaults to {@link DEFAULT_STANDING_PROFILE_SECTION_ORDER}. */
  standingProfileSectionOrder?: number
  /** Whether the per-step retrieval injection is enabled; defaults to true. */
  injectRetrievedMemory?: boolean
}

/** Validated plugin configuration. */
export const Config: z<Config> = z.object({
  standingProfileSectionOrder: z.number().default(DEFAULT_STANDING_PROFILE_SECTION_ORDER),
  injectRetrievedMemory: z.boolean().default(true),
})

/** One field a caller wants to ask the teacher about. */
export interface QuestionRequest {
  /** Namespace the answer belongs to. */
  readonly namespace: MemoryNamespace
  /** Field name inside it. */
  readonly key: string
  /** What would be asked, in the teacher's language. */
  readonly asked: string
  /** ① The teacher's current message, when it already answers the question. */
  readonly currentMessage?: string
  /** ② This task's parameters, when Session State already holds the answer. */
  readonly sessionState?: string
  /** True when the caller's ask budget for this task is spent. */
  readonly askBudgetExhausted?: boolean
  /** Instant to evaluate at; defaults to now. */
  readonly nowIso?: string
}

/** One answer to record in the ledger. */
export interface AnswerRequest {
  /** Namespace the answer belongs to. */
  readonly namespace: MemoryNamespace
  /** Field name inside it. */
  readonly key: string
  /** What was asked, in the teacher's language. */
  readonly asked: string
  /** The answer as stored; absent only for `user_skipped`. */
  readonly answer?: string
  /** Where the answer came from. */
  readonly answerSource: QuestionAnswerSource
  /** What the answer is valid for; defaults to the field's record scope, then a school year. */
  readonly scope?: MemoryScope
  /** True when the answer was promoted into a durable memory record. */
  readonly promotedMemoryId?: MemoryId
}

/**
 * The shared long-term memory service.
 *
 * Consumers reach it as `ctx.globalMemory`: GrabMe uses {@link GlobalMemory.consultQuestion}
 * and {@link GlobalMemory.recordAnswer} for the plan's ③ Memory / ④ Question
 * Ledger checks, and {@link GlobalMemory.retrieve} for conditional retrieval
 * outside the step listener.
 */
export class GlobalMemory extends Service {
  /** The storage domain and the tool registry must be present before the service opens. */
  static inject = ['storageDomain', 'tools', 'systemPrompt']

  /** Validated plugin configuration. */
  static Config: z<Config> = Config

  private tables?: MemoryStoreTables
  private store?: MemoryStore
  private readonly injectedDigests = new WeakMap<object, string>()
  private readonly options: Required<Config>

  /**
   * @param ctx - the owning context.
   * @param config - validated configuration.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'globalMemory')
    this.options = {
      standingProfileSectionOrder: config.standingProfileSectionOrder ?? DEFAULT_STANDING_PROFILE_SECTION_ORDER,
      injectRetrievedMemory: config.injectRetrievedMemory ?? true,
    }
  }

  /** Open the domain, register the six tools, and attach the two model-visible contributions. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(memoryDomainSpec)
    // The caller owns the handle (README §12): closing it is this plugin's effect,
    // so an unload releases the domain name for a later open.
    this.ctx.effect(() => () => domain.close(), 'globalMemory.domainClose')
    this.tables = {
      memories: domain.table(MEMORY_DOMAIN.tables.memories),
      ledger: domain.table(MEMORY_DOMAIN.tables.question_ledger),
      meta: domain.global,
    }
    const store = new MemoryStore(this.tables)
    this.store = store
    await store.stampMeta(MEMORY_DOMAIN.version)

    for (const tool of memoryToolDefinitions({ store })) {
      this.ctx.effect(() => this.ctx.tools.register(tool), `globalMemory.tool.${tool.name}`)
    }

    // The one unconditional contribution: three stable fields, bounded to 200
    // characters, identical for every step, so it is safe as a prompt section.
    this.ctx.systemPrompt.section({
      name: STANDING_PROFILE_SECTION,
      order: this.options.standingProfileSectionOrder,
      text: () => this.standingProfileText(),
    })

    if (this.options.injectRetrievedMemory) this.attachRetrievalInjection()
  }

  /**
   * Retrieve the memories one task needs, without injecting them.
   * @param taskText - what the teacher asked for.
   * @param options - optional session and cap overrides.
   * @returns the retrieval outcome, including the exclusions the rule made.
   */
  retrieve(taskText: string, options: { readonly sessionRef?: string; readonly limit?: number } = {}): RetrievalOutcome {
    const store = this.requireStore()
    return selectForTask({
      taskText,
      rows: store.all(),
      nowIso: store.now(),
      ...options.sessionRef === undefined ? {} : { session_ref: options.sessionRef },
      ...options.limit === undefined ? {} : { limit: options.limit },
    })
  }

  /**
   * Run the plan's four pre-question checks for one field (plan §四 P0-2:
   * ① current message ② Session State ③ Memory ④ Question Ledger).
   *
   * The invalidation evidence is derived, not remembered: a durable correction
   * that contradicts this field makes the ledger entry invalid, so the question is
   * re-asked once and the ledger stops asserting the value the teacher overruled.
   * @param request - the field and what the first two checks know.
   * @returns the decision, which check settled it, and the answer found.
   */
  consultQuestion(request: QuestionRequest): QuestionChecklistOutcome {
    const store = this.requireStore()
    const nowIso = request.nowIso ?? store.now()
    const questionKey = questionKeyOf(request.namespace, request.key)
    const entry = store.ledgerEntry(questionKey)
    // A retired row is not a known value: treating it as one would tell the checklist the field is
    // settled and suppress the question, which is the opposite of what a correction should do.
    const row = store.rowsFor(request.namespace, request.key).find(candidate => !isRetired(candidate))
    const memory = row === undefined
      ? undefined
      : { record: row, expired: isExpired(row, nowIso) }
    const correctedAt = store.correctionInstantFor(request.namespace, request.key)
    const ledger: PreQuestionChecklist['ledger'] = {
      questionKey,
      nowIso,
      ...entry === undefined ? {} : { entry },
      ...correctedAt === undefined ? {} : { correctedAt },
      ...request.askBudgetExhausted === undefined ? {} : { askBudgetExhausted: request.askBudgetExhausted },
      ...memory === undefined || !memory.expired
        ? {}
        : { reconfirm: reconfirmationFor(memory.record, nowIso) },
    }
    return runPreQuestionChecklist({
      nowIso,
      ...request.currentMessage === undefined ? {} : { currentMessage: { value: request.currentMessage } },
      ...request.sessionState === undefined ? {} : { sessionState: { value: request.sessionState } },
      ...memory === undefined ? {} : { memory },
      ledger,
    })
  }

  /**
   * Record one answer in the ledger (README §9).
   * @param request - the question key, the answer, and where it came from.
   * @returns the stored ledger row.
   */
  async recordAnswer(request: AnswerRequest): Promise<QuestionLedgerEntry> {
    const store = this.requireStore()
    const nowIso = store.now()
    const questionKey = questionKeyOf(request.namespace, request.key)
    // A retired row is not a value to inherit a scope from, for the same reason it is not a known
    // value in `consultQuestion`.
    const row = store.rowsFor(request.namespace, request.key).find(candidate => !isRetired(candidate))
    const entry = nextLedgerEntry(store.ledgerEntry(questionKey), {
      questionKey,
      asked: request.asked,
      ...request.answer === undefined ? {} : { answer: request.answer },
      answerSource: request.answerSource,
      // Without a stored record the answer's lifetime is the caller's statement;
      // the school-year default is what makes an unanswered-then-answered grade
      // question re-confirmable next year rather than re-asked.
      scope: request.scope ?? row?.scope ?? { scope_type: 'school_year' },
      nowIso,
      ...request.promotedMemoryId === undefined ? {} : { promotedMemoryId: request.promotedMemoryId },
    })
    await store.putLedgerEntry(entry)
    return entry
  }

  /** The store, failing loud when the service is used before its domain opened. */
  private requireStore(): MemoryStore {
    if (this.store === undefined) {
      throw new Error('globalMemory: the service is not initialized; its storage domain has not opened')
    }
    return this.store
  }

  /** The bounded standing-profile text, or `''` before the domain opens. */
  private standingProfileText(): string {
    if (this.store === undefined) return ''
    return renderStandingProfile(this.store.all(), this.store.now())
  }

  /**
   * Attach the per-step retrieval injection.
   *
   * The waterfall listener delegates first (`next()`), which is mandatory
   * (deepseek-harness/AGENTS.md: "Waterfall listeners MUST call `next()`"), then
   * appends one user-role message at the tail: the material the model must act on
   * sits closest to its answer, which is the placement `dsh-tool-skill` states for
   * its catalog (`src/index.ts:163-176`).
   */
  private attachRetrievalInjection(): void {
    this.ctx.on('agent/pre-step', async (
      { agent, signal },
      next,
    ): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const taskText = taskTextOf(decision.messages)
      if (taskText === undefined) return decision
      const store = this.store
      if (store === undefined) return decision
      const sessionRef = String(agent.session.header.id)
      const outcome = selectForTask({
        taskText,
        rows: store.all(),
        nowIso: store.now(),
        session_ref: sessionRef,
      })
      const text = renderMemoryContext(outcome)
      if (text === '') return decision
      const digest = digestOf(text)
      if (this.injectedDigests.get(agent.session) === digest) return decision
      signal.throwIfAborted()
      this.injectedDigests.set(agent.session, digest)
      return {
        ...decision,
        messages: [...decision.messages, memoryContextMessage(text, outcome.record_ids)],
      }
    })
  }
}

export default GlobalMemory

export { MemoryStore, memoryDomainSpec, memoryToolDefinitions }
export type { MemoryStoreTables }
