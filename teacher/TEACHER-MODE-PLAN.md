# Teacher DSH 教师模式：第一阶段开发计划

本文把"教师模式"从产品理念落到本仓库的可执行任务。它不是概念方案，是开工单。

---

## 一、产品原则（写进代码注释与 README）

> 不要教老师写提示词，帮老师把需求想清楚。
> 能推断的不要问，已经知道的不要再问。
> 让用户选，而不是让用户凭空描述。
> 能提供合理默认值，就不要让用户配置。
> 只有答案真正会改变结果时才追问。
> 用户纠正过一次的问题，不应再发生第二次。

**核心用户是普通教师，不是 AI 产品经理。** 最大的问题不是"AI 不会生成"，而是
**老师自己也不知道该告诉 AI 什么**。所以本阶段的产品重心是**需求发现**，不是生成能力。

第一条功能规范：**AI 先理解 → 查记忆 → 自动补默认值 → 给可识别的方向 → 只追问真正会
改变结果的问题。** 绝不做成"信息不足，请回答以下 8 个问题"。

---

## 二、分层与职责（不许混）

| 层 | 负责 | 不负责 | 落点 |
|---|---|---|---|
| Teacher Preset | 教师模式总原则、交互策略、调用策略 | 不写具体教案方法 | `dsh-plugin-desktop/presets/education/` |
| GrabMe | 帮用户**发现**需求 | 不生成最终教学内容 | `teacher/skills/teacher-grabme/` |
| Global Memory | 已知信息、偏好、历史纠正、问题台账 | 不决定教学方法 | `teacher/packages/global-memory/` |
| Skill | 某类任务**专业地怎么做** | 不管理用户长期画像 | `teacher/skills/<skill>/SKILL.md` |
| Session State | 当前任务参数 | 不进入永久记忆 | 由 DSH session 承担，不新造 |

判定规则：**"怎么想"属于 Skill；"记什么/取什么"属于 Memory。** 两者不合并。

---

## 三、四条工程规范（违反即返工）

1. **Preset 必须薄。** 只含 identity / audience_assumption / interaction_policy /
   memory_policy / skill_policy / execution_policy 六类规则。**不允许**把"教案怎么写"塞进
   Preset——那是 Skill 的事。参照 `standard` 组合，只替换 persona 块（现有
   `scripts/teacher/make-education-preset.mjs` 已按此契约生成，改动必须继续满足 `--check`）。
2. **渐进式披露。** Skill 只暴露 `name + description`，正文按需加载，深材料放 `references/`。
   Preset 是模板，Memory 是变量——**不要**靠不断改写巨大 system prompt 传递状态。
3. **召回优于回忆。** 面向老师的提问必须是"从几个方案里认出自己想要的"，不是开放式填空。
   技术词（PBL / UbD / 5E / 建构主义）**不得**出现在给老师的选择里。
4. **Memory 不全量注入。** 永远只注入极小的教师画像；其余按任务类型条件检索。

---

## 四、P0 任务

### P0-1 Teacher Preset（薄）

- 落点：`dsh-plugin-desktop/presets/education/`，由 `scripts/teacher/make-education-preset.mjs`
  从 `standard` 派生（保持 `--check` 通过）。
- 内容：六类规则，纯策略，不含学科方法。措辞面向"老师不知道自己要说啥"的现实。
- 关键条款：
  - 用户说"直接做"→ 立即停止需求访谈。
  - 信息足够 → 直接做；不足但可安全假设 → 边做边说明假设。
  - 只有缺**关键参数**时才启动 GrabMe。
- 完成判据：preset 的 persona 块长度与六类规则一一对应，且 `--check` 通过。

### P0-2 GrabMe（本阶段最重要的**产品**资产）

四阶段内部状态，**不是** ASK→ASK→ASK：

```
DISCOVER → INFER → PROPOSE → EXECUTE
```

核心算法（正式作为内部概念，写进 `references/question-policy.md`）：

```
Question Utility = Output Impact × Uncertainty × Information Gain − User Friction
```

提问前必须依次检查：① 当前消息 ② Session State ③ Memory ④ Question Ledger。

**追问预算**：
```yaml
grabme:
  max_questions_first_turn: 2
  max_clarification_rounds_before_draft: 2
  prefer_choices: true
  recommend_default: true
  allow_skip: true          # "不知道，你帮我选" 是正常路径，不是兜底
  allow_direct_execution: true
```

