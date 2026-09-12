# Teacher DSH 0.1

English | [中文](README.zh.md)

Teacher DSH 0.1 is a complete, offline teacher toolchain distributed as a Windows application. A
teacher installs one thing — or unzips one archive — and can generate teaching resources, generate
interactive HTML teaching aids, and publish a page. No Node.js, no pnpm, and no Git need to be
installed, and nothing is downloaded on first run.

The distribution is built around two upstream projects: the Electron desktop shell from
`anywhere-labs/dsh-desktop` and a pinned DeepSeek Harness runtime. The Harness is used unmodified;
this repository adds the runtime that goes with it, the teaching Skills, the teaching-aid
templates, the presentation and publishing toolchains, and the Windows packaging.

| | |
|---|---|
| Version | `0.1.0` |
| Platform | Windows x64 |
| Release artifacts | `Teacher-DSH-0.1.0-x64-Setup.exe` (NSIS), `Teacher-DSH-0.1.0-x64-Portable.zip` |
| Teacher layer license | MIT |
| Bundled third-party components | their own licenses — see [License and attribution](#license-and-attribution) |

This is a community distribution. It is not affiliated with, authorized by, or endorsed by DeepSeek
or Anywhere Labs.

## What is included in 0.1

Everything below ships inside the installer or the Portable archive. The versions are recorded in
[`teacher/manifests/`](teacher/manifests) and in the generated
`resources/teacher-runtime/manifests/runtime.build.json`.

| Component | Version | Role |
|---|---|---|
| Desktop shell (upstream baseline) | v2.0.5 | Electron shell, profile manager, packaging pipeline |
| DeepSeek Harness | 0.1.2-rc.1 | Pinned agent runtime, plugin loader, client UI, tool protocol |
| Node.js | 22.23.2 | Portable runtime used by every Teacher command |
| pnpm | 11.8.0 | Package manager for artifact projects |
| Vite | 8.2.2 | Teaching-aid build |
| Three.js | 0.186.0 | 3D teaching aids |
| JSXGraph | 1.13.3 | Interactive geometry and function graphs |
| KaTeX | 0.18.7 | Formula rendering |
| ECharts | 6.1.0 | Charts |
| Mermaid | 12.0.0 | Diagrams |
| Matter.js | 0.20.0 | 2D physics |
| PptxGenJS | 4.0.1 | Editable `.pptx` output, wrapped by `@teacher-dsh/ppt-kit` 0.1.0 |
| `@teacher-dsh/artifact-sdk` | 0.1.0 | Stage, UI, and formula API for teaching aids |
| netlify-cli / wrangler / vercel | 27.5.2 / 4.130.0 / 59.15.1 | Account-owned publishing |

Command-line tools in the package:

| Command | What it does |
|---|---|
| `teacher-artifact` | `init` / `build` / `check` / `preview` / `pack` a teaching aid from the bundled dependency tree |
| `teacher-latex` | Author `.tex` sources and validate their structure; render formulas with KaTeX |
| `teacher-ppt` | `init` / `build` / `check` a teaching deck; produces editable OOXML |
| `teacher-publish` | Detect, inspect, plan, deploy, and verify a static publish |

Seven teaching-aid templates are bundled: `basic`, `three`, `math`, `physics-2d`, `chart`,
`diagram`, and `classroom-game`.

Twelve Skills ship in the package and are discovered through `DSH_BUNDLED_SKILL_DIR`, so they work
with no configuration. Three are maintained here: `teaching-aid`, `publish-static`, and
`latex-authoring`. The rest are vendored: seven education Skills by Gareth Manning,
`pptkit-presentation`, and `web-design-guidelines`.

Three vendor plugins are preinstalled into the desktop profile of the bundled Harness home:

| Plugin | Version |
|---|---|
| `dsh-better-sidebar` | 0.18.1 |
| `@dsh-cowork/plugin` | 0.1.0 |
| `dsh-plugin-pptkit-presentation` | 0.1.0 |

## What is not in 0.1

Stated plainly, because these limits are part of the contract:

- **No OCR.** No image or scanned-document text extraction is bundled.
- **No Python.** There is no Python interpreter and no scientific Python stack.
- **No TeX distribution.** KaTeX 0.18.7 renders formulas, and `teacher-latex` authors and
  structurally validates `.tex` sources, but there is no `pdflatex`, `xelatex`, `tectonic`, or TeX
  Live — and therefore no TeX-to-PDF engine. 0.1 produces HTML and PPTX, not compiled PDFs.
- **No LMS integration.** Nothing connects to a school learning-management system.
- **No professional exam typesetting.** The LaTeX work here is math authoring for teaching
  material, not examination paper production.

## How a teacher uses it

1. Run `Teacher-DSH-0.1.0-x64-Setup.exe`, or unzip `Teacher-DSH-0.1.0-x64-Portable.zip` and start
   the application from the extracted folder.
2. Double-click. The DeepSeek Harness opens. The bundled Harness home is copied into the user's
   Harness directory on first run, and only when the `desktop` profile does not exist yet, so
   existing user data is never overwritten.
3. Configure the model in the Harness's own settings UI.
4. Describe the teaching material you want in the chat box.

The machine's `PATH`, `NODE_HOME`, and global npm prefix are never modified: the command shims are
generated into a per-user state directory and prepended to the Harness process only. The artifact
toolchain is linked into a workspace through a Windows junction, so `init`, `build`, and `check`
are offline and take seconds.

### The eight example tasks

| # | Prompt | Expected outcome |
|---|---|---|
| 1 | 做一个三维太阳系教学教具 | A runnable 3D page built from the `three` template, with orbit and camera interaction |
| 2 | 做一个可调整 a、b、c 的二次函数演示 | A `math` aid in which sliders for `a`, `b`, `c` redraw a JSXGraph parabola while KaTeX typesets the formula |
| 3 | 做一个二维碰撞实验 | A `physics-2d` aid that simulates collisions with Matter.js in the browser |
| 4 | 做一个班级成绩分布交互图 | A `chart` aid that renders an offline interactive distribution chart with ECharts |
| 5 | 根据这份材料生成教学 PPT | `teacher-ppt` builds an editable `.pptx` deck from the supplied material |
| 6 | 帮我设计一节课 | The education Skills produce a structured single-lesson plan |
| 7 | 把这个教具发到网上 | `teacher-publish` uploads the built aid, verifies it remotely, and returns a working URL |
| 8 | 讲一下这个公式 | The formula is explained and rendered with KaTeX, and can be embedded in an aid or a slide |

## Publishing a teaching aid

`teacher-publish` is the only component allowed to talk to a hosting service, and every provider
protocol is implemented in process or driven through a bundled CLI. The flow is:

1. **Detect** the built static artifact (`dist`, `build`, `public`, `out`, or a directory holding
   `index.html`).
2. **Inspect** it: a byte-level manifest plus a safety scan that hard-blocks credentials, keys, and
   class data. Nothing is uploaded while a hard block is present.
3. **Plan** by ranking the providers from the reviewed registry in
   [`teacher/packages/publish-cli/config/providers.json`](teacher/packages/publish-cli/config/providers.json)
   for the requested mode, filtering by capability before any upload is attempted. The plan
   contacts no provider.
4. **Deploy** through the highest-ranked eligible provider.
5. **Verify** — this is the contract that matters. An HTTP 2xx from an upload is only a *candidate*
   success. `deploy` reports `success: true` only after every deployed resource has been fetched
   back over HTTPS and its SHA-256 compared with the local manifest. A deployment whose
   verification cannot run is reported as failed, never as a success.

Three modes exist: `quick-share` (anonymous temporary hosts), `persistent` (account-owned hosts,
which are never silently downgraded to a temporary host), and `tunnel` (session-only exposure of
localhost through a tunnel CLI that must already be installed).

The registry currently holds eleven providers: six anonymous, four account-owned, and one —
`wh-drop` — disabled because no public service could be located for it.

- CLI reference: [`teacher/packages/publish-cli/README.md`](teacher/packages/publish-cli/README.md)
- Protocol reference: [`teacher/packages/publish-cli/docs/provider-protocols.md`](teacher/packages/publish-cli/docs/provider-protocols.md)

## Repository layout

```
dsh-plugin-desktop/       Electron shell, Teacher runtime injection, and electron-builder packaging
deepseek-harness/         Fetched upstream DeepSeek Harness checkout (ignored, read-only)
teacher/                  The Teacher layer: packages, skills, templates, vendor-skills, manifests, BUILD.md
resources/teacher-seed/   Vendored plugin sources and their prebuilt, installable trees
scripts/teacher/          Build, seed, prune, notice, vendoring, and verification scripts
licenses/                 Verbatim license texts for everything in the shipped payload
THIRD_PARTY_NOTICES.md    Generated inventory of bundled components and npm dependencies
```

Supporting entries: `dsh-community-market/` and `dsh-community-fabric/` are the desktop's plugin
market and its community interoperability documentation scaffold; `docs/` is the desktop
documentation index; `tests/` holds the artifact and presentation smoke suites;
`.github/workflows/` holds the release pipeline.

`resources/dsh-runtime/` and `resources/teacher-runtime/` are **build outputs and are not
committed**. They are produced by the scripts below and enter the installer through
electron-builder's `extraResources`. `dsh-plugin-desktop/dist/` is likewise a build output.

[`teacher/BUILD.md`](teacher/BUILD.md) is the authoritative description of the build pipeline.

## Building from source

Building requires Node.js `^22.19.0` or `>=24.0.0`, Yarn 4.18.0 through Corepack, and Windows x64.
Fetch the pinned upstream checkout first with `yarn fetch:upstream`, then:

```powershell
corepack enable
corepack yarn install --immutable

# 1. Bundled runtimes: Node, pnpm, the dsh shim, the Teacher CLIs, the artifact, presentation, and
#    deploy dependency trees, the bundled Skills, the manifests.
node scripts/teacher/build-teacher-runtime.mjs

# 2. The three vendor plugins, prebuilt.
node scripts/teacher/build-vendor-plugins.mjs

# 3. The desktop package must be built before the profile seed can be composed.
corepack yarn workspace dsh-plugin-desktop build

# 4. The bundled Harness profile seed: a desktop profile with every plugin already installed.
node scripts/teacher/build-profile-seed.mjs

# 5. License inventory and notices for the shipped payload.
node scripts/teacher/build-notices.mjs

# 6. Windows Setup (NSIS) and Portable (ZIP).
$env:DSH_PACKAGE_CHECK_ALREADY_RAN = '1'
corepack yarn workspace dsh-plugin-desktop dist:win
corepack yarn workspace dsh-plugin-desktop dist:win-portable

# 7. Prove the packaged payload works, then prove the Portable archive does.
node scripts/teacher/smoke-package.mjs
node scripts/teacher/smoke-portable.mjs --archive dsh-plugin-desktop/dist/*Portable*.zip
```

Only set `DSH_PACKAGE_CHECK_ALREADY_RAN=1` when `corepack yarn check` has already passed in the same
workspace state: it skips the upstream preflight suite.

### Fast iteration without repackaging

[`scripts/teacher/stage-dev.mjs`](scripts/teacher/stage-dev.mjs) replaces the two runtime trees
inside an already packaged application directory with Windows directory junctions pointing back at
`resources/`. A rebuilt CLI or Skill is then immediately visible to the packaged application, and
`smoke-package.mjs` exercises the live tree instead of a gigabyte-sized copy.

This is a local iteration aid only. **Remove those junctions before running electron-builder
again**, so that packaging copies real files instead of following links into the repository, and
never ship an application directory that was staged this way. The script takes `--app`, `--force`,
and `--json`.

## Verification

Every gate answers a different question, and all of them run in CI.

| Command | What it proves |
|---|---|
| `node scripts/teacher/verify-distribution.mjs` | The manifests and the three maintained Skills are present and consistent, then the artifact smoke tests run |
| `node scripts/teacher/verify-skills.mjs` | Every bundled Skill is a flat directory holding a `SKILL.md` with valid frontmatter, a `name` matching its directory, and a description, with no duplicate names |
| `node scripts/teacher/verify-plugins.mjs` | The three pinned vendor plugins agree across the manifest, the vendored checkout's `SOURCE.json`, and the prebuilt tree; a missing prebuilt tree is a warning rather than a failure |
| `node scripts/teacher/verify-licenses.mjs` | The license inventory parses, every curated component owns a `licenses/<slug>/` directory, and `THIRD_PARTY_NOTICES.md` names each one and states the CC BY-SA share-alike terms |
| `node scripts/teacher/verify-no-secrets.mjs` | No high-confidence credential shapes exist in the tracked tree (`git ls-files`) |
| `node scripts/teacher/verify-profile-seed.mjs` | The seed is copied into a fresh temporary Harness home and the `desktop` profile is booted headlessly, asserting that all three vendor plugins really mount and register their tools and skill provider, with no network access |
| `node scripts/teacher/smoke-package.mjs` | The packaged application directory works without a development environment: the in-package Node and artifact CLI initialize, build, and check a real teaching aid, and the in-package PPT CLI produces a real editable `.pptx` |
| `node scripts/teacher/smoke-portable.mjs --archive <zip>` | The Portable archive unpacks into a payload that passes the packaged smoke |
| `node tests/ppt/run-ppt-smoke.mjs` | The presentation toolkit builds and checks a deck |

The release pipeline is
[`.github/workflows/teacher-distribution.yml`](.github/workflows/teacher-distribution.yml), with
three jobs: `verify` (static distribution gates), `package-windows` (build the bundled runtime,
then electron-builder Setup and Portable), and `smoke-package` (run the packaged payload and
produce a real teaching aid and `.pptx`). It deliberately tests whether the *installer* works, not
whether the development sources run.

## License and attribution

- **The Teacher layer written in this repository is MIT.** That covers `teacher/`,
  `scripts/teacher/`, the Teacher bootstrap and profile seed in `dsh-plugin-desktop/`, and the
  three Skills maintained here.
- **The root [`LICENSE`](LICENSE) is the upstream MIT license and is preserved as-is.** It belongs to
  the upstream desktop project, not to the Teacher layer.
- **Seven vendored education Skills by Gareth Manning are CC BY-SA 4.0** and are redistributed
  verbatim from
  [`GarethManning/education-agent-skills`](https://github.com/GarethManning/education-agent-skills).
  That share-alike obligation travels with those files: any redistribution that includes them must
  keep the same license for them and credit the original author. They are not MIT, and the rest of
  the package being MIT does not relicense them.
- **Every other bundled component keeps its own license**, including the DeepSeek Harness, the
  desktop shell, Node.js, pnpm, the npm dependency trees, the two other vendored Skills, and the
  three vendor plugins. Some are MIT; others are Apache-2.0, BSD, ISC, or another set of terms.

[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) is the generated inventory: it lists every
bundled component with its license and role, calls out the share-alike component explicitly, and
enumerates the bundled npm dependencies per toolchain. [`licenses/`](licenses) holds the verbatim
license texts. Both are produced by `scripts/teacher/build-notices.mjs` and validated by
`verify-licenses.mjs`.

## Limitations

Known, current, and stated rather than hidden.

- **The account-owned publishing paths are unverified.** `netlify`, `cloudflare-pages`, `vercel`,
  and `github-pages` are implemented against their documented CLI contracts and were exercised only
  to the unauthenticated failure path, because no provider credentials were available during
  development. The anonymous hosts were verified live, including a real `ship.page` deployment
  whose 62 files were all hash-verified. Do not treat a `persistent` deployment as proven until it
  has run against a real authenticated account.
- **Windows x64 only.** macOS and Linux packages are not produced — those electron-builder targets
  are still `dir` — and the bundle contains Windows x64 native binaries. It will not run on another
  platform or architecture.
- **Size.** The current build produces a Setup installer of roughly 285 MB and a Portable ZIP of
  roughly 510 MB. This is the largest engineering constraint of the distribution: download time, CI
  time, and disk footprint.
- **The Setup installer is unsigned**, so Windows shows the usual unknown-publisher warning on first
  run.
- **The eight example tasks have automated coverage but no formal classroom acceptance run.** The
  templates behind them are built and checked by the packaging pipeline — the packaged smoke builds
  a `three` aid with the in-package CLI — but the aids were not opened in a real browser during
  validation. The generated `.pptx` is checked for editable OOXML but has not been opened in
  PowerPoint or WPS. And the installer has not been exercised end to end on a clean Windows machine
  or VM.

## Links

- This repository: <https://github.com/Inkotake/deepseek-harness-education>
- Upstream desktop shell: <https://github.com/anywhere-labs/dsh-desktop>
- Upstream Harness: <https://github.com/deepseek-ai/deepseek-harness>

Not affiliated with DeepSeek or Anywhere Labs.

---

**中文文档：[`README.zh.md`](README.zh.md)** — the same document in Chinese.
