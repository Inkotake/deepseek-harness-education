# DESIGN-NOTES — evidence map for `dsh-global-memory`

Every design decision in [`README.md`](./README.md) and every type in [`schema.ts`](./schema.ts)
maps onto something this repository actually has. This file records that mapping, plus the
verification I ran, the three citations I got wrong on the first pass, and what remains
unconfirmed.

---

## 1. What I searched, and how

| Target | Command shape | Result |
|---|---|---|
| `storageDomain` capability | `grep -r "storageDomain"` over `deepseek-harness/packages/**/*.ts` | 30 matches: 1 service definition, 2 real consumers, 3 test fixtures |
| Tools registry + a registering plugin | `read` of `core/tools/src/index.ts`, `core/tools/src/schema.ts`; `read` of `skill/tool-skill/src/index.ts` | `ToolRuntime`, `defineTool`, `presentCall`/`presentResult` |
| Prompt contribution + per-step injection | `grep` for `MessageSourceMap`, `agent/pre-step`; `read` of `core/system-prompt/src/index.ts`, `core/agent/src/runtime-types.ts` | `ctx.systemPrompt.section()/context()/tools()`; `agent/pre-step` waterfall |
| Skill subsystem | `glob`/`read` of `packages/skill/{skill,skill-badge,skill-filesystem,tool-skill}` | `ctx.skills` registry + `skill` loader tool + per-step catalog |
| Existing in-tree memory plugin | `grep` for `dsh-memory\|dsh-global-memory\|memoryDomain\|memoryStore`; filename search for `memory` under `dsh-plugin-desktop/presets`, `teacher/packages`, `teacher/skills`, `dsh-plugin-desktop/src`; recursive `*.cordis.yml` search | **none**. Only opt-in *MCP client* examples |
| Teacher preset contract | `read` of `dsh-plugin-desktop/presets/education/{preset.yml,agent.cordis.yml}` | already contains the memory policy prose and the realm rules |

---

## 2. Decision → evidence

### 2.1 Persistence goes through `storageDomain`

**Decision:** the service declares a storage domain and never opens a file, database, or JSON
store of its own (README §12).

| Evidence | What it establishes |
|---|---|
| `deepseek-harness/packages/storage/storage-domain/src/index.ts:236` — `domainCtx.provide('storageDomain', facility)` | The service is published under that exact name. |
| `.../storage-domain/src/index.ts:35-39` — `declare module '@deepseek-ai/cordis' { interface Context { storageDomain: DomainFacility } }` | A consumer declares `storageDomain` in `inject` and calls `ctx.storageDomain.open(spec)`. |
| `.../storage-domain/src/index.ts:69` — `export class DomainFacility` | The provider type; `open()` is at `:103`. |
| `.../storage-domain/src/spec.ts:107` — `export function defineDomain<S extends DomainSpec>(spec: S): S` | The declaration helper, and the load-time validation (`UNIT_NAME_RE`, integer version, non-nullable global). |
| `.../storage-domain/src/spec.ts:91` — `export function domainTable<K extends string, V>(schema: ZodType<V>)` | One table = one zod schema. Record schemas are **zod**, while plugin `Config` is schemastery — stated in the module doc at `spec.ts:4-8` and `index.ts:5-6`. |
| `deepseek-harness/packages/workspace/workspace/src/index.ts:92` — `static inject = ['storageDomain', 'sessionPersistence']` | Real consumer #1. |
| `.../workspace/workspace/src/index.ts:119-123` — `open` → `ctx.effect(() => () => domain.close())` → `domain.table('workspaces')` → `domain.global` | The exact open/close/table/global shape README §12 copies. |
| `deepseek-harness/packages/workspace/workspace/src/spec.ts:68-76` — `defineDomain({ name: 'workspace', version: 2, global: {...}, tables: { workspaces: domainTable<...>(...) } })` | The exact spec shape `MEMORY_DOMAIN` follows. |
| `deepseek-harness/packages/session/session-projection-cache/src/index.ts:93` and `:106-108` | Real consumer #2, same shape — so the shape is a convention, not one file's habit. |
| `.../storage-domain/src/spec.ts:140-145` | A global schema must not accept `null` (null is the "never written" sentinel). This is why README §12 says declaring a non-nullable `meta` global is required, not optional. |
| `.../storage-domain/src/domain.ts:204-209` — `get global()` throws when the spec declares none | Same conclusion from the runtime side. |
| `.../storage-domain/src/domain.ts:1-10` (module doc) and `.../storage-domain/src/domain.ts:42-90` (`KvTable`) | Reads are synchronous from in-memory state; writes queue on one chain and are durable before memory mutates. This is what lets retrieval run inside a `agent/pre-step` listener with no async read hop. |

