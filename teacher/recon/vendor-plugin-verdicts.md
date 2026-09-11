# Vendor plugin verdicts — recon against Harness 0.1.5-rc.2

Read-only reconnaissance. Only this file was written. No installs, no state-changing git commands.

Upstream source read at `deepseek-harness/` = tag `dsh-v0.1.5-rc.2`, commit `fb2c4b9e698e30edb738bca4cf0618587db7d203` (verified with `git -C deepseek-harness describe --tags` and `git rev-parse HEAD`).

---

## 0. Blocking caveat: the pin bump is only half applied

The submodule **working tree** is at 0.1.5-rc.2, but every distribution pin still says 0.1.2-rc.1. This matters because the shipped product does not resolve 0.1.5-rc.2 yet.

| Fact | Evidence |
|---|---|
| Parent index still records the old gitlink | `git ls-tree HEAD deepseek-harness` → `160000 commit a66e4702047846cdaa10c66c9d3df3951f5ea70d` (0.1.2-rc.1), while `git describe` inside the submodule = `dsh-v0.1.5-rc.2` |
| Channel pins unchanged | `upstream.json:5-18` — both `stable` and `beta` = commit `a66e4702…`, `sourceVersion: "0.1.2-rc.1"`, `runtimeSource: "vendor/dsh-runtime/0.1.2-rc.1/manifest.json"` |
| Fork lock unchanged | `teacher/manifests/desktop-upstream.lock.json:14-15` — `"commit": "a66e4702047846cdaa10c66c9d3df3951f5ea70d"`, `"version": "0.1.2-rc.1"` |
| Toolchain lock unchanged | `teacher/manifests/toolchain.lock.json:6` — `"harness": "deepseek-ai/deepseek-harness 0.1.2-rc.1"` |
| Every harness package still resolves to vendored 0.1.2-rc.1 tarballs | `package.json:16-378` — resolutions map each `@deepseek-ai/dsh-*` to `file:vendor/dsh-runtime/0.1.2-rc.1/*.tgz` |
| No 0.1.5-rc.2 runtime is vendored | `vendor/dsh-runtime/` contains only `0.1.2-rc.1`; `Test-Path vendor/dsh-runtime/0.1.5-rc.2` → `False` |

**Consequence:** every "official 0.1.5-rc.2 now provides …" statement below is true of the upstream **source tree** in the submodule working copy. It is not yet true of the built desktop, which resolves 0.1.2-rc.1 from `vendor/dsh-runtime`. The three DROP/KEEP verdicts that depend on new official coverage (sidebar, cowork) only hold **after the bump is completed** — i.e. after `upstream.json`, `desktop-upstream.lock.json`, `toolchain.lock.json`, the `package.json` resolutions and `vendor/dsh-runtime/0.1.5-rc.2/` are all regenerated. Flag this to the user before acting.

Also note: the prebuilt payloads on disk are stale relative to the new source. `resources/teacher-seed/plugins-built/*/SOURCE.json` carry `builtAt: 2026-09-10T14:05:24.754Z`; the seed's `TEACHER-SEED.json` carries `builtAt: 2026-09-11T06:14:29.956Z`. Both predate any 0.1.5-rc.2 vendoring (which does not exist).

---

## Q1. The vendored plugin list, versions, and sources

Two scripts disagree in shape, and both are authoritative for different stages.

### Stage 1 — vendored source checkouts (`scripts/teacher/vendor-plugins.mjs`)

Three git clones into `resources/teacher-seed/plugins/`, each pinned by a written `SOURCE.json`:

| id | repo | license | evidence |
|---|---|---|---|
| `dsh-better-sidebar` | `https://github.com/omdsh-dev/DSH-better-sidebar.git` | MIT | `vendor-plugins.mjs:12` |
| `dsh-cowork` | `https://github.com/Jesse-njx/dsh-cowork.git` | MIT | `vendor-plugins.mjs:13` |
| `pptkit-presentation` | `https://github.com/openHacking/pptkit-presentation.git` | MIT | `vendor-plugins.mjs:14` |

It only clones when `SOURCE.json` is absent (`vendor-plugins.mjs:25-29`), then records `HEAD` (`:31-32`). Recorded commits:

| plugin | vendored commit | checkout `package.json` version |
|---|---|---|
| `dsh-better-sidebar` | `bbf953b8a814d2dc3849e369d532569593e038d8` | **0.19.0** |
| `dsh-cowork` | `2ae5cf755c4294a1e988eebf3b12dd062425d84c` | `packages/dsh` → `@dsh-cowork/plugin` 0.1.0 |
| `pptkit-presentation` | `004a29fb702dbdd98bcdbf8b7ecce9617cd33775` | `packages/dsh-plugin-pptkit-presentation` 0.1.0 |

