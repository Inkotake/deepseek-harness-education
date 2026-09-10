// Syncs the canonical skills/ directory into packages/teacher-bundle/resources/teacher-skills.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'skills');
const dest = path.join(root, 'packages', 'teacher-bundle', 'resources', 'teacher-skills');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const skill of fs.readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const from = path.join(src, skill.name, 'SKILL.md');
  if (!fs.existsSync(from)) continue;
  const toDir = path.join(dest, skill.name);
  fs.mkdirSync(toDir, { recursive: true });
  fs.copyFileSync(from, path.join(toDir, 'SKILL.md'));
}
console.log('build-bundle: synced', fs.readdirSync(dest).length, 'skills to', dest);