# Teacher DSH 0.1 工作移交文档

> 本文档描述 Teacher DSH 0.1 **当前已验证的状态**，用于把它完整移交给下一位接手人。
> 所有路径均以本机绝对路径书写，可整体替换根目录。
> 构建流水线的规范说明在 `teacher/BUILD.md`，本文只做索引与状态汇报，不重复其内容。

---

## 0. TL;DR（先看这里）

- **产品目标**：把官方 `anywhere-labs/dsh-desktop`（Electron 外壳 + 未修改的 DeepSeek Harness）做成教师增强发行包 **Teacher DSH 0.1**。装完之后双击就是 DSH，但 Node.js、pnpm、Harness、artifact 工具链（Vite/Three.js/JSXGraph/KaTeX/ECharts/Mermaid/Matter.js）、PPT 工具链、12 个教学 Skill、3 个内置插件、匿名静态发布 + 4 个账号制托管通道——全部已经在这个安装包里，**不装 Node、不装 pnpm、不联网、不碰机器 PATH**。
- **当前状态**：0.1 的完整包已经做完并验证通过。版本 `0.1.0`，Windows x64 的 Setup（NSIS）与 Portable（ZIP）都已经生成；打包后的应用目录 41/41 项检查通过（`scripts/teacher/smoke-package.mjs`），Portable 压缩包 smoke 通过；profile seed 17/17 项通过，三个内置插件全部真实挂载；匿名静态发布已在本机真实跑通一次 62/62 文件哈希校验的部署。**剩余的不确定项**：账号制持久化发布没有实测过；②–⑤ 的教具只在打包流水线里构建成功、没有在真实浏览器里看过效果；安装器没有在干净的 VM 上跑过；另有一组未提交的体积瘦身改动尚未重新构建验证。详见第 5、8 节。

---

## 1. 仓库与 Git 状态

### 1.1 工作仓库（主线）

```text
路径：C:\Users\inkot\Desktop\kc\teacher-dsh-desktop
分支：teacher-dsh-0.1
origin：https://github.com/anywhere-labs/dsh-desktop.git   （尚未推送到自己的 fork）
基线：tag v2.0.5 / v2.0.5-beta.1，commit 423406f
```

近期 commit（从新到旧）：

```text
932e683 test(desktop): give the recovery uninstall fixture a realistic Windows shell environment
7405179 feat(publish): replace the publish skeleton with a verified provider CLI
1c7fb19 fix(desktop): align the Windows artifact verifiers and tests with Teacher DSH branding
64e9849 feat(teacher): bundle the complete Teacher DSH 0.1 runtime
1feca7c docs: add Teacher DSH 0.1 handover document
494fa2e wip(teacher): runtime bootstrap, publish-cli, ppt-kit (unverified)
7cc6109 chore(vendor): prune education-agent-skills to 7 selected skills
1caf6fe fix(vendor): pin web-design-guidelines to local snapshot
0e363ff test(teacher): add final-layer artifact smoke test
69e8396 docs: add Teacher DSH third-party notices
```

- `64e9849` 是主线提交：runtime 注入、ppt-kit 回迁、profile seed、打包与 CI 都在里面。
- `7405179` 把 publish-cli 从骨架换成完整实现（28 个文件、+5435 行）。
- `932e683` 修掉了原先那个与 Teacher 层无关的失败测试（见 5.6）。
- `494fa2e` 那条 WIP 提交记录的历史问题（ppt-kit `save()` 报错、runtime 未接入打包）**已经全部解决**，
  不要再按旧文档去修。

### 1.2 交接时的工作区状态

`HANDOVER.md` 与 `teacher/packages/publish-cli/README.md` 的改动是本轮文档工作的产出。除此之外，工作区里
还有一组**与文档无关、尚未提交、且仍在变化中的改动**（压缩包体积、开发期 staging 与 CI 门禁）。
接手第一件事就是用 `git status` + `git diff` 看清当时的确切状态，**不要直接丢弃它们**。

截至本文档最后一次更新，它们大致是这个范围（**以 `git status` 为准，不要照抄**）：

```text
 M scripts/teacher/build-teacher-runtime.mjs    # pruneRuntimeTree() + stepPrune：
                                                #   剪 sourcemap / PDB / 包内测试目录 / 异平台原生包 /
                                                #   已内联进客户端 bundle 的依赖；删除前用 package.json
                                                #   的入口声明做保护判断，LICENSE 类文件永不删除
 M scripts/teacher/build-profile-seed.mjs       # 复用同一个 pruneRuntimeTree()，不再维护第二套规则
 M .github/workflows/teacher-distribution.yml   # verify 阶段加 publish-cli 契约 smoke；
                                                # package-windows 阶段加 verify-profile-seed
 M dsh-plugin-desktop/package.json              # 与打包/裁剪相关
?? scripts/teacher/stage-dev.mjs                # 新增：把已打包 app 的 resources/{teacher,dsh}-runtime
                                                #   换成指向仓库 resources/ 的 Windows junction，
                                                #   从而免去每次打包（见 6.4）
```

