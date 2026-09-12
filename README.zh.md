# Teacher DSH 0.1

[English](README.md) | 中文

Teacher DSH 0.1 是一个完整、离线的教师工具链，以 Windows 应用的形式分发。老师只要装一个安装包，或者解压一个便携版压缩包，就能生成教学资源、生成可交互的 HTML 教具、并把页面发布到网上。机器上不需要装 Node.js、不需要装 pnpm、也不需要 Git，首次运行不下载任何东西。

这个发行版建立在两个上游项目之上：来自 `anywhere-labs/dsh-desktop` 的 Electron 桌面外壳，以及一个固定版本的 DeepSeek Harness 运行时。Harness 本身不做任何修改；本仓库在它之上补齐所需的运行时、教学技能、教具模板、演示文稿与发布工具链，以及 Windows 打包。

| | |
|---|---|
| 版本 | `0.1.0` |
| 平台 | Windows x64 |
| 发行产物 | `Teacher-DSH-0.1.0-x64-Setup.exe`（NSIS 安装包）、`Teacher-DSH-0.1.0-x64-Portable.zip`（便携版） |
| Teacher 层许可证 | MIT |
| 随包第三方组件 | 各自保留自己的许可证 —— 见[许可证与署名](#许可证与署名) |

这是一个社区发行版，与深度求索、Anywhere Labs 都不存在隶属、授权或背书关系。

## 0.1 包含什么

下面列出的东西全部在安装包或便携版压缩包里面。版本号记录在
[`teacher/manifests/`](teacher/manifests) 以及构建时生成的
`resources/teacher-runtime/manifests/runtime.build.json` 中。

| 组件 | 版本 | 作用 |
|---|---|---|
| 桌面外壳（上游基线） | v2.0.5 | Electron 外壳、profile 管理、打包流水线 |
| DeepSeek Harness | 0.1.2-rc.1 | 固定版本的智能体运行时、插件加载器、客户端界面、工具协议 |
| Node.js | 22.23.2 | 便携运行时，所有 Teacher 命令都靠它运行 |
| pnpm | 11.8.0 | 教具项目的包管理器 |
| Vite | 8.2.2 | 教具构建 |
| Three.js | 0.186.0 | 三维教具 |
| JSXGraph | 1.13.3 | 交互几何与函数图像 |
| KaTeX | 0.18.7 | 公式渲染 |
| ECharts | 6.1.0 | 图表 |
| Mermaid | 12.0.0 | 示意图 |
| Matter.js | 0.20.0 | 二维物理 |
| PptxGenJS | 4.0.1 | 输出可编辑的 `.pptx`，由 `@teacher-dsh/ppt-kit` 0.1.0 封装 |
| `@teacher-dsh/artifact-sdk` | 0.1.0 | 教具的舞台、UI 与公式 API |
| netlify-cli / wrangler / vercel | 27.5.2 / 4.130.0 / 59.15.1 | 账号制发布 |

随包提供的命令行工具：

| 命令 | 作用 |
|---|---|
| `teacher-artifact` | 基于内置依赖树对教具执行 `init` / `build` / `check` / `preview` / `pack` |
| `teacher-latex` | 撰写 `.tex` 源文件并做结构校验；用 KaTeX 渲染公式 |
| `teacher-ppt` | 对教学 PPT 执行 `init` / `build` / `check`，产出可编辑的 OOXML |
| `teacher-publish` | 静态发布的探测、检查、规划、部署与校验 |

内置 7 个教具模板：`basic`、`three`、`math`、`physics-2d`、`chart`、`diagram`、`classroom-game`。

包里带 12 个技能，通过 `DSH_BUNDLED_SKILL_DIR` 被发现，因此零配置即可使用。其中 3 个由本仓库维护：`teaching-aid`、`publish-static`、`latex-authoring`。其余为第三方引入：Gareth Manning 的 7 个教育技能、`pptkit-presentation`，以及 `web-design-guidelines`。

内置 Harness home 的 desktop profile 里预装了 3 个插件：

| 插件 | 版本 |
|---|---|
| `dsh-better-sidebar` | 0.18.1 |
| `@dsh-cowork/plugin` | 0.1.0 |
| `dsh-plugin-pptkit-presentation` | 0.1.0 |

## 0.1 不包含什么

这些边界是产品约定的一部分，所以直说：

- **没有 OCR。** 不包含图片或扫描件的文字识别。
- **没有 Python。** 不带 Python 解释器，也不带科学计算栈。
- **没有 TeX 发行版。** KaTeX 0.18.7 负责渲染公式，`teacher-latex` 可以撰写并结构校验 `.tex` 源文件，但包里没有 `pdflatex`、`xelatex`、`tectonic` 或 TeX Live，也就没有 TeX 转 PDF 的引擎。0.1 产出 HTML 和 PPTX，不产出编译好的 PDF。
- **没有 LMS 对接。** 不连接学校的教学管理系统。
- **不做专业试卷排版。** 这里的 LaTeX 能力面向教学材料的公式撰写，不面向试卷生产。

## 老师怎么用

1. 运行 `Teacher-DSH-0.1.0-x64-Setup.exe`；或者解压 `Teacher-DSH-0.1.0-x64-Portable.zip`，在解压出来的目录里直接启动应用。
2. 双击打开，DeepSeek Harness 就出现在眼前。首次运行时，内置的 Harness home 会被复制进用户的 Harness 目录，而且只在 `desktop` profile 尚不存在时才复制，不会覆盖已有的用户数据。
3. 在 Harness 自己的设置界面里配置模型。
4. 在对话框里描述你想要的教学材料。

机器的 `PATH`、`NODE_HOME` 和 npm 全局 prefix 都不会被改动：命令 shim 生成在按用户隔离的状态目录里，只注入到 Harness 进程。教具工具链通过 Windows junction 链接进工作目录，所以 `init`、`build`、`check` 都是离线且秒级的。

### 八个示例任务

| # | 提示词 | 预期结果 |
|---|---|---|
| 1 | 做一个三维太阳系教学教具 | 用 `three` 模板生成一个可运行的三维页面，可以互动观察轨道与视角 |
| 2 | 做一个可调整 a、b、c 的二次函数演示 | 用 `math` 模板做一个教具，拖动 a、b、c 滑块时 JSXGraph 抛物线实时重绘，公式由 KaTeX 排版 |
| 3 | 做一个二维碰撞实验 | 用 `physics-2d` 模板做一个在浏览器里运行、基于 Matter.js 的碰撞仿真 |
| 4 | 做一个班级成绩分布交互图 | 用 `chart` 模板做一个离线可交互的 ECharts 分布图 |
| 5 | 根据这份材料生成教学 PPT | `teacher-ppt` 依据给定材料生成可编辑的 `.pptx` 演示文稿 |
| 6 | 帮我设计一节课 | 教育技能产出一份结构完整的一节课方案 |
| 7 | 把这个教具发到网上 | `teacher-publish` 上传构建好的教具、在远端校验，并返回一个可用的 URL |
| 8 | 讲一下这个公式 | 用 KaTeX 讲解并渲染公式，可以嵌进教具或幻灯片 |

## 发布教具

`teacher-publish` 是唯一允许和托管服务通信的组件，所有 provider 协议要么在进程内实现，要么通过随包提供的 CLI 驱动。流程是：

1. **探测**构建好的静态产物（`dist`、`build`、`public`、`out`，或者任何包含 `index.html` 的目录）。
2. **检查**：生成字节级清单，并做一次安全扫描，命中凭证、密钥、班级数据就硬性拦截。只要有硬性拦截，就不会上传任何文件。
3. **规划**：按请求的模式，从
   [`teacher/packages/publish-cli/config/providers.json`](teacher/packages/publish-cli/config/providers.json)
   这份经过审阅的注册表中给候选 provider 排序，并在上传前先按能力过滤。规划阶段不接触任何 provider。
4. **部署**：走排序最靠前的可用 provider。
5. **校验** —— 这是最关键的约定。上传返回 HTTP 2xx 只是**候选成功**；只有在部署上去的每个资源都被重新用 HTTPS 取回、并且其 SHA-256 与本地清单逐一比对通过之后，`deploy` 才会报告 `success: true`。校验没能跑完的部署一律算失败，绝不算成功。

一共有三种模式：`quick-share`（匿名临时托管）、`persistent`（账号制持久托管，失败时绝不静默降级到临时主机）、`tunnel`（只有在机器上已经装了 tunnel CLI 的前提下，把本机端口临时暴露出去）。

注册表里现在有 11 个 provider：6 个匿名、4 个账号制，另有 1 个 `wh-drop` 因为找不到公开服务而被禁用。

- CLI 参考：[`teacher/packages/publish-cli/README.md`](teacher/packages/publish-cli/README.md)
- 协议参考：[`teacher/packages/publish-cli/docs/provider-protocols.md`](teacher/packages/publish-cli/docs/provider-protocols.md)

## 仓库结构

```
dsh-plugin-desktop/       Electron 外壳、Teacher 运行时注入、electron-builder 打包
deepseek-harness/         固定版本的上游 DeepSeek Harness 子模块（只读）
teacher/                  Teacher 层：packages、skills、templates、vendor-skills、manifests、BUILD.md
resources/teacher-seed/   第三方插件源码，以及预构建好的可安装产物
scripts/teacher/          构建、seed、裁剪、许可证清单、引入第三方与各类校验脚本
licenses/                 随包发放内容的许可证原文
THIRD_PARTY_NOTICES.md    自动生成的组件与 npm 依赖清单
```

其余顶层目录：`dsh-community-market/` 和 `dsh-community-fabric/` 分别是桌面的插件市场与社区互操作文档骨架；`docs/` 是桌面文档索引；`tests/` 放教具与 PPT 的 smoke 套件；`.github/workflows/` 是发布流水线。

`resources/dsh-runtime/` 和 `resources/teacher-runtime/` 是**构建产物，不入库**。它们由下面的脚本生成，再通过 electron-builder 的 `extraResources` 进入安装包。`dsh-plugin-desktop/dist/` 同样是构建产物。

构建流水线的权威说明是 [`teacher/BUILD.md`](teacher/BUILD.md)。

## 从源码构建

需要 Node.js `^22.19.0` 或 `>=24.0.0`、经 Corepack 启用的 Yarn 4.18.0，以及 Windows x64。先用
`yarn fetch:upstream` 拉取固定的上游检出（它是被忽略的目录，不是 Git submodule），然后：

```powershell
corepack enable
corepack yarn install --immutable

# 1. 内置运行时：Node、pnpm、dsh shim、Teacher 各 CLI、教具/PPT/发布三棵依赖树、内置技能、清单
node scripts/teacher/build-teacher-runtime.mjs

# 2. 预构建三个第三方插件
node scripts/teacher/build-vendor-plugins.mjs

# 3. 必须先构建桌面包，profile seed 才有东西可组合
corepack yarn workspace dsh-plugin-desktop build

# 4. 内置 Harness profile seed：一个已经装好全部插件的 desktop profile
node scripts/teacher/build-profile-seed.mjs

# 5. 随包发放内容的许可证清单与 notices
node scripts/teacher/build-notices.mjs

# 6. Windows Setup（NSIS）与便携版（ZIP）
$env:DSH_PACKAGE_CHECK_ALREADY_RAN = '1'
corepack yarn workspace dsh-plugin-desktop dist:win
corepack yarn workspace dsh-plugin-desktop dist:win-portable

# 7. 先验证打包后的载荷，再验证便携版归档
node scripts/teacher/smoke-package.mjs
node scripts/teacher/smoke-portable.mjs --archive dsh-plugin-desktop/dist/*Portable*.zip
```

只有在同一 workspace 状态下已经跑过 `corepack yarn check` 时，才可以设 `DSH_PACKAGE_CHECK_ALREADY_RAN=1`：它会跳过上游的 preflight 测试套件。

### 不重新打包的快速迭代

[`scripts/teacher/stage-dev.mjs`](scripts/teacher/stage-dev.mjs) 会把已打包应用目录里的两棵运行时树换成指回 `resources/` 的 Windows 目录 junction。这样重建过的 CLI 或技能立刻就能被打包后的应用看到，`smoke-package.mjs` 直接验证活的运行时树，不必每次复制上 GB 的文件。

这只适合本机迭代。**再次运行 electron-builder 之前必须把这些 junction 去掉**，否则打包会顺着链接把仓库里的文件复制进去；用这种方式 staging 出来的应用目录也绝不能对外发放。脚本支持 `--app`、`--force`、`--json`。

## 验证

每个门禁回答的问题都不一样，它们全部在 CI 里运行。

| 命令 | 证明了什么 |
|---|---|
| `node scripts/teacher/verify-distribution.mjs` | 清单与本仓库维护的 3 个技能齐备且自洽，随后跑教具 smoke |
| `node scripts/teacher/verify-skills.mjs` | 每个内置技能都是扁平目录，含 `SKILL.md`，frontmatter 合法、`name` 与目录同名、有 description，且名称不重复 |
| `node scripts/teacher/verify-plugins.mjs` | 3 个固定版本第三方插件在清单、源码 checkout 的 `SOURCE.json`、预构建产物三处保持一致；缺预构建目录只报警告，不算失败 |
| `node scripts/teacher/verify-licenses.mjs` | 许可证清单可解析，每个 curated 组件都有对应的 `licenses/<slug>/` 目录，且 `THIRD_PARTY_NOTICES.md` 逐个列出并写明 CC BY-SA 的相同方式共享条款 |
| `node scripts/teacher/verify-no-secrets.mjs` | 入库文件（`git ls-files`）里没有高置信度的凭证特征 |
| `node scripts/teacher/verify-profile-seed.mjs` | 把 seed 复制进一个全新的临时 Harness home，无头启动 `desktop` profile，逐项断言 3 个第三方插件真的挂载并注册了各自的工具与 skill provider，全程不联网 |
| `node scripts/teacher/smoke-package.mjs` | 打包后的应用目录不依赖开发环境也能工作：用包内的 Node 与教具 CLI 现场 init/build/check 出一个真实教具，并用包内的 PPT CLI 生成真实的、可编辑的 `.pptx` |
| `node scripts/teacher/smoke-portable.mjs --archive <zip>` | 便携版压缩包解出来的载荷同样能通过打包后的 smoke |
| `node tests/ppt/run-ppt-smoke.mjs` | PPT 工具链能构建并检查一份演示文稿 |

发布流水线是
[`.github/workflows/teacher-distribution.yml`](.github/workflows/teacher-distribution.yml)，
分三个 job：`verify`（静态发行门禁）、`package-windows`（构建内置运行时，再用 electron-builder 出 Setup 与便携版）、`smoke-package`（跑打包后的载荷，真的产出一个教具和一份 `.pptx`）。它要验证的是**安装包**能不能跑，不是开发源码能不能跑。

## 许可证与署名

- **本仓库自己写的 Teacher 层是 MIT。** 范围包括 `teacher/`、`scripts/teacher/`、`dsh-plugin-desktop/` 里的 Teacher 注入与 profile seed，以及本仓库维护的 3 个技能。
- **根目录的 [`LICENSE`](LICENSE) 是上游的 MIT 许可证，原样保留。** 它属于上游桌面项目，不属于 Teacher 层。
- **7 个引入的教育技能（作者 Gareth Manning）是 CC BY-SA 4.0**，从
  [`GarethManning/education-agent-skills`](https://github.com/GarethManning/education-agent-skills)
  原样引入。相同方式共享的义务跟着这些文件走：任何包含它们的再分发，都必须对它们保留同一许可证并署名原作者。它们不是 MIT，包里其他部分是 MIT 并不会给它们重新授权。
- **其余随包组件各自保留原有许可证**，包括 DeepSeek Harness、桌面外壳、Node.js、pnpm、各棵 npm 依赖树、另外两个引入的技能，以及 3 个第三方插件。其中有 MIT，也有 Apache-2.0、BSD、ISC 等其他条款。

[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 是自动生成的清单：逐个列出随包组件的许可证与作用，单独点明那个相同方式共享的组件，并按工具链枚举打包进去的 npm 依赖。[`licenses/`](licenses) 存放许可证原文。两者都由 `scripts/teacher/build-notices.mjs` 生成，并由 `verify-licenses.mjs` 校验。

## 已知限制

这些都是已知、当前存在的事实，写出来而不是藏起来。

- **账号制发布通道尚未实测成功路径。** `netlify`、`cloudflare-pages`、`vercel`、`github-pages` 是按各自 CLI 的公开契约实现的，但开发期间没有拿到任何 provider 凭证，因此只跑过未认证的失败路径。匿名通道是在真实线上服务上验证过的，其中包括一次真实的 `ship.page` 部署，62 个文件哈希全部校验通过。在真实账号上跑通之前，不要把 `persistent` 部署当成已验证能力。
- **只支持 Windows x64。** 不产出 macOS 与 Linux 安装包（这些 electron-builder target 目前仍是 `dir`），而且包内含 Windows x64 原生二进制，在其他平台或架构上跑不起来。
- **体积。** 当前构建产出的 Setup 安装包约 285 MB，便携版压缩包约 510 MB。这是本发行版最大的工程约束：下载时长、CI 时长与磁盘占用。
- **Setup 安装包未签名**，所以首次运行会出现 Windows 的未知发布者提示。
- **八个示例任务有自动化覆盖，但还没有正式的课堂验收。** 它们背后的模板会被打包流水线构建和检查（打包后的 smoke 会用包内 CLI 构建一个 `three` 教具），但验证过程中没有在真实浏览器里打开过这些教具；生成的 `.pptx` 校验了可编辑 OOXML，但没有用 PowerPoint 或 WPS 真正打开；安装包也没有在干净的 Windows 机器或虚拟机上完整跑过一遍。

## 相关链接

- 本仓库：<https://github.com/Inkotake/deepseek-harness-education>
- 上游桌面外壳：<https://github.com/anywhere-labs/dsh-desktop>
- 上游 Harness：<https://github.com/deepseek-ai/deepseek-harness>

与深度求索、Anywhere Labs 均无隶属关系。

---

**English version: [`README.md`](README.md)** — the same document in English.
