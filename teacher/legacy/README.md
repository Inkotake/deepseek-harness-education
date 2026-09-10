# Teacher DSH 0.1

Teacher DSH = DeepSeek Harness Desktop + 完整离线 Node/Vite 教具开发环境 + Three.js 教学 SDK + PPT 工具 + 教师 Skills + 一键静态网页分享。

用户只看到 DSH。打开即可让 Agent 生成交互教具、教学 PPT、数据图表，并可发布为网页。

## 目录结构

```
teacher-dsh/
├── upstream/                  # 官方 deepseek-harness 镜像（sync-upstream 拉取）
├── packages/
│   ├── teacher-bundle/        # DSH profile bundle（很薄）
│   ├── artifact-cli/          # teacher-artifact CLI
│   ├── artifact-sdk/          # @teacher-dsh/artifact-sdk
│   ├── ppt-kit/               # @teacher-dsh/ppt-kit
│   └── deploy-toolchain/      # Netlify CLI + Wrangler + Vercel CLI
├── skills/                    # 7 个 Bundled Teacher Skills
├── templates/                 # 教具模板
├── config/versions.lock.json  # 全量版本锁定
├── scripts/                   # 同步、构建、验证、打包脚本
└── tests/                     # 冒烟测试
```

## 快速开始（开发环境）

```bash
pnpm install:toolchain
pnpm pack:sdk
node packages/artifact-cli/bin/teacher-artifact.mjs init demo --template three
cd demo
node ../packages/artifact-cli/bin/teacher-artifact.mjs build
node ../packages/artifact-cli/bin/teacher-artifact.mjs check
node ../packages/artifact-cli/bin/teacher-artifact.mjs preview
```

## MVP 验收任务

1. Three.js 太阳系教具
2. JSXGraph + KaTeX 二次函数
3. Matter.js 自由落体/反弹
4. PptxGenJS 生成 .pptx
5. publish-static 一键网页分享

## 版本锁定

见 `config/versions.lock.json`。