*(commit `004a29fb702dbdd98bcdbf8b7ecce9617cd33775` read verbatim from `resources/teacher-seed/plugins/pptkit-presentation/SOURCE.json`.)*

### Stage 2 — built payloads (`scripts/teacher/build-vendor-plugins.mjs`)

The **sidebar is not built from the vendored checkout at all.** It is repacked from the npm registry at a hard pin:

- `build-vendor-plugins.mjs:46` `const SIDEBAR_ID = 'dsh-better-sidebar'`
- `build-vendor-plugins.mjs:47` `const SIDEBAR_VERSION = '0.18.1'`
- `build-vendor-plugins.mjs:48` `const SIDEBAR_SPEC = \`${SIDEBAR_ID}@${SIDEBAR_VERSION}\``
- built by `npm pack dsh-better-sidebar@0.18.1` + `npm install --omit=dev --legacy-peer-deps` (`build-vendor-plugins.mjs:308-321`), explicitly not rebuilt (`:323`).
- Source recorded as `npm:dsh-better-sidebar@0.18.1` (`resources/teacher-seed/plugins-built/dsh-better-sidebar/SOURCE.json`).

So the 0.19.0 checkout under `resources/teacher-seed/plugins/dsh-better-sidebar/` is **inert** for the sidebar build — it is only read for its `SOURCE.json` commit and contributes nothing to the shipped artifact. The other two are true source builds:

- `dsh-cowork`: pnpm install + build filtered to `dsh-cowork`/`@dsh-cowork/core`/`@dsh-cowork/plugin`, tarball the core, rewrite `dependencies` to `file:./vendor/<core>.tgz` (`build-vendor-plugins.mjs:327-381`).
- `pptkit-presentation`: pnpm install + `build` (= `node scripts/sync-skill.mjs && tsc -p tsconfig.json`), then copy `package.json`, `dist`, `cordis.patch.yml`, `skill` (`build-vendor-plugins.mjs:383-426`).

### Stage 3 — the mounted profile seed (`scripts/teacher/build-profile-seed.mjs`)

`build-profile-seed.mjs:32-36` defines the mount list, in order:

```
{ packageName: 'dsh-better-sidebar',            source: 'dsh-better-sidebar' }
{ packageName: '@dsh-cowork/plugin',            source: 'dsh-cowork' }
{ packageName: 'dsh-plugin-pptkit-presentation', source: 'pptkit-presentation' }
```

Copied into `profiles/desktop/node_modules/…`, pruned, and appended to `dsh.profile.bundles` (`build-profile-seed.mjs:260-289`). Verified in the built seed: `resources/teacher-runtime/seed/dsh-home/TEACHER-SEED.json` lists exactly those three as `bundles` tail and `vendorPlugins`, and `seed/dsh-home/profiles/desktop/package.json` lists the same five bundles in the same order.

### Manifests and locks

- `teacher/manifests/plugins.lock.json:4-27` — `core` = the same three ids, each with `"compatibility": "DSH 0.1.2-rc.1+"` and `"install": "local-tgz"`; the sidebar entry additionally carries `"note": "node-pty build scripts must be pre-approved during seed build"` (`:11`).
- `plugins.lock.json:28-48` — `optional` (`dsh-open-file`, `dsh-knowledge-base`, both `enabled: false`) and `excluded` (`dsh-at-file`, `dsh-auto-mode`, `dsh-undo`). No other plugin is vendored.
- `teacher/pnpm-lock.yaml` is the **teacher** workspace lock (48 KB, 1309 lines) and does not mention any of the three plugin ids — the plugins are never installed through it. Searched: `Select-String` over `teacher/pnpm-lock.yaml` for `dsh-better-sidebar|dsh-cowork|pptkit` → no matches.
- `teacher/vendor-plugins/` exists but is **empty** — not a plugin source.

### Dead-payload pruning list

`build-profile-seed.mjs:94-124` (`PLUGIN_DEAD_PAYLOAD`), applied per plugin at `:270` via `prunePluginDeadPayload` (`:194-224`). Each removal is guarded: it is skipped when a shipped JavaScript file of the plugin resolves the specifier with a bare `from`/`require`/`import`/`resolve` (`:128-169`, `:209-212`).