**Nothing was hand-rolled.** No `node:fs`, no `sqlite`, no `better-sqlite3` appears in this design.

### 2.2 The six tools register through `ctx.tools`

**Decision:** six tools, typed input/output, with presenters designed up front (README §10).

| Evidence | What it establishes |
|---|---|
| `deepseek-harness/packages/core/tools/src/index.ts:131` — `tools: ToolRuntime` in the `Context` augmentation | `ctx.tools` is the registry. |
| `.../core/tools/src/index.ts:780` — `export class ToolRuntime extends Service` | The service; `static inject = ['systemPrompt']` at `:781`. |
| `.../core/tools/src/index.ts:1027` — `register(definition: ToolDefinition): () => void` | Registration returns the exact disposer, so registrations are effects (AGENTS.md: "Registrations are effects"). |
| `.../core/tools/src/schema.ts:545` — `export function defineTool<const S, const O>(options: DefineToolOptions<S, O>): ToolDefinition` | The typed tool helper. |
| `.../core/tools/src/schema.ts:483-536` — `DefineToolOptions` | The declaration surface: `parameters` (implicit property-map DSL with per-property `required: true`), `output: { schema, render, presentationMeta? }`, optional `presentCall`/`presentResult`. |
| `.../core/tools/src/index.ts:271` / `:279` — `presentCall?(args): ToolCallView \| undefined` / `presentResult?(args, result): ToolResultView \| undefined` | The two presenters README §10.7 requires. |
| `deepseek-harness/packages/core/tools/src/presentation.ts:1-6` and `:15` (`ToolCallKind`) | The render-intent vocabulary. |
| `deepseek-harness/packages/skill/tool-skill/src/index.ts:11` (`import { defineTool }`), `:81-161` (the `skill` tool), `:157-159` (`presentCall`), `:161` (`ctx.tools.register(skillTool)`) | A complete worked example of a plugin registering a tool with a JSON-schema-shaped input, an `additionalProperties: false` output schema with `oneOf` branches, a `render`, and a presenter. `MEMORY_TOOLS` mirrors this. |
| `.../tool-skill/src/index.ts:84` — `parameters: { name: { type: 'string', required: true, description: '...' } }` | Confirms the implicit-open-object parameter form used by the six declarations. |

**Why the schema file carries output schemas too.** `defineTool` requires
`output.schema` (a canonical output contract enforced by the registry,
`core/tools/src/schema.ts:491-498`), so the tool's output is part of its declared contract and
belongs in `schema.ts` next to the input. `ToolRuntime.register` type-checks the declaration at
runtime (`index.ts:1029-1035`).

### 2.3 Memory reaches the model at the step boundary, not by rewriting the prompt

**Decision:** conditional retrieval via `agent/pre-step`; only the tiny standing profile uses the
prompt registry (README §8.3).

