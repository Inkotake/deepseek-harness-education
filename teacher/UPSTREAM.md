# 同步上游 DeepSeek Harness

本文说明 Teacher DSH 如何跟随上游发版。目标是：**上游发版后，同步是一条命令**，而不是在本地东改西改。

---

## 一、原则：不自己造 runtime

本发行包内置的 Harness **不是**从 npm 上抓 tarball 拼出来的，而是用上游自己的工具链构建的：

```
yarn upstream:prepare-runtime
  = upstream:install        在 deepseek-harness 子模块里 pnpm install --frozen-lockfile
  + upstream:build:official 以 DSH_BUILD_CLIENT_PROFILE=official 构建
  + upstream:pack:dsh       pnpm run release:pack --family dsh
```

产出 `vendor/dsh-runtime/<version>/` 与其 `manifest.json`。**`buildProfile` 必须是 `official`** —— 这正是不能自己拼包的原因：npm 上的包不等于 official profile 构建。

`manifest.json` 是 tarball 清单（`name` / `version` / `filename` / `size` / `sha256`），而 `scripts/sync-vendored-runtime.mjs` 以它为唯一真源，重写 `package.json` 里那 **484 条** `@deepseek-ai/dsh*` resolutions。

---

## 二、上游发版后的同步流程

### 第 0 步：看现在落后多少（只读，随时可跑）

```powershell
node scripts/teacher/upstream-status.mjs
```

输出会告诉你：当前 pin 的版本与 commit、vendor 目录的 tarball 数与 buildProfile、上游更新的版本列表、以及**一次 bump 会牵动什么**（484 条 resolutions + 哪些 patch 会失效）。

### 第 1 步：先干跑，确认范围

```powershell
node scripts/teacher/upstream-bump.mjs --version 0.1.5-rc.2 --dry-run
```

干跑**不改任何文件**（已验证）。它解析上游 tag、打印完整步骤序列，并列出结束后仍需人工处理的事项。

### 第 2 步：真正执行

```powershell
node scripts/teacher/upstream-bump.mjs --version 0.1.5-rc.2
```

脚本会依次完成：

| 步骤 | 做什么 |
|---|---|
| 1 | 解析上游 tag `dsh-v<version>` 到具体 commit（**不能用浮动分支**） |
| 2 | 在子模块里 `checkout --detach <commit>` |
| 3 | `yarn upstream:prepare-runtime` 构建 official profile 的 runtime |
| 4 | 校验 pack 产物：`deepseek-harness/dist/npm/` 下的 tarball 清单 |
| 5 | 改写 `upstream.json` 里**每个**频道的 commit / sourceVersion |
| 6 | 按频道逐个 `sync-vendored-runtime --write`：搬运 tarball、生成带 sha256 的 manifest、重写 resolutions、钉各频道产物依赖 |
| 7 | 校验生成的 manifest（version / buildProfile / commit / 包数） |
| 8 | `yarn install` |
| 9 | 列出仍需人工处理的事项（失效的 patch、内置插件复核等） |

**默认升级所有频道，而不只是 `activeChannel`。** 本发行包打的是 `dsh-plugin-desktop`
workspace，它属于 `stable` 频道；而 `activeChannel` 是 `beta`。只升 active 频道会**升级了却
没升到**：130 个依赖留在旧版本，同时树里出现两套 `@deepseek-ai/dsh*` resolutions。
需要只升一个频道时用 `--channel`。

**失败即停**：任何一步失败，脚本立即停下并说明原因，**不会留下半迁移的树**。
`--skip-install` 跳过第 8 步；`--skip-prepare` 复用已构建的 `dist/npm`（第 3 步是唯一慢步骤，
后续任何一步失败都不该让你再等一次完整上游构建）。

### 第 3 步：处理脚本明确留下的 TODO

第 1、2 步是机械的；下面这些**必须人工**，脚本会逐条列出来而不是假装完成：

1. **重新生成 patch** —— 用 `node scripts/teacher/port-patches.mjs`。
   见下节。

### patch 由脚本派生，不手写

`patches/` 里的 `dsh-*` patch 改的是**上游构建产物里的确切文本**，所以每次升级都会失效。
手写重做是升级最耗时的一环，因此每个 patch 在 `scripts/teacher/port-patches.mjs` 里声明为
「文件模式 + 有序 find/replace」，脚本从钉住的 vendor tarball 派生 patch 文件：

```
node scripts/teacher/port-patches.mjs          # 重新生成
node scripts/teacher/port-patches.mjs --check  # 只校验声明与文件是否一致（可进 CI）
```

上游改写了某个 patch 所针对的代码时，脚本会**直接失败并指出是哪个模式**，而不是留下一个
悄悄不再生效的 patch。Yarn 在 install 时应用 `patch:` resolutions，所以错的 patch 在那里
也会失败——两道独立检查。

