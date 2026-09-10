# Teacher DSH 0.1 工作移交文档

> 本文档由当前会话生成，用于把 Teacher DSH 0.1 的工作完整移交给下一位接手人。
> 所有路径均为本机绝对路径，可整体替换根目录。

---

## 0. TL;DR（先看这里）

- **产品目标**：把官方 `anywhere-labs/dsh-desktop` 做成教师增强发行包 `Teacher DSH 0.1`，安装后双击就是 DSH，但 Node/pnpm/Vite/Three.js/KaTeX/PPT/教师 Skills/静态发布 全部内置。
- **当前状态**：骨架、品牌、Teacher 层、Skill/Plugin 供货、CI、文档、artifact 工具链 smoke 已基本完成；最新一批改动（teacher-runtime 注入、publish-cli 完整实现、ppt-kit 回迁）已作为 WIP 提交，但尚未完成验证，且 ppt-kit 有一个未解决的报错。
- **最重要的一件事**：接手后先 `git status` 看未提交改动，把 pending 改动收尾、提交，再继续「完整 runtime 注入 + 打包」。

---

## 1. 两个仓库与 Git 状态

### 1.1 旧冻结仓库（参考基线）

```text
路径：C:\Users\inkot\Desktop\kc\teacher-dsh
分支：main
tag：legacy-teacher-skeleton
commit：6250bfb
```

- 这是最初做的一版独立 Teacher DSH 骨架（artifact-cli / artifact-sdk / ppt-kit / deploy-toolchain / 7 个自有 Skill / 7 个模板）。
- 已冻结，不要再往里加东西。新工作一律在下面的 desktop 仓库里。
- 工作区里有未跟踪的垃圾文件 `git-commit.log`、`legacy.tar`，可直接删除。
- `teacher/legacy/` 里已经导入了这一版，作为参考保留。
### 1.2 新工作仓库（主线）

```text
路径：C:\Users\inkot\Desktop\kc\teacher-dsh-desktop
分支：teacher-dsh-0.1
origin：https://github.com/anywhere-labs/dsh-desktop.git   （尚未推送到自己的 fork）
基线：tag v2.0.5 / v2.0.5-beta.1，commit 423406f
```

已提交的 commit（从新到旧）：

```text
7cc6109 chore(vendor): prune education-agent-skills to 7 selected skills
1caf6fe fix(vendor): pin web-design-guidelines to local snapshot
0e363ff test(teacher): add final-layer artifact smoke test
69e8396 docs: add Teacher DSH third-party notices
1ccf493 fix(teacher): regenerate template lockfiles and add teacher build scripts
6d5ff73 feat(teacher): add teacher layer manifests vendored skills and CI gates
c800990 feat(desktop): rebrand to Teacher DSH and disable auto OTA
333fe9d chore(teacher): import legacy teacher skeleton into teacher/legacy
423406f (tag: v2.0.5) upstream Merge pull request #796
```

**交付时的 WIP 改动（已提交为 commit `494fa2e`，接手第一件事是 review 它们）**：

```text
 M dsh-plugin-desktop/src/main.ts                    # 注入了 teacher-runtime bootstrap 调用
 M teacher/packages/publish-cli/package.json         # publish-cli 完整实现
 M teacher/packages/publish-cli/src/cli.mjs
 M teacher/pnpm-workspace.yaml                       # pnpm 自动加的 minimumReleaseAgeExclude
?? dsh-plugin-desktop/src/teacher-bootstrap.ts        # 新增：Teacher runtime PATH/env 注入
?? teacher/packages/ppt-kit/                          # 从 legacy 回迁的完整 PPT SDK
?? teacher/packages/publish-cli/src/adapters.mjs
?? teacher/packages/publish-cli/src/common.mjs
?? teacher/packages/publish-cli/src/detect.mjs
?? teacher/packages/publish-cli/src/plan.mjs
?? teacher/pnpm-lock.yaml
```

---
## 2. 总体架构（当前实现）

