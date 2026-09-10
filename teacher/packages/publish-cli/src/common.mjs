import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function log(msg) {
  process.stdout.write(msg + '\n');
}

export function err(msg) {
  process.stderr.write('[teacher-publish] ' + msg + '\n');
}

export function findStaticDir(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    for (const name of ['dist', 'build', 'public']) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: options.stdio || 'inherit',
    shell: true,
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) }
  });
  if (result.error) throw result.error;
  if (options.capture) {
    return { status: result.status ?? 1, stdout: (result.stdout ?? '').toString(), stderr: (result.stderr ?? '').toString() };
  }
  return result.status ?? 1;
}