| plugin | pruned path | specifier | reason (verbatim, abridged) |
|---|---|---|---|
| `dsh-better-sidebar` | `node_modules/react-icons` | `react-icons` | "inlined into lib/client.js and lib/client-registry.js" |
| `dsh-better-sidebar` | `node_modules/mermaid` | `mermaid` | "inlined into lib/client-mermaid.js, which stays in the package" |
| `dsh-better-sidebar` | `node_modules/@xterm` | — (`onlyIfEmpty: true`) | "empty scope directory" |
| `@dsh-cowork/plugin` | `node_modules/@napi-rs` | `@napi-rs/canvas` | optional pdf.js page-render dep; core only calls `getDocument` + `getTextContent`, never `page.render` |

**Note on the list's own drift risk:** `@xterm` is pruned `onlyIfEmpty`, and the measured seed still ships a `@xterm`-derived terminal path via `node-pty` — see §1 payload breakdown. The guard is what keeps this safe.

---

## 1. `dsh-better-sidebar` — version 0.18.1

### What it is

From the built manifest (`resources/teacher-seed/plugins-built/dsh-better-sidebar/package.json`): "DSH web plugin: a VSCode-like right sidebar (explorer / editor / terminal / git / browser), isolated per conversation session. Exposes a service for other plugins to register sidebar tabs and file viewers."

It is a **Host + Client** plugin: `main: lib/index.js`, client bundle `lib/client.js`, plus `lib/client-registry.js`, `lib/client-terminal.js`, `lib/client-editor.js`, `lib/client-mermaid.js`, and a bundle patch `cordis.patch.yml`.

### Q2 — is the 0.18.1→0.19.x blocker gone? Yes.

`dsh-client-ui-sidebar-right` now exists in 0.1.5-rc.2:

- Declared at `deepseek-harness/packages/client/ui-sidebar-right/package.json:2` → `"name": "@deepseek-ai/dsh-client-ui-sidebar-right"`, version `0.1.5-rc.2`.
- Mounted by default in the shipped web bundle: `deepseek-harness/packages/bundle/web-app/cordis.patch.yml:224-225` (`- id: ui-sidebar-right` / `name: '@deepseek-ai/dsh-client-ui-sidebar-right'`) and `deepseek-harness/packages/bundle/web-app/package.json:86`.
- Published artifact exists: `deepseek-harness/dist/npm/deepseek-ai-dsh-client-ui-sidebar-right-0.1.5-rc.2.tgz` (70 964 bytes).
- Documented as an owned subsystem: `deepseek-harness/docs/subsystems/sidebar-right.md:5`.

The two sidebar versions differ exactly where the user remembers:

| | `dsh-better-sidebar` 0.18.1 (shipped) | 0.19.0 (vendored checkout) |
|---|---|---|
| version | `resources/teacher-runtime/seed/dsh-home/profiles/desktop/node_modules/dsh-better-sidebar/package.json` → `0.18.1` | `resources/teacher-seed/plugins/dsh-better-sidebar/package.json` → `0.19.0` |
| `dsh.client.inject` | `@deepseek-ai/dsh-client-locale`, `-ui-slots`, `-ui-conversation`, `-client-modules` (4) | the same 4 **plus `@deepseek-ai/dsh-client-ui-sidebar-right`** (5) |
| peer range | `^0.1.2-rc.1` for the 14 harness peers | `^0.1.5-rc.1` for all harness peers |

All 18 declared peers of 0.19.0 exist in 0.1.5-rc.2, including the two that are easy to lose: `@deepseek-ai/dsh-invariants` → `deepseek-harness/packages/runtime-diagnostics/invariants/package.json:2` (version `0.1.5-rc.2`), and `@deepseek-ai/dsh-host-webserver` → `deepseek-harness/packages/host/webserver/package.json`. `^0.1.5-rc.1` admits `0.1.5-rc.2` (same major.minor.patch tuple), so the ranges are satisfied.

**Answer:** yes — the specific blocker that forced the downgrade is removed, and 0.19.x's peer ranges target exactly this release line. **Boundary of this recon:** that is a *dependency-availability* conclusion. No install, mount or boot of 0.19.0 was performed (installs are out of scope for this task), so runtime compatibility is not verified. Also note 0.19.0 lists `@deepseek-ai/dsh-client-ui-sidebar-right` as an **optional** peer (`peerDependenciesMeta`) while naming it unconditionally in `dsh.client.inject` — the inject edge, not the peer edge, is what makes it load-bearing.

### Q3 — what official 0.1.5-rc.2 now covers, and what it does not

Official now owns a real right-side docking surface. Capability comparison:

| Capability | Official 0.1.5-rc.2 | Evidence | Still needs the plugin? |
|---|---|---|---|
| Per-session docking surface (panes/tabs/splits/floats/close) | **yes** | `packages/client/ui-sidebar-right/README.md`; `src/client/stores.ts` (`splitPane`, `floatTab`, `closeTab`); `packages/client/ui-dockkit/**` | no |
| Tab-type registry, extension-friendly | **yes** | `packages/client/ui-sidebar-right/src/client/tab-registry.ts:87-116` (`SidebarRightTabDefinition`: `id`:95, `kind`:97, `patterns`:108, `priority`:110, default band `extension`), `register()` at `:242` | no |
| AppFrame right column in the layout grid | **yes** | `packages/client/ui-layout/src/client/AppFrame.tsx:207-208` (`gridTemplateColumns: '${cols.sidebar}px minmax(0,1fr) ${cols.rightbar}px'`), `:226-228` (`<RightbarColumn>` rendering the `rightbar` slot) | no |
| Read-only workspace file tree | **yes** | `packages/client/ui-sidebar-files/src/client/face.ts:44-46` — the remote slice is `Pick<ClientRemote['workspaceFiles'], 'list'>`; the only call is `remote.workspaceFiles.list(...)` at `:55` | partially |
| Document preview (md / code / text / html / image / pdf) | **yes** | `packages/client/ui-sidebar-documentpreview/**` | partially |
| **Interactive terminal emulator** | **no** | `grep 'xterm\|node-pty'` over `deepseek-harness/packages/client/**/*.ts` → **No matches found** | **yes** |
| **Git / source-control panel** | **no** | no git RPC client in `packages/client/**` (only file-type icon art) | **yes** |
| **Embedded browser pane with URL navigation** | **no** | only a sandboxed single-file HTML preview (`ui-sidebar-documentpreview` html viewer) | **yes** |
| **Editable editor with save; file create/rename/delete** | **no** | `ui-sidebar-files` exposes `list` only (`face.ts:44-46`); official previewers are read-only | **yes** |
| Layout/tab persistence across reload | **no** (memory-only) | `ui-sidebar-right/README.md` — a reload returns every session to collapsed | **yes** |
| Office (docx/xlsx/pptx) preview, mermaid, side-chat, subagent views | **no** | not present in `packages/client/**` | **yes** |

**Verdict on the user's suspicion for this plugin: the suspicion is refuted.** Official has replaced the *dock and layout plumbing* and added a basic read-only explorer and a text/image/PDF previewer — those parts of the plugin are now duplicative in function. But four capability clusters exist nowhere in official 0.1.5-rc.2: a terminal emulator (no `xterm`, no `node-pty` anywhere in the client), a git panel, a navigable browser pane, and an editable editor with file mutations. Dropping the plugin today removes working features.

---

## 2. `@dsh-cowork/plugin` — version 0.1.0

### What it is

`resources/teacher-seed/plugins-built/dsh-cowork/package.json` — "DSH Cowork — doc_read / doc_write tools for office documents and notebooks (xlsx, pdf, docx, pptx, ipynb) in DeepSeek Harness". Host-only: `main: ./lib/index.js`, bundle patch `cordis.patch.yml`, no `dsh.client` block. Peers `@deepseek-ai/dsh-fs`, `-dsh-system-prompt`, `-dsh-tools`, `-dsh-schemastery`.

### Q4 — does official 0.1.5-rc.2 have document reading built in? No.

Explicit finding: **official 0.1.5-rc.2 has no built-in binary office-document reading or writing; its file tools read UTF-8 text plus four raster image formats only.** `@dsh-cowork/plugin` is therefore not covered.

Evidence:

| Claim | Evidence |
|---|---|
| `doc_read`, `doc_write`, `markitdown` appear nowhere upstream | `grep 'doc_read\|doc_write\|markitdown'` over `deepseek-harness/packages`, `/docs`, `/apps` excluding `node_modules` → **no matches** |
| The fs tool package registers exactly four tools | `deepseek-harness/packages/fs/tool-fs/src/read.ts:2` — "Model-facing UTF-8 read"; `:79` — `description: 'Read a UTF-8 text file and return line-numbered content.'`; catalog confirms the set | 
| The tool set is `edit`, `read`, `read_image`, `write` | `deepseek-harness/docs/tool-catalog.md:28` — `\| @deepseek-ai/dsh-tool-fs \| \`edit\`, \`read\`, \`read_image\`, \`write\` \|` |
| Image passthrough is 4 raster types, not documents | `packages/fs/tool-fs/src/read-image.ts` image-extension list; `packages/attachment/attachment/src/types.ts` image media types |
| PDF support upstream is browser-side preview only, not a model tool | `deepseek-harness/packages/client/ui-sidebar-documentpreview/package.json:69` — `"pdfjs-dist": "6.3.289"`, a **client** package dependency |
| No `mammoth`/`exceljs`/`xlsx`/`docx` parser anywhere | not found in `deepseek-harness/pnpm-lock.yaml` nor in any `packages/bundle/**/package.json` |

