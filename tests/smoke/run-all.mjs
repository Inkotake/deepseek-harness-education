// Teacher DSH artifact smoke tests (final layer: teacher/packages/artifact-cli).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = path.join(root, 'teacher', 'packages', 'artifact-cli', 'bin', 'teacher-artifact.mjs');
const sdkTarball = path.join(root, 'teacher', 'packages', 'artifact-cli', 'vendor', 'artifact-sdk.tgz');
const buildToolchain = path.join(root, 'teacher', 'scripts', 'build-toolchain.mjs');

if (!fs.existsSync(sdkTarball)) {
  console.log('SDK tarball missing; building it first.');
  const r = spawnSync('node', [buildToolchain], { cwd: root, shell: true, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsh-smoke-'));
const cases = [
  { name: 'three', task: 'Three.js 3D teaching artifact' },
  { name: 'math', task: 'JSXGraph + KaTeX math artifact' },
  { name: 'physics-2d', task: 'Matter.js physics artifact' },
  { name: 'chart', task: 'ECharts chart artifact' },
  { name: 'diagram', task: 'Mermaid diagram artifact' }
];
const failed = [];

for (const c of cases) {
  console.log(`\n=== smoke: ${c.name} (${c.task}) ===`);
  const project = path.join(work, `smoke-${c.name}`);
  let r = spawnSync('node', [cli, 'init', `smoke-${c.name}`, '--template', c.name], { cwd: work, shell: true, stdio: 'inherit' });
  if (r.status !== 0) { failed.push(`${c.name}: init failed`); continue; }
  r = spawnSync('node', [cli, 'build'], { cwd: project, shell: true, stdio: 'inherit' });
  if (r.status !== 0) { failed.push(`${c.name}: build failed`); continue; }
  r = spawnSync('node', [cli, 'check'], { cwd: project, shell: true, stdio: 'inherit' });
  if (r.status !== 0) { failed.push(`${c.name}: check failed`); continue; }
  if (!fs.existsSync(path.join(project, 'dist', 'index.html'))) failed.push(`${c.name}: dist/index.html missing`);
}

fs.rmSync(work, { recursive: true, force: true });
if (failed.length) {
  console.error('\nSmoke failures:\n' + failed.join('\n'));
  process.exit(1);
}
console.log('\nAll teacher artifact smoke tests passed.');