# MOUNT — how `@teacher-dsh/global-memory` reaches a profile

**Applying this is the integrator's step.** Nothing in this package edits a profile, a
seed, a build script, or a bundle. `deepseek-harness/` is a pinned upstream submodule and
must not be written from a desktop feature branch
(`deepseek-harness/AGENTS.md`, repository `AGENTS.md`), so the row below is a proposal, not
an installed mount. Until it is applied, the six `memory_*` tools do not exist in any
profile — the package only builds and tests on its own.

---

## 1. The row

Append this to the desktop-owned Host layer
`dsh-plugin-desktop/cordis.patch.yml` (see §2), which is applied after the bundle layers:

```yaml
# Long-term memory: ONE shared instance for the teacher, research, and coding
# presets (plan §四 P0-3: 教师/研究/编码预设共用同一个底层服务). It opens its own
# storageDomain over the `storage-domain` row the base bundle already mounts, so it
# belongs on the host plane. Do NOT place this row inside a preset's `isolate`
# realm: a realm-per-preset instance would give every preset its own memory.
- insert:
    - id: global-memory
      name: '@teacher-dsh/global-memory'
      # No mode-varying value here: a patch replaces the targeted row's whole
      # config rather than merging into it (base/cordis.patch.yml:1-7), so a later
      # layer that re-addresses `global-memory` would drop anything mode-specific.
      # The two optional fields are documented, not set:
      #   config:
      #     standingProfileSectionOrder: 10
      #     injectRetrievedMemory: true
```

If the layer already ends with an `- insert:` block, the same two keys can be added to
that list instead — the profile root is a flat list either way. Keep the `id` stable:
later layers address rows by id, and the last write wins per row.

### Why `id: global-memory` and not `@deepseek-ai/dsh-global-memory`

The design's §12.1 sketch uses an `@deepseek-ai/...` spelling because every upstream
plugin is named that way. This package lives in the desktop-owned `teacher/` layer, so its
manifest is `@teacher-dsh/global-memory` like its siblings (`@teacher-dsh/ppt-kit`,
`@teacher-dsh/artifact-cli`). The `id` is what other layers address; the `name` is whatever
the profile's runtime can resolve. If the integrator publishes the package under another
scope, change `name` and leave `id: global-memory` alone.

---

## 2. Which layer, and why that one

Recommended: **`dsh-plugin-desktop/cordis.patch.yml`**.

- It is desktop-owned, so the change is reviewable here and does not touch the pinned
  submodule.
- It is applied after the bundles, and its `- insert:` list lands in the same profile root
  as the base bundle's rows — the plane the design requires ("mount the service on the
  **host plane**, and have presets contribute only reachability of the six tools plus
  `memory_policy` prose").
- The `storageDomain` stack the service injects is a base-bundle row
  (`deepseek-harness/packages/bundle/base/cordis.patch.yml:141-156`: `storage`,
  `storage-json` rooted at `dshHomePath('storages')`, and `storage-domain` with
  `backend: json`), so a host-plane row sees it. `tools` and `system-prompt` are host rows
  in the same file (`:460-466`).

Not recommended, recorded so it is not rediscovered:

- **A preset's `isolate` realm.** README §12.1: one instance must be shared by every
  preset, and `dsh-plugin-desktop/presets/education/agent.cordis.yml:16-23` documents that
  a realm-per-preset service row gives each preset its own instance. The six tools may be
  made reachable from a preset; the service may not live there.
- **The seeded per-profile user layer**
  (`resources/teacher-runtime/seed/dsh-home/profiles/desktop/cordis.patch.yml`). It is the
  right shape ("applied after every bundle layer") and useful for a local smoke test, but
  it is a per-install user home, not a shipped product decision.

### Resolution of `name`

The row's `name` must resolve from the runtime that loads the profile, and this package is
**TypeScript source** (`"main": "./src/index.ts"`, the same source-first convention as
`@teacher-dsh/ppt-kit` and `@teacher-dsh/artifact-sdk`). Two consequences for the
integrator:

1. The package has to be present in the profile runtime. Teacher packages reach it today
   through the desktop-owned assembly in `scripts/teacher/build-teacher-runtime.mjs` (for
   example `@teacher-dsh/artifact-sdk`, copied into
   `resources/teacher-runtime/artifact/node_modules/@teacher-dsh/`), which is an existing
   script outside this package and therefore not edited here.
