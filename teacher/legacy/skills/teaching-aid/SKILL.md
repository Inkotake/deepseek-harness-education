---
name: teaching-aid
description: Generate interactive teaching aids (interactive demos, simulations, 3D models, math explorers, physics experiments, charts, diagrams). Use when the user asks for a teaching artifact, demo, simulation, interactive model, visualization, or classroom tool. The skill initializes a Vite project from a template, writes source code, builds with teacher-artifact, checks, previews, and delivers dist/.
---

# Teaching Aid

## Goal

Turn a teacher's request into a self-contained, offline-capable interactive teaching artifact in `dist/`.

## Workflow

1. Classify the task.
2. Choose a template.
3. Initialize the project with `teacher-artifact init <name> --template <template>`.
4. Write source code in `<name>/src/main.js` and `<name>/src/style.css`.
5. Build with `teacher-artifact build` (from inside the project).
6. Check with `teacher-artifact check`.
7. Preview with `teacher-artifact preview` and fix issues.
8. Deliver the `dist/` directory.

## Technology selection

- 3D / space / models / geography / chemistry structure -> `three`
- Functions / geometry / coordinate systems -> `math`
- 2D mechanics / collision / gravity -> `physics-2d`
- Statistics / data / experiment charts -> `chart`
- Knowledge structure / process / relations -> `diagram`
- Simple interaction / classroom game / blank -> `classroom-game` or `basic`

Combinations are allowed (e.g. Three.js + KaTeX, JSXGraph + KaTeX, Matter.js + ECharts).

## Templates

```
templates/
├── basic/
├── three/
├── math/
├── physics-2d/
├── chart/
├── diagram/
└── classroom-game/
```

- `three`: Three.js + OrbitControls + lighting + renderer + camera + resize + animation loop
- `math`: JSXGraph + KaTeX + slider + formula panel
- `physics-2d`: Matter.js + canvas + reset + pause
- `chart`: ECharts
- `diagram`: Mermaid
- `classroom-game`: Artifact SDK UI kit game shell
- `basic`: empty teaching artifact with Teacher DSH toolbar

## Important engineering rules

- Never write `<script src="../vendor/three.min.js">`. Use ES modules: `import * as THREE from 'three';`
- Three.js addons come from `three/addons/*`:
  - `import { OrbitControls } from 'three/addons/controls/OrbitControls.js';`
  - `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';`
  - `import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';`
  - `import { Line2 } from 'three/addons/lines/Line2.js';`
- Use `@teacher-dsh/artifact-sdk` for common UI:
  - `createStage`, `createSlider`, `createPanel`, `createInfoCard`
  - `createFullscreenButton`, `createResetButton`, `createTeacherToolbar`
  - `renderKatex`, `createFormulaPanel`
- Do NOT run `npm install three` or `pnpm add` inside the artifact. The template already pins all dependencies. Run `teacher-artifact build` only.
- Do NOT use CDN scripts. The artifact must work offline.
- Use relative asset paths and keep assets in `public/assets/`.

## Teacher interaction standard (mandatory)

- 1920x1080 friendly, also works at 1366x768.
- Buttons >= 40px.
- Classroom font size >= 18px.
- Mouse and touch supported.
- No hover-only interaction.
- Every artifact has fullscreen and reset buttons (use `createTeacherToolbar`).

## Common recipes

### Three.js solar system

```js
import * as THREE from 'three';
import { createStage, createInfoCard } from '@teacher-dsh/artifact-sdk';
const stage = createStage({ mount: '#stage', cameraPosition: [0, 3, 8] });
// ... add sun, planets, use stage.onUpdate((t) => { ... })
```

### Math quadratic explorer

```js
import JXG from 'jsxgraph';
import { createSlider, renderKatex } from '@teacher-dsh/artifact-sdk';
const board = JXG.JSXGraph.initBoard('jxgbox', { boundingbox: [-10, 10, 10, -10], axis: true });
const curve = board.create('functiongraph', [x => a*x*x + b*x + c, -10, 10]);
```

### Matter.js physics

```js
import Matter from 'matter-js';
const { Engine, Runner, Bodies, Composite } = Matter;
// Engine.create({ gravity: { x: 0, y: 1 } })
```

### ECharts

```js
import * as echarts from 'echarts';
const chart = echarts.init(document.querySelector('#chart'));
```

### Mermaid

```js
import mermaid from 'mermaid';
mermaid.initialize({ startOnLoad: false });
const { svg } = await mermaid.render('id', code);
```

## Completion criteria

- `teacher-artifact build` exits 0.
- `teacher-artifact check` exits 0.
- Artifact runs from `teacher-artifact preview` with no console errors.
- `dist/` exists and contains `index.html`.