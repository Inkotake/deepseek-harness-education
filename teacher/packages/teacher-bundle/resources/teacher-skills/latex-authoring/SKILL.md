---
name: latex-authoring
description: Create LaTeX math documents, formula sheets, and .tex drafts; render formulas with KaTeX for HTML/PPT preview. Use when the user asks for LaTeX, 公式文档, 数学讲义, or .tex output.
---

# LaTeX Authoring

## Contract

This skill is only a tool-use contract. It is not a TeX engine.

- KaTeX is bundled for HTML and PPT formula rendering.
- `teacher-latex build xxx.tex` validates .tex structure only.
- PDF compilation is NOT available in Teacher DSH 0.1.

## Workflow

1. Generate a standalone `.tex` document when source is requested.
2. When HTML preview is requested, render formulas with KaTeX inside a `basic` or `math` artifact.
3. Validate structure with `teacher-latex build <file>`.

## Rules

- Never claim a PDF was compiled.
- Use `\(...\)` or `\[...\]` for math.
- Keep a clean Question Model structure so exam layout can be added later without rework.