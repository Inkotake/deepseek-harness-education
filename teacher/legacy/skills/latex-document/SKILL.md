---
name: latex-document
description: Create LaTeX math documents, formula sheets, or exam drafts as .tex files with KaTeX-based HTML rendering. Use when the user asks for LaTeX, 公式文档, 数学讲义, or .tex output.
---

# LaTeX Document

## Goal

Produce valid `.tex` documents and render formulas with KaTeX when HTML preview is needed.

## Two levels

1. **KaTeX (always available)** - for HTML artifacts, formula panels, and PPT formula rendering.
2. **`.tex -> PDF` engine** - interface reserved (`teacher-latex build xxx.tex`). Not bundled in MVP 0.1.

## Workflow

1. Generate a standalone `.tex` document (article class, CJK-safe if needed).
2. When an HTML preview is requested, render the formulas with KaTeX in a teaching artifact.
3. Never pretend a full TeX engine is installed in this version.

## Template

```latex
\documentclass[12pt]{article}
\usepackage{amsmath,amssymb}
\usepackage[UTF8]{ctex}
\title{...}
\author{...}
\begin{document}
\maketitle
\section{...}
...
\end{document}
```

## Rules

- Use `teacher-latex build` only as the future interface; in MVP, deliver `.tex` + KaTeX HTML preview.
- Keep formulas in `\(...\)` or `\[...\]`.
- For exam drafts, keep a clear Question Model structure so `exam-layout` can be added later without rework.