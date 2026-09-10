import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot, log, run } from './common.mjs';

export async function packArtifact(args) {
  const root = findProjectRoot();
  if (!root) throw new Error('Not inside a teacher-artifact project.');
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('dist/index.html not found. Run teacher-artifact build first.');
  }

  const nameIdx = args.indexOf('--name');
  const zipName = nameIdx >= 0 ? args[nameIdx + 1] : path.basename(root) + '-dist.zip';
  const zipPath = path.resolve(root, zipName.endsWith('.zip') ? zipName : zipName + '.zip');

  const ps = `$ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path '${dist}\\*' -DestinationPath '${zipPath}' -Force`;
  const status = run('powershell', ['-NoProfile', '-Command', ps], { cwd: root });
  if (status !== 0) throw new Error('zip failed');
  log('Packed: ' + zipPath + ' (' + (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2) + ' MB)');
  return 0;
}