**这组改动尚未跑过完整重建验证**，所以第 3、4 节引用的 41/41、1215.8 MB 等数字都是**改动之前**那一次
构建的实测结果。接手后请按第 4 节完整重建一遍，重新跑 `smoke-package.mjs` / `smoke-portable.mjs` /
`verify-profile-seed.mjs`，并把 1.2 / 3.3 / 5.3 的数字一起更新。

### 1.3 旧冻结仓库（仅参考）

```text
路径：C:\Users\inkot\Desktop\kc\teacher-dsh
分支：main
tag：legacy-teacher-skeleton
commit：6250bfb
```

- 最初那一版独立 Teacher DSH 骨架（artifact-cli / artifact-sdk / ppt-kit / deploy-toolchain / 自有 Skill / 模板）。
- **已冻结，不要往里加东西。** 新工作一律在 `teacher-dsh-desktop` 里。
- `teacher/legacy/` 已经导入了这一版作为参考；注意里面也有一份完整的旧 artifact-cli，不要和 `teacher/packages/artifact-cli` 搞混，新代码一律用后者。

---

## 2. 总体架构

```text
teacher-dsh-desktop/
│
├── deepseek-harness/                  # 上游 submodule，pinned Harness 0.1.2-rc.1（只读，永不修改）
├── dsh-plugin-desktop/                # Electron 主插件：品牌、打包、Desktop runtime、Teacher 注入
│   ├── src/teacher-bootstrap.ts       # ★ Teacher 命令 shim + TEACHER_*/DSH_BUNDLED_SKILL_DIR 注入
│   ├── src/teacher-profile-seed.ts    # ★ 首次运行把内置 DSH home 复制进用户目录
│   ├── src/main.ts                    # 调用上面两者
│   └── package.json                   # build.appId / productName / artifactName / extraResources
├── dsh-community-market/              # 上游自带社区市场（保留）
│
├── teacher/                           # ★ Teacher 层（我们维护）
│   ├── BUILD.md                       # ★ 发行构建的唯一权威说明
│   ├── packages/
│   │   ├── artifact-cli/              # teacher-artifact + teacher-latex
│   │   ├── artifact-sdk/              # @teacher-dsh/artifact-sdk
│   │   ├── ppt-kit/                   # @teacher-dsh/ppt-kit（PptxGenJS 封装）
│   │   ├── publish-cli/               # teacher-publish（detect/inspect/plan/deploy/verify/providers）
│   │   └── teacher-bundle/            # profile glue 与 bundled skills 清单
│   ├── skills/                        # 自有 Skill：teaching-aid / publish-static / latex-authoring
│   ├── templates/                     # 7 个模板：basic / three / math / physics-2d / chart / diagram / classroom-game
│   ├── vendor-skills/                 # 第三方 Skill（原样 vendoring，保留 LICENSE 与 SOURCE.json）
│   ├── manifests/                     # 7 个 lock/manifest（见 6.2）
│   ├── scripts/                       # build-toolchain.mjs / build-template-lockfiles.mjs
│   └── legacy/                        # 旧实现整体保留，勿删
│
├── resources/                         # ★ 构建产物（git-ignored，由 extraResources 进安装包）
│   ├── dsh-runtime/                   # node/ + pnpm/ + dsh/ + node_modules/(resolution contract)
│   ├── teacher-runtime/               # cli/ artifact/ ppt/ deploy/ skills/ plugins/ seed/ manifests/
│   └── teacher-seed/plugins-built/    # 3 个插件的预构建产物
│
├── scripts/teacher/                   # 发行构建与校验脚本（见 6.4）
├── tests/                             # smoke/ + ppt/
├── .github/workflows/                 # teacher-distribution.yml（唯一发行流水线）
└── THIRD_PARTY_NOTICES.md             # 由 build-notices.mjs 生成
```

### 关键设计决策

