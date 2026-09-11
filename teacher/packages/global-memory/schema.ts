/**
 * `dsh-global-memory` record schema, namespace definitions, and the six-tool
 * contract.
 *
 * This module is deliberately self-contained: it imports nothing, so it type-checks
 * in isolation and states the durable record format, the confidence ladder, the
 * conflict priority, the TTL policy, and the tool input/output types for the six
 * model-facing tools — and nothing else.
 *
 * It is NOT the storage adapter. The implementation's zod schemas (for
 * `storageDomain` validation at the durable boundary) and the wire JSON Schemas
 * (for `ctx.tools.register`) are projections of the types and canonical tables
 * declared here; see `DESIGN-NOTES.md` for the file:line evidence behind that
 * split.
 *
 * Spec: `teacher/TEACHER-MODE-PLAN.md` §二, §四 (P0-3), §五.
 */

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

declare const memoryIdBrand: unique symbol
declare const memoryCandidateIdBrand: unique symbol

/** Stable identity of one stored memory record (a plain string at runtime). */
export type MemoryId = string & { readonly [memoryIdBrand]: true }

/** Identity of one candidate before it is promoted into the durable table. */
export type MemoryCandidateId = string & { readonly [memoryCandidateIdBrand]: true }

// ---------------------------------------------------------------------------
// Namespaces (plan §四 P0-3: five, no more)
// ---------------------------------------------------------------------------

/** The five long-term memory namespaces. "How to think" is Skill; "what to remember" is Memory. */
export type MemoryNamespace =
  | 'profile'
  | 'environment'
  | 'preferences'
  | 'projects'
  | 'corrections'

/** Every namespace name, in stable declaration order. */
export const MEMORY_NAMESPACES = [
  'profile',
  'environment',
  'preferences',
  'projects',
  'corrections',
] as const satisfies readonly MemoryNamespace[]

/**
 * Durable value carried by one memory record. Records are stored as text so they
 * survive a model swap; a structured value is a JSON-encoded object in
 * `details` and a human-readable rendering in `value`.
 */
export type MemoryValue = string

/** Arbitrary lossless JSON, the same domain every DSH durable/wire boundary accepts. */
export type MemoryJson =
  | string
  | number
  | boolean
  | null
  | readonly MemoryJson[]
  | { readonly [key: string]: MemoryJson }

/**
 * One declared field of one namespace.
 *
 * `stableKeys` documents which fields are allowed to carry `scope_type: 'stable'`;
 * anything outside it must expire. This is how the plan's "学科可长期；年级/教材版本/
 * 班级情况按学年失效" ("the subject can be long-lived; grade/textbook edition/class
 * situation expire by school year") becomes a checkable rule instead of prose.
 */
export interface MemoryFieldDeclaration {
  /** Field name inside the namespace's value/content object. */
  readonly name: string
  /** What this field holds, in the teacher's own vocabulary. */
  readonly description: string
  /** Scope types this field may legally use. */
  readonly allowedScopeTypes: readonly MemoryScopeType[]
  /** The scope type a newly promoted record of this field defaults to. */
  readonly defaultScopeType: MemoryScopeType
  /**
   * True when the value stays true indefinitely (subject, naming convention).
   * False when the value is tied to a school year, a class, or a textbook
   * edition and MUST carry `scope_type: 'school_year'` or `'class'`.
   */
  readonly stableKeys: boolean
  /** Namespace-specific prompt text used when a school-year value expires. */
  readonly reconfirmPrompt?: string
}

/** One of the five namespaces, with the fields it holds. */
export interface MemoryNamespaceDeclaration {
  /** Namespace name. */
  readonly namespace: MemoryNamespace
  /** What this namespace is for — and, in one line, what it is not for. */
  readonly purpose: string
  /** Teacher-facing examples from the plan, used verbatim in the control surface. */
  readonly examples: readonly string[]
  /** The fields this namespace holds. Keys are `MemoryFieldDeclaration.name`. */
  readonly fields: readonly MemoryFieldDeclaration[]
}

