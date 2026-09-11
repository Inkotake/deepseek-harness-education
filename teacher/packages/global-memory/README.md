# dsh-global-memory — design

The shared long-term memory service for every teacher/research/coding preset.

`dsh-global-memory` answers two questions and nothing else: **what is already known about this
user**, and **what must be retrieved for this task**. It does not decide how to teach — that is a
Skill's job (plan §二: "怎么想"属于 Skill；"记什么/取什么"属于 Memory). It does not own the current
task's parameters — that is Session State, which DSH already provides and this package does not
re-create.

Spec: [`teacher/TEACHER-MODE-PLAN.md`](../TEACHER-MODE-PLAN.md) §二, §四 (P0-3), §五, §七.
Schema: [`schema.ts`](./schema.ts). Evidence for every decision: [`DESIGN-NOTES.md`](./DESIGN-NOTES.md).

**Status: design + schema only.** Nothing here is wired into a profile, seed, build script, or
bundle. `schema.ts` is self-contained and imports nothing, so it type-checks before any
integration decision is made.

---

## 1. Scope and non-goals

| In scope | Out of scope |
|---|---|
| The five long-term namespaces and their fields | Teaching methods, lesson structure, pedagogy templates |
| The durable record and its metadata | The current task's parameters (Session State owns those) |
| The confidence ladder and promotion gate | The content of any Skill |
| TTL, expiry, and re-confirmation | Full-text search over chat history |
| The Question Ledger | Model routing, presets, or tool catalogs |
| Six model-facing tools | More than six tools |
| Conditional retrieval and the per-step injection | Injecting the whole memory into every prompt |

Raw chat logs are never persisted. An extracted record may carry a short verbatim quote for
traceability (`MemorySourceRef.quoted_fragment`, ≤ 200 characters); the conversation it came from
is not stored, indexed, or replayed by this service.

---

## 2. Boundaries against the other layers

The plan's judgement rule is **"怎么想"属于 Skill；"记什么/取什么"属于 Memory.** Concretely:

- **Preset** contributes `memory_policy` prose and declares which of the six tools are reachable.
  It does not contain memory data. The `education` preset already carries the memory paragraph this
  service is the implementation of — `dsh-plugin-desktop/presets/education/agent.cordis.yml:44-45`
  ("Memory: check the teacher memory that bears on this task before you answer. Never ask for
  something already known reliably, and let what they state now override an older memory.").
- **GrabMe** asks questions. Before it asks one, it consults this service and the Question Ledger.
  GrabMe owns the budget and the question wording; this service owns the ledger and the rule
  "never ask twice unless the old answer may no longer be valid".
- **Skill** declares professional method. When the extractor sees something that is really a
  method, it discards with `already_covered_by_skill` instead of saving it (plan §二: both stay
  separate).
- **Session State** owns this task's parameters. A one-off value is a Session/Project fact, never a
  durable namespace write; see §7.3.

---

## 3. Namespaces

Exactly five (plan §四 P0-3). Each is declared in `schema.ts` with the fields it holds, the scope
types each field may use, and whether the field may be long-lived.

| Namespace | Holds | Plan's examples |
|---|---|---|
| `profile` | Who the teacher is and what they teach | 高中地理老师 · 主要带高一 · 教龄 8 年 |
| `environment` | The conditions around the teacher | 人教版必修一 · 一节课 45 分钟 · 教室有投影、没有学生平板 |
| `preferences` | Stable, expressed or repeated work habits | 喜欢少讲授、多观察推理 · PPT 不要满屏字 · 教案先给表格版 |
| `projects` | Multi-session work and its per-project config | 大气受热过程公开课备课中 · 课程标准 2017 版 2020 修订 |
| `corrections` | Corrections the teacher made, traceable to their words | 不要用 PPT 讲整节课 · 年级写高一，不写高中 |

`corrections` is separate from `preferences` on purpose. A preference is a habit; a correction is a
promise. The plan's principle "用户纠正过一次的问题，不应再发生第二次" can only be enforced if the
correction keeps its original wording and its scope (`scope_of_correction`: this time, or always).

Justification for the mapping — the plan lists five memory categories in §五 (自动发现显式偏好、长期
环境、用户纠正、稳定工作习惯; plus the Question Ledger) against five namespaces. The mapping is:
显式偏好 → `preferences`; 长期环境 → `environment`; 用户纠正 → `corrections`; 稳定工作习惯 →
`preferences`; the Question Ledger is a separate table, not a namespace; and `profile`/`projects`
carry the plan's §四 examples that no §五 category names.

### 3.1 Fields per namespace

Full declarations with descriptions are in `schema.ts`. Each field declares `allowedScopeTypes`
and `stableKeys`. `stableKeys: false` means the field **must** carry
`scope_type: 'school_year'`, `'term'`, or `'class'` — it may never be written as `stable`.

- **`profile`**: `display_name`, `subject`, `grades_taught`, `role`, `teaching_years`.
- **`environment`**: `school_name`, `region`, `textbook_edition`, `curriculum_standard`,
  `class_profile`, `class_duration_minutes`, `available_equipment`.
- **`preferences`**: `interaction_preference`, `output_format_preference`,
  `pedagogy_preference`, `language_style`, `assessment_preference`.
- **`projects`**: `project_title`, `project_status`, `project_config`, `deliverable_index`,
  `open_threads`.
- **`corrections`**: `rejected_behavior`, `corrected_value`, `correction_context`,
  `scope_of_correction`.

Only `profile` fields are candidates for the always-injected standing block (§8); every other
field is retrieved.

---

## 4. The durable record

One row per `(namespace, key, scope)`. Storage table key is `MemoryRecord.id`.

| Field | Meaning |
|---|---|
| `id` | Stable record id (storage table key). |
| `namespace` | One of the five. |
| `key` | Field name inside the namespace, declared in §3.1. |
| `value` | The remembered value, already human-readable. |
| `details` | Optional structured detail for list/object values. |
| `scope` | `scope_type`, `valid_for`, `project_id`, `class_id`. |
| `source` | `source`, `session_ref`, `observed_at`, `quoted_fragment?`. |
| `confidence` | Ladder rung, not a bare number (§5). |
| `updated_at` | ISO-8601 instant of the last write. |
| `expires_at` | ISO-8601 instant the value stopped applying; `null` for `stable`. |
| `last_confirmed_at` | When a human or the extractor last confirmed it still holds. |
| `user_pinned` | Set by the teacher through the control surface (§9); pins survive re-confirmation. |
| `suppressed_for_session` | Session id for which the teacher chose 本次不要用 (§9, §11.4). |
| `tags` | Retrieval tags. Never a model-invented subject taxonomy. |

`source.session_ref` is an evidence locator, not payload, and is **not** model-visible:
`MemoryRecordView` is the model-facing projection and drops it (`schema.ts`).
`quoted_fragment` is model-visible only when the record is explicitly grounded in something the
teacher said.

`confidence` stores the rung; the number is derived through `confidenceValue()`. Storing both
would let them disagree.

---

## 5. The confidence ladder

Verbatim from the plan (§四 P0-3), in `MEMORY_CONFIDENCE_LADDER`:

| Rung | Value | In long-term memory | Evidence required |
|---|---|---|---|
| `explicit_user` | 1.00 | yes | The teacher stated it. |
| `explicit_correction` | 1.00 | yes | The teacher corrected a memory or the AI's behaviour. Always full confidence. |
| `repeated_behavior` | ≈0.85 | yes | The same behaviour in independent sessions, never contradicted. |
| `strong_inference` | ≈0.65 | yes | Reliably derived and safe if wrong (a defaultable value). |
| `weak_inference` | — | **no** | Single phrasing, single task parameter, or the model's guess. Never enters long-term memory. |

`LONG_TERM_CONFIDENCE_FLOOR = 0.65`; `isLongTermEligible()` is the gate. `weak_inference` is
declared with `longTermEligible: false` so the gate is a table lookup rather than a scattered
comparison, and `memory_set`'s input schema does not even offer it as an enum value.

### 5.1 The worked example that must not be learned

The plan: a single "这次不要课堂活动" **绝不**能沉淀为"用户不喜欢课堂活动".

`schema.ts` pins this as `TRANSIENT_NEGATION_EXAMPLE`:

- **Forbidden**: `preferences.pedagogy_preference = "用户不喜欢课堂活动"` — a long-term claim about
  the teacher derived from one instruction.
- **Permitted**: `projects.project_config = "本次不安排课堂活动"` with `scope_type: 'project'` and
  `confidence: 'explicit_user'` — true for this project, and it actually settles a decision.
- **Pipeline reason when the long-term write is refused**: `transient_negation`.

The test: the extractor's unit fixture asserts that the forbidden extraction produces
`{ stage: 'discarded', reason: 'transient_negation' }`, and the permitted one lands in `projects`.
Note the asymmetry — the utterance *is* explicit, so `explicit_user` is the right rung for the
project-scoped fact. What makes the long-term write illegal is not low confidence in the
teacher's words; it is that a single negation carries no information about the long-term
preference. Scope, not confidence, is what fails.

---

## 6. Conflict priority

Verbatim from the plan, highest first (`MEMORY_CONFLICT_PRIORITY`):

```
当前用户明确表达 > 当前项目配置 > 本学年配置 > 长期用户画像 > 行为推断 > 模型默认
current_explicit_user > current_project_config > current_school_year_config
  > long_term_user_profile > behavior_inference > model_default
```

### 6.1 The 35-minute public-lesson example

The plan requires that a one-off must not overwrite a long-term value.
`schema.ts` pins this as `ONE_OFF_OVERWRITE_EXAMPLE`:

- **Durable record** (school year): `environment.class_duration_minutes = "45"`,
  `scope_type: 'school_year'`, `valid_for: '2026-2027'`.
- **This task**: the public lesson is 35 minutes.
- **Resolution**: `current_project_config` wins, `value = "本节公开课 35 分钟"`, and
  `durableRecordPreserved: true`. The teacher is not asked again next week whether their lessons
  are 45 minutes.

The mechanism is a rule, not a convention: the resolution returns
`durableRecordPreserved`, and the implementation **must not** call `memory_update` on the durable
record when that flag is true. An ephemeral winner is carried in the task's own context and
reaches the model through §8's injection, not through a namespace write.

`current_explicit_user` outranks everything, including a project config, because the plan's first
row is the teacher speaking right now. That is also what makes the `education` preset's memory
sentence true: "let what they state now override an older memory".

---

## 7. TTL and expiry

The plan: 学科可长期；年级/教材版本/班级情况按学年失效，到期是"重新确认"，不是重新盘问.

### 7.1 Which keys are stable, which expire

`schema.ts` declares this twice, so the two can be cross-checked:

1. Per field: `MemoryFieldDeclaration.stableKeys`.
2. Per scope type: `MEMORY_TTL_POLICY`.

| `scope_type` | Expires | TTL | On expiry |
|---|---|---|---|
| `stable` | no | — | never |
| `school_year` | yes | 365d | **reconfirm** |
| `term` | yes | 180d | **reconfirm** |
| `project` | yes | 120d | **reconfirm** |
| `class` | yes | 365d | **reconfirm** |
| `session` | yes | 1d | never (it was never long-term) |

Stable keys: `profile.subject`, `profile.role`, `preferences.*`, `corrections.rejected_behavior`.
Expiring keys: `profile.grades_taught`, `environment.textbook_edition`,
`environment.curriculum_standard`, `environment.class_profile`,
`environment.class_duration_minutes`, `environment.available_equipment`, and all `projects` fields.

`scope_type: 'school_year'` records carry `valid_for: '2026-2027'`. `schoolYearOf()` derives the
label from a date with an August 1 boundary, so `2027-01-15` → `2026-2027` and a record written in
September 2026 lands in the same school year as one written the following January.

### 7.2 Expiry produces re-confirmation, never interrogation

Expiry does **not** delete and does not cause a blank question. `isExpired()` still returns the
record; `reconfirmationFor()` turns it into a `MemoryReconfirmation` whose `previous_value` is the
recommended default:

> 我记得上学年你主要带高一，今年还是高一吗？

The prompt text is the field's own `reconfirmPrompt`, so it is declared per field rather than
generated from a template (fallback: `我记得{value}，今年还是这样吗？`). The teacher confirms or
corrects one value; they are not walked through the profile again.

An expired record must never be silently used as if current, and must never be silently dropped:
it is retrieved (with `include_expired`), rendered as a question with a default, and only
`memory_update` or a new `memory_set` resolves it.

---

## 8. Retrieval policy

Plan §三.4: **Memory 不全量注入。永远只注入极小的教师画像；其余按任务类型条件检索。**

### 8.1 Always injected — the tiny teacher profile

`MEMORY_INJECTION_MODES.always`, bounded by `STANDING_PROFILE_MAX_CHARS = 200`:

- `profile.display_name`
- `profile.subject`
- `profile.grades_taught`

Three fields. Nothing else is unconditional. This is what makes "Preset 是模板，Memory 是变量——不要
靠不断改写巨大 system prompt 传递状态" (plan §三.2) true in practice.

### 8.2 Retrieved per task type

`MEMORY_RETRIEVAL_RULES` declares one row per task type with `mustInclude`, `mustExclude`, and
`maxRecords`:

| Task type | Namespaces | Must include | Must exclude |
|---|---|---|---|
| `lesson_design` | environment, preferences, corrections, projects | `environment.curriculum_standard`, `environment.class_duration_minutes` | `projects.deliverable_index` |
| `ppt_design` | preferences, corrections | `preferences.output_format_preference`, `corrections.rejected_behavior` | `environment.class_profile`, `environment.available_equipment` |
| `assessment_design` | environment, preferences, corrections, profile | `preferences.assessment_preference`, `environment.curriculum_standard` | `projects.open_threads` |
| `general` | preferences, corrections | `corrections.rejected_behavior` | — |

The PPT row is the plan's own example of the distinction. Building a slide deck must retrieve the
teacher's format preferences and past corrections ("PPT 不要满屏字", "不要用 PPT 讲整节课"), and
must **not** retrieve class logistics: how many students are in 8 班, or whether the room has a
projector, changes nothing a deck contains. Retrieving them costs tokens and invites the model to
invent slides about classroom management.

`mustExclude` is the witness that retrieval is a decision rather than a namespace dump. A
retrieval unit test asserts that a `ppt_design` query over a populated store never returns an
`environment.class_profile` record even though `environment` records exist.

### 8.3 The per-step injection point

Memory reaches the model **conditionally, at the step boundary**, not by rewriting the system
prompt. The mechanism DSH provides is the `agent/pre-step` waterfall, whose contract is
"Replace the messages that enter it" (`deepseek-harness/packages/core/agent/src/runtime-types.ts:330`).
Three in-tree plugins already do exactly this, so it is a validated pattern rather than a guess:

- `dsh-tool-skill` injects the skill catalog and `/name`-invoked skill bodies
  (`deepseek-harness/packages/skill/tool-skill/src/index.ts:177`, `:213`).
- `dsh-agent-instructions` injects workspace instruction context
  (`deepseek-harness/packages/context/agent-instructions/src/index.ts:313`).
- `dsh-agent-default-model` rewrites the call configuration from the same payload
  (`deepseek-harness/packages/core/agent/src/model-selection.ts:109`).

So the implementation registers one `agent/pre-step` listener that:

1. Calls `next()` first (the waterfall contract: a listener must delegate, and this reader only
   adds).
2. Skips entirely when the step carries no task (tool continuations add nothing).
3. Computes the task type, runs `MEMORY_RETRIEVAL_RULES`, and returns `{ ...decision, messages:
   [...decision.messages, memoryContext] }`.

The injected message declares its own `MessageSourceMap` member (the extension point used by
`agent-instructions` at `state.ts:48-52` and `tool-skill` at `index.ts:43-47`), so the durable
session log records exactly what memory reached the model. That matters for two rules: the harness
convention "Model-visible ⟺ logged", and the plan's §七 `Memory Precision` / `Wrong Memory Usage
Rate` observables, which are read back from the session log.

**Why not a prompt section.** `ctx.systemPrompt.section()` accepts a
`text: (context) => string` provider evaluated at every assembly
(`deepseek-harness/packages/core/system-prompt/src/index.ts:448`, `:66`), and
`system-prompt/assemble` is a waterfall over the whole assembly (`:31`). Memory *could* be
rendered there. It is deliberately not: the assembled system prompt is the KV-cache prefix, so
changing it per step discards the cache for every step, while an appended user-role message is
cache-neutral at the tail. `dsh-tool-skill` states the same placement reasoning for the skill
catalog: background first, "the material the model must act on last, closest to its answer"
(`tool-skill/src/index.ts:163-176`).

The always-injected standing profile (§8.1) is the exception and rides the prompt registry,
because it is stable, tiny, and identical for every step.

---

## 9. The Question Ledger

Goal, verbatim from the plan: `Never ask twice unless the old answer may no longer be valid.`

Fields per entry (`QuestionLedgerEntry`):

| Field | Meaning |
|---|---|
| `id` | Leadger row id (storage table key). |
| `question_key` | Normalized key, e.g. `profile.grades_taught`. Asked questions join on this. |
| `asked` | What was actually asked, in the teacher's language. |
| `answer` | The answer as stored; absent only for `user_skipped`. |
| `answer_source` | `user_explicit` / `user_choice` / `user_skipped` / `memory_hit` / `safe_default`. |
| `last_confirmed` | ISO-8601 instant the answer was last confirmed. |
| `scope` | What the answer was valid for. |
| `valid_until` | When it stops being valid; drives re-asking. |
| `asked_count` | How many times this has been asked; the §七 `Ask Rate` observable. |
| `promoted_memory_id` | The memory record the answer produced, when it did. |

`QuestionLedgerDecision` answers "may I ask this again?" and returns the reason:
`never_asked`, `answer_expired`, `answer_invalidated_by_correction`,
`already_answered_and_still_valid`, `answered_by_safe_default`, or `ask_budget_exhausted`.

Three rules the implementation enforces here:

1. **A `safe_default` answer is an answer.** It is recorded and not re-asked as if unknown. The
   plan lists "不知道，你帮我选" as a normal path, not a fallback
   (`TEACHER-MODE-PLAN.md:88`).
2. **`answer_expired` returns a re-confirmation, not a question.** `QuestionLedgerDecision`
   carries `reconfirm` exactly when the reason is `answer_expired`, and the payload is the same
   `MemoryReconfirmation` from §7.2. The teacher never gets the original open question twice.
3. **A correction invalidates the ledger entry it contradicts.** `answer_invalidated_by_correction`
   exists so that a `corrections` write can force a single re-ask rather than leaving the ledger
   asserting a value the teacher has already overruled.

GrabMe must consult the ledger as step ④ of its pre-question checklist
(`TEACHER-MODE-PLAN.md:79`): ① current message ② Session State ③ Memory ④ Question Ledger.

---

## 10. The six tools

Exactly six (plan §四 P0-3: 只做 6 个工具（不要一上来 30 个）). No seventh tool is introduced by this
design. `schema.ts` declares all six as `MEMORY_TOOLS` with their input schema, output schema, and
a realistic call.

These declarations are the source; the implementation projects them to the two runtime forms DSH
needs — the wire JSON Schema for `defineTool({ parameters, output: { schema, render } })`
(`deepseek-harness/packages/core/tools/src/schema.ts:545`) and the zod record schemas for the
`storageDomain` spec (`deepseek-harness/packages/storage/storage-domain/src/spec.ts:107`).

### 10.1 `memory_get`

Read one exact field. Preferred over `memory_search` when the field name is known.

- **Input**: `namespace` (enum, required), `key` (string, required), `scope?` (Scope),
  `include_expired?` (boolean).
- **Output**: `{ found: boolean, record?: MemoryRecordView, reconfirm?: MemoryReconfirmation }`.
- **Example**: `{ namespace: 'environment', key: 'textbook_edition', scope: { scope_type:
  'school_year', valid_for: '2026-2027' } }` → `{ found: true, record: { value: '人教版必修一',
  ... } }`.

### 10.2 `memory_search`

Find memories relevant to the current task.

- **Input**: `query` (string, required), `namespaces?` (enum array), `scope_type?` (enum),
  `min_confidence?` (number), `include_expired?` (boolean), `limit?` (integer).
- **Output**: `{ records: MemoryRecordView[], truncated: boolean }`.
- **Example**: `{ query: '设计一节大气受热过程的 PPT', namespaces: ['preferences','corrections'],
  limit: 8 }` → the teacher's slide-format preference.
- This tool backs the control surface's 查看 AI 记住了什么 (§11), so the teacher can ask the same
  question the agent asks.

### 10.3 `memory_set`

Save one durable fact.

- **Input**: `namespace` (required), `key` (required), `value` (required), `details?`, `scope`
  (required), `confidence` (required; enum **excludes** `weak_inference`), `evidence` (required),
  `quoted_fragment?`.
- **Output**: `{ record: MemoryRecordView, created: boolean, merged_with?: MemoryId }`.
- **Example**: `{ namespace: 'environment', key: 'class_duration_minutes', value: '45', scope:
  { scope_type: 'school_year', valid_for: '2026-2027' }, confidence: 'explicit_user', evidence:
  '老师在第 3 轮说明每节课 45 分钟。', quoted_fragment: '我们一节课 45 分钟' }`.
- `evidence` is required so every durable write is justifiable after the fact. `weak_inference` is
  absent from the enum, so the promotion gate cannot be bypassed through the tool.

### 10.4 `memory_update`

Correct or restate an existing record. Backs 修改.

- **Input**: `id` (required), `value?`, `details?`, `scope?`, `confidence?`, `evidence` (required).
- **Output**: `{ record: MemoryRecordView, previous_value: string }`.
- **Example**: `{ id: 'mem_01J8ZC01', value: '40', confidence: 'explicit_correction', evidence:
  '老师纠正：这学期调成了 40 分钟。' }` → `{ previous_value: '45', record: { value: '40' } }`.
- `previous_value` is returned so the control surface can show "45 → 40" and offer undo, and so the
  §七 `Wrong Memory Usage Rate` metric can be audited after a correction.

### 10.5 `memory_forget`

Delete. Backs 删除.

- **Input**: `id?`, `namespace?`, `key?`, `scope?`, `confirm` (required, must be `true`).
- **Output**: `{ deleted: number, deleted_ids: MemoryId[] }`.
- **Example**: `{ id: 'mem_01J8ZB44', confirm: true }` → `{ deleted: 1, deleted_ids:
  ['mem_01J8ZB44'] }`.
- `confirm` is required and must be true, because deletion is irreversible. The tool is denied
  rather than silently ignored when `confirm` is absent.

### 10.6 `memory_feedback`

Report wrong / outdated / not-for-this-task.

- **Input**: `record_id?`, `namespace?`, `key?`, `signal` (required: `correct` | `incorrect` |
  `outdated` | `dont_use_this_time`), `corrected_value?`, `evidence` (required).
- **Output**: `{ action: 'corrected' | 'invalidated' | 'suppressed_for_session' | 'no_op',
  record?: MemoryRecordView, correction_recorded: boolean }`.
- **Example**: `{ record_id: 'mem_01J8ZC01', signal: 'dont_use_this_time', evidence: '老师说明
  本次公开课 35 分钟，不是平时的 45 分钟。' }` → `{ action: 'suppressed_for_session',
  correction_recorded: false }`, with the stored record's `value` still `'45'`.
- `dont_use_this_time` is the tool-level form of §6.1's one-off rule and §11's 本次不要用: it
  suppresses for the session and never overwrites. `correction_recorded` tells the caller whether a
  durable `corrections` write happened, so a suppression is never mistaken for a correction.

### 10.7 Tool registration requirements

- All six register through `ctx.tools.register(definition)` — `ToolRuntime.register` at
  `deepseek-harness/packages/core/tools/src/index.ts:1027`, returning the exact disposer, so the
  registrations are effects and unload cleanly.
- Each tool declares a presenter. `presentCall` / `presentResult` are `ToolDefinition` methods
  (`index.ts:271`, `:279`) that return a `ToolCallView` / `ToolResultView`
  (`deepseek-harness/packages/core/tools/src/presentation.ts`). Design them up front — the
  registered view for `memory_get` should show the key and the remembered value, and for
  `memory_feedback(dont_use_this_time)` should show that the value is suppressed for this task only,
  not deleted.
- Output `render` must be a pure projection of the canonical value. For the control-surface
  requirement, `memory_search`'s result is what the teacher sees when they ask what the AI
  remembers, so it must not leak `session_ref`.

---

## 11. Memory Promotion pipeline

Plan §五, verbatim ordering:

```
Session Observation → Memory Candidate → Worth saving?
   ├── NO  → discard
   └── YES → Deduplication → Conflict Check → Scope Selection → Save
```

`schema.ts` pins this as `MEMORY_PROMOTION_PIPELINE` and models each stage's output.

`MemoryObservation` is the **only** shape that leaves the session. `channel` is
`user_message` | `user_correction` | `session_log` | `project_config`. The `session_log` channel
reads structure — which tools ran, which files were edited — never prose. Raw chat logs are never
persisted; the observation carries a `session_ref` locator and, when explicit, a short
`quoted_fragment`.

### 11.1 `Worth saving?` — the discard set

`MemoryDiscardReason` is a closed union so the eval harness can count what was dropped and why:

| Reason | Fires when |
|---|---|
| `weak_inference` | The candidate's rung is not long-term eligible (§5). |
| `one_off_task_parameter` | True only for the current task (35 分钟公开课). |
| `transient_negation` | A single negative instruction (§5.1). |
| `already_covered_by_skill` | The content is method, which belongs to a Skill (§2). |
| `raw_chat_text` | The candidate is conversation, not an extracted fact. |
| `not_about_the_teacher` | It is about the world or the model, not this user. |

`MemoryPromotionResult.stage = 'discarded'` carries the candidate, not just the reason, so §七's
`Memory Precision` can be computed over what the extractor rejected.

### 11.2 Deduplication

Join on `(namespace, key, scope)`. An exact value match refreshes `last_confirmed_at` and, when the
rung increases, raises `confidence`; it does not create a second row. A near-duplicate within the
same key goes to Conflict Check rather than being written alongside.

### 11.3 Conflict Check

Rank all candidates through `MEMORY_CONFLICT_PRIORITY` (§6) and return a
`MemoryConflictResolution`. When `durableRecordPreserved` is true, the durable row is left alone
and the ephemeral winner reaches the model through the step injection.

### 11.4 Scope Selection

Apply the namespace's `MemoryFieldDeclaration` for the key: reject a `stableKeys: false` field
proposed as `stable`, default to `defaultScopeType` when the extractor is unsure, and stamp
`valid_for` from `schoolYearOf()` for school-year records. Compute `expires_at` from
`memoryTtlFor()`. This is the stage that makes §5.1's permitted extraction land in `projects`
instead of `preferences`.

### 11.5 Save

Write through the domain table. Emit the change so the control surface updates, and — when the
saved record answers a ledger question — set `promoted_memory_id` on the entry and refresh
`last_confirmed`.

---

## 12. Persistence: `storageDomain`, not a hand-rolled database

The plan forbids building a database (plan §四 P0-3: 持久化走 DSH 的 `storageDomain`，不自己造库).
The capability and its real consumers:

- **Facility / provider**: `DomainFacility`, provided as `ctx.storageDomain` by the
  `storage-domain` plugin (`deepseek-harness/packages/storage/storage-domain/src/index.ts:236`,
  class at `:69`, service augmentation at `:35-39`). Declare it in `inject`.
- **Declaring a domain**: `defineDomain` + `domainTable` +
  `domainTable<Key, Value>(zodSchema)`
  (`deepseek-harness/packages/storage/storage-domain/src/spec.ts:107`, `:91`).
- **Consumer 1 — workspace registry**: `storageDomain` + `sessionPersistence` in `inject`, opens
  the domain at init, closes it as an effect, holds one table plus the global
  (`deepseek-harness/packages/workspace/workspace/src/index.ts:92`, `:119-123`).
  Domain spec at `deepseek-harness/packages/workspace/workspace/src/spec.ts:68-76`.
- **Consumer 2 — session projection cache**: `inject = ['storageDomain', 'sessionProjections',
  'sessions']`, same open/close shape
  (`deepseek-harness/packages/session/session-projection-cache/src/index.ts:93`, `:106-108`).

So the implementation's `index.ts` follows the workspace-registry shape:

```ts
static inject = ['storageDomain']
protected async [Service.init](): Promise<void> {
  const domain = await this.ctx.storageDomain.open(memoryDomainSpec)
  this.ctx.effect(() => () => domain.close(), 'globalMemory.domainClose')
  this.memories = domain.table('memories')
  this.ledger = domain.table('question_ledger')
  this.meta = domain.global
}
```

`MEMORY_DOMAIN` in `schema.ts` declares `name: 'global_memory'`, `version: 1`, tables
`memories` + `question_ledger`, and a `meta` global. The name is a `storageDomain` unit name and
must match `UNIT_NAME_RE`; the implementation asserts this with `defineDomain`, which fails loud at
load (`spec.ts:107-147`).

Reads are synchronous from the domain's in-memory state; every write is queued on the domain's
single write chain and is durable before memory mutates (`domain.ts` module doc, `KvTable` at
`spec.ts`/`domain.ts:42-90`). Retrieval can therefore run inside a `agent/pre-step` listener
without an async read hop. The `domain/changed` event is what drives the control surface's live
view.

One caveat worth recording: `DomainSpec.global.schema` must not accept `null`, and
`domain.global.get()` throws when the spec declares no global (`spec.ts:140-145`,
`domain.ts:204-209`). Declaring `meta` as a real (non-nullable) global is therefore required, not
optional.

### 12.1 Mount plane

The memory service must be **one shared instance** across the teacher, research, and coding
presets (plan §四 P0-3: 教师/研究/编码预设共用同一个底层服务). `dsh-plugin-desktop/presets/education/agent.cordis.yml:16-23`
documents that a service row in an agent preset must sit inside a group carrying an `isolate`
realm, or it publishes process-global and collides; and that a realm-per-preset instance would
give each preset its own memory, which is exactly what this design must avoid.

Consequence for whoever integrates this: mount the service on the **host plane** (alongside the
other registries the preset file explicitly says stay there — `tools`, `skills`, `sessions`,
`subagents`, `sessionProjections`; see `agent.cordis.yml:83-84`, `:107-108`, `:188-192`), and have
presets contribute only reachability of the six tools plus `memory_policy` prose. The exact host
composition file is **not** identified here — see §15.

---

## 13. User-visible control surface

Requirement: **the teacher must be able to see what the AI remembers and 修改 / 删除 / 本次不要用.**

`schema.ts` declares `MEMORY_CONTROL_SURFACE` with each affordance and the tool that backs it:

| Teacher sees | Tool | Durable |
|---|---|---|
| 查看 AI 记住了什么 | `memory_search` | no (read) |
| 修改 | `memory_update` | yes |
| 删除 | `memory_forget` | yes |
| 本次不要用 | `memory_feedback` (`dont_use_this_time`) | **no** |

Implementation requirements:

1. **Everything stored is listable.** `memory_search` with an empty query and no namespace filter
   returns every non-session-suppressed record. A record the teacher cannot see is a record they
   cannot correct.
2. **Every row shows its provenance.** The control surface renders `source.source`, `confidence`
   as a word not a number ("你明确说过" / "我推断的"), `updated_at`, and — for expired rows — the
   re-confirmation prompt from §7.2. Reusing `quoted_fragment` here is what lets a teacher
   recognise a wrong memory as wrong.
3. **本次不要用 never deletes.** It sets `suppressed_for_session` to the current session id and
   returns `action: 'suppressed_for_session'`. The next session sees the value again. This is the
   same rule as §6.1, exposed to the teacher directly.
4. **Deleting is explicit and confirmed.** `memory_forget` requires `confirm: true`; the surface
   shows the value being deleted and its scope first.
5. **A correction is durable and traceable.** 修改 produces `corrections.rejected_behavior` /
   `corrections.corrected_value` at 1.00, so the plan's "用户纠正过一次的问题，不应再发生第二次" has
   something to retrieve next time.

This surface is a *Host/Client* concern, not a model-facing one — the model reaches the same data
through the six tools. The design fixes the data contract (record metadata, provenance, the
suppress-for-session field) so a client can be built without further schema work.

---

## 14. Files this package is expected to grow

The plan names the implementation files (plan §四 P0-3, `TEACHER-MODE-PLAN.md:130-131`). This
deliverable creates the first two; the rest are the implementer's:

| File | Owns |
|---|---|
| `README.md` | this document |
| `schema.ts` | ✅ created — record schema, namespaces, ladder, priority, TTL, ledger, six tools |
| `index.ts` | plugin entry: opens the domain, registers the six tools, the step listener, the service |
| `retrieval.ts` | §8 policy execution and the standing-profile render |
| `extractor.ts` | §11 pipeline and the discard rules |
| `conflict.ts` | §6 ranking and `durableRecordPreserved` |
| `question-ledger.ts` | §9 decision and re-confirmation |
| `DESIGN-NOTES.md` | evidence map |

---

## 15. What could not be confirmed

Recorded honestly rather than guessed:

1. **The host-plane composition file for the desktop product.** `base.cordis.yml` /
   `web.cordis.yml` are named in
   `dsh-plugin-desktop/presets/education/agent.cordis.yml:12-13`, but no such file exists anywhere
   in the repository at the time of writing (a recursive search for `*.cordis.yml` outside
   `node_modules` returns only upstream preset files, the desktop preset, and no host
   composition). The mount plane in §12.1 is therefore a derived requirement, not a verified path.
   The integrator must locate the real host composition.
2. **Whether DSH has a per-step *system prompt* hook distinct from `system-prompt/assemble`.**
   `domain.ts`/`index.ts` for `system-prompt` show assembly happens before each model step and
   exposes `section()` / `context()` / `tools()` providers plus the `system-prompt/assemble`
   waterfall. No separate pre-step prompt event was found. `agent/pre-step` was chosen on the
   evidence in §8.3.
3. **A teacher-specific memory UI or control surface client.** None exists in the repository. §13
   fixes the data contract only.
4. **Zod is not resolvable from `teacher/packages/`.** `teacher/node_modules` is a pnpm layout with
   no hoisted `zod`, and `teacher/packages/*` have no `node_modules`. `schema.ts` therefore imports
   nothing. The implementer must add a package manifest with `zod` (the upstream version is
   `^4.4.3`, per `deepseek-harness/packages/storage/storage-domain/package.json`) before projecting
   the zod record schemas.
5. **`MemoryId` / `MemoryCandidateId` branding.** This schema declares them as branded strings
   following the harness convention (`Opaque cross-boundary ids are branded`). `dsh-brand` is
   available upstream but is not resolvable from `teacher/packages/` for the same reason as (4),
   so the brand is declared locally. Whoever integrates should switch to
   `brandString<MemoryId>()` if the package gains upstream dependencies.