```text
anywhere-labs/dsh-desktop (v2.0.5, 未改上游 Harness)
│
├── deepseek-harness/                  # 上游 submodule，pinned 0.1.2-rc.1（只读）
├── dsh-plugin-desktop/                # Electron 主插件（改了品牌 + 关了 OTA + 注入 teacher runtime）
├── dsh-community-market/              # 上游自带社区市场（保留）
│
├── teacher/                           # ★ Teacher 层（我们维护）
│   ├── packages/
│   │   ├── artifact-cli/              # teacher-artifact + teacher-latex
│   │   ├── artifact-sdk/              # @teacher-dsh/artifact-sdk
│   │   ├── ppt-kit/                   # @teacher-dsh/ppt-kit（PptxGenJS 封装）
│   │   ├── publish-cli/               # teacher-publish（新增，完整实现中）
│   │   └── teacher-bundle/            # DSH bundle glue + bundled skills
│   ├── skills/                        # 自有 Skill（只有 3 个）
│   │   ├── teaching-aid/
│   │   ├── publish-static/
│   │   └── latex-authoring/
│   ├── templates/                     # 7 个教具模板
│   ├── vendor-skills/                 # 第三方 Skill（原样 vendoring）
│   │   ├── education-agent-skills/    # 7 个（CC BY-SA 4.0）
│   │   ├── pptkit-presentation/       # MIT
│   │   └── vercel-web-design/         # MIT，已本地化 guidelines 快照
│   ├── manifests/                     # 8 个 lock/manifest
│   ├── scripts/                       # build-toolchain / build-template-lockfiles
│   └── legacy/                        # 旧实现整体保留，勿删
│
├── resources/teacher-seed/plugins/    # 3 个核心插件源码 vendoring
│   ├── dsh-better-sidebar/
│   ├── dsh-cowork/
│   └── pptkit-presentation/
│
├── scripts/teacher/                   # 发行构建脚本
├── tests/                             # 最终层测试
├── .github/workflows/                 # CI
└── THIRD_PARTY_NOTICES.md
```

**关键设计决策**：

- 不 fork Harness，不修改 `deepseek-harness/`。
- 不覆盖 Desktop 的 Node/pnpm，而是复用 Desktop 自带 runtime，再在其上注入 Teacher runtime。
- 0.1 默认关闭 OTA（`dsh-plugin-desktop/src/updates.ts` 的 `enabled` 默认改为 `false`）。
- 0.1 只维护 3 个自有 Skill，其余全部 vendor。
- Teacher 层是独立的 pnpm workspace（`teacher/pnpm-workspace.yaml`），不并入 Desktop 的 Yarn workspace。

---
## 3. 已完成的工作（可验收）

### 3.1 品牌与 OTA（commit c800990）

`dsh-plugin-desktop/package.json` 已修改：

```text
appId:        ai.deepseek.dsh.desktop  ->  com.teacherdsh.desktop
productName:  DSH Desktop              ->  Teacher DSH
win artifact: DSH-Desktop-*.exe        ->  Teacher-DSH-*.exe
shortcutName: DSH Desktop              ->  Teacher DSH
```

`dsh-plugin-desktop/src/updates.ts`：`Config.enabled` 默认 `true` -> `false`。

### 3.2 Teacher 层（commit 6d5ff73 / 1ccf493）

- `teacher/packages/`：artifact-cli、artifact-sdk、teacher-bundle、publish-cli（骨架）
- `teacher/skills/`：teaching-aid、publish-static、latex-authoring 三个薄 Skill
- `teacher/templates/`：basic / three / math / physics-2d / chart / diagram / classroom-game
- `teacher/manifests/`：见第 6 节
- `teacher/scripts/`：`build-toolchain.mjs`（打包 SDK tarball）、`build-template-lockfiles.mjs`（重新生成模板 lockfile）

### 3.3 Vendor 供货（commit 6d5ff73 / 1caf6fe / 7cc6109）

- `teacher/vendor-skills/education-agent-skills/`：已剪到 7 个 Skill，保留 LICENSE，`SOURCE.json` 记录 commit。
- `teacher/vendor-skills/pptkit-presentation/`：完整保留，MIT。
- `teacher/vendor-skills/vercel-web-design/`：已下载 `command.md` 快照到 `skills/web-design-guidelines/references/`，并改 SKILL.md 不再运行时 fetch。
- `resources/teacher-seed/plugins/`：dsh-better-sidebar、dsh-cowork、pptkit-presentation 三个插件源码已 clone 并带 `SOURCE.json`。

