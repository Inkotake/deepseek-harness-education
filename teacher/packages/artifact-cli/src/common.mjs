import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CLI_ROOT = path.resolve(__dirname, '..');

export function log(msg) {
  process.stdout.write(msg + '\n');
}

export function warn(msg) {
  process.stderr.write('[teacher-artifact] WARN ' + msg + '\n');
}

export function error(msg) {
  process.stderr.write('[teacher-artifact] ERROR ' + msg + '\n');
}

export function resolveTemplatesRoot() {
  const candidates = [
    process.env.TEACHER_DSH_TEMPLATES,
    path.join(CLI_ROOT, 'templates'),
    path.join(CLI_ROOT, '..', '..', 'templates')
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
  }
  throw new Error('Cannot locate templates directory. Set TEACHER_DSH_TEMPLATES.');
}

export function listTemplates() {
  const root = resolveTemplatesRoot();
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'template.json')))
    .map((d) => d.name);
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const json = readJson(pkg);
        if (json.teacherArtifact) return dir;
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: options.stdio || 'inherit',
    shell: true,
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) }
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}