| Evidence | What it establishes |
|---|---|
| `deepseek-harness/packages/core/agent/src/runtime-types.ts:330` — `'agent/pre-step'(this: Scoped<Agent>, payload: {agent, messages, turn, step, signal}, next) => Promise<PreStepDecision>` | The per-step waterfall exists, and its documented purpose is "Reject a proposed step or replace the messages that enter it" (`:319-321`). |
| `.../core/agent/src/runtime-types.ts:112-119` — `PreStepDecision = { kind: 'reject' } \| { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true }` | The decision shape; `messages` is replaceable. |
| `deepseek-harness/packages/skill/tool-skill/src/index.ts:177-204` | Precedent #1: inject a user message from `agent/pre-step`. |
| `deepseek-harness/packages/skill/tool-skill/src/index.ts:213-251` | Precedent #2 (the skill catalog), with digest-based suppression so the same context is not re-injected. |
| `deepseek-harness/packages/context/agent-instructions/src/index.ts:313-339` | Precedent #3, and the closest analogue: workspace context injected at every step, folded "right after the claimed batch" (`:336-337`). |
| `deepseek-harness/packages/core/agent/src/model-selection.ts:109-110` | Precedent #4: the same payload used to replace the call configuration. |
| `deepseek-harness/AGENTS.md:110` — "Waterfall listeners MUST call `next()` to delegate" | Why the memory listener must call `next()` first. |
| `deepseek-harness/AGENTS.md:111` — "Model-visible ⟺ logged: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event." | Why the injected message needs its own `MessageSourceMap` member, not an anonymous message. |
| `deepseek-harness/packages/llm/llm/src/message.ts:102` — `export interface MessageSourceMap` | The extension point itself. |
| `deepseek-harness/packages/context/agent-instructions/src/state.ts:48-52` | The exact `declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { ... } }` form to copy. |
| `deepseek-harness/packages/context/session-reference/src/types.ts:34-38` | A second, independent instance of the same form. |
| `deepseek-harness/packages/core/system-prompt/src/index.ts:448` — `section(section: PromptSection): () => void`, and `:66` — `text: string \| ((context: AssembleContext) => string)` | The prompt registry's dynamic provider — the route I deliberately did **not** take for retrieval. |
| `.../core/system-prompt/src/index.ts:483` — `context(context: PromptContext): () => void`, `:515` — `tools(provider)`, `:31` — `'system-prompt/assemble'` waterfall, `:618` — where the waterfall is dispatched | The complete set of prompt contribution points, so "no separate pre-step prompt event was found" is a checked statement, not an assumption. |
| `.../core/system-prompt/src/index.ts:121-154` — `SECTION_ORDERS`, `:159-163` — `CONTEXT_ORDERS` | The centrally allocated positions. The standing profile needs a position; none is allocated for memory, so the implementer should add one rather than invent a number inline. |
| `deepseek-harness/packages/skill/tool-skill/src/index.ts:163-176` (comment) and `:166-168` — "background first ..., the material the model must act on last, closest to its answer" | The in-repo statement of the placement reasoning README §8.3 gives for appending memory at the tail. |
| `deepseek-harness/packages/preset/persona/src/index.ts:63-74` | The preset-visible route to prompt sections: `ctx.systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text })`, plus `suppressRuntimeContext()`. |

**The KV-cache argument is imported, not measured.** README §8.3 claims appending a user-role
message is cache-neutral while changing a system section is not. I did not find an in-repo
document stating that trade-off explicitly; it follows from the sections being a prefix. Treat it
as reasoned, not cited.

### 2.4 Skills and Memory stay separate

**Decision:** `schema.ts` never models method; the extractor has an `already_covered_by_skill`
discard reason (README §2, §11.1).

| Evidence | What it establishes |
|---|---|
| Plan §二 (`teacher/TEACHER-MODE-PLAN.md:34`) — "怎么想"属于 Skill；"记什么/取什么"属于 Memory | The separation is the spec's own judgement rule. |
| `deepseek-harness/packages/skill/tool-skill/src/index.ts:81-83` | The `skill` tool's model-facing description: "Load the full instructions for an available skill. Call this with the exact skill name from the session skill catalog before acting..." — skills are loaded on demand, which is what keeps them out of memory. |
| `.../tool-skill/src/index.ts:254-277` — `renderCatalogMessage`, especially `:266` "This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded." | Progressive disclosure is already DSH behaviour; memory must not duplicate it. |
| `.../tool-skill/src/index.ts:34-47` and `:49-58` — `SkillCatalogSource` + `catalogSourceEntries` | The catalog records its entries as durable structured data beside the model-facing prose. The parallel for memory is the `MessageSourceMap` member in §2.3. |
| Plan §二 line 30 — the Global Memory row's "不负责" column is 不决定教学方法 | Memory explicitly does not decide teaching method. |

### 2.5 No existing memory plugin to reuse

**Decision:** implement a thin native service rather than adopting an MCP memory server
(plan §四 P0-3: 不绑死任何社区插件，自己实现一个很薄的 adapter).

| Search | Result |
|---|---|
| `grep "dsh-memory\|dsh-global-memory\|memoryDomain\|memoryStore"` over `deepseek-harness/packages/**/*.ts` | No matches. |
| Filename search for `memory` under `dsh-plugin-desktop/presets`, `teacher/packages`, `teacher/skills`, `dsh-plugin-desktop/src` | No matches. |
| Recursive `*.cordis.yml` search | Two **example** configs exist: `deepseek-harness/apps/cli/config/examples/mcp-memory/mcp-reference-memory.cordis.yml` and `.../engram.cordis.yml` |

Both examples mount `@deepseek-ai/dsh-mcp-client` against an **external** executable
(`mcp-server-memory`, `engram`), and both say so: "Install the pinned executable first; DSH starts
it but does not run a package manager"
(`mcp-reference-memory.cordis.yml:1-2`, `engram.cordis.yml:1-2`). They are references for an
opt-in third-party server, not an in-tree memory implementation — which is exactly the situation
the plan's "不绑死任何社区插件" anticipates.

