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
| 4 | 校验产出的 `vendor/dsh-runtime/<version>/manifest.json`（版本 + buildProfile 必须匹配） |
| 5 | 改写 `upstream.json` 的 channel（commit / sourceVersion / runtimePackageVersion / runtimeSource） |
| 6 | 钉住 `dsh-plugin-desktop` 与 `dsh-community-market` 的 `@deepseek-ai/dsh` 依赖 |
| 7 | `node scripts/sync-vendored-runtime.mjs --write --channel beta` 重写 resolutions |
| 8 | `yarn install` |

**失败即停**：任何一步失败，脚本立即停下并说明原因，**不会留下半迁移的树**。`--skip-install` 可跳过第 8 步。

### 第 3 步：处理脚本明确留下的 TODO

第 1、2 步是机械的；下面这些**必须人工**，脚本会逐条列出来而不是假装完成：

1. **重新生成 patch** —— `patches/` 里 7 个 patch 都按**精确版本**命名（如 `dsh-settings@0.1.2-rc.1.patch`）。版本一变就 patch 不上，必须对新 tarball 重新生成。
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
channel            : beta
pinned Harness     : 0.1.2-rc.1 (a66e47020478)
vendor tarballs    : 242 (build profile official)
upstream           : 2 个更新版本 —— 0.1.5-rc.1, 0.1.5-rc.2
```

升级到 `0.1.5-rc.2` 的机械步骤已经验证可跑（干跑解析到 tag `dsh-v0.1.5-rc.2` → commit `fb2c4b9e698e`），剩余的是第三节列出的 5 项人工事项。
