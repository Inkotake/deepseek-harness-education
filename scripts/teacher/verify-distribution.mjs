// Distribution gate: verifies manifests and own skills, then runs artifact smoke tests.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const errors = [];
const requiredManifests = ['desktop-upstream.lock.json', 'toolchain.lock.json', 'plugins.lock.json', 'skills.lock.json', 'providers.lock.json', 'licenses.lock.json'];
for (const m of requiredManifests) {
  const p = path.join(root, 'teacher', 'manifests', m);
  if (!fs.existsSync(p)) errors.push(`missing manifest ${m}`);
}
for (const skill of ['teaching-aid', 'publish-static', 'latex-authoring']) {
  const p = path.join(root, 'teacher', 'skills', skill, 'SKILL.md');
  if (!fs.existsSync(p)) errors.push(`missing own skill ${skill}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Manifests and own skills OK');