当前保留 4 个 patch，以及它们各自为什么必须存在：

| patch | 为什么必须 |
|---|---|
| `dsh@` | profile 插件运行器用 shell 调 pnpm，Windows 下不加 `windowsHide` 每次都会弹出控制台窗口 |
| `dsh-web-app@` | 浏览器打开器 spawn 的是 `process.execPath`（即 Electron）。不给子进程 `ELECTRON_RUN_AS_NODE` 会**再启动一个 app 实例**而不是当 Node 跑；同时隐藏其控制台窗口 |
| `dsh-win32-process@` | 两处 CreateProcess 只传了 `STARTF_USESTDHANDLES`，缺 `STARTF_USESHOWWINDOW` + `SW_HIDE`，控制台子进程会显示窗口 |
| `dsh-host-directory-picker-browse@` | Windows reparse/system 目录会被 dirent 报成目录但 `stat` 失败，原逻辑只探测符号链接，于是列出了进不去的路径 |

`app-builder-lib@` 与 `open@` 是第三方 patch，按我们自己选的版本钉住，不随上游漂移。

**升到 0.1.5-rc.2 时删掉的 4 个 patch，以及为什么能删：**

| 删掉的 patch | 为什么不再需要 |
|---|---|
| `dsh-subprocess-local@` | 上游自己现在在 `spawn.ts` / `windows-inspector.ts` 里设了 `windowsHide`，README 也已写明 |
| `dsh-settings@` | 那个 patch 是给 alpha.2 之前插件用的兼容 shim，**唯一的真实消费者是我们自己的代码**；已改为直接传字面量命名空间 |
| `dsh-client-ui-directory-picker-browse@` | 上游把「原生文件夹选择器」做成了一等插件（`ui-directory-picker-native` + `host-directory-picker-native` + `directory-picker-auto`），注册进**完全相同的两个 slot 洞**。我们那 182 行 patch 已过时 |
| `dsh-client-ui-settings-general@` | 只是给自建的 desktop 设置分区画了个图标，属装饰，随该分区一并去掉 |
2. **修桌面源码的 API 漂移** —— `yarn workspace dsh-plugin-desktop build`，按报错改。
3. **重建 teacher runtime** —— `build-teacher-runtime.mjs` + `build-profile-seed.mjs`（manifests 与 seed 都引用版本号）。
4. **考虑同步升级 vendor plugin** —— 例如 `dsh-better-sidebar`：我们之所以钉在 0.18.1，是因为 **0.1.2-rc.1 没有 `dsh-client-ui-sidebar-right`**；该包在 **0.1.5 起存在**，所以 bump 之后即可升回 0.19.0。
5. **全量验证** —— `verify-desktop-variants` / `verify-*` / `smoke-package` / `smoke-portable`。

---

## 三、为什么不能"顺手改改"

本仓库有三类东西**按版本硬绑定**，这是有意的，不是缺陷：

| 类别 | 为什么硬绑定 | 升级时怎么办 |
|---|---|---|
| `patches/*.patch` | patch 的是上游打包产物里的确切文本 | 重新生成（见上） |
| `resolutions` 484 条 | 全部指向 `vendor/` 里带 sha256 的本地 tarball，保证**离线可复现** | 由 `sync-vendored-runtime --write` 自动重写 |
| `@teacher-dsh/*` 对 Harness 的 peer 范围 | 记录**实际验证过**的兼容区间 | 升级后重跑 `verify-profile-seed`（会实际 mount 三个 plugin 并断言效果） |

所以正确的升级姿势是**跑流程**，不是手工改某个版本号 —— 手工改会让 resolutions 与 vendor 目录对不上，`yarn install` 直接失败，或者更糟：装上一个 manifest 里没有 sha256 记录的包。

---

## 四、自动化

`.github/workflows/upstream-watch.yml` 定时（cron `17 0 * * *`）+ 手动检查上游 pin 变动，**只开 PR，不推默认分支**。

注意它当前只比对**已声明的 pin**，不会主动去查上游有没有新 release —— 那需要 CI 里跑 `git ls-remote`。要做到"上游一发版就自动开 PR"，把 `upstream-status.mjs` 的输出接进这个 workflow 即可（脚本已支持 `--json`，便于机器消费）。

---

## 五、当前状态

```
channel            : beta（active）
pinned Harness     : 0.1.5-rc.2 (fb2c4b9e698e)   stable 与 beta 同版本
vendor tarballs    : 265 (build profile official)
保留的 dsh patch   : 4
```

从 `0.1.2-rc.1` 升到 `0.1.5-rc.2` 的机械步骤已经验证可跑，patch 也已用
`port-patches.mjs` 重新派生并在 `yarn install` 中验证应用成功。