**Cannot confirm** any official substitute for `doc_read`/`doc_write`. The official PDF path is a human preview inside the dock; it does not hand extracted text to the model. Verdict therefore KEEP.

---

## 3. `dsh-plugin-pptkit-presentation` — version 0.1.0

### What it registers (host, not client)

`resources/teacher-seed/plugins-built/pptkit-presentation/dist/index.js`:

- `export const name = "dsh-plugin-pptkit-presentation"`, `export const inject = ["skills"]`, `Config` = `{ skillDir?: string }`.
- `apply()` resolves its own package dir and calls `ctx.skills.registerProvider(...)` (`dist/index.js`, last lines). **No tools, no commands, no client half.**

`dist/skill-provider.js` — the provider it registers:

- `export const SKILL_NAME = "pptkit-presentation"`
- `export const PROVIDER_NAME = "pptkit-bundle"`
- `export const BUNDLE_RANK = 250`
- `list()` reads `<packageDir>/skill/pptkit-presentation/SKILL.md`, parses `name`/`description` frontmatter, returns one summary with `source: "bundled"`, `provider: "pptkit-bundle"`, `resourceBase: { kind: "directory", path: dir }`, `rank: 250`.
- Resolution order: explicit `skillDir` → `process.env.PPTKIT_SKILL_DIR` → the bundled `skill/pptkit-presentation`. The comment states rank 250 "sits between DSH's project roots (100/200) and custom/user roots (300-500)".

### Does our own `teacher/packages/ppt-kit` overlap it? Not materially — but something else does.

`teacher/packages/ppt-kit` is **not** a skill and registers nothing with DSH. It is a plain Node library:

- `teacher/packages/ppt-kit/package.json` — `"name": "@teacher-dsh/ppt-kit"`, "Teacher DSH PPT Kit - teaching deck wrapper over PptxGenJS", single dependency `"pptxgenjs": "4.0.1"`.
- `teacher/packages/ppt-kit/src/index.js:1` — `import PptxGenJS from 'pptxgenjs'`; `:4-26` `TEACHING_THEMES`; `:46` `export function createTeachingDeck({...})` with `addTitleSlide` / `addConceptSlide` / `addExperimentSlide` / `addExerciseSlide` (documented at `:40-44`).
- It ships to `resources/teacher-runtime/ppt/` (5.92 MB / 356 files) via `scripts/teacher/build-teacher-runtime.mjs:789-794`, i.e. it is a **toolchain for the artifact/CLI path**, not a model-facing skill.

The third-party SKILL.md, by contrast, teaches a completely different "PPTKit" API: `DeckSession`, `DeckSpec`, `authorDeck()`, `transferPptkitSession()`, a browser preview workflow, and an explicitly-documented **DeepSeek Harness** limitation path (`resources/teacher-runtime/skills/pptkit-presentation/SKILL.md:8,20,34,37,45,49`; `references/dsh-harness.md`). Grep of the skill for our package name: no reference to `@teacher-dsh/ppt-kit` or `createTeachingDeck`. So **ppt-kit and the pptkit-presentation skill are two different products**; the skill is not redundant *because of ppt-kit*.

### The real redundancy: the plugin duplicates a skill already bundled three ways

The skill is already installed as a **bundled Teacher Skill**, independent of the plugin:

- `scripts/teacher/build-teacher-runtime.mjs:857` — `['pptkit-presentation', path.join(TEACHER, 'vendor-skills', 'pptkit-presentation', 'skills')]` is copied into `resources/teacher-runtime/skills/`.
- `dsh-plugin-desktop/src/teacher-bootstrap.ts:357` — `DSH_BUNDLED_SKILL_DIR: join(runtimeRoot, 'skills')`, with the comment at `:355-356`: "The Harness filesystem skill provider scans this root with bundled-skill rank, which is what makes every Teacher Skill available to a session with no user configuration."
- `deepseek-harness/packages/skill/skill-filesystem/src/index.ts:258` — that root is pushed with `rank: BUNDLED_SKILL_RANK`, `trustedHost: true`.
- `deepseek-harness/packages/skill/skill/src/index.ts:28` — `export const BUNDLED_SKILL_RANK = 600`.