1. **不 fork Harness，不修改 `deepseek-harness/`。** 上游是 pinned submodule；Teacher 层只做供货、注入与打包。
2. **复用 Desktop 的 Electron 外壳，不自己写启动器。** 品牌、安装器、窗口、终端全部沿用上游能力，只改标识与行为开关。
3. **自带完整 runtime，而不是复用机器上的 Node/pnpm。** 安装包内含 portable Node.js **22.23.2**（含 npm/npx/corepack）、pnpm **11.8.0**、deploy CLI（netlify-cli **27.5.2** / wrangler **4.130.0** / vercel **59.15.1**）。
4. **pinned Harness 随应用载荷一起发。** `resources/dsh-runtime/node_modules/` 只放“解析契约”而不再复制一份 Harness，安装体积不翻倍（见 `build-teacher-runtime.mjs` 的 `stepDsh`）。
5. **profile seed：首启即用的 DSH home。** `resources/teacher-runtime/seed/dsh-home/` 是一份已经 materialize 好的 `desktop` profile（含 3 个 vendor 插件）。`teacher-profile-seed.ts` **只在 `profiles/desktop` 不存在时**才复制进去，绝不覆盖用户数据，也绝不联网安装。
6. **`DSH_BUNDLED_SKILL_DIR` 是 Skill 的发现入口。** `teacher-bootstrap.ts` 把 `<teacher-runtime>/skills` 导出给 Host，Harness 的 filesystem skill provider 以 bundled-skill 优先级扫描它，所以 12 个 Skill 零配置可用。该目录必须是**扁平**的 `<root>/<skill-name>/SKILL.md`，不能按 vendor 分组。
7. **永不修改机器 PATH。** 所有 shim（`teacher-artifact.cmd` / `teacher-latex.cmd` / `teacher-publish.cmd` / `teacher-ppt.cmd` / `pnpm.cmd` / `dsh-teacher.cmd`）都生成在按用户的私有状态目录里，只前插到当前 Host 进程的 `PATH`；`NODE_HOME`、系统 PATH、npm 全局 prefix 一律不动。
8. **`extraResources` 承载两个 runtime。** `dsh-plugin-desktop/package.json` 的 `build.extraResources` 把 `../resources/dsh-runtime` 与 `../resources/teacher-runtime` 映射到安装包内同名目录；`resources/` 本身是构建产物，不进 git。
9. **所有网络调用只发生在构建期。** 运行时（首启、生成教具、导出 PPT、匿名发布）不需要 npm registry，也不需要 GitHub。

---

## 3. 已经完成并且验证通过的工作

### 3.1 版本与产物

```text
version：      0.1.0
productName：  Teacher DSH
appId：        com.teacherdsh.desktop
shortcutName： Teacher DSH
Setup（NSIS）：Teacher-DSH-0.1.0-x64-Setup.exe      319.6 MB
Portable（ZIP）：Teacher-DSH-0.1.0-x64-Portable.zip  595.1 MB
输出目录：      dsh-plugin-desktop\dist\
```

### 3.2 打进安装包的东西

```text
portable Node.js   22.23.2
pnpm               11.8.0
Harness            0.1.2-rc.1（随应用载荷）
deploy CLI         netlify-cli 27.5.2 / wrangler 4.130.0 / vercel 59.15.1
artifact 工具链     vite 8.2.2, three 0.186.0, jsxgraph 1.13.3, katex 0.18.7,
                   echarts 6.1.0, mermaid 12.0.0, matter-js 0.20.0,
                   @teacher-dsh/artifact-sdk 0.1.0
PPT 工具链          @teacher-dsh/ppt-kit + pptxgenjs 4.0.1
模板                7 个（basic / three / math / physics-2d / chart / diagram / classroom-game）
Skill               12 个（扁平目录，经 DSH_BUNDLED_SKILL_DIR 发现）
vendor 插件         3 个（见 3.4）
```

`teacher-artifact init` 会把这份 artifact 依赖树通过 **Windows junction** 链到项目里的
`node_modules`，所以 `init` / `build` / `check` 是秒级且完全离线的（不跑 `npm install`）。

### 3.3 实测数字（本轮真实运行的结果）

```text
脚本                                              结果
scripts\teacher\smoke-package.mjs                 41/41 checks passed
  ├─ dsh-runtime-size      112.7 MB,  2476 files
  ├─ teacher-runtime-size 1215.8 MB, 73541 files
  ├─ bundled-skills        12 skills
  └─ profile-seed-bundles  5 bundles / 3 个 vendor 插件全部就位
scripts\teacher\smoke-portable.mjs --archive ...  通过（对 595.1 MB 的 ZIP 解包后重跑上面的 smoke）
scripts\teacher\verify-profile-seed.mjs           17/17 checks passed
scripts\teacher\verify-skills.mjs                 OK，12 skills validated
scripts\teacher\verify-plugins.mjs                OK，3 core plugins verified
scripts\teacher\verify-licenses.mjs               OK，9 curated components / 1537 inventoried packages
```

`verify-profile-seed.mjs` 不是“看一眼目录”，它把 seed 拷进临时 DSH home、按 desktop profile 组合并
**无头真实启动**，然后逐项断言：

```text
profile booted without throwing                    160 Loader rows settled
layers / boot graph / mounted row                  dsh-better-sidebar（row id: better-sidebar）
layers / boot graph / mounted row                  @dsh-cowork/plugin（row id: cowork-docs）
layers / boot graph / mounted row                  dsh-plugin-pptkit-presentation
resolved module entry exists                       dsh-better-sidebar@0.18.1 / @dsh-cowork/plugin@0.1.0 /
                                                   dsh-plugin-pptkit-presentation@0.1.0
effect: Cowork registers doc_read and doc_write    ctx.tools.get: doc_read, doc_write
effect: PPTKit registers its skill provider        skill catalog entry: pptkit-presentation
```