### 3.4 脚本与 CI（commit 6d5ff73 / 1ccf493 / 0e363ff）

`scripts/teacher/`：

```text
sync-upstream.mjs             # 写 desktop-upstream.lock
vendor-skills.mjs             # 拉取 3 个 vendor skill 仓库
vendor-plugins.mjs            # 拉取 3 个核心插件
build-offline-store.mjs       # pnpm install + build-toolchain + build-template-lockfiles
bootstrap-teacher-profile.mjs # 生成 teacher-profile.lock.json
verify-distribution.mjs       # 校验 manifests + 3 个自有 Skill
package-windows.mjs           # 打包蓝图（未真正执行）
```

`.github/workflows/`：`upstream-watch.yml`、`verify.yml`、`windows-package.yml`、`release.yml`（另有上游自带 `ci.yml`）。

### 3.5 文档

- 根 `THIRD_PARTY_NOTICES.md`：列出所有组件 license，含 CC BY-SA 4.0 的 Education Agent Skills 独立说明。
- `teacher/profiles.md`：desktop / teacher 双 profile 说明。

### 3.6 已验证通过

```text
node tests/smoke/run-all.mjs
  -> three / math / physics-2d / chart / diagram 全部 init(offline) -> build -> check 通过

node scripts/teacher/verify-distribution.mjs
  -> manifests + 3 个自有 Skill 通过

yarn --version
  -> 4.18.0（通过 corepack 激活）
```

---
## 4. 进行中 / 未完成（接手重点）

### 4.1 Teacher runtime 注入（未提交，未验证编译）

新增文件：`dsh-plugin-desktop/src/teacher-bootstrap.ts`

功能：

- 解析 teacher runtime 根目录（打包模式用 `process.resourcesPath/teacher-runtime`，dev 模式用相对路径）。
- 生成 Windows shim：`teacher-artifact.cmd`、`teacher-publish.cmd`、`teacher-latex.cmd`，写入 `userData/teacher-runtime/teacher-bin`。
- 设置环境变量：`TEACHER_DSH_HOME`、`TEACHER_ARTIFACT_HOME`、`TEACHER_SKILLS_HOME`、`TEACHER_DEPLOY_HOME`、`TEACHER_TEMPLATES_HOME`。
- 把 `teacher-bin` 前插到 `process.env.PATH`。

改动文件：`dsh-plugin-desktop/src/main.ts`

- 新增 `import { installTeacherRuntime } from './teacher-bootstrap.ts'`
- 在 `installDesktopPnpmRuntime(...)` 之后、`const dshBootstrapPath = ...` 之前插入 `const teacherRuntime = installTeacherRuntime({...})` 与 `const releaseTeacherRuntime = generation.own(...)`。

**风险 / 待办**：

- `teacher-bootstrap.ts` 里有个可疑判断 `process.defaultApp ?? true ? ... : false`，逻辑不严谨，需要简化。
- shim 里的 `--import ""` 是占位写法，可能不合法，需要用 Desktop 已有的 `clearEnvironmentPath` 机制或直接 `node <cli>`。
- 必须跑 `yarn workspace dsh-plugin-desktop build`（tsdown）验证 TS 能编译，再跑测试。
- 若打包后 `teacher-runtime` 不在 `resourcesPath`，需要 `electron-builder` 的 `extraResources` 配置把 `teacher/` 拷进去（目前还没配）。

### 4.2 publish-cli 完整实现（未提交，已单测 detect/inspect）

文件：

```text
teacher/packages/publish-cli/src/common.mjs    # findStaticDir / walk / run
teacher/packages/publish-cli/src/detect.mjs    # 敏感文件扫描 + provider/token/CLI/git 探测
teacher/packages/publish-cli/src/plan.mjs      # provider 排序
teacher/packages/publish-cli/src/adapters.mjs  # netlify / cloudflare / vercel / github pages
teacher/packages/publish-cli/src/cli.mjs       # detect / inspect / deploy
```

已实现命令：

