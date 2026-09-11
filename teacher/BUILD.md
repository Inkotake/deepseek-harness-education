# Building the Teacher DSH 0.1 distribution

This is the single pipeline that produces a complete Teacher DSH installation. There is no
development-mode smoke and no partial build: every step below exists so that the *installer* works
on a machine with no Node, no pnpm, and no Git.

## One command sequence

```powershell
# 0. Desktop workspace (Yarn 4 through Corepack)
corepack enable
corepack yarn install --immutable

# 1. Bundled runtimes: Node.js, pnpm, the DSH command, the teacher CLIs, the artifact toolchain,
#    the presentation toolchain, the deploy CLIs, the bundled Skills, the manifests.
node scripts/teacher/build-teacher-runtime.mjs

# 2. Prebuilt vendor plugins (Cowork, Better Sidebar, PPTKit).
node scripts/teacher/build-vendor-plugins.mjs

# 3. The desktop package must be built before the profile seed can be generated.
corepack yarn workspace dsh-plugin-desktop build

# 4. The bundled DSH profile seed: the desktop profile with every plugin already installed.
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

`DSH_PACKAGE_CHECK_ALREADY_RAN=1` skips the upstream preflight test suite. Only set it when
`corepack yarn check` has already passed in the same workspace state.

## What lands where

```
dsh-plugin-desktop/dist/win-unpacked/resources/
├── dsh-runtime/
│   ├── node/          portable Node.js 22.23.2 (node.exe, npm, npx, corepack)
│   ├── pnpm/          pnpm 11.8.0
│   ├── dsh/           Harness command shim + pinned identity
│   └── node_modules/  resolution contract (the Harness bundle itself ships in the app payload)
└── teacher-runtime/
    ├── cli/           artifact-cli, publish-cli, artifact-sdk
    ├── artifact/      the 7 templates + a pre-installed dependency tree
    │                  (vite, three, jsxgraph, katex, echarts, mermaid, matter-js, the SDK)
    ├── ppt/           @teacher-dsh/ppt-kit + PptxGenJS
    ├── deploy/        netlify-cli, wrangler, vercel
    ├── skills/        12 bundled Skills, flat so DSH discovers all of them
    ├── plugins/       the pinned plugin lock
    ├── seed/dsh-home/ the ready-made DSH home: desktop profile + 3 vendor plugins
    └── manifests/     every lock plus the runtime build record
```

`resources/dsh-runtime` and `resources/teacher-runtime` are build outputs and are git-ignored.
They enter the installer through electron-builder's `extraResources` in
`dsh-plugin-desktop/package.json`.

## First run

`dsh-plugin-desktop/src/teacher-bootstrap.ts` generates the command shims in the per-user state
directory and exports the `TEACHER_*` roots plus `DSH_BUNDLED_SKILL_DIR` into the Host process.
The Windows machine PATH, `NODE_HOME`, and the global npm prefix are never modified.

`dsh-plugin-desktop/src/teacher-profile-seed.ts` copies the bundled DSH home into the user's DSH
home **only when the `desktop` profile does not exist yet**. Existing user data is never
overwritten and nothing is installed from the network.

## Why the vendor plugin pins are what they are

`dsh-better-sidebar` is pinned to **0.18.1**, not to the vendored git HEAD (0.19.0). 0.19.0
requires `@deepseek-ai/dsh-client-ui-sidebar-right@^0.1.5-rc.1`, which the pinned Harness
`0.1.2-rc.1` does not provide. This is the documented upgrade rule: the old pin stays buildable,
a newer upstream is tested separately, and only then is the pin bumped.

`wh-drop` is registered as `enabled: false` with `disabledReason: "no-public-service-found"`. No
host, documentation, or API could be located for it, so no adapter is attempted.

## Windows packaging pitfalls

These cost real time during the 0.1 build. Read them before debugging a "packaging failure".

### A locked artifact looks like a packaging bug

`electron-builder` writes `Teacher-DSH-<version>-x64-Portable.zip.tmp`, then renames it over the
final name. **Windows Search Indexer opens the freshly written archive to index it**, so the rename
fails with `EBUSY` — surfaced only as the localized message *"The file is being used by another
process"*, followed by a `builder-util` stack trace that names nothing useful. The `.tmp` is left
behind at full size, which reads exactly like a truncated or corrupt build.

Symptoms: `dist:win-portable` exits 1, or appears to hang for tens of minutes with the `.tmp`
growing and never being renamed. Re-running does not help, because the indexer re-opens each new
file.

Fixes, in order of preference:

1. Build into a directory Windows does not index — for example `--config.directories.output=dist-release`.
2. Exclude the output directory from Windows Search indexing.
3. Delete the previous archive *and* the `.tmp` before rebuilding, and retry until the lock clears.
   Deleting only the `.tmp` is not enough; the lock is on the final `.zip`.

Confirm the holder with `Get-Process | Where-Object Name -match 'SearchIndexer'` and, when a build
fails, look for a localized "file is being used" message rather than an English `EBUSY`.

### Never let a packaging run follow the dev junctions

`scripts/teacher/stage-dev.mjs` replaces `dist/win-unpacked/resources/{teacher-runtime,dsh-runtime}`
with junctions into the repository. `electron-builder`'s `extraResources` copy targets those exact
paths, so a packaging run while they exist can follow them into the source tree.

Remove them first with `cmd /c rmdir "<path>"`. Do **not** use `Remove-Item`: PowerShell prompts for
confirmation on a non-empty junction and fails in a non-interactive shell.

Also delete `dsh-plugin-desktop/dist/win-unpacked` when swapping between junction-staged and real
copies, so a run can never mix the two.

### The bundled runtime is large, so builds are I/O bound

The payload is roughly 1 GB across ~67,000 files. Expect the `extraResources` copy to dominate the
first packaging pass. `compression: maximum` was chosen deliberately: it costs build time and saves
about 35 MB on the Setup and 85 MB on the Portable archive. Reuse a single `--prepackaged` directory
when producing more than one target instead of re-copying the payload per artifact.