`smoke-package.mjs` 跑的是**打包后的应用目录**（`dsh-plugin-desktop/dist/win-unpacked`），它会用包内的
Node + artifact CLI 现场 `init → build → check` 出一个 three 教具，并用包内的 PPT CLI 现场生成一个
可编辑的 `.pptx`。

### 3.4 profile seed 与三个 vendor 插件

```text
dsh-better-sidebar@0.18.1                （注意：不是 0.19.0，理由见 5.1）
@dsh-cowork/plugin@0.1.0
dsh-plugin-pptkit-presentation@0.1.0
```

三者都以**真实目录**（非 symlink/junction）落在 `seed/dsh-home/profiles/desktop/node_modules/` 下，
并写进 profile 的 `dsh.profile.bundles`，mount 顺序为 launcher bundles 在前、vendor 插件在后。

### 3.5 静态发布（publish-cli）

- 6 个命令全部实现：`detect` / `inspect` / `plan` / `deploy` / `verify` / `providers`（另有 `tunnel detect|start`）。
- 匿名通道已对**真实线上服务**验证：一次真实部署成功落在 ship.page，**62/62 个文件哈希校验通过**。
- 6 个匿名通道（ship.page / ShipStatic / aft.page / here.now / Show / Dropley）的协议已逐条实测并记录在
  `teacher/packages/publish-cli/docs/provider-protocols.md` 的 “Live observations” 一节（ship.page 的 zip 通道、
  ShipStatic 的 `files[]` 与改写 HTML、here.now 的 `versionId`/`finalizeUrl`、aft.page 返回包装页、
  Show 的 `*.127.dev` 主机、Dropley 未公开的扩展名白名单）。
- 成功语义是硬的：上传返回 2xx 只是**候选成功**，`success: true` 必须等远端 SHA-256 比对通过。

---

## 4. 如何重新构建完整包

**权威说明是 `teacher/BUILD.md`**，那里解释每一步为什么存在。命令序列（PowerShell）：

```powershell
# 0. Desktop workspace（Yarn 4 经 Corepack）
corepack enable
corepack yarn install --immutable

# 1. 内置 runtime：Node、pnpm、dsh shim、teacher CLI、artifact/PPT/deploy 依赖树、Skill、manifest
node scripts/teacher/build-teacher-runtime.mjs

# 2. 预构建三个 vendor 插件
node scripts/teacher/build-vendor-plugins.mjs

# 3. 必须先构建 desktop 包，profile seed 才有东西可组合
corepack yarn workspace dsh-plugin-desktop build

# 4. profile seed
node scripts/teacher/build-profile-seed.mjs

# 5. 许可证清单与 THIRD_PARTY_NOTICES
node scripts/teacher/build-notices.mjs

# 6. Setup（NSIS）与 Portable（ZIP）
$env:DSH_PACKAGE_CHECK_ALREADY_RAN = '1'
corepack yarn workspace dsh-plugin-desktop dist:win
corepack yarn workspace dsh-plugin-desktop dist:win-portable

# 7. 验证打包后的载荷与 Portable 归档
node scripts/teacher/smoke-package.mjs
node scripts/teacher/smoke-portable.mjs --archive dsh-plugin-desktop/dist/*Portable*.zip
```

`DSH_PACKAGE_CHECK_ALREADY_RAN=1` 会跳过上游 preflight 测试套件；**只有在同一 workspace 状态下已经跑过
`corepack yarn check` 时才可以设置它。**

CI 里等价的流水线是 `.github/workflows/teacher-distribution.yml`（`verify` → `package-windows` →
`smoke-package` 三段），它测的不是“开发源码能不能跑”，而是“**安装包能不能跑**”。

---

## 5. 已知问题与坑

### 5.1 `dsh-better-sidebar` 必须钉在 0.18.1，不要升 0.19.0

vendored 的 git HEAD 是 0.19.0，但它要求 `@deepseek-ai/dsh-client-ui-sidebar-right@^0.1.5-rc.1`，
而 pinned Harness `0.1.2-rc.1` 并不提供这个包。**升级规则**：旧 pin 必须保持可构建；新版上游单独测试；
测试通过之后才允许 bump pin。`verify-plugins.mjs` 会打印实际 pin（当前 0.18.1 / 0.1.0 / 0.1.0）。

### 5.2 只读 junction 与项目内 `cacheDir`

`teacher-artifact init` 把内置依赖树以 **junction** 链成项目的 `node_modules`，它是一个指向安装目录的
只读链接。因此 7 个模板的 `vite.config.js` 都显式设置：

```js
cacheDir: '.teacher-cache',   // 项目内，不写进安装目录、不写进只读 junction
```

删掉这一行会导致构建在某些环境下因无法写入缓存目录而失败。**新增模板时必须照抄这个设置。**

### 5.3 体积

未压缩的内置 runtime 约 **1.2 GB**（`teacher-runtime` 1215.8 MB / 73541 文件，`dsh-runtime` 112.7 MB），
压缩后 NSIS 安装器约 **320 MB**、Portable ZIP 约 **595 MB**。这已经超出普通 Electron 工具的常见量级，
是本发行版最大的工程约束（下载时长、CI 时长、磁盘占用）。