```text
teacher-publish detect           # 找 dist/build/public
teacher-publish inspect [dir]    # 列文件 + 敏感扫描
teacher-publish deploy [dir]     # 排序 provider -> 打印计划 -> 交互确认 -> 调用 CLI
```

**已验证**：`detect`、`inspect` 在临时 basic artifact 上通过。

**待办 / 风险**：

- `deploy` 依赖 `netlify` / `wrangler` / `vercel` 命令在 PATH 上；目前没有把 deploy CLI 的 node_modules 打进 resources，也没有生成对应 shim。
- 未做真实 provider 部署测试。
- `run` 用 `shell: true`，会有 DEP0190 警告；非阻塞但可优化。

### 4.3 ppt-kit 回迁（未提交，有 bug）

- 已从 `teacher/legacy/packages/ppt-kit` 完整拷贝到 `teacher/packages/ppt-kit`。
- 已 `pnpm install`（teacher workspace 现在 160 packages）。
- **PPT smoke 失败**，报错：

```text
Error: [object Object]
```

- 位置：调用 `createTeachingDeck(...).save(...)` 时抛出。
- 最可能原因：`pptxgenjs@4.0.1` 的 `writeFile` 在 Node 下抛出了非 Error 对象，或 `deck.save()` 的参数格式有问题。
- **接手后必须**：先看 `teacher/packages/ppt-kit/src/index.js` 的 `save()`，改为 `await pptx.writeFile({ fileName: out })`；如果仍失败，打印 `JSON.stringify(err)` 和 `err.stack`。然后生成 `.pptx` 并用 zip 工具确认 OOXML 结构。

---
## 5. 已知问题 / 坑（按优先级）

1. **ppt-kit 报错 `[object Object]`**（见 4.3）— 阻塞验收项 6（PPT）。
2. **teacher-runtime 未接入打包**：`teacher-bootstrap.ts` 未验证编译；`electron-builder` 未配置 `extraResources`；打包后找不到 teacher 目录。
3. **deploy CLI 未打包**：`netlify-cli` / `wrangler` / `vercel` 的 node_modules 和 bin 未进 `resources/teacher-runtime/deploy/`。
4. **artifact node_modules 未预置**：模板 lockfile 有了，但 `resources/teacher-runtime/artifact/node_modules/` 还没有真正离线 seed 到安装包。
5. **profile 集成未完成**：`teacher-profile.lock.json` 只是 bootstrap 清单，Desktop 的 `ensureDesktopProfile()` / `desktopBundleList()` 还没有真正把 `@teacher-dsh/teacher-bundle` 和 3 个插件 bundle 加进去。
6. **`teacher/pnpm-workspace.yaml` 被 pnpm 自动加了 `minimumReleaseAgeExclude`**（mermaid / @mermaid-js/parser）。可以保留，但注意别让它在干净机器上触发 policy 报错。
7. **GitHub 直连问题**：本机 `~/.gitconfig` 配了 `http.proxy=http://127.0.0.1:10808`，该代理经常不可用。clone GitHub 时要加：
   ```powershell
   git -c http.proxy= -c https.proxy= clone ...
   ```
   `scripts/teacher/vendor-*.mjs` 已经内置了这个 override。
8. **corepack 首次下载 yarn 会交互**：要设置 `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`。
9. **pnpm 会拦截 build scripts**：本仓库 `pnpm-workspace.yaml` 里 `allowBuilds: esbuild: true`；deploy 相关（netlify-cli/sharp/workerd）在旧仓库里设为 true，新仓库 teacher 层目前只有 esbuild。
10. **DEP0190 警告**：所有 `spawnSync(..., { shell: true })` 都会刷；不影响功能。
11. **`teacher/legacy/` 里也有完整的旧 artifact-cli**：注意别把两套 CLI 搞混。新代码一律用 `teacher/packages/artifact-cli`。
12. **旧仓库工作区垃圾**：`C:\Users\inkot\Desktop\kc\teacher-dsh\git-commit.log`、`legacy.tar` 可删。
13. **`dsh-plugin-desktop/package.json` 的 `files` 数组没有包含 teacher 资源**：打包时需要补 `extraResources`，否则 teacher/ 不会进安装包。
14. **npm registry 可访问，GitHub 时好时坏**：npm 包基本都能装；GitHub clone 用 curl 测试过 `github.com` 200，但 git 走代理会挂，用 `-c http.proxy=` override 即可。

