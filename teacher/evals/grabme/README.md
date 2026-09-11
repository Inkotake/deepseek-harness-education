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

## Runner 还没有实现

**说清楚：本仓库里目前没有这个套件的 runner，`cases.json` 也还没有被任何脚本消费。**
`teacher/evals/grabme/` 现在只有用例、指标定义和本文件。

要真正跑起来，runner 至少要具备：

1. **会话驱动**：按 case 起一个真实 DSH session（`education` profile），先注入
   `preloaded_memory`，再把 `teacher_message` 作为首条用户消息送进去；遇到
   `ask_user_question` 时按该 case 的剧本扮演老师回答（`do-not-know-you-choose`
   这类用例的答案是固定的，`correction_followup` 类需要能注入第二轮纠正）。
2. **日志读取**：按 session 读 append-only JSONL 事件流，能处理默认的
   `.jsonl.zstd` 压缩世代与版本迁移（复用
   `deepseek-harness/packages/session/session-persistence-jsonl/`，不要自己解析裸文件）。
3. **指标实现**：把 `metrics.md` 的八个公式实现为对事件流的纯函数，包括
   `ask_user_question` 按 `questions` 数组长度计数、TTL 豁免的三条判据、
   以及 `changed(x)` 的“回答后产物是否真的变了”判定。
4. **槽位归一化表**：维护槽位名（年级、教材版本、教学侧重、考试范围……）与问题文本的
   同义匹配表，用于 `must_ask_about` / `must_not_ask_about` 判定；
   匹配不到的问题记 `unclassified` 并报出，不得静默丢弃。
5. **两种模式的报告**：整套连续跑 + 逐条隔离跑，输出每 case 断言结果、八个总体指标、
   以及两个方向的失败清单。
6. **成本与稳定性控制**：真实会话 API 调用有费用且不确定，需要可配置的重复轮数与
   并发度，并把原始 session 归档，使指标可复算。

Runner 落地时按仓库既有风格放在 `teacher/scripts/` 下（与 `verify-*.mjs`、
`build-*.mjs` 同类），与 `cases.json` 同源引用，不要在 `deepseek-harness/` 内改动任何东西。

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