上面的 1.2 GB 是**瘦身改动之前**的实测值。第 1.2 节列出的未提交改动（`stepPrune` / 复用
`pruneRuntimeTree`）目的就是压这个数字；它们尚未经过完整重建验证，所以**当前文档里的体积数字仍是旧的**。
提交前请重跑完整构建，确认体积确实下降、且 `smoke-package.mjs`、`smoke-portable.mjs`、
`verify-profile-seed.mjs` 全部仍然通过。

### 5.4 持久化 provider 没有凭证，成功路径未实测

`netlify` / `cloudflare-pages` / `vercel` / `github-pages` 走的是包内 CLI，代码按官方 CLI 契约实现，
**只实测过未认证的失败路径**，没有真实账号跑通过成功路径。不要在没有实测的情况下把 persistent 部署
当作已验证能力。注意：persistent 模式失败时**不会**降级到匿名临时主机，这是刻意设计。

### 5.5 `wh-drop` 彻底没有实现

注册表里 `enabled: false` + `disabledReason: "no-public-service-found"`（21 个候选域名都无法解析）。
`src/providers/index.mjs` 的 `UNIMPLEMENTED_ADAPTERS` 明确包含它，`adapterAvailability()` 对它返回 false，
**即使 overlay 重新启用它也无法被派发**。不要再花时间找这个服务。

### 5.6 上游测试失败：已修复

原先 `dsh-plugin-desktop/tests/recovery-plugin-uninstall.spec.ts` 是失败的，它与 Teacher 层无关。该问题现已
由 commit `932e683` 修复（给测试夹具补上真实的 Windows shell 环境 `ComSpec` / `SystemRoot` / `PATHEXT`，
因为上游 `dsh plugin` 通过 `spawnSync(..., { shell: true })` 找 shell）。本轮实测确认：

```text
corepack yarn workspace dsh-plugin-desktop vitest run tests/recovery-plugin-uninstall.spec.ts
  → Test Files 1 passed (1) / Tests 5 passed (5)
```

**因此当前没有已知的失败测试。** 如果后续又看到它失败，先检查是不是这个夹具环境又被改动了。

### 5.7 `providers.lock.json` 已经和实现对不上

`teacher/manifests/providers.lock.json` 还停在候选池阶段，而运行时真正加载的是
`teacher/packages/publish-cli/config/providers.json`。两者在 provider 数量、ID 和 `enabled` 状态上都已经
不一致（详见 6.2 的说明）。这不影响功能（CLI 只读后者），但会误导接手人，而且 CI 抓不到。
**建议**：要么把 `providers.lock.json` 重新生成为后者的摘要，要么在 `verify-*` 里加一条一致性断言。

### 5.8 只产出 Windows x64

macOS / Linux 的打包没有产出（`electron-builder` 的 mac/linux target 仍是 `dir`），且整包内含 Windows x64
原生二进制（`node.exe`、`win32-x64` prebuilds 等）。**这个包只能在 Windows x64 上跑。**

### 5.9 其他小坑

- `resources/` 是构建产物且被 git 忽略；`smoke-package.mjs` 默认读 `dsh-plugin-desktop/dist/win-unpacked`，
  所以**必须先打包**再跑它。
- `teacher/pnpm-workspace.yaml` 会被 pnpm 自动追加 `minimumReleaseAgeExclude`（mermaid / @mermaid-js/parser）。
  可以保留，但注意别让它在干净机器上触发 policy 报错。
- corepack 首次下载 yarn 会交互，脚本里统一设 `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`。
- 若本机 `~/.gitconfig` 配了 HTTP 代理且该代理不可用，clone GitHub 会挂；临时绕过用
  `git -c http.proxy= -c https.proxy= clone ...`，`scripts/teacher/vendor-*.mjs` 已内置该 override。
- 旧仓库工作区里的 `git-commit.log`、`legacy.tar` 可以直接删。

---

## 6. 关键文件地图

### 6.1 Desktop 侧改动

| 文件 | 作用 |
|---|---|
| `dsh-plugin-desktop/package.json` | `version 0.1.0`、`appId com.teacherdsh.desktop`、`productName Teacher DSH`、NSIS `artifactName`/`shortcutName`、`extraResources`（两个 runtime）、`electronFuses.runAsNode: true` |
| `dsh-plugin-desktop/src/teacher-bootstrap.ts` | 生成 Teacher 命令 shim 到私有状态目录；导出 `TEACHER_*` 与 `DSH_BUNDLED_SKILL_DIR`；把 `bin/`、`node/`、`deploy/node_modules/.bin` 前插到进程 PATH；只改 `process.env`，不碰机器 PATH |
| `dsh-plugin-desktop/src/teacher-profile-seed.ts` | `materializeTeacherProfileSeed()`：仅当 `profiles/desktop` 不存在时把 seed 拷进 DSH home，返回 `applied` / `no-seed` / `profile-exists` / `seed-incomplete` |
| `dsh-plugin-desktop/src/main.ts` | 调用上述两者完成注入 |
| `dsh-plugin-desktop/scripts/package-win.ts` / `package-win-portable.ts` | `dist:win` / `dist:win-portable` |
| `dsh-plugin-desktop/installer.nsh` | NSIS 安装钩子 |
| `dsh-plugin-desktop/scripts/verify-packaged-runtime.ts` | electron-builder `afterPack` 校验 |

