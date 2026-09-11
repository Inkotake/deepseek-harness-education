# GrabMe eval suite

`teacher/evals/grabme/` 是需求发现层（GrabMe，见 `teacher/TEACHER-MODE-PLAN.md` 第四节 P0-2）
的评测套件。它要抓的唯一一件事是：**助手有没有把“帮老师把需求想清楚”做成一场审问。**

套件由三个文件组成：

| 文件 | 作用 |
|---|---|
| `cases.json` | 26 条教师真实模糊需求用例（含 `expected` 断言） |
| `metrics.md` | 八个指标的度量定义、计数规则、目标与方向 |
| `README.md` | 本文件：怎么跑、什么算通过、还缺什么 |

## 这个套件跑的是真实会话

用例**不是**单元测试，也**不是**对助手回复的人工评分。每个 case 都会以该 case 的
`teacher_message` 作为首条用户消息、以 `preloaded_memory` 作为开局记忆，在真实的
DSH 会话里跑一遍完整对话。多数 case 带真实记忆（年级、教材版本、课时、已记录的纠正），
`missing-*` 一类的 `preloaded_memory` 各 namespace 均为空对象或空数组，必须真的从零开始。

因此判定依据只有两个：会话里实际发生了什么，以及仓库的 **append-only session log**
（`session[.vN].jsonl`，见 `deepseek-harness/packages/session/session-persistence-jsonl/`）。
指标全部从事件流里数出来——`user/message`、`turn/start`、`turn/end`、`assistant/message`、
`tool/call`、`tool/result`、`deliverables/presented`。**信号来自日志，不来自阅读助手的散文。**

为什么必须这样：一句“我先按高一、45 分钟来设计……”读起来永远很得体，只有日志能回答
“这是第几轮”“一共问了几个问题”“这个问题是不是记忆里已经有答案”。`metrics.md` 里
每个指标都写了精确到事件类型的计数规则，目的就是让两个人跑同一批会话能得出同一个数。

## 什么算通过

一次跑批要同时满足四组条件：

1. **总体指标**
   - Repeated Question Rate **< 2%**
   - Median clarification rounds **≤ 1**
   - Time to First Useful Artifact **≤ 2 用户轮**
   - 其余四项（Ask Rate / Useful Question Rate / Memory Precision /
     Wrong Memory Usage Rate / Direct Execution Rate）为观察项，但须与上一轮基线一并报出；
     `direct_execution` 用例的 Direct Execution Rate 必须为 1，
     `memory-not-longterm-*` 用例的 Wrong Memory Usage Rate 必须为 0。
2. **每个 case 的 `expected` 断言**：`max_questions_first_turn` 不得超出；
   `must_ask_about` 的槽位必须被问到；`must_not_ask_about` 的槽位不得作为问题出现；
   `must_offer_choices` 为真时必须给出可选项；`must_produce_brief` 为真时必须产出
   可纠正的 Requirement Brief 或可交付产物。
3. **两个方向的失败分别统计**：既要报“不该问却问了”，也要报“该问没问”。
   只压提问数会让助手学会闭嘴，那不是通过。
4. **不能只在本用例单独跑时通过**（下一节）。

## 只在本用例单独跑时才通过的 suite，是 suite 的缺陷

这条规则是硬的：**一个只在“单独跑这个 case”时才通过的套件是套件自身的缺陷，不是通过。**

原因有二，而且两条都会真实咬人：

- **整套跑批才有状态。** `memory_should_answer` 和 `correction_followup` 类用例检验的是
  跨轮、跨用例的记忆与纠正是否被复用；单独跑意味着没有历史，问题会被“合理地”又问一遍。
- **顺序与并发会暴露耦合。** 真实的老师不会一次只问一件事。会话之间共享同一个
  Global Memory 和 Question Ledger，一个 case 写入的记忆会影响后面的 case；
  如果某些 case 必须独占运行才能过，说明记忆的 scope 或失效规则有问题。

所以跑批默认是**一次跑完 26 条**（可重复多轮），并在报告里同时给出
“整套一起跑”和“逐条隔离跑”两组数字。两者不一致时，先修套件与记忆 scope，不要挑好看的报。

## Runner：怎么跑

Runner 已经实现，落在 `teacher/evals/grabme/`（`run.mjs` / `score.mjs` / `lib/` / `tests/`）。
**它评的是已经录下来的会话：不自己起 session，也不调用模型。** 一次跑批要先把 case 各跑成
一份真实会话（这一步的驱动程序仍未实现，见文末），再把 runner 指向那些会话。

```sh
# 一次跑完一个跑批目录（目录树里每个 session 目录取代号最高的世代）
node teacher/evals/grabme/run.mjs <跑批根目录>

# 单条会话：session id 或所在目录名与 cases.json 的 id 相同即自动对上
node teacher/evals/grabme/run.mjs path/to/sessions/missing-midterm-paper-two-questions

# 机器可读报告 / 在 PowerShell 里可以直接复制的文本报告
node teacher/evals/grabme/run.mjs <路径> --json
node teacher/evals/grabme/run.mjs <路径> --ascii

# 用某一个 case 的 expected 逐条判定，并分别给出两个方向的失败清单
node teacher/evals/grabme/score.mjs --case missing-midterm-paper-two-questions <路径>

# 单元测试
node --test "teacher/evals/grabme/tests/*.test.mjs"
```

**为什么要 `--ascii`**：PowerShell 控制台会把中文输出打乱，`--ascii` 把非 ASCII 字符转成
`\uXXXX`，是唯一能直接粘出来的文本形态；`--json` 保留原字符，供程序消费。

### 读什么、不读什么

