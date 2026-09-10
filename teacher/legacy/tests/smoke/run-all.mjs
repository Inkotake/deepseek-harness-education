import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = path.join(root, 'packages', 'artifact-cli', 'bin', 'teacher-artifact.mjs');
const work = path.join(root, 'tests', 'smoke', 'tmp');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const cases = [
  { name: 'three', task: 'Three.js 3D teaching artifact smoke test' },
  { name: 'math', task: 'JSXGraph + KaTeX math artifact smoke test' },
  { name: 'physics-2d', task: 'Matter.js physics artifact smoke test' },
  { name: 'chart', task: 'ECharts chart artifact smoke test' },
  { name: 'diagram', task: 'Mermaid diagram artifact smoke test' }
];

const failed = [];

for (const c of cases) {
  console.log(`\n=== smoke: ${c.name} (${c.task}) ===`);
  const project = path.join(work, `smoke-${c.name}`);
  fs.rmSync(project, { recursive: true, force: true });

  let r = spawnSync('node', [cli, 'init', `smoke-${c.name}`, '--template', c.name], { cwd: work, shell: true, stdio: 'inherit' });
  if (r.status !== 0) { failed.push(`${c.name}: init failed`); continue; }

  r = spawnSync('node', [cli, 'build'], { cwd: project, shell: true, stdio: 'inherit' });
  if (r.status !== 0) { failed.push(`${c.name}: build failed`); continue; }

  r = spawnSync('node', [cli, 'check'], { cwd: project, shell: true, stdio: 'inherit' });
  if (r.status !== 0) { failed.push(`${c.name}: check failed`); continue; }

  const distIndex = path.join(project, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) { failed.push(`${c.name}: dist/index.html missing`); }
}

if (failed.length) {
  console.error('\nSmoke failures:\n' + failed.join('\n'));
  process.exit(1);
}
console.log('\nAll smoke tests passed.');