So **two providers serve the same skill name**, and they ship byte-identical content:

| Location | SKILL.md SHA-256 | bytes |
|---|---|---|
| `resources/teacher-runtime/skills/pptkit-presentation/SKILL.md` (bundled root) | `54350655839FDC1E2947173558E263183C87836FED60FE7210AA7FF3BD54CC1C` | 10 620 |
| `resources/teacher-seed/plugins-built/pptkit-presentation/skill/pptkit-presentation/SKILL.md` (plugin) | `54350655839FDC1E2947173558E263183C87836FED60FE7210AA7FF3BD54CC1C` | 10 620 |
| `teacher/vendor-skills/pptkit-presentation/skills/pptkit-presentation/SKILL.md` (input to the above) | `54350655839FDC1E2947173558E263183C87836FED60FE7210AA7FF3BD54CC1C` | 10 620 |

Full-tree comparison of the bundled root vs the plugin's `skill/` dir: **33 files each, identical set, 33 identical hashes, 0 differing.**

Rank decides which one wins: `deepseek-harness/packages/skill/skill/src/index.ts:76` — "Lower ranks win duplicate skill names before provider registration order is considered" — so the plugin's 250 beats the bundled root's 600 today. Remove the plugin and the 600-ranked filesystem provider serves the same skill, same body, and its own `resourceBase: { kind: 'directory', path: locator.directory }` (`skill-filesystem/src/index.ts:741`) keeps `scripts/*.mjs` and `assets/previews/*` resolvable. The bundled root is additionally `trustedHost: true` (`:258`, consumed at `:730`, `:751`, `:844`), so it is treated as a trusted host root rather than a sandboxed user root.

**What would be lost by dropping the plugin: nothing that is not already present.** The only asymmetry is cosmetic: `source`/`provider` become the filesystem provider's `bundled`/`filesystem` identity instead of `bundled`/`pptkit-bundle`, and the skill would be discovered from `DSH_BUNDLED_SKILL_DIR` rather than from a package. No text, no script, no asset changes.

Drop-path follow-ups (files that name the plugin and would need updating): `scripts/teacher/build-profile-seed.mjs:35`; `scripts/teacher/build-vendor-plugins.mjs:383-426`; `scripts/teacher/vendor-plugins.mjs:14`; `teacher/manifests/plugins.lock.json:20-26`; `scripts/teacher/verify-profile-seed.mjs:39` (and the "PPTKit registers its skill provider" observation at `:400-417`, whose `/pptkit/` assertion would still pass via the bundled root but whose label would be wrong); `scripts/teacher/smoke-package.mjs:162`; `scripts/teacher/build-notices.mjs:74-79` (its `role` string currently reads "Vendored presentation workflow Skill **and the PPTKit DSH plugin**").

---

## 4. Measured payloads

All sizes are `Get-ChildItem -Recurse -File | Measure-Object Length -Sum` on Windows. Two distinct trees are reported because only one ships.

**Shipped payload** — `resources/teacher-runtime/seed/dsh-home/profiles/desktop/node_modules/` (the tree `build-profile-seed.mjs` writes and the installer copies):

| Plugin | MB | files | internal breakdown |
|---|---|---|---|
| `dsh-better-sidebar` | **68.46** | 10 658 | `lib` 11.55 MB / 162 files (incl. `client-mermaid.js` 6.69 MB, `client-editor.js` 2.00 MB); `node_modules` 54.15 MB / 10 324 files (top: `cytoscape-fcose` 8.88, `node-pty` 7.15, `cytoscape` 5.44, `@codemirror` 5.05, `es-toolkit` 4.04, `katex` 3.85, `@mermaid-js` 3.67, `rxjs` 2.69, `@lezer` 2.55); `src` 2.23 MB / 163 files |
| `@dsh-cowork/plugin` | **33.06** | 3 176 | `node_modules` 32.95 MB / 3 160 files (top: `pdfjs-dist` 15.81, `exceljs` 6.67, `mammoth` 1.63, `@types` 1.53, `jszip` 0.79, `async` 0.77, `pako` 0.75); `lib` 0.03 MB / 10 files |
| `dsh-plugin-pptkit-presentation` | **0.30** | 74 | `dist` 2 files of code, `skill/pptkit-presentation` 33 files, `node_modules` (`@deepseek-ai/schemastery` + `cosmokit` + `@standard-schema/spec`) |
| **seed total** | **101.82** | 13 915 | equals the three plugin trees exactly; no other payload is in the seed |

