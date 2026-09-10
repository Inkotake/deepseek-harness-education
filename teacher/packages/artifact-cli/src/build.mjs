import path from 'node:path';
import fs from 'node:fs';
import { findProjectRoot, log, run } from './common.mjs';

export async function buildArtifact(args) {
  const root = findProjectRoot();
  if (!root) throw new Error('Not inside a teacher-artifact project (missing teacherArtifact package.json).');

  const baseIdx = args.indexOf('--base');
  const base = baseIdx >= 0 ? args[baseIdx + 1] : './';

  const viteArgs = ['exec', 'vite', 'build', '--base', base];
  log('Building ' + root);
  const status = run('pnpm', viteArgs, { cwd: root });
  if (status !== 0) throw new Error('vite build failed');

  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('Build finished but dist/index.html was not produced.');
  }
  log('Built: ' + dist);
  return 0;
}