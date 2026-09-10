---
name: teaching-aid
description: Generate interactive teaching artifacts (3D demos, math explorers, physics simulations, charts, diagrams, classroom games) as offline-capable static web pages. Use when the user asks for a teaching aid, interactive demo, simulation, model, visualization, animation, manipulable figure, or classroom tool. Also use when a request needs a runnable interactive page rather than a document.
whenToUse: Use when the user asks for an interactive teaching aid, simulation, 3D model, function explorer, physics experiment, data chart, diagram, or classroom game.
user-invocable: true
disable-model-invocation: false
metadata:
  teacher-dsh:
    version: 1
    cli: teacher-artifact
    sdk: "@teacher-dsh/artifact-sdk"
---

# Teaching Aid

Build a real, runnable teaching artifact. Every dependency you need is already installed in the
Teacher DSH runtime; there is nothing to install and nothing to download.

## The four commands you will actually use

```bash
teacher-artifact init <name> --template <template>   # scaffold into ./<name>
teacher-artifact build                               # vite build -> dist/
teacher-artifact check                               # must exit 0 before you finish
teacher-artifact preview --open                      # serve dist/ locally
```

`teacher-artifact pack` produces a zip of `dist/` when the teacher wants a file instead of a URL.

Work in this order, always:

1. Pick exactly one primary stack from the table below.
2. `teacher-artifact init`, then edit `src/main.js` and `src/style.css`.
3. `teacher-artifact build`.
4. `teacher-artifact check` — do not finish while it reports a failure.
5. `teacher-artifact preview` and tell the teacher what to click.

## Stack selection

| The request is about | Stack | Template | Why |
|---|---|---|---|
| 3D, space, molecular structure, terrain, rotation, models | **Three.js** | `three` | WebGL scene with orbit camera |
| Functions, geometry, coordinate systems, calculus, statistics plots | **JSXGraph** (+ KaTeX) | `math` | Draggable geometry, accurate function boards |
| 2D mechanics, collision, gravity, springs, pendulums | **Matter.js** | `physics-2d` | Rigid-body engine with a render loop |
| Class data, distributions, comparisons, time series | **ECharts** | `chart` | Interactive charts with tooltips and legends |
| Process, knowledge structure, relationships, flowcharts | **Mermaid** | `diagram` | Text-to-diagram, easy for teachers to edit |
| Quick classroom game, voting, matching, quiz board | **Artifact SDK UI** | `classroom-game` | Buttons/sliders/panels already styled for projection |
| Anything else, or unsure | **Artifact SDK UI** | `basic` | Minimal shell you extend |

Combine stacks only as a deliberate secondary layer, for example:

- Three.js scene + KaTeX formula panel for a physics derivation.
- JSXGraph board + ECharts plot showing the same function numerically.
- Matter.js simulation + a readout panel using the SDK.

Never add a second 3D or a second charting library.

## What is available locally

All of these are pre-installed. Import them directly; never fetch from a CDN.

| Library | Version | Import |
|---|---|---|
| three | 0.186.0 | `import * as THREE from 'three'` |
| JSXGraph | 1.13.3 | `import JXG from 'jsxgraph'` |
| KaTeX | 0.18.7 | `import katex from 'katex'` |
| ECharts | 6.1.0 | `import * as echarts from 'echarts'` |
| Mermaid | 12.0.0 | `import mermaid from 'mermaid'` |
| Matter.js | 0.20.0 | `import Matter from 'matter-js'` |
| Vite | 8.2.2 | build tool, already configured per template |
| Artifact SDK | 0.1.0 | `import { ... } from '@teacher-dsh/artifact-sdk'` |

### Three.js addons already present

These resolve from the bundled `three` package. Use the `three/addons/...` specifier:

```js
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
```

Import only what you use; the whole addons tree is available but unused addons bloat the build.

## Artifact SDK

Use the SDK instead of hand-rolling controls. It fixes the classroom contract: buttons at least
40 px, body text at least 18 px, touch-friendly hit areas, and a consistent control panel.

```js
import {
  createTeachingApp,
  createStage,
  createPanel,
  createButton,
  createSlider,
  createToggle,
  createSelect,
  createReadout,
  createStepControls,
  createResetButton,
  createFullscreenButton,
  createPauseButton,
  createLegend,
  createInfoCard,
  createFormulaPanel,
  createLoadingIndicator,
  createErrorOverlay,
  renderKatex,
  renderKatexInline,
  TEACHER_UI
} from '@teacher-dsh/artifact-sdk';
```

`createTeachingApp` builds the page shell (title, stage, docked control panel, fullscreen/reset
toolbar, loading indicator, error overlay). `createStage` builds a complete Three.js stage.

```js
import { createTeachingApp, createStage, createSlider } from '@teacher-dsh/artifact-sdk';

const app = createTeachingApp({ title: '二次函数', subtitle: '拖动滑块观察图象' });
const stage = createStage({ mount: app.stage, cameraPosition: [0, 4, 10] });

const panel = app.createPanel({ title: '控制' });
panel.add(createSlider({ label: 'a', min: -3, max: 3, step: 0.1, value: 1,
  onChange: (v) => { a = v; redraw(); } }).el);
```

`createStage` already provides: `Scene`, `PerspectiveCamera`, `WebGLRenderer`, `OrbitControls`,
three lights (`ambient`, `key`, `fill`), a resize handler, a `requestAnimationFrame` loop driven
by `stage.onUpdate((elapsed, delta) => …)`, a teacher toolbar, `stage.reset()`, `stage.dispose()`,
and a readable Chinese error overlay when WebGL is unavailable. Start from it rather than writing
your own renderer wiring.

## Rules that are not negotiable

- **No CDN scripts and no runtime network access.** Artifacts must work on a classroom machine
  with no internet. `teacher-artifact check` fails the build on CDN or `localhost` references.
- **ES modules only.** Never write `<script src="../vendor/three.min.js">`.
- **Relative asset paths.** Put images, models, and fonts in `public/assets/`, reference them as
  `./assets/…`, and build with `--base ./` (the CLI does this for you).
- **Do not run `npm install` or `pnpm add` inside an artifact.** Everything is pinned already.
  If you truly need a package that is not bundled, say so and ask before installing it.
- **Dispose GPU resources.** Geometry, materials, textures, and renderers must be disposed and
  the animation loop stopped when the artifact is torn down.
- **WebGL failure must be readable.** Use `createStage` (it handles this) or show
  `createErrorOverlay` with a Chinese explanation instead of a blank screen.
- **Respect `prefers-reduced-motion`** for continuous animation, and always provide a pause.
- **Classroom readability first.** Projected at 1920×1080 and still usable at 1366×768.

## UI review

If the artifact is meant for classroom projection, also consult the bundled
`web-design-guidelines` skill for layout and contrast rules instead of inventing your own.

## Completion checklist

- [ ] `teacher-artifact build` exits 0 and produced `dist/index.html`.
- [ ] `teacher-artifact check` exits 0.
- [ ] `teacher-artifact preview` serves it locally.
- [ ] No CDN references, no `localhost` URLs, no absolute local paths in `dist/`.
- [ ] Controls are reachable by mouse and touch, with a visible reset.
- [ ] The teacher is told how to open it and what to try first.