**Repo intermediates** (gitignored — `.gitignore:27-29`; not shipped as-is):

| Tree | MB | files |
|---|---|---|
| `resources/teacher-seed/plugins-built/dsh-better-sidebar` | 299.39 | 13 340 |
| `resources/teacher-seed/plugins-built/dsh-cowork` | 102.29 | 3 592 (includes `@napi-rs/canvas-win32-x64-msvc` 36.54 MB, which pruning removes) |
| `resources/teacher-seed/plugins-built/pptkit-presentation` | 0.33 | 85 |

**Related, for context:** `teacher/vendor-skills/` holds the pinned skill sources (`pptkit-presentation`, `education-agent-skills`, `vercel-web-design`); the derived `resources/teacher-runtime/skills/` root is 0.285 MB / 45 files across 12 skills. `resources/teacher-runtime/` total is 858.65 MB, `resources/teacher-seed/` total 407.53 MB.

---

## Summary table

| plugin | version | purpose | official coverage in 0.1.5-rc.2 | payload MB (shipped) | verdict | risk if dropped |
|---|---|---|---|---|---|---|
| `dsh-better-sidebar` | 0.18.1 (npm pin; 0.19.0 checked out but unused) | VSCode-like per-session right sidebar: explorer, editable editor, terminal (xterm + node-pty), git panel, browser pane, office preview, mermaid, side-chat, subagent views | **partial** — dock/panes/tabs/splits/floats, AppFrame right column, dockkit engine, read-only file tree (`face.ts:44-46`), md/code/text/html/image/pdf preview. **No** terminal emulator, git panel, navigable browser, editable editor, file mutations, persistence, office preview (`grep 'xterm\|node-pty'` over `packages/client/**/*.ts` → no matches) | **68.46** | **KEEP** (0.19.0 upgrade now unblocked) | Loses 4 capability clusters with no official substitute; the official right sidebar can host tabs but cannot execute a terminal, show git status, or edit-and-save a file |
| `@dsh-cowork/plugin` | 0.1.0 | `doc_read` / `doc_write` tools for xlsx / pdf / docx / pptx / ipynb, via pdfjs-dist, exceljs, mammoth, jszip | **none found** — tool-fs is `edit`/`read`/`read_image`/`write` only (`docs/tool-catalog.md:28`); read tool is UTF-8 text (`tool-fs/src/read.ts:2,79`); pdfjs-dist is a **client** preview dep (`ui-sidebar-documentpreview/package.json:69`); no mammoth/exceljs/xlsx/docx anywhere; `doc_read`/`doc_write`/`markitdown` absent from `packages`, `docs`, `apps` | **33.06** | **KEEP** | **Cannot confirm** any official substitute. Dropping removes the only path by which the model can read or write xlsx/pdf/docx/pptx — teachers' most common inputs |
| `dsh-plugin-pptkit-presentation` | 0.1.0 | Registers a `ctx.skills` provider (`pptkit-bundle`, rank 250) serving the `pptkit-presentation` Agent Skill; no tools, no commands, no client half | **fully covered by our own bundling, not by official** — the same skill is already a bundled Teacher Skill at `DSH_BUNDLED_SKILL_DIR` (`teacher-bootstrap.ts:357`), rank 600 (`skill/src/index.ts:28`); skill body and all 33 files byte-identical (SHA-256 `543506558…`) | **0.30** | **DROP** | None. The skill remains in the catalog via the filesystem provider, with identical body, scripts and assets. Only the reported `provider` identity changes from `pptkit-bundle` to `filesystem` |

### Total saving if all DROPs are taken

**0.30 MB** (74 files) out of 101.82 MB shipped seed payload — **0.29%**. Only `dsh-plugin-pptkit-presentation` qualifies. The two large plugins are both KEEP, so this is not a payload-reduction exercise; it is a correctness/de-duplication win, not a size win.

---

## What the user loses if we drop each plugin (plain language)

- **`dsh-better-sidebar` — do not drop.** The teacher would lose the terminal pane (the only place in the app where a shell can actually be typed into), the Git panel (the only view of what changed in the workspace), the in-app browser pane (the only way to open a URL side-by-side with the conversation), and the file editor (the only way to edit and save a file without asking the model to do it). The new official right sidebar looks similar and supports tabs, splitting and floating — so it *looks* like a replacement — but it opens read-only viewers: a file tree you can only look at, and previews of text, code, Markdown, HTML, images and PDF. Nothing in it runs a shell, shows a diff, or lets you type into a file. The good news is the reason for the painful 0.19.0 → 0.18.1 downgrade is gone: `dsh-client-ui-sidebar-right` now exists and 0.19.0's dependencies all match 0.1.5-rc.2, so this is the moment to un-downgrade — after the pin bump in §0 is actually completed.

