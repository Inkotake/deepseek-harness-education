// Syncs the official deepseek-harness repo into upstream/ and records the pinned commit.
// MVP 0.1: repository is fetched manually or by CI; this script is a placeholder that
// records the current ref when upstream/deepseek-harness exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = path.join(root, 'upstream', 'deepseek-harness');
const lockFile = path.join(root, 'config', 'versions.lock.json');
const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));

if (!fs.existsSync(upstream)) {
  console.log(`upstream/deepseek-harness not present. Run:
  git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git upstream/deepseek-harness`);
  process.exit(0);
}

lock.dsh.repo = 'https://github.com/deepseek-ai/deepseek-harness';
lock.dsh.ref = fs.readFileSync(path.join(upstream, '.git', 'HEAD'), 'utf8').trim();
fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
console.log('Recorded upstream ref:', lock.dsh.ref);