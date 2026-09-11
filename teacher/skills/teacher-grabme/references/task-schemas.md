# 任务槽位分层（Task Schemas）

每类任务都有一张槽位表。**槽位名是内部字段名，不要读给老师听。**

分层含义：

| 分层 | 含义 | 缺失时的动作 |
|---|---|---|
| `blocking` | 没有它就无法产出**可用的**东西 | 必须问，或在 `unresolved` 里明确挂起 |
| `high_impact` | 它的取值会改变产物的**结构** | 优先问；能安全假设就假设并说明 |
| `medium_impact` | 会改变**细节安排**，不影响骨架 | 静默取默认值；老师提了再改 |
| `low_impact` | 外观/措辞层面的差异 | **不问**，直接按默认值 |
| `inferable` | 能从消息、会话、记忆或常识推出 | **绝不问**，推出后写进 `assumptions` |

**通用铁律**：任何落在 `inferable` 的槽位，只要命中来源，就**不再提问**。
`blocking` 槽位若在预算内问不到，也必须给出默认假设，让 briefing 能继续，并把它挂在
`unresolved` 上。

---

## 1. `lesson_design`（一节课的教学设计）

| 槽位 | 分层 | 说明 |
|---|---|---|
| `topic` | `blocking` | 这一节讲什么。老师几乎总会说——"大气受热过程"这类就是 topic |
| `duration` | `high_impact` | 课时长度。一节课 40/45 分钟还是连堂，直接决定环节数量 |
| `goal_orientation` | `high_impact` | 这一节更偏"真懂"还是更偏"考试"。**决定整份设计的骨架** |
| `prior_knowledge` | `high_impact` | 学生已经会什么。决定从哪里起步、要不要补前置 |
| `audience.grade` | `inferable` | 年级 + 具体班级。记忆里通常已有，**不要问** |
| `audience.textbook` | `inferable` | 教材版本与章节位置。记忆里通常已有，**不要问** |
| `key_difficulty` | `medium_impact` | 本节最卡的地方。默认取课标与教材通例 |
| `lesson_type` | `medium_impact` | 新授 / 复习 / 习题 / 实验。默认新授 |
| `activity_preference` | `medium_impact` | 是否安排课堂活动。默认按 `defaults.md` 给一个低风险活动 |
| `assessment_form` | `medium_impact` | 当堂怎么知道学生懂了。默认一个快速检查 |
| `differentiation` | `low_impact` | 分层安排。默认给一条保底要求，不问 |
| `output_format` | `low_impact` | 文档 / 表格 / 课件脚本。默认教学设计文档 |
| `constraints` | `inferable` | 老师此前说过的限制（"不要课堂活动""学校要求写三维目标"）。**会话内查** |

**这一节的 `blocking` 只有一个 `topic`**：老师只要说了讲什么，就一定能出一份草的 Brief。
不要把 `duration` / `goal_orientation` 提升为 blocking——预算内问不到就问不到，
其余按默认走，然后在草稿上改。

---

## 2. `assessment_design`（一份试卷 / 一套题）

| 槽位 | 分层 | 说明 |
|---|---|---|
| `coverage` | `blocking` | 考到哪（章 / 节 / 进度 / 老师发的范围）。**没有它出不了卷** |
| `item_types` | `high_impact` | 题型构成：选择 / 填空 / 实验 / 计算 / 材料题 |
| `total_score` | `high_impact` | 满分。影响分值分配与题量 |
| `duration` | `high_impact` | 考试时长。影响题量与难度配比 |
| `difficulty_mix` | `high_impact` | 难度配比。基础题为主还是压轴拉开 |
| `audience.grade` | `inferable` | 年级与班级。记忆里通常已有，**不要问** |
| `audience.textbook` | `inferable` | 教材版本。记忆里通常已有，**不要问** |
| `exam_purpose` | `inferable` | 期中 / 期末 / 单元测 / 随堂练。**从老师说的一句话直接推** |
| `blueprint` | `medium_impact` | 各部分分值比例。默认按常规双基配比 |
| `answer_key` | `medium_impact` | 是否要答案与解析。默认要，并附解析 |
| `reuse_policy` | `medium_impact` | 要不要用往年题改编。默认全部新编 |
| `layout` | `low_impact` | 卷面排版：字号、密封线、装订线。默认考试友好版式 |
| `source_constraints` | `inferable` | 老师给的范围、禁用资料、本校格式。**会话内查** |