2. The loader has to be able to load TypeScript. Either add an emit step and point the row
   at the built entry, or mount it through a TS-capable loader. This package deliberately
   makes no claim about which one the desktop already does.

---

## 3. Dependencies this package needs at its runtime

`zod` is a real runtime dependency (the durable record schemas in `src/records.ts`):

```jsonc
"dependencies": { "zod": "^4.4.3" }
```

The upstream harness packages it imports (`@deepseek-ai/cordis`, `dsh-agent`, `dsh-llm`,
`dsh-storage-domain`, `dsh-system-prompt`, `dsh-tools`, `@deepseek-ai/schemastery`) are
declared as `peerDependencies` **and** pinned `devDependencies`, so the host provides them
in production while `tsc` and the tests can resolve them here.

Installed here with (run from `teacher/`, the standalone pnpm workspace):

```powershell
corepack pnpm install --lockfile=false --filter "@teacher-dsh/global-memory"
```

Two side effects of that install that are **not** this package's to keep, and were reverted
before this deliverable was written:

- pnpm appends `minimumReleaseAgeExclude` entries for the 17 `@deepseek-ai/*@0.1.5-rc.2`
  packages to `teacher/pnpm-workspace.yaml`. That file is outside this package's directory,
  so a re-install will want to touch it again; the integrator decides whether to keep the
  entries (they are what lets the pinned runtime versions install at all).
- `--lockfile=false` was used on purpose so `teacher/pnpm-lock.yaml` is untouched. If the
  integrator wants the workspace lockfile to carry this package, run the same install
  without that flag and commit the lockfile change there.

---

## 4. Gaps between `schema.ts` and its own wire schema

`schema.ts` is the contract (this package does not edit it), and every canonical tool
result is validated by `dsh-tools` against the declared output schema
(`core/tools/src/index.ts:1785`) with `additionalProperties: false`. Three consequences,
all handled inside this package and all worth a spec fix upstream of it:

1. **`evidence` has no field on `MemoryRecord`.** `memory_set`, `memory_update`, and
   `memory_feedback` all require an `evidence` sentence, and `MemoryRecord` declares
   nowhere to keep it. This package stores it in a durable-only `StoredMemory.evidence`
   field that is never projected to the model (`src/records.ts`).
2. **`recordViewSchema.expires_at` is typed `string`, but `MemoryRecordView.expires_at`
   is `string | null`** and `schema.ts`'s own `memory_search` example emits `null` for a
   stable record. The canonical wire value therefore *omits* `expires_at` when it is
   `null` (`MemoryRecordWire` in `src/store.ts`); emitting `null` would fail the registry's
   output validation for exactly the common case.
3. **`recordViewSchema` has no `suppressed_for_session` property**, while
   `MemoryRecordView` carries it. A suppression is therefore observable to the model only
   through `memory_feedback`'s `action: 'suppressed_for_session'`, while the row itself
   records the session id durably so the next session sees the value again.

One transcription slip is corrected in the projection rather than in `schema.ts`:
`memory_search`'s declared input spells `scope_type` as the memory `scope` property map
(the four properties of `scopeSchema`), while the declared TypeScript input
`MemorySearchInput.scope_type?: MemoryScopeType` is a scalar. `src/wire.ts` projects the
scope-type enum, matching the type.

---

## 5. What to verify after mounting

1. `corepack pnpm install --lockfile=false --filter "@teacher-dsh/global-memory"` inside
   `teacher/`, then `npx tsc --noEmit` and `node --test "tests/**/*.test.ts"` in this
   package (64 tests).
2. `node scripts/teacher/make-education-preset.mjs --check` — the preset contract is
   independent of this package and must keep passing.
3. A loader smoke that actually mounts the row: the plugin has **no** boot test in this
   package. Its pieces are tested (store, promotion pipeline, retrieval policy, question
   ledger, and the six tools through the real `defineTool` and the real argument/output
   validators), but nothing here constructs a Cordis context, opens a real
   `storageDomain`, or drives an `agent/pre-step` step end to end. The first mount should
   confirm: the domain opens with `name: global_memory` version 1; the six tools appear in
   the tool catalog; the standing profile section is non-empty; and one injected
   `global-memory` snapshot message appears in the session log with its `recordIds`.
