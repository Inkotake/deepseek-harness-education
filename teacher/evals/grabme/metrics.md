# GrabMe 指标定义（teacher/evals/grabme/metrics.md）

本文定义 `cases.json` 跑真实会话后要统计的八个指标。目标与方向来自
`teacher/TEACHER-MODE-PLAN.md` 第七节。

**信号来源：仓库的 append-only session log，不是助手回复的散文。**
所有指标只从会话事件流计算。每个 case 是一个独立 session，session 里的事件类型取自
`deepseek-harness/packages/core/session/src/known-event-types.ts`
（`user/message`、`turn/start`、`turn/end`、`assistant/message`、`tool/call`、`tool/result`、
`deliverables/presented` 等）。不读助手自然语言做人工打分——那会把评测变成主观评价，
也就无法回归。

## 记号

对一次跑批（`cases.json` 的全部 case 各跑一次真实会话，可重复多轮）：

| 记号 | 含义 |
|---|---|
| `S` | 本次跑批的 session 集合，`\|S\|` = case 数 |
| `T(s)` | session `s` 的 `turn/start` 事件数，即用户轮数 |
| `U(s)` | session `s` 的 `user/message` 事件数（含 case 首条消息；追问后的补充回答也算） |
| `Q(s)` | session `s` 中助手发起的澄清问题数（计数规则见下） |
| `A` | 全部 session 的已回答槽位集合（来自 `preloaded_memory` + 本 session 先前轮次），`\|A\|` 为其大小 |
| `Qmem` | `Q` 中命中 `A` 的问题（重复/已知仍在问） |

**澄清问题的计数规则（`Q` 的唯一口径）**：一次 `ask_user_question` 的 `tool/call`
按 `questions` 数组长度计 `k` 个问题，不是计 1 个。以自然语言在 `assistant/message` 里
写出来的问句只有在同一 `turn` 内没有任何 `ask_user_question` 调用时才计入，并按问号
分隔的疑问句逐句计。两种提问方式不得重复计数。

**“这个问题问了槽位 X”的判定规则（作用于 `Q` 的每个问题）**：
把该问题的文本归一化（去空白、全角转半角），与 `cases.json` 中该 case 的槽位名表
（`must_ask_about` ∪ `must_not_ask_about` ∪ `notes` 里显式列出的槽位）做同义匹配；
匹配到唯一槽位即归属该槽位；匹配不到任何槽位记为 `unclassified`，`unclassified`
单独列出但不从 `Q` 中剔除（否则可以通过含糊提问刷指标）。

---

## 1. Ask Rate（提问密度）

- **度量什么**：平均每个任务的提问数，即需求发现层的“摩擦总量”。
- **计数规则**：把每个 session 的 `Q(s)` 求和。
- **公式**：`Ask Rate = Σ_{s∈S} Q(s) / |S|`（单位：问/任务）。
- **目标**：计划只写“观察”，无数值目标。首个基线跑批后应把它当作回归线：
  同一 suite 的后续版本不得显著高于该基线。
- **方向**：**越低越好**（在 Useful Question Rate 不下降的前提下）。

## 2. Repeated Question Rate（重复提问率）

- **度量什么**：已知信息又被问一次的比例。这是整个 suite 头号要抓的失败模式。
- **计数规则**：对 `Q` 中每个问题，用上面的槽位判定规则得到槽位 `x`；若 `x ∈ A`
  且该问题不是“到期重新确认”（见下），计入 `Qmem`。
  **唯一豁免**：TTL 到期后的重新确认。仅当满足全部三条时豁免——(a) 该槽位对应的记忆条目
  带有早于本次会话的 `expires_at` 且已过期；(b) 问题文本是确认式而非盘问式
  （例如“今年还是高一吗？”）；(c) session log 中存在该记忆条目的注入记录。
  任一不满足即计入 `Qmem`。
- **公式**：`Repeated Question Rate = |Qmem| / |Q|`，其中 `|Q| = Σ Q(s)`。
- **目标**：**< 2%**。
- **方向**：**越低越好**。

## 3. Useful Question Rate（提问有效率）

- **度量什么**：问题是否真正改变了结果。计划把它列为“观察”，因为它要人（或
  diff）来判断产出是否因该回答而变化。
- **计数规则**：对 `Q` 中每个问题记 `changed(x) ∈ {0,1}`：
  - `1`，当且仅当该问题的回答被采用后，产物（或结构化 Requirement Brief 的某个字段）
    与该回答不一致的版本被实际改写——判据是 `deliverables/presented` 或 brief 写入
    发生在回答之后，且其中出现该回答带来的取值/结构差异。
  - `0`，若回答后产物与回答前逐字段等价，或该槽位在产出里根本没有落点。
  - 无法从日志判定的问题单列 `undecidable`，不计入分子也不计入分母，
    但必须在报告里给出计数（`undecidable` 长期偏高本身就是 suite 缺陷）。
- **公式**：`Useful Question Rate = Σ changed(x) / (|Q| − undecidable)`。
- **目标**：计划只写“观察”，无数值目标。
- **方向**：**越高越好**（与 Ask Rate 一起看：低提问量 + 高有效率才是目标形态）。

## 4. Time to First Useful Artifact（首个有用成果时间）

- **度量什么**：用户在**第几轮**看到第一个有价值的成果。计划表格里叫
  “First useful output”。
- **计数规则**：对每个 session `s`，找最早的“有用成果”事件 `e(s)`：
  - 命中 `deliverables/presented`，或
  - 命中产出了可交付内容的 `tool/result`（例如 artifact 构建成功、文档/课件/试卷文件
    写出），且该 `tool/result` 之后没有被回滚或被用户判为答非所问。
  记该事件所在 `turn/start` 的序号（从 1 开始）为 `f(s) = ` 用户第几轮看到成果。
  若整场 session 没有任何有用成果，`f(s) = ∞`，并在报告中单列“无成果 session”数。