**Reverse Brief**：AI 先写 brief，用户纠错 brief —— 而不是用户写 brief、AI 执行 brief。
面向用户只输出一句可纠正的复述，例如"我先按高一、45 分钟、少讲授、多观察推理来设计……
如果没有特别要求我就按这个展开"。

**产物必须是结构化 Requirement Brief**（`task / audience / context / goals / pedagogy /
deliverable / assumptions / unresolved`），GrabMe 不能只是"聊完了"。

落点：`teacher/skills/teacher-grabme/{SKILL.md,references/{task-schemas,question-policy,defaults,examples}.md}`

### P0-3 Global Memory（全局基础设施，**不叫** teacher-memory）

命名 `dsh-global-memory`：教师/研究/编码预设共用同一个底层服务。**不绑死任何社区插件**，
自己实现一个很薄的 adapter（DSH 仍是 developer preview）。

五个 namespace：`profile` / `environment` / `preferences` / `projects` / `corrections`。

**只做 6 个工具**（不要一上来 30 个）：
`memory_get` / `memory_search` / `memory_set` / `memory_update` / `memory_forget` / `memory_feedback`

每条记忆必须带 metadata：`value` `scope` `source` `confidence` `updated_at` `expires_at`。

置信度分层（**区分"用户说的"与"AI 猜的"**）：
```
explicit_user      1.00
explicit_correction 1.00
repeated_behavior  ≈0.85
strong_inference   ≈0.65
weak_inference     不入长期记忆
```
一次"这次不要课堂活动"**绝不**能沉淀为"用户不喜欢课堂活动"。

**冲突优先级**：当前用户明确表达 > 当前项目配置 > 本学年配置 > 长期用户画像 > 行为推断 > 模型默认。

**TTL**：学科可长期；年级/教材版本/班级情况按学年失效，到期是"重新确认"（"我记得上学年你主要带高一，今年还是高一吗？"），不是重新盘问。

**Question Ledger**：记录问了什么、答案是什么、来源、最后确认时间。目标是
`Never ask twice unless the old answer may no longer be valid.`

落点：`teacher/packages/global-memory/`（`index.ts` / `schema.ts` / `retrieval.ts` /
`extractor.ts` / `conflict.ts` / `question-ledger.ts`），持久化走 DSH 的 `storageDomain`，不自己造库。

---

## 五、P1 任务

- **三个核心 Skill**：`lesson-design` / `ppt-design` / `assessment-design`（使用频率最高）。
- **Memory Extractor**：自动发现显式偏好、长期环境、用户纠正、稳定工作习惯；
  经 `Worth saving? → 去重 → 冲突检查 → scope 选择 → 保存` 五步，**不把聊天记录永久化**。

## 六、P2

`worksheet-design` / `teaching-review` 等，之后再拆。

---

## 七、必须做 eval（否则 GrabMe 会越来越烦）

除"最终产物质量"外，必须测这七项指标：

| 指标 | 含义 | 目标 |
|---|---|---|
| Repeated Question Rate | 已知信息又问一次的比例 | **< 2%** |
| Median clarification rounds | 每任务追问轮数中位数 | **≤ 1** |
| First useful output | 用户第几轮看到第一个有价值成果 | **≤ 2 轮** |
| Ask Rate | 平均每任务提问数 | 观察 |
| Useful Question Rate | 问题是否真正改变结果 | 观察 |
| Memory Precision | 检索到的记忆有多少真相关 | 观察 |
| Direct Execution Rate | 无需追问即可开始的比例 | 观察 |
| Wrong Memory Usage Rate | 错误/过期记忆被使用的概率 | 观察 |

方案：20–30 条**教师真实模糊需求**用例（如"我想上一节有意思的大气受热过程"、
"我要做一份期中试卷"、"我要讲人口迁移，有什么新颖点的吗"），跑真实会话，
从 DSH 的 append-only session log 统计上述指标。

落点：`teacher/evals/grabme/`（用例），指标脚本与 `teacher/scripts/` 下的验证脚本同风格。

---

## 八、明确不做（第一阶段）

几十个学科 Skill、几十套课标、教材全文、题库、学科网、复杂 multi-agent、自动生成 Skill、
复杂知识图谱。

理由：**需求理解层没做好，接 100 个 MCP 也还是不知道该查什么。**

---

## 九、第一阶段立刻可开发的 4 件东西

1. `teacher preset` 初版
2. `teacher-grabme/SKILL.md`（含 4 个 references）
3. `global-memory` schema + 6 个工具
4. 20–30 条教师真实模糊需求 eval case

这四件出来，就能在 DSH 上跑第一轮 A/B。
