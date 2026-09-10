# Third-Party Notices — Teacher DSH 0.1.0

Teacher DSH is built on upstream projects. Key components and their licenses:

| Component | License | Source |
|---|---|---|
| DeepSeek Harness | MIT | deepseek-ai/deepseek-harness |
| anywhere-labs DSH Desktop | MIT | anywhere-labs/dsh-desktop |
| Three.js | MIT | mrdoob/three.js |
| Vite | MIT | vitejs/vite |
| KaTeX | MIT | KaTeX/KaTeX |
| JSXGraph | MIT-compatible (see COPYRIGHT) | jsxgraph/jsxgraph |
| ECharts | Apache-2.0 | apache/echarts |
| Mermaid | MIT | mermaid-js/mermaid |
| Matter.js | MIT | liabru/matter-js |
| PptxGenJS | MIT | gitbrent/PptxGenJS |
| PPTKit Presentation | MIT | openHacking/pptkit-presentation |
| DSH Cowork | MIT | Jesse-njx/dsh-cowork |
| DSH Better Sidebar | MIT | omdsh-dev/DSH-better-sidebar |
| Vercel Agent Skills | MIT | vercel-labs/agent-skills |
| Education Agent Skills | CC BY-SA 4.0 | GarethManning/education-agent-skills |

## Education Agent Skills notice

The 7 vendored education skills are from Gareth Manning's
`education-agent-skills` repository and are licensed under CC BY-SA 4.0.
They are vendored **unmodified** in:

`teacher/vendor-skills/education-agent-skills/`

See `teacher/vendor-skills/education-agent-skills/SOURCE.json` for the
pinned commit and source URLs. CC BY-SA 4.0 requires attribution and that
modified versions remain under the same license.

## Tectonic

Tectonic is NOT bundled in Teacher DSH 0.1.0. The `teacher-latex build`
command validates `.tex` structure only; it does not compile PDF.