---
## 6. 关键文件地图

### 6.1 Desktop 侧改动

| 文件 | 作用 |
|---|---|
| `dsh-plugin-desktop/package.json` | 品牌、appId、artifactName、shortcutName |
| `dsh-plugin-desktop/src/updates.ts` | 关闭自动 OTA（enabled 默认 false） |
| `dsh-plugin-desktop/src/main.ts` | 注入 `installTeacherRuntime`（未提交） |
| `dsh-plugin-desktop/src/teacher-bootstrap.ts` | 新增 Teacher runtime 注入（未提交） |
| `dsh-plugin-desktop/src/desktop-runtime-environment.ts` | 上游 pnpm/DSH shim 参考（未改） |
| `dsh-plugin-desktop/src/profile.ts` | `ensureDesktopProfile` / `desktopBundleList`，profile 集成入口 |
| `dsh-plugin-desktop/tsdown.config.ts` | 新增 TS 入口要在这里注册（teacher-bootstrap 若要独立输出需加） |

### 6.2 Teacher manifests

| 文件 | 内容 |
|---|---|
| `teacher/manifests/desktop-upstream.lock.json` | desktop v2.0.5 commit + harness 0.1.2-rc.1 |
| `teacher/manifests/toolchain.lock.json` | vite/three/katex/jsxgraph/echarts/mermaid/matter-js 版本 |
| `teacher/manifests/plugins.lock.json` | 3 个 core 插件 + optional + excluded |
| `teacher/manifests/skills.lock.json` | 3 个自有 + 7 个 education + pptkit + vercel |
| `teacher/manifests/providers.lock.json` | 静态托管 provider 候选池 + 优先级 |
| `teacher/manifests/licenses.lock.json` | 许可证清单 |
| `teacher/manifests/teacher-profile.lock.json` | teacher profile bootstrap 清单 |

### 6.3 Teacher packages

| 包 | 状态 |
|---|---|
| `@teacher-dsh/artifact-sdk` | 完成，含 createStage/UI/公式，已验证 |
| `@teacher-dsh/artifact-cli` | 完成，init/build/check/preview/pack + teacher-latex，已验证 |
| `@teacher-dsh/ppt-kit` | 回迁完成，**save() 有 bug** |
| `@teacher-dsh/publish-cli` | detect/inspect 完成，deploy 未联调 |
| `@teacher-dsh/teacher-bundle` | glue + bundled skills，未真正接入 Desktop profile |

### 6.4 测试

| 文件 | 作用 |
|---|---|
| `tests/smoke/run-all.mjs` | 5 个模板 init->build->check，已通过 |
| `tests/ppt/` | 目录已建，ppt smoke 待修 |
| `teacher/legacy/tests/` | 旧层测试（参考） |

---
## 7. 常用命令

### 7.1 Teacher 层

```powershell
# 安装 teacher workspace 依赖
cd C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher
pnpm install

# 打包 artifact SDK tarball（init 需要的 vendor/artifact-sdk.tgz）
node scripts\build-toolchain.mjs

# 重新生成 7 个模板的 lockfile
node scripts\build-template-lockfiles.mjs

# 生成 teacher profile bootstrap
node ..\scripts\teacher\bootstrap-teacher-profile.mjs

# 校验 manifests + 自有 skill
node ..\scripts\teacher\verify-distribution.mjs

# 最终层 artifact smoke（5 个模板）
node ..\tests\smoke\run-all.mjs
```

### 7.2 单次 artifact 验证

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

### 7.3 publish-cli 验证

```powershell
cd <一个已 build 的 artifact 目录>
node C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher\packages\publish-cli\bin\teacher-publish.mjs detect
node C:\Users\inkot\Desktop\kc\teacher-dsh-desktop\teacher\packages\publish-cli\bin\teacher-publish.mjs inspect
# deploy 会要求交互确认
```

### 7.4 Desktop 侧（尚未完整跑通）

