# PPTKit authoring boundary

Use the bundled runtime for ordinary decks. Extend it only when a requested behavior cannot be expressed by the existing `SlidePlan` contract.

## Public imports

```ts
import {
  createPresentation,
  normalizePresentation,
  validatePresentation,
} from "@pptkit/core";
import { writePptx } from "@pptkit/pptx-exporter/node";
```

Never import package `dist` files or private source paths.

## Supported native elements

- Rich text boxes and shape text
- Images registered as assets with optional source dimensions
- Rectangles, rounded rectangles, ellipses, triangles, diamonds, arrows, and chevrons
- Connectors with editable strokes and arrows
- Groups and native editable tables
- Native data-bound bar, line, and pie charts
- Themes, layouts, placeholders, notes, actions, metadata, and accessibility

## Chart IR v2

PPTKit normalizes charts as IR v2. Bar charts support vertical or horizontal orientation plus clustered, stacked, and percent-stacked grouping. Cartesian charts support category/value axis visibility, labels, and automatic or fixed value scales. Line charts support automatic, hidden, or shape-selected markers. Pie charts require one non-negative series and use theme-derived point colors. Keep chart area, plot area, text, axes, gridlines, and series styling theme-driven in `presentation-workflow`; do not expose raw paint or stroke objects in `ChartPlan`.

## Known limits

- No PPTX parser or existing-template fill
- No browser/SVG preview renderer
- No SmartArt authoring
- No environment-backed text measurement, automatic pagination, or general constraint solver
- No animation, audio, or video authoring

Use the starter's deterministic grids and conservative density rules instead of hiding these limits. Put reusable presentation recipes inside the skill runtime, not inside Core.