- **`@dsh-cowork/plugin` — do not drop.** The teacher would lose the ability to have the model read a spreadsheet, a PDF, a Word document or a PowerPoint, and to write them back out. This is not a "nice to have" for a teaching product: grade books are xlsx, worksheets are docx and pdf, and lesson decks are pptx. Upstream 0.1.5-rc.2 genuinely has nothing comparable — its file tool reads UTF-8 text and four kinds of image, and it will refuse a binary office file outright. The one thing that *looks* like overlap, PDF display, is a picture shown to the human in the sidebar; the model still receives no text from it. This plugin's 33 MB is real cost, but it buys the only office-document capability in the product.

- **`dsh-plugin-pptkit-presentation` — safe to drop, and it is genuinely redundant.** The "PPTKit presentation" skill is already installed as a bundled Teacher Skill that the app loads from its own skills folder every time. The plugin exists only to inject that same skill a second time from inside a package. We verified the two copies are byte-for-byte identical — same SKILL.md, same 33 files, same hashes. If we remove the plugin, the skill stays available exactly as before; nothing about what the teacher or the model sees changes. One clarification on the original suspicion: this redundancy is *not* because of our own `teacher/packages/ppt-kit`. That package is a different thing entirely — a PptxGenJS helper library for programmatically building teaching decks in the artifact toolchain — and the PPTKit skill never refers to it. So the plugin is worth dropping because it duplicates our own skill bundling, not because it duplicates ppt-kit.

---

## Verification record

Every file:line cited above was re-opened, and every size re-measured, after the report was drafted. Counted citations re-checked: **79** (file:line references and absence greps re-run), plus **9** directory-size measurements re-taken and **4** SHA-256 comparisons re-run.

Items corrected during verification:

1. **`tab-registry.ts:242`** — the initial note described this line as the `register({ id, kind, patterns?, priority?, … })` field list. The line number is right but the content is `register(definition: SidebarRightTabDefinition): () => void {`. The field list is the `SidebarRightTabDefinition` interface at `:87-116` (`id`:95, `kind`:97, `patterns`:108, `priority`:110). Citation corrected to point at the interface.
   *Methodology note:* PowerShell `Get-Content` line indexing disagreed with the `read`/`grep` tools by one line on this file. Where they disagreed, `read`/`grep` were treated as authoritative and the line was re-read with the `read` tool before citing.
2. **0.19.0's `dsh-client-ui-sidebar-right` requirement** — the briefing described it as *required*. In the actual 0.19.0 manifest it is a peerDependency listed under `peerDependenciesMeta` as **optional**, while `dsh.client.inject` still names it unconditionally. Corrected to state that the inject edge, not the peer edge, is load-bearing. This does not change the conclusion.
3. **`@xterm` pruning** — clarified that the `PLUGIN_DEAD_PAYLOAD` entry is `onlyIfEmpty` and that the terminal still works through `node-pty` + the bundled `@xterm` code path; the guard, not the entry, is what keeps the removal safe.
4. **`pptkit-presentation` vendored commit** — re-read verbatim from `SOURCE.json` as `004a29fb702dbdd98bcdbf8b7ecce9617cd33775`. The first draft of this report mistyped it at the Q1 table as `…bdd98bcdb**83**b7ec…`; caught by re-grepping this report against `SOURCE.json` and corrected in place. The other two vendored commits (`bbf953b8a814d2dc3849e369d532569593e038d8`, `2ae5cf755c4294a1e988eebf3b12dd062425d84c`) and the SKILL.md SHA-256 were re-verified against their `SOURCE.json` / `Get-FileHash` sources and match.

**Not determinable in this recon / stated as a limitation:**
- 0.19.0 runtime compatibility was not verified (no install/build permitted); only dependency availability and peer-range satisfaction were checked.
- The built seed and `plugins-built` trees are stale relative to the 0.1.5-rc.2 source; no size was measured for a 0.1.5-rc.2-built payload because none exists.
- `resources/teacher-seed/plugins-built` may or may not be the tree the installer stages; `.gitignore:27-29` and `package-windows.mjs:10` (which delegates to `build-offline-store.mjs`) were read, but the final `electron-builder` `extraResources` block was not located in `package.json`, so the **shipped** figure used throughout is the seed tree, which is what `build-profile-seed.mjs` and `smoke-package.mjs:159-163` actually assert on.
