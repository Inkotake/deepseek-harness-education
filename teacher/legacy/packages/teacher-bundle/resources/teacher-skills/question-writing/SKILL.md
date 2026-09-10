---
name: question-writing
description: Write practice questions or an exam draft (选择题, 填空题, 解答题) for a topic. Use when the user asks for 题目, 练习, 习题, 测验, or 试卷草稿.
---

# Question Writing

## Goal

Create well-formed practice questions with answers and suggested difficulty.

## Output format

For each question:

```json
{
  "type": "choice | fill | answer",
  "stem": "...",
  "options": ["...", "...", "...", "..."],
  "answer": "...",
  "difficulty": "easy | medium | hard",
  "knowledgePoint": "...",
  "score": 5
}
```

## Rules

- Questions must match the stated grade and textbook level.
- Answers must be correct and verifiable.
- For math/science, use LaTeX for formulas.
- Mark knowledge points for future exam layout integration.
- This skill only outputs a Question Model (`Question[]`). It does NOT do OCR, auto-grading, or page layout in MVP 0.1.

## Future interface

`question-writing` output feeds `exam-layout` -> DOCX / LaTeX / PDF later.