所有数字只从 append-only session log 的事件流里数出来（`user/message`、`turn/start`、
`turn/end`、`assistant/message`、`tool/call`、`tool/result`、`deliverables/presented`），
不读助手散文。事件名与载荷字段取自
`deepseek-harness/packages/core/session/src/known-event-types.ts`；该文件在运行时被读取并
解析，所以 runner 不会和它评的那份构建脱节（`tests/known-events.test.mjs` 断言两者一致）。

- `.jsonl` 与 `.jsonl.zstd` 都读（zstd 走 Node 自带的 `zlib.zstdDecompressSync`）。
- 只解析「逻辑行」世代（v2/v3：行类型就是事件名）。更早的世代把助手输出编成
  `assistant/chunk` / `reasoning-chunks` 这类物理行，需要
  `deepseek-harness/packages/session/` 下的迁移编解码器；runner 遇到即报错退出，不猜。
- 出现 `KNOWN_SESSION_EVENT_TYPES` 之外、且没有 `ignorable` 标记的事件类型时，按 DSH 读
  路径的规则拒读；`--tolerate-unknown-events` 可降级为「照评并在报告里列出」。

### 口径与目标

八个指标按 `metrics.md` 的公式实现，报告同时给出分子、分母与目标判定（Repeated Question
Rate `< 2%`、Median clarification rounds `≤ 1`、Time to First Useful Artifact `≤ 2 轮`，
其余四项为观察项）。每个 case 的 `expected` 断言逐条判定，`must_ask_about`（该问没问）与
`must_not_ask_about`（不该问却问了）分开统计。

### 这些地方做不到，报告里会直说，不静默跳过

1. **结构化 Requirement Brief 无法从日志判定。** `KNOWN_SESSION_EVENT_TYPES` 里没有任何
   brief 事件类型，日志无法把 brief 与普通散文区分开——而那正是「不读散文」要避免的。
   `briefDetected` 一律为 `null` 并给出原因；`must_produce_brief` 改用
   `deliverables/presented` 或产出型工具的 `tool/result`，也就是 `metrics.md` 同一句话里的
   另一半判据。
2. **TTL 豁免的三条判据全部实现**（`lib/memory.mjs` 的 `evaluateTtlExemption`），并逐条报出
   `a`/`b`/`c` 与不合格原因：(a) 该槽位记忆条目带早于本次会话的 `expires_at` 且已过期；
   (b) 问题文本是确认式（`还是/仍然/依然/是否` + `吗/呢`）；(c) 日志里有该条目的注入记录
   （非 `source.kind: 'user'` 的 `user/message` 里出现条目 id 或值）。`cases.json` 的
   `preloaded_memory` 没有任何 `expires_at` 字段，所以只有会话旁边放了 `memory.json`
   （按 `teacher/packages/global-memory/schema.ts` 的 `MemoryRecord` 形状）时 (a) 才可能成立；
   没有时报告写「无法判定」，而不是默认豁免成立。
3. **记忆两项指标的判据有一处无法完全从日志得出，报告会标出来。** `rel(m)` 的任务类型来自
   `metrics.md` 说的 brief 的 `task` 字段；brief 不存在，于是按 case 的 `teacher_message`
   关键词映射到 `MEMORY_RETRIEVAL_RULES` 的键，并在报告里写明用了哪条规则。rule 1（与用户
   当前明确表达冲突）只在槽位有可解析取值时才能判定（分钟/节/分/题/页/年级/教材版本），判
   定不了的记 `undetermined`，并把该率标成下界。
4. **`changed(x)` 是日志代理量，不是人看 diff。** 判据：回答之后有没有产出事件；有的话，
   回答的取值 token（CJK 二元组 + ASCII 词）是否出现在其中，且该 token 在回答前不存在。
   三条出路是 `1` / `0` / `undecidable`，`undecidable` 按 `metrics.md` §3 从分子分母同时剔除
   并单独计数。
5. **只有「一次跑完」一种报告模式。** README 要求的「整套连续跑 + 逐条隔离跑」两组数字还
   没有：runner 评的是给定的会话集合，隔离与串联是录制阶段的事。

### 仍然没有实现的部分

**会话驱动与录制还没有。** 没有东西按 case 起真实 DSH session、注入 `preloaded_memory`、
把 `teacher_message` 当首条用户消息送进去、并按剧本扮演老师回答 `ask_user_question`；也没有
原始 session 归档、可配置重复轮数与并发度的成本控制。在它落地之前，`cases.json` 的 26 条
case 仍然需要手工或另写脚本跑成会话。

落点说明：本次 runner 按交付要求放在 `teacher/evals/grabme/`（与 `cases.json`、`metrics.md`
同目录），没有放进 `teacher/scripts/`；`deepseek-harness/` 内没有任何改动，`cases.json` 也
没有被改过。

## 配套事实：`cases.json` 的字段

每个 case 有 7 个必填字段：`id`、`category`、`teacher_message`、`preloaded_memory`、
`expected`、`why`，其中 `expected` 又固定包含 `must_ask_about`、`must_not_ask_about`、
`max_questions_first_turn`、`must_offer_choices`、`must_produce_brief`、`notes`。

`category` 只有八个取值：`vague_request`、`missing_key_parameter`、`memory_should_answer`、
`correction_followup`、`novelty_request`、`direct_execution`、`ambiguous_scope`、
`out_of_scope`。

`teacher_message` 是真实老师会打出来的话（口语、缺参数、没有提示词工程），
**不是产品需求描述**。技术词（PBL / UbD / 5E / 建构主义 / 认知冲突 等）不得出现在
`teacher_message` 里——老师不会这么说话，出现即说明用例被写成了规格书。