**这一节的 `blocking` 是 `coverage`**：出卷必须有范围。范围问不到时，
用"按期中进度（前两章）+ 100 分 + 45 分钟"这一整套假设先出一份，并挂 `unresolved`。

---

## 3. `ppt_design`（一节课的课件）

| 槽位 | 分层 | 说明 |
|---|---|---|
| `topic` | `blocking` | 讲什么。通常与同一节备课的 topic 相同 |
| `slide_count` | `high_impact` | 页数预算。老师会用它表达"讲完就行 / 就五分钟" |
| `slide_flow` | `high_impact` | 页面推进方式：情境导入 / 问题链 / 边讲边练 / 复习串讲 |
| `audience.grade` | `inferable` | 年级与班级。**不要问** |
| `duration` | `inferable` | 若同一次会话里已为同一 topic 定过课时，**直接复用** |
| `content_density` | `medium_impact` | 每页信息量：一个点一页 / 要点罗列。默认一个点一页 |
| `visual_assets` | `medium_impact` | 要不要图、示意、公式。默认给最少够用的示意 |
| `interaction_points` | `medium_impact` | 是否插入几页提问或练习。默认插 1–2 页 |
| `formula_rendering` | `medium_impact` | 是否含公式及其渲染方式。默认可编辑公式 |
| `theme_color` | `low_impact` | 主题色、字体、母版。**不问**，按默认版式 |
| `projection_notes` | `low_impact` | 备注页讲稿。默认附简短备注 |
| `constraints` | `inferable` | 学校模板、必须包含的要素。**会话内查** |

`ppt_design` 高度依赖会话上下文：如果老师刚让你备了这节课，`duration`、`audience`、
`goal_orientation` **全部复用**，最多只剩 `slide_flow` 一个 `high_impact` 需要处理。

---

## 4. `worksheet_design`（一份学案 / 练习单）

| 槽位 | 分层 | 说明 |
|---|---|---|
| `topic` | `blocking` | 练什么。范围或知识点 |
| `use_stage` | `high_impact` | 什么时候用：课前预习 / 课中随堂 / 课后作业 / 复习巩固 |
| `item_count` | `high_impact` | 题量。直接决定学生写多久 |
| `difficulty_mix` | `high_impact` | 难度配比：基础为主 / 含少量提高 |
| `audience.grade` | `inferable` | 年级与班级。**不要问** |
| `textbook` | `inferable` | 教材版本与章节。**不要问** |
| `question_types` | `medium_impact` | 题型：选择 / 填空 / 简答 / 实验 / 作图。默认与本节课内容匹配 |
| `answer_key` | `medium_impact` | 是否需要答案。默认附答案，不附详解 |
| `scaffolding` | `medium_impact` | 是否给提示、示例、脚手架。默认给一条示例 |
| `differentiation` | `medium_impact` | 是否分层（必做 / 选做）。默认标一道选做 |
| `layout` | `low_impact` | 排版、留白、每页题量。按默认值，**不问** |
| `constraints` | `inferable` | 老师此前说过的限制。**会话内查** |

---

## 跨任务规则

1. **识别任务类型优先于填槽位。** 类型认错，槽位全错。
2. **一个槽位只问一次。** 问到答案立刻记入台账（见 `question-policy.md`）。
3. **`blocking` 最多一个。** 多于一个说明你把 `high_impact` 误升了级。
4. **只问 `blocking` 与 `high_impact`。** `medium_impact` 取默认；`low_impact` 和
   `inferable` 一律不问、不确认、不罗列。
5. **同一个任务类型在同一会话里被反复提及时，只增量提问。**
   第一次已确定的槽位在第二次直接复用。
6. **老师明确说过的约束优先级最高**，高于任何默认值和历史偏好。
