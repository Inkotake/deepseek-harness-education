// Generates a pinned pnpm-lock.yaml for every template by running the exact
// init flow with --skip-install and then installing online. The resulting
// lockfiles make offline teacher-artifact init reproducible.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'packages', 'artifact-cli', 'bin', 'teacher-artifact.mjs');
const templatesRoot = path.join(root, 'templates');
const templates = fs.readdirSync(templatesRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(templatesRoot, d.name, 'template.json')))
  .map((d) => d.name);

const failed = [];
for (const template of templates) {
  console.log(`\n=== template: ${template} ===`);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsh-lock-'));
  const name = `lock-${template}`;
  let r = spawnSync('node', [cli, 'init', name, '--template', template, '--skip-install'], {
    cwd: tmpRoot, shell: true, stdio: 'inherit'
  });
  if (r.status !== 0) { failed.push(`${template}: init failed`); fs.rmSync(tmpRoot, { recursive: true, force: true }); continue; }

  const project = path.join(tmpRoot, name);
  r = spawnSync('pnpm', ['install', '--ignore-workspace', '--reporter=append-only'], {
    cwd: project, shell: true, stdio: 'inherit'
  });
  if (r.status !== 0) { failed.push(`${template}: install failed`); fs.rmSync(tmpRoot, { recursive: true, force: true }); continue; }

  const lock = path.join(project, 'pnpm-lock.yaml');
  const dest = path.join(templatesRoot, template, 'pnpm-lock.yaml');
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.copyFileSync(lock, dest);
  console.log('Wrote', dest);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

if (failed.length) {
  console.error('Failures:\n' + failed.join('\n'));
  process.exit(1);
}
console.log('\nAll template lockfiles generated.');