---

## 3. The plan text this design implements

Cited by line so the implementation can be checked against the spec directly.

| Requirement | Plan lines | Where it lands |
|---|---|---|
| Five namespaces | `TEACHER-MODE-PLAN.md:106` | `MEMORY_NAMESPACES`, `MEMORY_NAMESPACE_DECLARATIONS` |
| Exactly six tools | `:108-109` | `MEMORY_TOOL_NAMES`, `MEMORY_TOOLS` |
| Required metadata | `:111` | `MemoryRecord` |
| Confidence ladder | `:113-120` | `MEMORY_CONFIDENCE_LADDER` |
| The "这次不要课堂活动" rule | `:121` | `TRANSIENT_NEGATION_EXAMPLE` |
| Conflict priority | `:123` | `MEMORY_CONFLICT_PRIORITY` |
| TTL + re-confirmation sentence | `:125` | `MEMORY_TTL_POLICY`, `reconfirmationFor()` |
| Question Ledger + its goal | `:127-128` | `QuestionLedgerEntry`, `QuestionLedgerDecision` |
| Persistence via `storageDomain` | `:131` | `MEMORY_DOMAIN` |
| Promotion five-step pipeline, no chat-log persistence | `:138-139` | `MEMORY_PROMOTION_PIPELINE`, `MemoryObservation` |
| Memory not fully injected | `:48` | `MEMORY_INJECTION_MODES`, `MemoryRetrievalRule` |
| Preset is template / Memory is variable | `:45` | README §8.1 (200-character standing profile) |
| Four pre-question checks incl. the ledger | `:79` | README §9 |
| Eval observables read from the session log | `:149-164` | README §8.3, §11.1 |

---

## 4. Verification performed

### 4.1 `schema.ts` type-checks in isolation — PASS

Two runs, from `C:\Users\inkot\Desktop\kc\teacher-dsh-desktop`:

```powershell
node .\dsh-plugin-desktop\node_modules\typescript\lib\tsc.js --noEmit --strict `
  --target es2022 --module esnext --moduleResolution bundler --lib es2022 `
  --skipLibCheck "teacher\packages\global-memory\schema.ts"
# EXIT=0
```