/** `profile` — who the teacher is and what they teach, in stable terms. */
const PROFILE_FIELDS: readonly MemoryFieldDeclaration[] = [
  {
    name: 'display_name',
    description: '称呼，例如"张老师"；用于称呼，不用于任何教学决策。',
    allowedScopeTypes: ['stable'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
  {
    name: 'subject',
    description: '任教学科，例如"高中地理"。学科可长期。',
    allowedScopeTypes: ['stable', 'school_year'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
  {
    name: 'grades_taught',
    description: '任教年级，例如"高一"。按学年失效，到期重新确认。',
    allowedScopeTypes: ['school_year', 'class'],
    defaultScopeType: 'school_year',
    stableKeys: false,
    reconfirmPrompt: '我记得上学年你主要带高一，今年还是高一吗？',
  },
  {
    name: 'role',
    description: '角色，例如"教研组长""班主任"。',
    allowedScopeTypes: ['stable', 'school_year'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
  {
    name: 'teaching_years',
    description: '教龄，用整数；仅用于措辞与教研材料深度。',
    allowedScopeTypes: ['stable'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
]

/** `environment` — the durable facts around the teacher that they did not choose. */
const ENVIRONMENT_FIELDS: readonly MemoryFieldDeclaration[] = [
  {
    name: 'school_name',
    description: '学校名称。',
    allowedScopeTypes: ['stable', 'school_year'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
  {
    name: 'region',
    description: '省市地区；影响课标与考试口径。',
    allowedScopeTypes: ['stable'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
  {
    name: 'textbook_edition',
    description: '教材版本，例如"人教版必修一"。按学年失效。',
    allowedScopeTypes: ['school_year'],
    defaultScopeType: 'school_year',
    stableKeys: false,
    reconfirmPrompt: '上学年用的是人教版必修一，今年换教材了吗？',
  },
  {
    name: 'curriculum_standard',
    description: '课标口径，例如"2017 版 2020 修订"。',
    allowedScopeTypes: ['stable', 'school_year'],
    defaultScopeType: 'school_year',
    stableKeys: false,
    reconfirmPrompt: '今年还是按 2017 版 2020 修订的课标来吗？',
  },
  {
    name: 'class_profile',
    description: '班级情况，例如"8 班偏理科、讨论活跃；3 班需要更多脚手架"。按学年失效。',
    allowedScopeTypes: ['class', 'school_year'],
    defaultScopeType: 'class',
    stableKeys: false,
    reconfirmPrompt: '上学年 8 班讨论很活跃，今年的班级还是这个情况吗？',
  },
  {
    name: 'class_duration_minutes',
    description: '单课时长，例如 45。',
    allowedScopeTypes: ['school_year', 'class', 'stable'],
    defaultScopeType: 'school_year',
    stableKeys: false,
    reconfirmPrompt: '去年一节课 45 分钟，今年课时安排有变化吗？',
  },
  {
    name: 'available_equipment',
    description: '可用设备，例如"教室有投影、无学生平板"。',
    allowedScopeTypes: ['stable', 'school_year', 'class'],
    defaultScopeType: 'school_year',
    stableKeys: false,
    reconfirmPrompt: '教室设备今年有变化吗？',
  },
]

/** `preferences` — stable work habits the teacher has expressed or repeated. */
const PREFERENCES_FIELDS: readonly MemoryFieldDeclaration[] = [
  {
    name: 'interaction_preference',
    description: '交互偏好，例如"先给方案再问细节""别一次问很多问题"。',
    allowedScopeTypes: ['stable'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
  {
    name: 'output_format_preference',
    description: '产物格式偏好，例如"教案先给表格版""PPT 每页不超过 6 行"。',
    allowedScopeTypes: ['stable'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
  {
    name: 'pedagogy_preference',
    description: '教学取向偏好，例如"少讲授、多观察推理"。只记老师自己说过的取向，不记模型推断的教学法。',
    allowedScopeTypes: ['stable', 'school_year'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
  {
    name: 'language_style',
    description: '语言风格，例如"用中文、口语化、不要小标题"。',
    allowedScopeTypes: ['stable'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
  {
    name: 'assessment_preference',
    description: '测评偏好，例如"试卷必须有分层题""不要纯选择题"。',
    allowedScopeTypes: ['stable'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
]

/** `projects` — multi-session work and its per-project configuration. */
const PROJECTS_FIELDS: readonly MemoryFieldDeclaration[] = [
  {
    name: 'project_title',
    description: '项目名称，例如"大气受热过程公开课"。',
    allowedScopeTypes: ['project', 'term'],
    defaultScopeType: 'project',
    stableKeys: false,
  },
  {
    name: 'project_status',
    description: '进行状态，例如"备课中""已上课""待复盘"。',
    allowedScopeTypes: ['project'],
    defaultScopeType: 'project',
    stableKeys: false,
  },
  {
    name: 'project_config',
    description: '当前项目配置：时长、班级、目标、交付物。优先级高于学年配置与长期画像。',
    allowedScopeTypes: ['project'],
    defaultScopeType: 'project',
    stableKeys: false,
  },
  {
    name: 'deliverable_index',
    description: '该项目已产出的产物索引（教案 / PPT / 学案的文件名或链接），不存正文。',
    allowedScopeTypes: ['project'],
    defaultScopeType: 'project',
    stableKeys: false,
  },
  {
    name: 'open_threads',
    description: '该项目尚未解决的问题，例如"等教研组定课时"。',
    allowedScopeTypes: ['project'],
    defaultScopeType: 'project',
    stableKeys: false,
  },
]

/** `corrections` — the plan's "用户纠正过一次的问题，不应再发生第二次". */
const CORRECTIONS_FIELDS: readonly MemoryFieldDeclaration[] = [
  {
    name: 'rejected_behavior',
    description: '被明确纠正的做法，逐字保留老师原话，例如"不要用 PPT 讲整节课"。',
    allowedScopeTypes: ['stable', 'project', 'class', 'school_year'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
  {
    name: 'corrected_value',
    description: '纠正后的正确取值，例如"年级写高一，不写高中"。',
    allowedScopeTypes: ['stable', 'project', 'class', 'school_year'],
    defaultScopeType: 'stable',
    stableKeys: true,
  },
  {
    name: 'correction_context',
    description: '纠正发生的场合。用于判断纠正是否只对那一次生效。',
    allowedScopeTypes: ['stable', 'project', 'class'],
    defaultScopeType: 'project',
    stableKeys: false,
  },
  {
    name: 'scope_of_correction',
    description: '"这一次"还是"以后都这样"。规则：只有老师明说或重复出现才升为 stable。',
    allowedScopeTypes: ['stable', 'project', 'class', 'school_year'],
    defaultScopeType: 'project',
    stableKeys: false,
  },
]

/** The five namespace declarations, keyed by namespace name. */
export const MEMORY_NAMESPACE_DECLARATIONS: Readonly<
  Record<MemoryNamespace, MemoryNamespaceDeclaration>
> = Object.freeze({
  profile: {
    namespace: 'profile',
    purpose: '教师是谁、教什么。不含偏好，不含当前任务参数。',
    examples: ['高中地理老师', '主要带高一', '教龄 8 年'],
    fields: PROFILE_FIELDS,
  },
  environment: {
    namespace: 'environment',
    purpose: '教师周围的客观条件。不含教师本人的选择（那是 preferences）。',
    examples: ['人教版必修一', '一节课 45 分钟', '教室有投影、没有学生平板'],
    fields: ENVIRONMENT_FIELDS,
  },
  preferences: {
    namespace: 'preferences',
    purpose: '教师明确表达或反复表现出的稳定工作习惯与交付偏好。',
    examples: ['喜欢少讲授、多观察推理', 'PPT 不要满屏字', '教案先给表格版'],
    fields: PREFERENCES_FIELDS,
  },
  projects: {
    namespace: 'projects',
    purpose: '跨会话的在办事项与其项目级配置。一次性任务参数不进入这里。',
    examples: ['大气受热过程公开课备课中', '课程标准 2017 版 2020 修订'],
    fields: PROJECTS_FIELDS,
  },
  corrections: {
    namespace: 'corrections',
    purpose: '用户纠正过的事实与做法。与 preferences 分开，因为纠正必须可追溯到原话。',
    examples: ['不要用 PPT 讲整节课', '年级写高一，不写高中'],
    fields: CORRECTIONS_FIELDS,
  },
})

/** Every declared field of one namespace. */
export type MemoryFieldName<N extends MemoryNamespace> =
  (typeof MEMORY_NAMESPACE_DECLARATIONS)[N]['fields'][number]['name']

// ---------------------------------------------------------------------------
// Scope (plan §四 P0-3 TTL)
// ---------------------------------------------------------------------------

/** How long a record's value is expected to remain true. */
export type MemoryScopeType = 'stable' | 'school_year' | 'term' | 'project' | 'class' | 'session'

/** A value's lifetime declaration. `scope_type` and `valid_for` are the plan's own spelling. */
export interface MemoryScope {
  /** Coarse lifetime class; decides the TTL rule applied at retrieval. */
  readonly scope_type: MemoryScopeType
  /**
   * Free identity of the scope instance. For `school_year` this is the school
   * year label, e.g. `2026-2027`; a school year runs 2026-08-01 .. 2027-07-31,
   * so the label names the year the autumn term started in.
   */
  readonly valid_for?: string
  /** Project id for `scope_type: 'project'`; the projects namespace's own key. */
  readonly project_id?: string
  /** Class id for `scope_type: 'class'`, e.g. `2026-2027/高一(8)班`. */
  readonly class_id?: string
}

/** The school year label that {@link MemoryScope.valid_for} carries. */
export type SchoolYear = string

// ---------------------------------------------------------------------------
// Provenance and the confidence ladder (plan §四 P0-3, verbatim)
// ---------------------------------------------------------------------------

/** Where a memory value came from. The ladder is the plan's, at its exact values. */
export type MemoryConfidence =
  | 'explicit_user'
  | 'explicit_correction'
  | 'repeated_behavior'
  | 'strong_inference'
  | 'weak_inference'

/** One rung of the ladder. */
export interface MemoryConfidenceRung {
  /** Numeric confidence written to {@link MemoryRecord.confidence}. */
  readonly value: number
  /** True when this rung may be written to long-term memory at all. */
  readonly longTermEligible: boolean
  /** What must be observed before a record may carry this rung. */
  readonly evidence: string
}

/** The confidence ladder, at the plan's exact values. */
export const MEMORY_CONFIDENCE_LADDER: Readonly<Record<MemoryConfidence, MemoryConfidenceRung>> =
  Object.freeze({
    explicit_user: {
      value: 1,
      longTermEligible: true,
      evidence: '老师明确说出了这个事实或偏好。',
    },
    explicit_correction: {
      value: 1,
      longTermEligible: true,
      evidence: '老师明确纠正了一个既有记忆或 AI 的做法。纠正一律满置信度。',
    },
    repeated_behavior: {
      value: 0.85,
      longTermEligible: true,
      evidence: '同一行为在多个独立会话中重复出现，且从未被否定。',
    },
    strong_inference: {
      value: 0.65,
      longTermEligible: true,
      evidence: '从任务上下文可靠推出，且写错也不会伤害结果（可安全默认值）。',
    },
    weak_inference: {
      value: 0,
      longTermEligible: false,
      evidence: '单次措辞、单次任务参数、模型的猜测。永不进入长期记忆。',
    },
  })

/** Rungs that may be persisted, at or above the long-term threshold. */
export const LONG_TERM_CONFIDENCE_FLOOR = 0.65

/** Whether one rung may be written to the long-term table. */
export function isLongTermEligible(confidence: MemoryConfidence): boolean {
  return MEMORY_CONFIDENCE_LADDER[confidence].longTermEligible
}

/** Numeric value of one rung, for conflict resolution and ranking. */
export function confidenceValue(confidence: MemoryConfidence): number {
  return MEMORY_CONFIDENCE_LADDER[confidence].value
}

/** Where a stored value came from, for the teacher-visible control surface. */
export type MemorySource =
  | 'explicit_user'
  | 'explicit_correction'
  | 'repeated_behavior'
  | 'strong_inference'
  | 'project_config'
  | 'school_year_config'
  | 'migrated'

/** One provenance record. `session_ref` is a session id or session-log locator, never chat text. */
export interface MemorySourceRef {
  /** The extraction route that produced this record. */
  readonly source: MemorySource
  /** Session or session-log locator that evidences the record. Evidence, not payload. */
  readonly session_ref?: string
  /** ISO-8601 timestamp of the originating observation. */
  readonly observed_at: string
  /**
   * The teacher's own words, verbatim and short (`<= 200` characters), for the
   * `explicit_user`/`explicit_correction` routes only. Raw chat logs are never
   * persisted; this is a quoted fragment inside the extracted record.
   */
  readonly quoted_fragment?: string
}

// ---------------------------------------------------------------------------
// The durable record
// ---------------------------------------------------------------------------

/**
 * Per-key TTL policy. `expires_at` is derived from `scope_type` through this
 * policy, never chosen ad hoc by the model.
 */
export interface MemoryTtlPolicy {
  /** YYYY-MM-DD. Stable records never expire. */
  readonly expiresAt: string | null
  /** Whether expiry means "re-confirm", never "forget before asking". */
  readonly expiryAction: 'never' | 'reconfirm'
}

/** One durable long-term memory record. One row per (namespace, key, scope). */
export interface MemoryRecord {
  /** Stable record id; the storage table key. */
  readonly id: MemoryId
  /** Which of the five namespaces this record belongs to. */
  readonly namespace: MemoryNamespace
  /** Field name inside the namespace; declared in the namespace declaration. */
  readonly key: string
  /** The remembered value, already human-readable. */
  readonly value: MemoryValue
  /** Structured detail for values that are not one string (lists, objects). */
  readonly details?: MemoryJson
  /** Lifetime declaration: `scope_type`, `valid_for`, project/class ids. */
  readonly scope: MemoryScope
  /** Provenance, including the quoted fragment for explicit routes. */
  readonly source: MemorySourceRef
  /** Ladder rung; the numeric confidence is derived from it, not stored twice. */
  readonly confidence: MemoryConfidence
  /** ISO-8601 instant of the last write to this record. */
  readonly updated_at: string
  /** ISO-8601 instant this record stopped being used. `null` for stable records. */
  readonly expires_at: string | null
  /**
   * ISO-8601 instant a correction retired this record.
   *
   * A retired record leaves retrieval permanently and is never re-confirmed. This is
   * deliberately not `expires_at`: an expired value may still hold, so the teacher is
   * offered it back as a default, whereas a retired value was wrong and offering it
   * again would re-ask a question the teacher already answered. The row survives so
   * the correction keeps its audit trail.
   */
  readonly retired_at?: string | null
  /** ISO-8601 instant a teacher or extractor last confirmed the value still holds. */
  readonly last_confirmed_at?: string
  /** True when the teacher pinned this value through the control surface. */
  readonly user_pinned?: boolean
  /** True when the teacher marked the record as "本次不要用" for the current task only. */
  readonly suppressed_for_session?: string
  /** Free-form tags for retrieval; never model-invented subject taxonomies. */
  readonly tags?: readonly string[]
}

/**
 * A record as the model sees it: identical to {@link MemoryRecord} except the
 * evidence locator is dropped, so a session id never becomes model-visible text.
 */
export type MemoryRecordView = Omit<MemoryRecord, 'source'> & {
  readonly source: Omit<MemorySourceRef, 'session_ref'>
}

/** Re-confirmation candidate produced by `expires_at` (plan: never a fresh interrogation). */
export interface MemoryReconfirmation {
  /** The record whose scope expired or is about to expire. */
  readonly record_id: MemoryId
  /** The field's namespace-specific prompt, e.g. "我记得上学年你主要带高一，今年还是高一吗？". */
  readonly prompt: string
  /** The expired value, offered as the recommended default the teacher can accept. */
  readonly previous_value: MemoryValue
  /** The day the value stopped applying. */
  readonly expired_on: string
}

// ---------------------------------------------------------------------------
// Conflict priority (plan §四 P0-3, verbatim)
// ---------------------------------------------------------------------------

/** The plan's precedence ladder, highest priority first. */
export type MemoryPriorityRank =
  | 'current_explicit_user'
  | 'current_project_config'
  | 'current_school_year_config'
  | 'long_term_user_profile'
  | 'behavior_inference'
  | 'model_default'

/**
 * Conflict priority, verbatim from the plan:
 * 当前用户明确表达 > 当前项目配置 > 本学年配置 > 长期用户画像 > 行为推断 > 模型默认.
 * Index 0 wins.
 */
export const MEMORY_CONFLICT_PRIORITY = [
  'current_explicit_user',
  'current_project_config',
  'current_school_year_config',
  'long_term_user_profile',
  'behavior_inference',
  'model_default',
] as const satisfies readonly MemoryPriorityRank[]

/** One ranked input to a conflict resolution. */
export interface MemoryConflictCandidate {
  /** The plan's rank for this candidate. */
  readonly rank: MemoryPriorityRank
  /** What this candidate would set. */
  readonly value: MemoryValue
  /** The record carrying the value, when the candidate came from memory. */
  readonly record_id?: MemoryId
  /** True when the value is true only for the current request or session. */
  readonly ephemeral?: boolean
}

/** The outcome of one conflict resolution. */
export interface MemoryConflictResolution {
  /** The winning rank. */
  readonly winner: MemoryPriorityRank
  /** The winning value. */
  readonly value: MemoryValue
  /** Every candidate, ranked, in priority order. */
  readonly ranked: readonly MemoryConflictCandidate[]
  /**
   * True when an ephemeral winner outranked a durable record. The durable
   * record is NOT overwritten; the model uses `value` for this task only.
   */
  readonly durableRecordPreserved: boolean
}

// ---------------------------------------------------------------------------
// Question Ledger (plan §四 P0-3)
// ---------------------------------------------------------------------------

/** Where a question's answer came from. */
export type QuestionAnswerSource =
  | 'user_explicit'
  | 'user_choice'
  | 'user_skipped'
  | 'memory_hit'
  | 'safe_default'

/** One ledger entry. Goal: `Never ask twice unless the old answer may no longer be valid.` */
export interface QuestionLedgerEntry {
  /** Stable entry id; the ledger table key. */
  readonly id: string
  /** The normalized question key, e.g. `profile.grades_taught`. Asked questions join on this. */
  readonly question_key: string
  /** What was actually asked, in the teacher's language. */
  readonly asked: string
  /** The answer as stored; absent only while `answer_source` is `user_skipped`. */
  readonly answer?: MemoryValue
  /** Where the answer came from — a safe default is recorded, so it is never re-asked as if unknown. */
  readonly answer_source: QuestionAnswerSource
  /** ISO-8601 instant the answer was last confirmed. */
  readonly last_confirmed: string
  /** The scope the answer was valid for, e.g. `2026-2027`. */
  readonly scope: MemoryScope
  /** ISO-8601 instant the answer stops being valid; drives re-asking. */
  readonly valid_until?: string
  /** Turns spent asking this question; the Ask Rate observable (plan §七). */
  readonly asked_count: number
  /** Memory id this answer produced, when it was promoted. */
  readonly promoted_memory_id?: MemoryId
}

/** Inputs to the "may I ask this again?" decision. */
export interface QuestionLedgerDecision {
  /** True when the question may be put to the teacher now. */
  readonly mayAsk: boolean
  /** Why it may or may not be asked. */
  readonly reason:
    | 'never_asked'
    | 'answer_expired'
    | 'answer_invalidated_by_correction'
    | 'already_answered_and_still_valid'
    | 'answered_by_safe_default'
    | 'ask_budget_exhausted'
  /** The prior entry, when one exists. */
  readonly entry?: QuestionLedgerEntry
  /**
   * When re-asking an expired answer, the re-confirmation to offer instead of an
   * open question. Present exactly when `reason === 'answer_expired'`.
   */
  readonly reconfirm?: MemoryReconfirmation
}

// ---------------------------------------------------------------------------
// Memory Promotion pipeline (plan §五)
// ---------------------------------------------------------------------------

/** One step of the promotion pipeline, in execution order. */
export type MemoryPromotionStage =
  | 'session_observation'
  | 'memory_candidate'
  | 'worth_saving'
  | 'deduplication'
  | 'conflict_check'
  | 'scope_selection'
  | 'save'
  | 'discarded'

/** The pipeline, verbatim from the plan's ordering. */
export const MEMORY_PROMOTION_PIPELINE = [
  'session_observation',
  'memory_candidate',
  'worth_saving',
  'deduplication',
  'conflict_check',
  'scope_selection',
  'save',
] as const satisfies readonly MemoryPromotionStage[]

/** Why a candidate was discarded at `worth_saving`. */
export type MemoryDiscardReason =
  | 'weak_inference'
  | 'one_off_task_parameter'
  | 'transient_negation'
  | 'already_covered_by_skill'
  | 'raw_chat_text'
  | 'not_about_the_teacher'

/** One candidate produced from an observation, before it is saved or dropped. */
export interface MemoryCandidate {
  /** Identity of this candidate within its run. */
  readonly id: MemoryCandidateId
  /** Proposed namespace. */
  readonly namespace: MemoryNamespace
  /** Proposed field name. */
  readonly key: string
  /** Proposed value. */
  readonly value: MemoryValue
  /** Proposed scope; may be revised at `scope_selection`. */
  readonly scope: MemoryScope
  /** Ladder rung the extractor assigned. */
  readonly confidence: MemoryConfidence
  /** Provenance. */
  readonly source: MemorySourceRef
  /** Which observation produced it. */
  readonly observation: MemoryObservation
}

/**
 * One extractor observation about the session. This is the ONLY shape that
 * leaves the session; raw chat logs are never persisted (plan §五:
 * "不把聊天记录永久化").
 */
export interface MemoryObservation {
  /** Normalized statement of what was noticed. */
  readonly summary: string
  /** The teacher's own words, when the observation is explicit. */
  readonly quoted_fragment?: string
  /** Session or session-log locator. Evidence, not payload. */
  readonly session_ref: string
  /** ISO-8601 instant of the observation. */
  readonly observed_at: string
  /** Observation channel. `session_log` reads structure (tool use, edits), never prose. */
  readonly channel: 'user_message' | 'user_correction' | 'session_log' | 'project_config'
}

/** Result of running one candidate through the whole pipeline. */
export type MemoryPromotionResult =
  | {
    readonly stage: 'save'
    /** The saved record, after dedup/conflict/scope selection. */
    readonly record: MemoryRecord
    /** True when an existing record was updated rather than a new row created. */
    readonly merged: boolean
  }
  | {
    readonly stage: 'discarded'
    /** Why it was dropped. */
    readonly reason: MemoryDiscardReason
    /** The candidate as it was dropped, for the eval harness's Memory Precision metric. */
    readonly candidate: MemoryCandidate
  }

/**
 * The plan's worked example: a single "这次不要课堂活动" must NOT become
 * "用户不喜欢课堂活动".
 *
 * This constant is the fixture the extractor's unit test asserts against, and
 * the reason `transient_negation` exists as a discard reason.
 */
export const TRANSIENT_NEGATION_EXAMPLE = {
  /** What the teacher said. */
  utterance: '这次不要课堂活动',
  /** What a naive extractor would wrongly save. */
  forbiddenExtraction: {
    namespace: 'preferences',
    key: 'pedagogy_preference',
    value: '用户不喜欢课堂活动',
    confidence: 'weak_inference',
  },
  /** What MAY be saved from the same utterance, if anything. */
  permittedExtraction: {
    namespace: 'projects',
    key: 'project_config',
    value: '本次不安排课堂活动',
    scope_type: 'project',
    confidence: 'explicit_user',
  },
  /** The pipeline reason a long-term preference write is discarded. */
  discardReason: 'transient_negation',
} as const satisfies {
  utterance: string
  forbiddenExtraction: {
    namespace: MemoryNamespace
    key: string
    value: string
    confidence: MemoryConfidence
  }
  permittedExtraction: {
    namespace: MemoryNamespace
    key: string
    value: string
    scope_type: MemoryScopeType
    confidence: MemoryConfidence
  }
  discardReason: MemoryDiscardReason
}

/**
 * The plan's 35-minute public-lesson example: a one-off project value must not
 * overwrite the durable school-year value.
 *
 * The public lesson is 35 minutes; every ordinary lesson is 45. The 35 must win
 * for the public lesson and leave the 45 intact afterwards.
 */
export const ONE_OFF_OVERWRITE_EXAMPLE = {
  /** The durable, school-year-scoped record. */
  durableRecord: {
    namespace: 'environment',
    key: 'class_duration_minutes',
    value: '45',
    scope_type: 'school_year',
    valid_for: '2026-2027',
    confidence: 'explicit_user',
  },
  /** The one-off, project-scoped value stated for a single lesson. */
  ephemeralCandidate: {
    namespace: 'projects',
    key: 'project_config',
    value: '本节公开课 35 分钟',
    scope_type: 'project',
    confidence: 'explicit_user',
    ephemeral: true,
  },
  /** The resolution: the ephemeral value wins for this task; the durable row is untouched. */
  expectedResolution: {
    winner: 'current_project_config',
    value: '本节公开课 35 分钟',
    durableRecordPreserved: true,
  },
} as const satisfies {
  durableRecord: {
    namespace: MemoryNamespace
    key: string
    value: string
    scope_type: MemoryScopeType
    valid_for: SchoolYear
    confidence: MemoryConfidence
  }
  ephemeralCandidate: {
    namespace: MemoryNamespace
    key: string
    value: string
    scope_type: MemoryScopeType
    confidence: MemoryConfidence
    ephemeral: true
  }
  expectedResolution: {
    winner: MemoryPriorityRank
    value: string
    durableRecordPreserved: boolean
  }
}

// ---------------------------------------------------------------------------
// TTL policy (plan §四 P0-3)
// ---------------------------------------------------------------------------

/** One row of the TTL table. */
export interface MemoryTtlRule {
  /** Scope type this rule covers. */
  readonly scopeType: MemoryScopeType
  /** Whether records of this scope type carry an `expires_at`. */
  readonly expires: boolean
  /** Number of days from `updated_at`/`last_confirmed_at` to `expires_at`; `null` for stable. */
  readonly ttlDays: number | null
  /** What the system does when the record expires. */
  readonly onExpiry: 'never' | 'reconfirm'
}

/**
 * The TTL table. Only `stable` never expires; everything else expires and
 * produces a re-confirmation, never a fresh interrogation.
 */
export const MEMORY_TTL_POLICY: Readonly<Record<MemoryScopeType, MemoryTtlRule>> = Object.freeze({
  stable: { scopeType: 'stable', expires: false, ttlDays: null, onExpiry: 'never' },
  school_year: { scopeType: 'school_year', expires: true, ttlDays: 365, onExpiry: 'reconfirm' },
  term: { scopeType: 'term', expires: true, ttlDays: 180, onExpiry: 'reconfirm' },
  project: { scopeType: 'project', expires: true, ttlDays: 120, onExpiry: 'reconfirm' },
  class: { scopeType: 'class', expires: true, ttlDays: 365, onExpiry: 'reconfirm' },
  session: { scopeType: 'session', expires: true, ttlDays: 1, onExpiry: 'never' },
})

/**
 * The school-year label owning one date. A school year starts on 1 August, so a
 * date in January 2027 belongs to `2026-2027`.
 * @param isoDate - an ISO-8601 date or timestamp.
 * @returns the school year label, e.g. `2026-2027`.
 */
export function schoolYearOf(isoDate: string): SchoolYear {
  const year = Number.parseInt(isoDate.slice(0, 4), 10)
  const month = Number.parseInt(isoDate.slice(5, 7), 10)
  const startYear = month >= 8 ? year : year - 1
  return `${startYear}-${startYear + 1}`
}

/**
 * Compute the TTL policy for one record from its scope.
 * @param scope - the record's scope declaration.
 * @param fromIso - ISO-8601 instant the TTL runs from (last confirmation or write).
 * @returns the derived expiry instant and the action taken on expiry.
 */
export function memoryTtlFor(scope: MemoryScope, fromIso: string): MemoryTtlPolicy {
  const rule = MEMORY_TTL_POLICY[scope.scope_type]
  if (!rule.expires || rule.ttlDays === null) {
    return { expiresAt: null, expiryAction: rule.onExpiry }
  }
  const from = Date.parse(fromIso)
  const expiresAt = new Date(from + rule.ttlDays * 24 * 60 * 60 * 1000).toISOString()
  return { expiresAt, expiryAction: rule.onExpiry }
}

/**
 * Whether a record is expired at one instant. An expired record is still READ
 * and offered as a re-confirmation default; it is not silently dropped.
 * @param record - the record to test.
 * @param nowIso - ISO-8601 instant to test against.
 * @returns true when the record's value may no longer hold.
 */
export function isExpired(record: MemoryRecord, nowIso: string): boolean {
  if (record.expires_at === null) return false
  return Date.parse(record.expires_at) <= Date.parse(nowIso)
}

/**
 * Whether a record was retired by a correction. A retired record is never
 * retrieved and never re-confirmed; it survives only as an audit record, so
 * every read path must filter it out rather than treat it as a stale value.
 * @param record - the record to test.
 * @returns true when a correction retired this record.
 */
export function isRetired(record: MemoryRecord): boolean {
  return record.retired_at !== undefined && record.retired_at !== null
}

/**
 * Build the re-confirmation for one expired record. The previous value is the
 * recommended default, so the teacher confirms or corrects rather than
 * re-answering from scratch.
 * @param record - the expired record.
 * @param nowIso - ISO-8601 instant of the expiry check.
 * @returns the re-confirmation to offer, or `undefined` when the scope never re-confirms.
 */
export function reconfirmationFor(
  record: MemoryRecord,
  nowIso: string,
): MemoryReconfirmation | undefined {
  if (!isExpired(record, nowIso)) return undefined
  if (MEMORY_TTL_POLICY[record.scope.scope_type].onExpiry !== 'reconfirm') return undefined
  const declared = MEMORY_NAMESPACE_DECLARATIONS[record.namespace].fields.find(
    field => field.name === record.key,
  )
  const prompt = declared?.reconfirmPrompt
    ?? `我记得${record.value}，今年还是这样吗？`
  return {
    record_id: record.id,
    prompt,
    previous_value: record.value,
    expired_on: (record.expires_at as string).slice(0, 10),
  }
}

// ---------------------------------------------------------------------------
// Retrieval policy (plan §三.4: Memory 不全量注入)
// ---------------------------------------------------------------------------

/** Prompt-placement of a namespace. Only `always` reaches the standing prompt. */
export type MemoryInjectionMode = 'always' | 'retrieve'

/** Which namespaces have fields that are always injected, and which are only retrieved. */
export const MEMORY_INJECTION_MODES = {
  /**
   * The tiny standing profile. Ordered, smallest first; the whole standing block
   * is bounded by {@link STANDING_PROFILE_MAX_CHARS}.
   */
  always: ['profile.display_name', 'profile.subject', 'profile.grades_taught'] as const,
  /** Everything else is retrieved per task type. */
  retrieve: [
    'environment',
    'preferences',
    'projects',
    'corrections',
  ] as const satisfies readonly MemoryNamespace[],
} as const

/** Hard character budget for the always-injected teacher profile block. */
export const STANDING_PROFILE_MAX_CHARS = 200

/** One retrieval plan row: a task type, and what to pull for it. */
export interface MemoryRetrievalRule {
  /** Stable task-type key the router matches on. */
  readonly task_type: string
  /** Namespaces to retrieve, in priority order. */
  readonly namespaces: readonly MemoryNamespace[]
  /** Namespace/key pairs that must be injected when present. */
  readonly mustInclude: readonly string[]
  /**
   * Namespace/key pairs explicitly excluded even when the namespace is
   * retrieved. Exclusion is the default witness that retrieval is a decision,
   * not a namespace dump.
   */
  readonly mustExclude: readonly string[]
  /** Maximum records injected for this task type. */
  readonly maxRecords: number
}

/** Retrieval rules per task type. `ppt_design` is the plan's own example. */
export const MEMORY_RETRIEVAL_RULES: readonly MemoryRetrievalRule[] = [
  {
    task_type: 'lesson_design',
    namespaces: ['environment', 'preferences', 'corrections', 'projects'],
    mustInclude: ['environment.curriculum_standard', 'environment.class_duration_minutes'],
    mustExclude: ['projects.deliverable_index'],
    maxRecords: 12,
  },
  {
    task_type: 'ppt_design',
    namespaces: ['preferences', 'corrections'],
    mustInclude: ['preferences.output_format_preference', 'corrections.rejected_behavior'],
    // The plan's PPT example: design preferences apply; class logistics do not,
    // because they change nothing a slide deck shows.
    mustExclude: ['environment.class_profile', 'environment.available_equipment'],
    maxRecords: 8,
  },
  {
    task_type: 'assessment_design',
    namespaces: ['environment', 'preferences', 'corrections', 'profile'],
    mustInclude: ['preferences.assessment_preference', 'environment.curriculum_standard'],
    mustExclude: ['projects.open_threads'],
    maxRecords: 10,
  },
  {
    task_type: 'general',
    namespaces: ['preferences', 'corrections'],
    mustInclude: ['corrections.rejected_behavior'],
    mustExclude: [],
    maxRecords: 6,
  },
]

// ---------------------------------------------------------------------------
// Control surface (user-visible)
// ---------------------------------------------------------------------------

/** What the teacher may do to one memory record from the control surface. */
export type MemoryControlAction = 'inspect' | 'modify' | 'delete' | 'suppress_for_session'

/** One control-surface affordance, with the tool that backs it. */
export interface MemoryControlAffordance {
  /** The affordance the teacher sees. */
  readonly action: MemoryControlAction
  /** The Chinese label shown to the teacher. */
  readonly label: string
  /** The tool that performs it. */
  readonly tool: MemoryToolName
  /**
   * Whether the action is durable. `suppress_for_session` writes
   * `suppressed_for_session` on the model-visible view and never touches the
   * stored record, so it is reversible by starting a new session.
   */
  readonly durable: boolean
}

/** The teacher-visible control surface. The teacher must be able to see what the AI remembers. */
export const MEMORY_CONTROL_SURFACE: readonly MemoryControlAffordance[] = [
  { action: 'inspect', label: '查看 AI 记住了什么', tool: 'memory_search', durable: false },
  { action: 'modify', label: '修改', tool: 'memory_update', durable: true },
  { action: 'delete', label: '删除', tool: 'memory_forget', durable: true },
  { action: 'suppress_for_session', label: '本次不要用', tool: 'memory_feedback', durable: false },
]

// ---------------------------------------------------------------------------
// The six tools (plan §四 P0-3: 只做 6 个工具)
// ---------------------------------------------------------------------------

/** The six model-facing tool names. No more. */
export const MEMORY_TOOL_NAMES = [
  'memory_get',
  'memory_search',
  'memory_set',
  'memory_update',
  'memory_forget',
  'memory_feedback',
] as const

/** One of the six model-facing tool names. */
export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number]

/** A short declarative JSON Schema, the subset `dsh-tools` compiles to. */
export type MemoryJsonSchema = MemoryJson

/** One tool's declared contract. The implementation registers exactly these six. */
export interface MemoryToolDeclaration<I, O> {
  /** Tool name; one of {@link MEMORY_TOOL_NAMES}. */
  readonly name: MemoryToolName
  /** Model-facing description: what it does and when to reach for it. */
  readonly description: string
  /** Input JSON Schema, object-rooted. */
  readonly input: MemoryJsonSchema
  /** Canonical output JSON Schema; the tool's `output.schema` in `dsh-tools`. */
  readonly output: MemoryJsonSchema
  /** One realistic call, used verbatim in this package's README and tests. */
  readonly example: { readonly input: I; readonly output: O }
}

/** Define one tool declaration while pinning its input/output and example types. */
function declareTool<I, O>(declaration: MemoryToolDeclaration<I, O>): MemoryToolDeclaration<I, O> {
  return Object.freeze(declaration)
}

const scopeSchema: MemoryJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scope_type: {
      type: 'string',
      required: true,
      enum: ['stable', 'school_year', 'term', 'project', 'class', 'session'],
    },
    valid_for: { type: 'string' },
    project_id: { type: 'string' },
    class_id: { type: 'string' },
  },
}

const recordViewSchema: MemoryJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    namespace: {
      type: 'string',
      required: true,
      enum: ['profile', 'environment', 'preferences', 'projects', 'corrections'],
    },
    key: { type: 'string', required: true },
    value: { type: 'string', required: true },
    details: { type: 'json' },
    scope: { ...(scopeSchema as { [key: string]: MemoryJson }), required: true },
    source: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        source: {
          type: 'string',
          required: true,
          enum: [
            'explicit_user',
            'explicit_correction',
            'repeated_behavior',
            'strong_inference',
            'project_config',
            'school_year_config',
            'migrated',
          ],
        },
        observed_at: { type: 'string', required: true },
        quoted_fragment: { type: 'string' },
      },
    },
    confidence: {
      type: 'string',
      required: true,
      enum: ['explicit_user', 'explicit_correction', 'repeated_behavior', 'strong_inference'],
    },
    updated_at: { type: 'string', required: true },
    expires_at: { type: 'string' },
    last_confirmed_at: { type: 'string' },
    user_pinned: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
  },
}

/** Input of `memory_get`. */
export interface MemoryGetInput {
  readonly namespace: MemoryNamespace
  readonly key: string
  readonly scope?: MemoryScope
  readonly include_expired?: boolean
}

/** Output of `memory_get`. */
export interface MemoryGetOutput {
  readonly found: boolean
  readonly record?: MemoryRecordView
  readonly reconfirm?: MemoryReconfirmation
}

/** Input of `memory_search`. */
export interface MemorySearchInput {
  readonly query: string
  readonly namespaces?: readonly MemoryNamespace[]
  readonly scope_type?: MemoryScopeType
  readonly min_confidence?: number
  readonly include_expired?: boolean
  readonly limit?: number
}

/** Output of `memory_search`. */
export interface MemorySearchOutput {
  readonly records: readonly MemoryRecordView[]
  readonly truncated: boolean
}

/** Input of `memory_set`. */
export interface MemorySetInput {
  readonly namespace: MemoryNamespace
  readonly key: string
  readonly value: string
  readonly details?: MemoryJson
  readonly scope: MemoryScope
  readonly confidence: MemoryConfidence
  readonly evidence: string
  readonly quoted_fragment?: string
}

/** Output of `memory_set`. */
export interface MemorySetOutput {
  readonly record: MemoryRecordView
  readonly created: boolean
  readonly merged_with?: MemoryId
}

/** Input of `memory_update`. */
export interface MemoryUpdateInput {
  readonly id: MemoryId
  readonly value?: string
  readonly details?: MemoryJson
  readonly scope?: MemoryScope
  readonly confidence?: MemoryConfidence
  readonly evidence: string
}

/** Output of `memory_update`. */
export interface MemoryUpdateOutput {
  readonly record: MemoryRecordView
  readonly previous_value: string
}

/** Input of `memory_forget`. */
export interface MemoryForgetInput {
  readonly id?: MemoryId
  readonly namespace?: MemoryNamespace
  readonly key?: string
  readonly scope?: MemoryScope
  readonly confirm: boolean
}

/** Output of `memory_forget`. */
export interface MemoryForgetOutput {
  readonly deleted: number
  readonly deleted_ids: readonly MemoryId[]
}

/** Input of `memory_feedback`. */
export interface MemoryFeedbackInput {
  readonly record_id?: MemoryId
  readonly namespace?: MemoryNamespace
  readonly key?: string
  readonly signal: 'correct' | 'incorrect' | 'outdated' | 'dont_use_this_time'
  readonly corrected_value?: string
  readonly evidence: string
}

/** Output of `memory_feedback`. */
export interface MemoryFeedbackOutput {
  readonly action: 'corrected' | 'invalidated' | 'suppressed_for_session' | 'no_op'
  readonly record?: MemoryRecordView
  /** True when the feedback produced a `corrections` record. */
  readonly correction_recorded: boolean
}

const evidenceProperty = {
  type: 'string',
  required: true,
  description: 'Why this write is justified: one short sentence naming what the teacher said or did, and when.',
} as const

/** The six tool declarations. Register exactly these; see README "Tools". */
export const MEMORY_TOOLS = [
  declareTool<MemoryGetInput, MemoryGetOutput>({
    name: 'memory_get',
    description:
      'Read one exact long-term memory field, e.g. the teacher\'s subject or this year\'s textbook edition. '
      + 'Call this before asking the teacher something the profile or a prior answer may already settle. '
      + 'Prefer it over memory_search when the field name is known.',
    input: {
      type: 'object',
      additionalProperties: false,
      properties: {
        namespace: {
          type: 'string',
          required: true,
          enum: ['profile', 'environment', 'preferences', 'projects', 'corrections'],
        },
        key: { type: 'string', required: true, description: 'Field name inside the namespace.' },
        scope: scopeSchema,
        include_expired: {
          type: 'boolean',
          description: 'Include a record whose scope expired; the result then carries a re-confirmation.',
        },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        found: { type: 'boolean', required: true },
        record: recordViewSchema,
        reconfirm: {
          type: 'object',
          additionalProperties: false,
          properties: {
            record_id: { type: 'string', required: true },
            prompt: { type: 'string', required: true },
            previous_value: { type: 'string', required: true },
            expired_on: { type: 'string', required: true },
          },
        },
      },
    },
    example: {
      input: { namespace: 'environment', key: 'textbook_edition', scope: { scope_type: 'school_year', valid_for: '2026-2027' } },
      output: {
        found: true,
        record: {
          id: 'mem_01J8Z9K2' as MemoryId,
          namespace: 'environment',
          key: 'textbook_edition',
          value: '人教版必修一',
          scope: { scope_type: 'school_year', valid_for: '2026-2027' },
          source: { source: 'explicit_user', observed_at: '2026-09-02T08:10:00.000Z', quoted_fragment: '我们用的是人教版必修一' },
          confidence: 'explicit_user',
          updated_at: '2026-09-02T08:10:00.000Z',
          expires_at: '2027-09-02T08:10:00.000Z',
        },
      },
    },
  }),

  declareTool<MemorySearchInput, MemorySearchOutput>({
    name: 'memory_search',
    description:
      'Find long-term memories relevant to the current task, across one or more namespaces. '
      + 'Call this at the start of a task to recover preferences and past corrections instead of guessing.',
    input: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', required: true, description: 'What you are about to do, in a few words.' },
        namespaces: {
          type: 'array',
          items: { type: 'string', enum: ['profile', 'environment', 'preferences', 'projects', 'corrections'] },
          description: 'Namespaces to search. Omit to search all five.',
        },
        scope_type: scopeSchema.properties as MemoryJson,
        min_confidence: { type: 'number', description: 'Minimum numeric confidence; 0.65 is the durable floor.' },
        include_expired: { type: 'boolean' },
        limit: { type: 'integer', description: 'Maximum records returned.' },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        records: { type: 'array', required: true, items: recordViewSchema },
        truncated: { type: 'boolean', required: true },
      },
    },
    example: {
      input: { query: '设计一节大气受热过程的 PPT', namespaces: ['preferences', 'corrections'], limit: 8 },
      output: {
        records: [
          {
            id: 'mem_01J8ZB44' as MemoryId,
            namespace: 'preferences',
            key: 'output_format_preference',
            value: 'PPT 每页不超过 6 行字',
            scope: { scope_type: 'stable' },
            source: { source: 'explicit_user', observed_at: '2026-09-05T02:00:00.000Z' },
            confidence: 'explicit_user',
            updated_at: '2026-09-05T02:00:00.000Z',
            expires_at: null,
          },
        ],
        truncated: false,
      },
    },
  }),

  declareTool<MemorySetInput, MemorySetOutput>({
    name: 'memory_set',
    description:
      'Save one durable fact about the teacher, their environment, their preferences, or an in-flight project. '
      + 'Only call this for something the teacher stated, explicitly corrected, or clearly repeated. '
      + 'Never save a one-off task parameter or a single negative remark as a long-term preference.',
    input: {
      type: 'object',
      additionalProperties: false,
      properties: {
        namespace: {
          type: 'string',
          required: true,
          enum: ['profile', 'environment', 'preferences', 'projects', 'corrections'],
        },
        key: { type: 'string', required: true },
        value: { type: 'string', required: true },
        details: { type: 'json' },
        scope: { ...(scopeSchema as { [key: string]: MemoryJson }), required: true },
        confidence: {
          type: 'string',
          required: true,
          enum: ['explicit_user', 'explicit_correction', 'repeated_behavior', 'strong_inference'],
          description: 'Ladder rung. weak_inference is rejected: it must never reach long-term memory.',
        },
        evidence: evidenceProperty,
        quoted_fragment: { type: 'string', description: 'The teacher\'s own words, at most 200 characters.' },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        record: { ...(recordViewSchema as { [key: string]: MemoryJson }), required: true },
        created: { type: 'boolean', required: true },
        merged_with: { type: 'string' },
      },
    },
    example: {
      input: {
        namespace: 'environment',
        key: 'class_duration_minutes',
        value: '45',
        scope: { scope_type: 'school_year', valid_for: '2026-2027' },
        confidence: 'explicit_user',
        evidence: '老师在第 3 轮说明每节课 45 分钟。',
        quoted_fragment: '我们一节课 45 分钟',
      },
      output: {
        record: {
          id: 'mem_01J8ZC01' as MemoryId,
          namespace: 'environment',
          key: 'class_duration_minutes',
          value: '45',
          scope: { scope_type: 'school_year', valid_for: '2026-2027' },
          source: { source: 'explicit_user', observed_at: '2026-09-07T01:20:00.000Z', quoted_fragment: '我们一节课 45 分钟' },
          confidence: 'explicit_user',
          updated_at: '2026-09-07T01:20:00.000Z',
          expires_at: '2027-09-07T01:20:00.000Z',
        },
        created: true,
      },
    },
  }),

  declareTool<MemoryUpdateInput, MemoryUpdateOutput>({
    name: 'memory_update',
    description:
      'Correct or restate an existing memory record, including one the teacher marked outdated. '
      + 'This is the tool behind the teacher-facing 修改 action. Prefer it over memory_set when a record id is known. '
      + 'Raising confidence to explicit_correction requires the teacher\'s correction, not your own judgement.',
    input: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true, description: 'Record id from memory_get or memory_search.' },
        value: { type: 'string' },
        details: { type: 'json' },
        scope: scopeSchema,
        confidence: {
          type: 'string',
          enum: ['explicit_user', 'explicit_correction', 'repeated_behavior', 'strong_inference'],
        },
        evidence: evidenceProperty,
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        record: { ...(recordViewSchema as { [key: string]: MemoryJson }), required: true },
        previous_value: { type: 'string', required: true },
      },
    },
    example: {
      input: {
        id: 'mem_01J8ZC01' as MemoryId,
        value: '40',
        evidence: '老师纠正：这学期调成了 40 分钟。',
        confidence: 'explicit_correction',
      },
      output: {
        record: {
          id: 'mem_01J8ZC01' as MemoryId,
          namespace: 'environment',
          key: 'class_duration_minutes',
          value: '40',
          scope: { scope_type: 'school_year', valid_for: '2026-2027' },
          source: { source: 'explicit_correction', observed_at: '2026-10-11T06:00:00.000Z' },
          confidence: 'explicit_correction',
          updated_at: '2026-10-11T06:00:00.000Z',
          expires_at: '2027-10-11T06:00:00.000Z',
        },
        previous_value: '45',
      },
    },
  }),

  declareTool<MemoryForgetInput, MemoryForgetOutput>({
    name: 'memory_forget',
    description:
      'Delete memories the teacher asked you to forget. This is the tool behind the teacher-facing 删除 action. '
      + 'Deletion is durable and irreversible, so it requires confirm: true and an explicit teacher request.',
    input: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'One record to delete. Preferred over the namespace/key pair.' },
        namespace: { type: 'string', enum: ['profile', 'environment', 'preferences', 'projects', 'corrections'] },
        key: { type: 'string' },
        scope: scopeSchema,
        confirm: {
          type: 'boolean',
          required: true,
          description: 'Must be true. The call is rejected otherwise, because deletion cannot be undone.',
        },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        deleted: { type: 'integer', required: true },
        deleted_ids: { type: 'array', required: true, items: { type: 'string' } },
      },
    },
    example: {
      input: { id: 'mem_01J8ZB44' as MemoryId, confirm: true },
      output: { deleted: 1, deleted_ids: ['mem_01J8ZB44' as MemoryId] },
    },
  }),

  declareTool<MemoryFeedbackInput, MemoryFeedbackOutput>({
    name: 'memory_feedback',
    description:
      'Report that a memory was wrong, outdated, or should not be used for this task. '
      + 'Use dont_use_this_time for a value that applies to this task only: the record is suppressed for the '
      + 'current session and never overwritten, which is how a one-off stays a one-off.',
    input: {
      type: 'object',
      additionalProperties: false,
      properties: {
        record_id: { type: 'string' },
        namespace: { type: 'string', enum: ['profile', 'environment', 'preferences', 'projects', 'corrections'] },
        key: { type: 'string' },
        signal: {
          type: 'string',
          required: true,
          enum: ['correct', 'incorrect', 'outdated', 'dont_use_this_time'],
        },
        corrected_value: { type: 'string', description: 'Required for signal correct.' },
        evidence: evidenceProperty,
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          required: true,
          enum: ['corrected', 'invalidated', 'suppressed_for_session', 'no_op'],
        },
        record: recordViewSchema,
        correction_recorded: { type: 'boolean', required: true },
      },
    },
    example: {
      input: {
        record_id: 'mem_01J8ZC01' as MemoryId,
        signal: 'dont_use_this_time' as const,
        evidence: '老师说明本次公开课 35 分钟，不是平时的 45 分钟。',
      },
      output: {
        action: 'suppressed_for_session',
        record: {
          id: 'mem_01J8ZC01' as MemoryId,
          namespace: 'environment',
          key: 'class_duration_minutes',
          value: '45',
          scope: { scope_type: 'school_year', valid_for: '2026-2027' },
          source: { source: 'explicit_user', observed_at: '2026-09-07T01:20:00.000Z' },
          confidence: 'explicit_user',
          updated_at: '2026-09-07T01:20:00.000Z',
          expires_at: '2027-09-07T01:20:00.000Z',
        },
        correction_recorded: false,
      },
    },
  }),
] as const

/** A tool declaration with its input/output types erased, for exhaustive iteration. */
export type AnyMemoryToolDeclaration = MemoryToolDeclaration<unknown, unknown>

/** Names of the declared tools, for the exhaustiveness assertion below. */
export const DECLARED_MEMORY_TOOL_NAMES: readonly MemoryToolName[] =
  MEMORY_TOOLS.map(tool => tool.name)

// ---------------------------------------------------------------------------
// Storage domain identity (consumed by the implementation's zod projection)
// ---------------------------------------------------------------------------

/** The `storageDomain` name and version the implementation opens. */
export const MEMORY_DOMAIN = {
  /** Domain name; must match the storage `UNIT_NAME_RE` (`^[a-z][a-z0-9_]*$`). */
  name: 'global_memory',
  /** Domain format version. Bump only for a structural change to stored records. */
  version: 1,
  /** Declared tables. Keys are the table names. */
  tables: {
    /** One row per {@link MemoryRecord}, keyed by `MemoryRecord.id`. */
    memories: 'memories',
    /** One row per {@link QuestionLedgerEntry}, keyed by `QuestionLedgerEntry.id`. */
    question_ledger: 'question_ledger',
  },
  /** The global singleton holds the schema/namespace declaration version marker. */
  global: 'meta',
} as const
