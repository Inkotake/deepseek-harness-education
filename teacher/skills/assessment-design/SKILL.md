---
name: assessment-design
description: Turn a Requirement Brief into a test, quiz, or exam paper with its answer key and scoring. Use when the user asks for a test, quiz, exam, 试卷, 练习, 单元测, 期中/期末, or wants questions written for a topic or range. Fills scoring, difficulty distribution and question mix itself rather than asking.
whenToUse: Use when the user asks for a test paper, quiz, 试卷, 练习, or exam questions for a topic or range.
user-invocable: true
disable-model-invocation: false
metadata:
  teacher-dsh:
    version: 1
---

# Assessment Design

Produce a paper the teacher can print, plus the answer key and the marking scheme.

## What you decide rather than ask

The brief deliberately leaves these unset, and asking about them is the single most common way this
task goes wrong. **Decide them, apply them consistently, and state them once at the top of the
paper** so the teacher can change them in one place:

| Slot | Default | When to deviate |
|---|---|---|
| 总分 | 100 | the brief names a number, or the school's format is stated |
| 题型比例 | 选择 40% · 填空 20% · 解答 40% | the brief names a range or a format |
| 难度梯度 | 约 6:3:1（基础 : 中等 : 挑战） | the brief says it is a 选拔/竞赛 paper, or a 基础过关 paper |
| 考试时长 | 与分值和学段相称（初中约 60 min，高中约 90 min） | the brief names a duration |
| 题量 | whatever the time budget supports at the students' reading speed | — |

State every one of these in a short 「本次试卷的设定」 block at the top. That block is also where
the teacher finds the one place to change them.

## What you must not decide alone

These change the paper fundamentally, and the brief should already carry them. If it does not, they
are the only things worth asking about — and even then, offer choices rather than an open question:

- **which grade and subject** — determines the whole vocabulary level,
- **the range** — which chapters or unit the paper may draw on.

## Workflow

1. **Restate the brief in one sentence**, including the range.
2. **Write the specification first**: the slot table above, filled in. This is what the teacher can
   correct cheaply.
3. **Build a coverage table** before writing any question — every item in the range mapped to the
   question(s) that assess it, so nothing is tested twice and nothing is missed.
4. **Write the questions** using `references/item-design.md`. Each question gets its answer, its
   marks, and where its marks come from.
5. **Mark-scheme check**: add the marks up, confirm they equal the total, and confirm a student who
   knows the material can finish in the time budget.
6. **Self-check** — the list at the end of `references/item-design.md`.

## Output shape

1. **本次试卷的设定** — the slot table, filled, in one short block.
2. **试卷** — questions numbered continuously; each states its marks.
3. **参考答案与评分标准** — per question: the answer, the mark allocation, and what earns partial
   credit.
4. **双向细目表** — the coverage table: range item → question number → marks → difficulty band.
5. **我替你定的事** — the defaults you applied and anything you assumed.

## Boundaries

- Do not re-interview. Only the grade/subject and the range are worth a question, and only if the
  brief is silent.
- Do not manage memory.
- Do not write questions whose answer depends on a fact outside the stated range, unless the
  question supplies it.
- Do not ship a paper without its answer key and mark allocation.
