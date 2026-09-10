import path from 'node:path';
import fs from 'node:fs';
import { findProjectRoot, linkSharedNodeModules, log, resolveSharedNodeModules, runVite } from './common.mjs';

export async function buildArtifact(args) {
  const root = findProjectRoot();
  if (!root) throw new Error('Not inside a teacher-artifact project (missing teacherArtifact package.json).');

  const baseIdx = args.indexOf('--base');
  const base = baseIdx >= 0 ? args[baseIdx + 1] : './';
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'production';

  const nodeModules = path.join(root, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    if (resolveSharedNodeModules()) {
      log('Linking bundled Teacher DSH artifact toolchain.');
      linkSharedNodeModules(root);
    }
  }
  if (!fs.existsSync(path.join(nodeModules, 'vite'))) {
    throw new Error(
      'Vite is not available in this project. Reinstall Teacher DSH, or run "teacher-artifact install".'
    );
  }

  log('Building ' + root);
  const status = runVite(['build', '--base', base, '--mode', mode], { cwd: root });
  if (status !== 0) throw new Error('vite build failed');

  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('Build finished but dist/index.html was not produced.');
  }
  log('Built: ' + dist);
  return 0;
}
