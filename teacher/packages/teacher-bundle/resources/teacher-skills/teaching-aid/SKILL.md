---
name: teaching-aid
description: Generate interactive teaching artifacts (3D demos, math explorers, physics simulations, charts, diagrams, classroom games). Use when the user asks for a teaching aid, interactive demo, simulation, model, visualization, or classroom tool. This skill only routes to the correct stack and orchestrates teacher-artifact; it does not teach web design or UI theory.
---

# Teaching Aid

## Role

Router + orchestrator for Teacher DSH artifacts. You do not author design theory.

## Workflow

1. Classify the task into exactly one primary stack.
2. Pick the matching template.
3. `teacher-artifact init <name> --template <template>`
4. Edit `src/main.js` and `src/style.css`.
5. `teacher-artifact build`
6. `teacher-artifact check` (must exit 0)
7. `teacher-artifact preview`
8. Deliver `dist/`.

## Stack selection (mandatory)

| Need | Stack | Template |
|---|---|---|
| 3D / space / models / geography / chemistry structure | Three.js | `three` |
| Functions / geometry / coordinate systems | JSXGraph + KaTeX | `math` |
| 2D mechanics / collision / gravity | Matter.js | `physics-2d` |
| Statistics / data / experiment charts | ECharts | `chart` |
| Knowledge structure / process / relations | Mermaid | `diagram` |
| Classroom interaction / quick game | SDK UI kit | `classroom-game` |
| Unknown / simple | SDK UI kit | `basic` |

Combinations are allowed only as secondary additions (e.g. Three.js + KaTeX labels).

## Hard rules

- Never write `<script src="../vendor/three.min.js">`. Use ES modules.
- Three.js addons use `three/addons/*`.
- Use `@teacher-dsh/artifact-sdk` for stage/toolbar/sliders/panels/formulas.
- Never run `npm install three` / `pnpm add` inside an artifact. Templates are pre-pinned.
- Never use CDN scripts. Artifacts must run offline.
- Relative asset paths only; assets in `public/assets/`.
- Use `--base ./` for builds (the CLI already does this).
- WebGL resources must be disposed when they are no longer needed (`geometry.dispose()`, `material.dispose()`, `texture.dispose()`, `renderer.dispose()`).
- Implement resize, devicePixelRatio cap, and OrbitControls lifecycle correctly. The SDK `createStage` already handles the common cases.
- WebGL failure must show a readable Chinese error message, not a blank screen.
- Respect `prefers-reduced-motion` where feasible.

## UI accessibility review

After building, if the artifact is intended for classroom projection, run the vendored `web-design-guidelines` skill rather than inventing your own UI rules.

## Completion criteria

- `teacher-artifact build` exits 0.
- `teacher-artifact check` exits 0.
- `teacher-artifact preview` serves the artifact locally.
- No CDN, no localhost leak, no absolute local path.