### 6.2 Teacher manifests（`teacher/manifests/`）

| 文件 | 内容 |
|---|---|
| `desktop-upstream.lock.json` | desktop 基线与 pinned Harness 版本 |
| `toolchain.lock.json` | artifact 工具链版本 + 兼容性区间（desktop v2.0.5 / harness 0.1.2-rc.1） |
| `plugins.lock.json` | 3 个 core 插件 + 2 个 optional（均 `enabled: false`）+ 3 个 excluded |
| `skills.lock.json` | 自有 3 个 + vendor Skill 清单 |
| `providers.lock.json` | 12 个静态托管候选池 + 5 个 tunnel 候选（除 ship-page / netlify-anonymous 外全部 `enabled: false`）。**注意：这个 lock 已经落后于实现**，见下方说明 |
| `licenses.lock.json` | 许可证清单（约 300 KB） |
| `teacher-profile.lock.json` | teacher profile bootstrap 清单 |

运行时还会额外生成 `runtime.build.json`（构建时间、平台、三组依赖版本），随包发出。

> **manifest 与实现的偏差（建议修）**：`providers.lock.json` 停留在“候选池调研”阶段，而
> `publish-cli/config/providers.json` 才是**运行时真正加载**的注册表。实测（`teacher-publish providers`）
> 当前注册表共 **11 个 provider**，其中 `enabled: true` 的有 10 个：匿名 `ship-page` / `shipstatic` /
> `aft-page` / `here-now` / `show` / `dropley`（quick-share），账号制 `netlify` / `cloudflare-pages` /
> `vercel` / `github-pages`（persistent）；唯一 disabled 的是 `wh-drop`。ID 也已变化
> （`netlify-anonymous` → `netlify`）。`smoke-package.mjs` 只检查 `teacher-runtime/manifests/` 里的文件
> **存在**，不校验其内容，所以这个偏差不会被 CI 抓到。

### 6.3 Teacher packages

| 包 | 状态 |
|---|---|
| `@teacher-dsh/artifact-sdk` | 完成（`createStage` / UI / 公式） |
| `@teacher-dsh/artifact-cli` | 完成：`teacher-artifact init/build/check/preview/pack` + `teacher-latex`；junction 直连内置依赖树，离线秒级 |
| `@teacher-dsh/ppt-kit` | 完成：`teacher-ppt init/build/check`；旧的 `save()` 报错已解决，能产出可编辑 `.pptx` |
| `@teacher-dsh/publish-cli` | 完成：6 命令 + tunnel；匿名通道线上实测；见 `README.md` 与 `docs/provider-protocols.md` |
| `@teacher-dsh/teacher-bundle` | profile glue 与 bundled skills 清单 |

### 6.4 发行脚本（`scripts/teacher/`）

| 脚本 | 作用 |
|---|---|
| `build-teacher-runtime.mjs` | **主构建**：node / pnpm / dsh / cli / artifact / ppt / deploy / skills / plugins / manifests / bin（+ 未提交的 prune 步骤） |
| `build-vendor-plugins.mjs` | 预构建 3 个 vendor 插件；断言产物中没有 symlink/junction |
| `build-profile-seed.mjs` | 组合并落盘 `seed/dsh-home`，修剪插件树（复用 `pruneRuntimeTree`） |
| `stage-dev.mjs` | **（未提交）** 把已打包 app 的 `resources/{teacher,dsh}-runtime` 换成指向仓库 `resources/` 的 junction，之后 `smoke-package.mjs` 直接验证**活的运行时树**，不必每次重新打包；`--force` / `--app` / `--json` |
| `build-notices.mjs` | 生成 `THIRD_PARTY_NOTICES.md` 与 `licenses/` |
| `smoke-package.mjs` | 对打包后的应用目录跑 41 项检查 |
| `smoke-portable.mjs` | 解包 Portable ZIP 后重跑上面的 smoke |
| `verify-profile-seed.mjs` | 无头启动 seed profile，验证 3 个插件真实挂载与副作用 |
| `verify-skills.mjs` / `verify-plugins.mjs` / `verify-licenses.mjs` | Skill / 插件 pin / 许可证校验 |
| `verify-distribution.mjs` | manifests + 自有 Skill 的基础校验 |
| `vendor-skills.mjs` / `vendor-plugins.mjs` | 抓取第三方 Skill / 插件源码 |
| `sync-upstream.mjs` | 写 `desktop-upstream.lock` |
| `package-windows.mjs` / `build-offline-store.mjs` / `bootstrap-teacher-profile.mjs` | 早期蓝图脚本，保留参考 |