- **公式**：`Time to First Useful Artifact = median({ f(s) : s ∈ S, f(s) ≠ ∞ })`，单位：用户轮。
- **目标**：**≤ 2 轮**。
- **方向**：**越低越好**。

## 5. Memory Precision（记忆精度）

- **度量什么**：检索到的记忆有多少真相关。抓“记忆很美但全是噪声”。
- **计数规则**：对每个 session，取出所有被注入上下文的记忆条目 `M(s)`（含
  `preloaded_memory` 中实际注入的部分和会话中 `memory_get`/`memory_search`
  命中的部分）。对每条 `m` 记 `rel(m) ∈ {0,1}`：该条目是否属于当前任务类型
  （任务类型由 brief 的 `task` 字段给出，例如 lesson_design / assessment_design），
  且是否在产物或提问中有实际落点。
- **公式**：`Memory Precision = Σ rel(m) / Σ |M(s)|`。
- **目标**：计划只写“观察”，无数值目标。
- **方向**：**越高越好**。

## 6. Wrong Memory Usage Rate（错误记忆使用率）

- **度量什么**：错误或过期记忆被使用的概率——包括把一次性说法当成长期偏好。
- **计数规则**：对每个 session 的 `M(s)`，记 `bad(m) ∈ {0,1}`，只要满足任一条即记 1：
  - `m` 与当前会话中用户的明确表达冲突（违反计划四的冲突优先级：当前明确表达 > 长期画像）；
  - `m.expires_at` 已过期却仍被当作当前事实使用；
  - `m.source` 属于行为推断（`repeated_behavior` / `strong_inference` 及更弱），
    却被用于确定结论而非作为待确认的假设。
- **公式**：`Wrong Memory Usage Rate = Σ bad(m) / Σ |M(s)|`。
- **目标**：计划只写“观察”；但 `memory-not-longterm-*` 三个 case 上该指标必须为 0，
  否则视为硬失败。
- **方向**：**越低越好**。

## 7. Direct Execution Rate（直接执行率）

- **度量什么**：无需追问即可开始的比例，即需求发现层有没有变成路障。
- **计数规则**：若 session `s` 的第一个 `assistant/message` 已包含实际产出
  （工具调用开始生成产物）或结构化的 Requirement Brief 且 `Q(s) = 0`，则
  `direct(s) = 1`，否则为 0。仅复述问题不算直接执行。
- **公式**：`Direct Execution Rate = Σ direct(s) / |S|`。
- **目标**：计划只写“观察”，无数值目标。
  `category = direct_execution` 的 case（`max_questions_first_turn = 0`）上必须为 1。
- **方向**：**越高越好**（受 Correctness 约束：不能靠不问而做错来抬高）。

## 8. Median clarification rounds（追问轮数中位数）

- **度量什么**：每任务追问轮数中位数，即“要聊几轮才开始干活”。
- **计数规则**：对 session `s`，一轮“追问轮”指一个 `turn/end` 已结束、
  且该轮助手消息包含至少一个澄清问题（`Q` 的任一计数来源）、且该轮没有产出成果的轮次。
  记 `r(s)` 为这样的轮次数。**上限关系**：`r(s)` 超过
  `grabme.max_clarification_rounds_before_draft`（= 2，见计划四）即记为违反预算，
  单独计数。
- **公式**：`Median clarification rounds = median({ r(s) : s ∈ S })`，单位：轮。
- **目标**：**≤ 1**。
- **方向**：**越低越好**。

---

## 汇总表

| # | 指标 | 公式（见上文细则） | 目标 | 更好方向 |
|---|---|---|---|---|
| 1 | Ask Rate | `Σ Q(s) / \|S\|` | 观察（建立基线后不得上升） | 低 |
| 2 | Repeated Question Rate | `\|Qmem\| / \|Q\|` | **< 2%** | 低 |
| 3 | Useful Question Rate | `Σ changed(x) / (\|Q\| − undecidable)` | 观察 | 高 |
| 4 | Time to First Useful Artifact | `median(f(s))` | **≤ 2 轮** | 低 |
| 5 | Memory Precision | `Σ rel(m) / Σ \|M(s)\|` | 观察 | 高 |
| 6 | Wrong Memory Usage Rate | `Σ bad(m) / Σ \|M(s)\|` | 观察（3 条 no-longterm case 必须 0） | 低 |
| 7 | Direct Execution Rate | `Σ direct(s) / \|S\|` | 观察（direct_execution case 必须 1） | 高 |
| 8 | Median clarification rounds | `median(r(s))` | **≤ 1** | 低 |

## 按 case 的判定（在总体指标之外）

除八个总体指标，每个 case 还有 `cases.json` 里的 `expected` 断言，逐 case 判定：

- `max_questions_first_turn`：该 case 首轮 `Q` 不得超过此值。
- `must_ask_about`：首轮（或首轮 + 一轮内）必须出现过这些槽位的问题，否则算“该问没问”。
- `must_not_ask_about`：这些槽位在整个 session 中不得作为问题出现；出现即 case 失败，
  且同时推高 Repeated Question Rate。
- `must_offer_choices`：为 `true` 时，该 session 至少一次澄清问题带 `options`，且
  `must_not_ask_about` 中的开放式问句不得出现。
- `must_produce_brief`：为 `true` 时，`r(s) = 0` 的轮次内必须出现结构化 Requirement Brief
  或可交付产物；整场只有提问、没有 brief 也没有产物即失败。

**“该问没问”和“不该问却问了”是两个方向相反的失败，必须分开统计。**
只压提问量会让助手学会什么都不问，因此 Readme 里的通过条件是两者同时满足。
