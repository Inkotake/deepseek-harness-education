---
name: data-visualization
description: Visualize data or statistics as ECharts charts or Mermaid diagrams for teaching. Use when the user provides data (scores, experiment results, tables) and wants charts, graphs, or diagrams.
---

# Data Visualization

## Goal

Turn teacher-provided data into clear, classroom-readable charts.

## Workflow

1. Parse the provided data (table, CSV, text).
2. Choose chart type:
   - comparison -> bar chart
   - trend -> line chart
   - proportion -> pie chart
   - distribution -> scatter or histogram
   - structure / process -> Mermaid
3. Initialize an artifact with `chart` or `diagram` template.
4. Write the chart code, build, check, preview.
5. Deliver `dist/`.

## Classroom readability rules

- Title >= 20px, axis labels >= 16px.
- High contrast colors; no hover-only tooltips (show key values as labels).
- Buttons and legend large enough for a projector.