### 6.5 测试

| 路径 | 作用 |
|---|---|
| `tests/smoke/run-all.mjs` | 5 个模板 init → build → check（开发期用；打包验证以 `smoke-package.mjs` 为准） |
| `tests/ppt/run-ppt-smoke.mjs` | PPT 工具链 smoke |
| `teacher/packages/publish-cli/tools/` | `check-imports.mjs`、`smoke.mjs`（命令面与 `--json` 契约，不联网）、`probe-contracts.mjs`（重新实测线上匿名通道） |
| `dsh-plugin-desktop/tests/recovery-plugin-uninstall.spec.ts` | **已知失败**（见 5.6） |

---

## 7. 常用命令

### 7.1 发行构建与验证

```powershell
cd C:\Users\inkot\Desktop\kc\teacher-dsh-desktop

# 全量构建（细节见 teacher\BUILD.md）
node scripts\teacher\build-teacher-runtime.mjs
node scripts\teacher\build-vendor-plugins.mjs
corepack yarn workspace dsh-plugin-desktop build
node scripts\teacher\build-profile-seed.mjs
node scripts\teacher\build-notices.mjs

# 打包
$env:DSH_PACKAGE_CHECK_ALREADY_RAN = '1'
corepack yarn workspace dsh-plugin-desktop dist:win
corepack yarn workspace dsh-plugin-desktop dist:win-portable

# 验证
node scripts\teacher\smoke-package.mjs
node scripts\teacher\smoke-portable.mjs --archive dsh-plugin-desktop\dist\Teacher-DSH-0.1.0-x64-Portable.zip
node scripts\teacher\verify-profile-seed.mjs
node scripts\teacher\verify-skills.mjs
node scripts\teacher\verify-plugins.mjs
node scripts\teacher\verify-licenses.mjs
```

### 7.1b 不重新打包的迭代方式（`stage-dev.mjs`，尚未提交）

只要已经打包过一次，就可以把 app 里的两份 runtime 换成指向仓库的 junction，之后改 CLI / Skill 只需要重建
runtime 的一部分：

```powershell
# 把 dist\win-unpacked\resources\{teacher-runtime,dsh-runtime} 换成 junction
node scripts\teacher\stage-dev.mjs

# 改完 CLI 或 Skill 后（秒级，不必重打包）
node scripts\teacher\build-teacher-runtime.mjs --only=cli
node scripts\teacher\build-teacher-runtime.mjs --only=skills

# 立刻用打包路径验证活的运行时树
node scripts\teacher\smoke-package.mjs
```

注意：junction 只适合本机迭代，**真正的安装包必须走 `dist:win` 的真实复制**（见第 4 节）。

### 7.2 单次 artifact 验证（用包内工具链）

```powershell
$tmp = "$env:TEMP\tdsh-check"; Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Set-Location $tmp
node C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher\packages\artifact-cli\bin\teacher-artifact.mjs init demo --template three
Set-Location demo
node C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher\packages\artifact-cli\bin\teacher-artifact.mjs build
node C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher\packages\artifact-cli\bin\teacher-artifact.mjs check
node C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher\packages\artifact-cli\bin\teacher-artifact.mjs preview --open
```

### 7.3 publish-cli

```powershell
cd <一个已 build 的 artifact 目录>
node C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher\packages\publish-cli\bin\teacher-publish.mjs detect
node C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher\packages\publish-cli\bin\teacher-publish.mjs inspect --json
node C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher\packages\publish-cli\bin\teacher-publish.mjs plan --mode quick-share
node C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher\packages\publish-cli\bin\teacher-publish.mjs deploy --mode quick-share --auto
# 离线契约 smoke（不联网）
node C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher\packages\publish-cli\tools\smoke.mjs <artifact-dir>
```

### 7.4 Desktop 侧

```powershell
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT='0'
cd C:\Users\inkot\Desktop\kc\teacher-dsh-desktop
corepack yarn install --immutable
corepack yarn check          # typecheck + 测试 + 上游 gate
corepack yarn dev            # 开发模式启动
```

### 7.5 Git（GitHub 访问 override）

```powershell
git -c http.proxy= -c https.proxy= clone https://github.com/...
git -c http.proxy= -c https.proxy= fetch --tags
```

---

## 8. 八项验收任务的当前状态

判定口径：**只有存在真实运行证据的才写「已通过」**；只在包内跑通、但没有在真实浏览器/真实账号上确认的
写「部分通过」，并明确写出测过什么、没测过什么。

