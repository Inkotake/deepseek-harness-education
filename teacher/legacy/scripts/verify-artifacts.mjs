import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'packages', 'artifact-cli', 'bin', 'teacher-artifact.mjs');
const work = path.join(root, 'tests', 'artifacts');

fs.mkdirSync(work, { recursive: true });
const errors = [];

for (const template of ['basic', 'three']) {
  const name = `verify-${template}`;
  const project = path.join(work, name);
  fs.rmSync(project, { recursive: true, force: true });

  let r = spawnSync('node', [cli, 'init', name, '--template', template], { cwd: work, shell: true, stdio: 'inherit' });
  if (r.status !== 0) { errors.push(`${template}: init failed`); continue; }

  r = spawnSync('node', [cli, 'build'], { cwd: project, shell: true, stdio: 'inherit' });
  if (r.status !== 0) { errors.push(`${template}: build failed`); continue; }

  r = spawnSync('node', [cli, 'check'], { cwd: project, shell: true, stdio: 'inherit' });
  if (r.status !== 0) { errors.push(`${template}: check failed`); continue; }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('verify-artifacts: OK');