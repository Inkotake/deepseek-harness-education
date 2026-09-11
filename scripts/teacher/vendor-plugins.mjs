// Vendors core community plugins into resources/teacher-seed/plugins for offline seeding.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const seedDir = path.join(root, 'resources', 'teacher-seed', 'plugins');
fs.mkdirSync(seedDir, { recursive: true });

const plugins = [
  { id: 'dsh-better-sidebar', repo: 'https://github.com/omdsh-dev/DSH-better-sidebar.git', license: 'MIT' },
  { id: 'dsh-cowork', repo: 'https://github.com/Jesse-njx/dsh-cowork.git', license: 'MIT' }
];

function git(args, cwd) {
  return execFileSync('git', ['-c', 'http.proxy=', '-c', 'https.proxy=', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

for (const p of plugins) {
  const dest = path.join(seedDir, p.id);
  const sourceFile = path.join(dest, 'SOURCE.json');
  console.log(`\n=== vendoring plugin ${p.id} ===`);
  if (fs.existsSync(sourceFile)) {
    const meta = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
    console.log(`already vendored at ${meta.commit}`);
    continue;
  }
  git(['clone', '--depth', '1', p.repo, dest], seedDir);
  const head = git(['rev-parse', 'HEAD'], dest);
  fs.writeFileSync(sourceFile, JSON.stringify({ id: p.id, repo: p.repo, commit: head, license: p.license }, null, 2) + '\n');
  console.log(`${p.id} HEAD ${head}`);
}