| # | 任务 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| ① | 干净 Windows 安装并打开 | **部分通过** | 安装包已产出（`Teacher-DSH-0.1.0-x64-Setup.exe`），打包后的应用目录 41/41 项通过、Portable 解包 smoke 通过，证明载荷自洽且不依赖开发环境。**未做**：在真正干净的 Windows 机器/VM 上执行安装向导并手动打开窗口（本机验证走的是 `win-unpacked` 目录与 ZIP 解包，不是安装器流程）；安装器未签名。 |
| ② | Three.js 三维教具 | **部分通过** | 包内 three 模板 `init → build → check` 全部通过，产物含 JS bundle 与 `dist/index.html`（`smoke-package.mjs` 的 `artifact-*` 检查）。**未做**：在浏览器里实际打开并确认三维渲染与交互效果。 |
| ③ | 数学二次函数演示（JSXGraph + KaTeX） | **部分通过** | `math` 模板可初始化（jsxgraph 1.13.3 + katex 0.18.7 均在包内依赖树中），`tests/smoke/run-all.mjs` 覆盖该模板。**未做**：参数交互与公式渲染的浏览器内实际确认。 |
| ④ | 二维碰撞实验（Matter.js） | **部分通过** | `physics-2d` 模板可初始化，matter-js 0.20.0 在包内。**未做**：碰撞效果与帧率的浏览器内实际确认。 |
| ⑤ | 班级成绩分布图（ECharts） | **部分通过** | `chart` 模板可初始化，echarts 6.1.0 在包内。**未做**：图表渲染的浏览器内实际确认。 |
| ⑥ | 教学 PPT | **部分通过** | 包内 PPT CLI 现场 `init → build` 生成了 `.pptx`（181.3 KB / 11 页）并通过 `check`，check 自己报告 `editable OOXML: yes`（`smoke-package.mjs` 的 `ppt-*` 检查）。**未做**：用 PowerPoint/WPS 真正打开确认排版与可编辑性。 |
| ⑦ | 教育 Skill 设计一节课 | **部分通过** | 12 个 Skill 随包发出并通过校验；`verify-profile-seed.mjs` 证明 PPTKit 的 skill provider 已注册、Cowork 注册了 `doc_read`/`doc_write`。**未做**：让 Agent 真正端到端设计出一节课并人工评审产出。 |
| ⑧ | 静态发布返回 URL | **部分通过** | 匿名 quick-share 通道**已线上实测**：一次真实部署落在 ship.page，62/62 文件哈希校验通过，返回可用 URL。**未做**：persistent（Netlify / Cloudflare Pages / Vercel / GitHub Pages）的成功路径——没有凭证，只跑过未认证的失败路径。 |

> 补充：②③④⑤ 的模板都随包发出，并且同一个 smoke 会用包内工具链真的把 `three` 模板构建出
> `dist/`；「部分通过」指的是**没有在真实浏览器里验证视觉与交互结果**，不是模板跑不起来。

---

## 9. 交接检查清单

建议严格按顺序做：

1. [ ] `cd C:\Users\inkot\Desktop\kc\teacher-dsh-desktop; git status` — 读 1.2 节，review 当时那组未提交的
       瘦身改动（`build-teacher-runtime.mjs` 的 `stepPrune`、`build-profile-seed.mjs` 复用同一条规则、
       CI 加的两步）；确认无误后提交，它们会显著影响安装包体积。
2. [ ] 读 `teacher/BUILD.md`（构建流水线的唯一权威说明），再读本文件第 5 节。
3. [ ] `corepack yarn install --immutable`，然后 `corepack yarn check` 确认基线（当前没有已知失败测试，5.6）。
4. [ ] 跑一遍验证脚本：`verify-distribution.mjs`、`verify-skills.mjs`、`verify-plugins.mjs`、
       `verify-licenses.mjs`、`verify-profile-seed.mjs`。
5. [ ] 按第 4 节完整重建一次（含打包），再跑 `smoke-package.mjs` 与 `smoke-portable.mjs`，
       确认 41/41 与 Portable 通过，并更新 1.2 / 3.3 / 5.3 里的体积与数字。
6. [ ] 在**真实干净的 Windows VM** 上安装 Setup、打开窗口：这就是任务 ①。补做时同时确认首启 seed
       是否真的落到用户 DSH home、以及 12 个 Skill 是否可见。
7. [ ] 在浏览器里逐个打开 ②③④⑤ 的教具产物，把「部分通过」推进到「已通过」（或记录实际缺陷）。
8. [ ] 用 PowerPoint/WPS 打开 ⑥ 生成的 `.pptx`，确认可编辑（任务 ⑥）。
9. [ ] 让 Agent 用教育 Skill 端到端设计一节课并人工评审（任务 ⑦）。
10. [ ] 拿到一个 provider 账号（建议先 Netlify 或 Vercel），实测 persistent 部署成功路径；成功之后才能把
        ⑧ 标为完全通过（任务 ⑧，当前唯一未实测的成功路径）。
11. [ ] 处理体积：确认 `stepPrune` 的收益，并决定是否进一步拆分可选 runtime。
12. [ ] 决定 macOS/Linux 是否在 0.1.x 范围内（当前明确不支持，包里是 Windows x64 原生二进制）。
13. [ ] 推送到自己的 GitHub fork 并开 PR（origin 仍是上游仓库）。
