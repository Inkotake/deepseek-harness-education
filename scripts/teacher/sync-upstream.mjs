// Writes teacher/manifests/desktop-upstream.lock.json from the current git tree.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lockFile = path.join(root, 'teacher', 'manifests', 'desktop-upstream.lock.json');

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const lock = {
  name: 'desktop-upstream.lock',
  version: '0.1.0',
  desktop: {
    repo: 'https://github.com/anywhere-labs/dsh-desktop',
    tag: null,
    commit: git(['rev-parse', 'HEAD'])
  },
  harness: {
    repo: 'https://github.com/deepseek-ai/deepseek-harness',
    pinned_by_desktop: true,
    version: null
  },
  policy: 'Upgrade only through PR + tests; never follow master/latest automatically.'
};

try { lock.desktop.tag = git(['describe', '--tags', '--exact-match', 'HEAD']); } catch { lock.desktop.tag = null; }
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const harnessKey = Object.keys(pkg.resolutions || {}).find((k) => k.startsWith('@deepseek-ai/dsh-brand'));
lock.harness.version = harnessKey ? (harnessKey.match(/npm:([^" ]+)/)?.[1] ?? null) : null;

fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
console.log('Wrote', lockFile);
console.log(JSON.stringify(lock, null, 2));