```powershell
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT='0'
cd C:\Users\inkot\Desktop\kc\teacher-dsh-desktop
corepack prepare yarn@4.18.0 --activate
yarn install --immutable
yarn check
# 打包（在 runtime 注入完成后）
yarn workspace dsh-plugin-desktop package:win
```

### 7.5 Git（GitHub 访问 override）

```powershell
git -c http.proxy= -c https.proxy= clone https://github.com/...
git -c http.proxy= -c https.proxy= fetch --tags
```

---
## 8. 距离「完整 0.1」还差什么

按主线（一次把完整包做完），剩余工作：

1. **收尾未提交改动**（第 4 节）。
2. **修好 ppt-kit `save()`**，让 `xxx.pptx` 真正可生成、可编辑。
3. **把 deploy CLI 打包**：`netlify-cli` / `wrangler` / `vercel` 的 node_modules + bin 放进 `resources/teacher-runtime/deploy/`，并给 `teacher-publish` 提供这些命令的 PATH。
4. **把 artifact node_modules 预置**：`resources/teacher-runtime/artifact/node_modules/` 用模板 lockfile 离线 seed（可参考 `teacher/scripts/build-template-lockfiles.mjs`，目标是把 node_modules 拷进 resources）。
5. **完成 profile 集成**：改 `dsh-plugin-desktop/src/profile.ts`，让 `ensureDesktopProfile()` / `desktopBundleList()` 把 `@teacher-dsh/teacher-bundle` 和 3 个插件 bundle 写进 desktop profile；或在打包时把预置 profile 直接 seed 进 resources。
6. **配置 electron-builder `extraResources`**：把 `teacher/`、`resources/teacher-seed/`、`teacher/vendor-skills/` 拷进安装包。
7. **验证打包后的 Teacher runtime**：`teacher-bootstrap.ts` 编译通过、打包后 PATH/env 正确、能跑 `teacher-artifact init/build/check`。
8. **完成 8 个真实验收任务**：
   - 1 干净 Windows（无 Node/pnpm/Git）能打开
   - 2 三维太阳系教具
   - 3 二次函数（JSXGraph + KaTeX）
   - 4 二维碰撞（Matter.js）
   - 5 成绩分布图（ECharts）
   - 6 教学 PPT（可编辑 .pptx）
   - 7 教育 Skill 设计一节课
   - 8 静态发布返回 URL
9. **生成 Setup + Portable**（NSIS + Portable ZIP）。
10. **更新 THIRD_PARTY_NOTICES**（加入 deploy CLI、ppt-kit 等）。

---

## 9. 版本锁定参考（来自 toolchain.lock.json）

```text
vite        8.2.2
three       0.186.0
katex       0.18.7
jsxgraph    1.13.3
echarts     6.1.0
mermaid     12.0.0
matter-js   0.20.0
pptxgenjs   4.0.1
netlify-cli 27.5.2   （旧仓库锁的版本，deploy 打包时参考）
wrangler    4.130.0
vercel      59.15.1
```

Desktop 侧：`anywhere-labs/dsh-desktop v2.0.5` -> Harness `0.1.2-rc.1`（由 Desktop 自己 pin，不要覆盖）。

---

## 10. 交接检查清单（接手人按顺序做）

- [ ] `cd C:\Users\inkot\Desktop\kc\teacher-dsh-desktop; git status` 看未提交改动。
- [ ] 读本文件第 4 节，先修 ppt-kit `save()`。
- [ ] 验证 `dsh-plugin-desktop/src/teacher-bootstrap.ts` 能编译（`yarn workspace dsh-plugin-desktop build`）。
- [ ] 补 `electron-builder extraResources`。
- [ ] 把 deploy CLI + artifact node_modules seed 进 `resources/teacher-runtime/`。
- [ ] 完成 profile 集成。
- [ ] 跑 `node tests/smoke/run-all.mjs` + `node scripts/teacher/verify-distribution.mjs`。
- [ ] 跑 PPT smoke。
- [ ] 打包 Setup + Portable。
- [ ] 在干净 Windows VM 上跑 8 个验收任务。
- [ ] 推送到自己的 GitHub fork，开 PR。