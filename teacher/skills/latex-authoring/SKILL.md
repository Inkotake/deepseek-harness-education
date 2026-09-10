---
name: latex-authoring
description: Author LaTeX math content, formula sheets, and .tex sources, and render formulas for web and slide output with KaTeX. Use when the user asks for LaTeX, 数学公式, 公式推导, 讲义, 试卷公式, a .tex file, or typeset mathematics.
whenToUse: Use when the request involves mathematical notation, formula authoring or formatting, .tex sources, or rendering math for HTML and presentation output.
user-invocable: true
disable-model-invocation: false
metadata:
  teacher-dsh:
    version: 1
    cli: teacher-latex
    renderer: KaTeX
---

# LaTeX Authoring

Teacher DSH 0.1 is a **math authoring and rendering** environment, not a TeX distribution.

## What is available in 0.1

| Capability | Status |
|---|---|
| KaTeX rendering (HTML, slides, artifacts) | **Bundled** — KaTeX 0.18.7 |
| `.tex` source authoring and structural validation | **Bundled** — `teacher-latex` |
| Formula content inside a teaching artifact or a `.pptx` | **Bundled** |
| `pdflatex` / `xelatex` / `tectonic` / TeX Live | **Not bundled in 0.1** |

Never state or imply that a PDF was compiled with a TeX engine. If the user asks for a PDF, say
plainly that 0.1 renders formulas with KaTeX and can produce HTML or PPTX, and that TeX-to-PDF is
reserved for a later release.

## Decide the output first

| The user wants | Do this |
|---|---|
| A formula visible on screen, in a teaching aid | KaTeX inside a `math` or `basic` artifact |
| Formulas inside slides | `teacher-ppt` with a `formula` slide (Math font, editable) |
| A portable math document | `.tex` source plus an HTML/KaTeX rendering |
| A print-ready PDF | Explain the 0.1 limitation; offer HTML/PPTX instead |

## Rendering with KaTeX

Inside an artifact, use the SDK rather than calling KaTeX directly:

```js
import { createFormulaPanel, renderKatex, renderKatexInline } from '@teacher-dsh/artifact-sdk';

// A panel that can hold several display formulas.
const formulas = createFormulaPanel({ container: app.stage });
formulas.addFormula('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}');

// Or render to an HTML string for your own container.
element.innerHTML = renderKatex('\\int_0^1 x^2 \\, dx = \\frac{1}{3}');
inline.textContent = renderKatexInline('a^2 + b^2 = c^2');
```

Delimiters:

- Display math in KaTeX APIs: pass the bare LaTeX (`'\\frac{a}{b}'`).
- Inside Markdown or `.tex` prose: use `\[ … \]` for display and `\( … \)` for inline.
- Do **not** use `$$ … $$`; it is not a LaTeX delimiter and KaTeX will not treat it as one.

### KaTeX subset limits

KaTeX covers the vast majority of school and undergraduate mathematics but is not TeX. Before
committing to a construct, remember it does **not** support:

- `\usepackage`, custom packages, or `\newcommand` across separate renders
- TikZ, PSTricks, or any drawing package — build figures as SVG, Three.js, or JSXGraph instead
- `\begin{table}` / `tabular` environments — use an HTML table or a presentation `table` slide
- Bibliographies, `\cite`, or multi-file `\include`
- Arbitrary fonts beyond the bundled KaTeX font set (use `\mathbb`, `\mathcal`, `\mathfrak`,
  `\mathrm`, `\mathbf`, `\mathit` for variant letterforms)

Useful and well supported: fractions, roots, sums and integrals with limits, matrices
(`pmatrix`, `bmatrix`), cases, aligned multi-line equations, `\overbrace`/`\underbrace`, Greek,
operators, spacing (`\,` `\;` `\quad`), and units written as `\text{ m/s}^2`.

## Authoring `.tex`

```bash
teacher-latex build 讲义.tex    # structural validation only
teacher-latex info             # what this installation can actually do
```

A valid document must have all three of:

```latex
\documentclass[11pt]{article}
\begin{document}
...
\end{document}
```

`teacher-latex build` checks exactly that structure. It does not typeset anything.

## Writing rules

- **One formula per line in a derivation.** Teachers read them one step at a time; never merge
  algebra steps.
- **State units and conditions.** `F = ma` is incomplete without "in an inertial frame, for
  constant mass".
- **Prefer `\text{}` for words inside math** — `v_{\text{平均}}`, not `v_{平均}`.
- **Match the notation the teacher already uses.** If the class writes `\vec{F}`, do not switch
  to `\mathbf{F}`.
- **Keep a clean content model.** Write exercises as structured data (stem, options, answer,
  solution) so the same content can later be rendered to HTML, PPTX, or an exam sheet without
  re-authoring. This is the same content-model approach as `@teacher-dsh/ppt-kit`.
- **Never invent a result.** If a derivation does not close, say so instead of presenting a
  plausible-looking final line.

## Answering the user

Report which form you produced and how to open it:

- KaTeX in an artifact → the artifact's `dist/` and how to preview it.
- `.tex` source → the file path, plus a note that it is source, not a compiled PDF.
- Slides → the `.pptx` path, and that the formulas remain editable in PowerPoint or WPS.