and a stricter second pass with an explicit minimal `tsconfig.json`
(`strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`types: []`, `files: [schema.ts]`):

```powershell
node .\dsh-plugin-desktop\node_modules\typescript\lib\tsc.js -p .tscheck-mem\tsconfig.json
# EXIT=0
```

Compiler: TypeScript **6.0.3** from `dsh-plugin-desktop/node_modules/typescript`. Node: **v24.14.0**.

Two notes on the flags:

- `--lib es2022` and `types: []` are required because the file must not depend on anything. With
  the default lib set, `Object.freeze` and friends need DOM/ES libs that the isolation check should
  not silently supply.
- The repository's own `tsconfig.base.json` was **not** used. A package under `teacher/packages/`
  is outside the upstream pnpm workspace and has no manifest, so extending the upstream base would
  pull in `paths` mappings this file cannot resolve. The flags above are the isolation check; the
  integrator should add a real manifest + tsconfig extending the teacher workspace's convention.
- **Nothing was rejected.** No `@ts-expect-error`, no `any`, no cast was needed.

### 4.2 Runtime export check — PASS

```powershell
node --experimental-strip-types -e "import('file:///.../teacher/packages/global-memory/schema.ts').then(...)"
```

Reported 23 exports, and the four values the design leans on:

```
TOOLS=memory_get,memory_search,memory_set,memory_update,memory_forget,memory_feedback
PRIORITY=current_explicit_user > current_project_config > current_school_year_config > long_term_user_profile > behavior_inference > model_default
LADDER=explicit_user=1 explicit_correction=1 repeated_behavior=0.85 strong_inference=0.65 weak_inference=0
SY=2026-2027          # schoolYearOf('2027-01-15T00:00:00.000Z')
```

So the six-tool list, the priority order, the ladder values, and the August school-year boundary
are all verified as executing TypeScript, not just as types. (Console output was read for Latin
and numeric values only; Chinese strings were verified with the `read` tool, per the known console
UTF-8 limitation.)

### 4.3 Citation verification — 51 citations checked, 3 corrected

Every `file:line` in `README.md` and in this file was re-opened and read at the cited line before
this file was written. Three were wrong on the first pass and are corrected in the shipped files:

1. **`tool-skill/src/index.ts:164-167`** (draft) → shipped as **`:163-176`**. The placement-reasoning
   comment starts at `:163`, not `:164`; the range is one line wider. Verified by reading
   `:162-177`.
2. **`agent.cordis.yml:83-84`** (draft, used as a `tools`-stays-on-host citation) → shipped as
   **`:83-84` for `tool-fs`/`tool-fs-search` only**, with the `tools` registry claim moved to the
   realm rule at `:16-23`. The file's `tools`-registry statement is in the header comment, not next
   to those rows; citing `:83-84` for it would have been a real misattribution.
3. **§12.1's host-plane claim** (draft: "the exact host composition file is not identified here") →
   shipped as a located path, `deepseek-harness/packages/bundle/base/cordis.patch.yml:141-156`. My
   first search used `Get-ChildItem -Filter *.cordis.yml`, which matched neither the bundle patches
   (named `cordis.patch.yml`) nor anything else, and I nearly shipped "no host composition exists"
   on the strength of a glob that could not have found it. Searching for `base.cordis.yml` by name
   turned up nothing, but searching the bundle packages for `storage|tools|system-prompt` found the
   real composition in one step. The shipped text now cites the real file and names the stale
   `base.cordis.yml` / `web.cordis.yml` reference as stale.

One citation is deliberately soft and labelled as such in README §15 item 4: `zod` is `^4.4.3`,
read from `deepseek-harness/packages/storage/storage-domain/package.json` and
`deepseek-harness/packages/workspace/workspace/package.json` with `Select-String` rather than
`read` (JSON manifests, not prose).

---

## 5. Anything I could not confirm

Restated from README §15, because these are the parts an integrator must not treat as settled:

1. **Which plane the service should live on is a product decision.** The *mechanics* are settled:
   one `- insert:` row in `deepseek-harness/packages/bundle/base/cordis.patch.yml`, beside
   `storage-domain` at `:153-156`, whose `config: { backend: json }` already routes every domain to
   the JSON backend rooted at `dshHomePath('storages')` (`:148-151`). What I could not confirm is
   whether a teacher-specific service belongs in the shared base bundle, which every profile loads,
   or in a desktop-owned patch layer over it.
   `deepseek-harness/AGENTS.md` forbids editing the upstream submodule from a desktop feature
   branch, so it is almost certainly the latter — but the specific layer is the integrator's call,
   and no wiring was attempted per the task's explicit instruction.
2. **No separate per-step system-prompt hook.** I searched `core/system-prompt/src/*.ts` and
   `core/agent/src/*.ts` for a pre-step prompt event and found only `agent/pre-step` and
   `system-prompt/assemble`. "Cannot confirm an alternative injection point exists" is the accurate
   statement.
3. **No teacher memory UI.** No control-surface client exists in the repository; README §13 fixes
   the data contract only.
4. **`zod` is not resolvable from `teacher/packages/`.** `teacher/node_modules` is a pnpm layout
   (`.pnpm`, `.modules.yaml`) with no hoisted `zod`; `teacher/packages/*` have no `node_modules`
   and `teacher-bundle/package.json` declares no runtime dependencies. `schema.ts` imports nothing
   for this reason. The zod projection and the package manifest are the integrator's work.
5. **Branded ids are local.** `MemoryId`/`MemoryCandidateId` use a locally declared `unique symbol`
   brand because `@deepseek-ai/dsh-brand` is not resolvable there either. AGENTS.md requires branded
   cross-boundary ids, so this is a temporary local form; switch to `brandString<...>()` once the
   package has upstream dependencies.

### Resolved after the first pass

- **`MEMORY_DOMAIN.name = 'global_memory'` passes `UNIT_NAME_RE`.** The pattern is
  `/^[a-z][a-z0-9_]*$/`, read directly at
  `deepseek-harness/packages/storage/storage/src/backend.ts:10` and re-exported at
  `.../storage/src/index.ts:15`. `global_memory`, `memories`, and `question_ledger` all match.
  `defineDomain` enforces the pattern on the domain name and every table name at load
  (`storage-domain/src/spec.ts:108-110`, `:136-139`).
- **`base.cordis.yml` / `web.cordis.yml` do not exist.** A name search over the whole repository
  including `node_modules` returns nothing. The bundles' composition files are `cordis.patch.yml`
  (`deepseek-harness/packages/bundle/{base,web-app,headless,acp-app,sdk-app,sdk-minimal}/cordis.patch.yml`).
  The preset comment at `dsh-plugin-desktop/presets/education/agent.cordis.yml:12-13` names files
  that are not present.
