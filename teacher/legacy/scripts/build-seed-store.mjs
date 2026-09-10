// Seeds the pnpm store with all packages required by templates and SDK.
// Run before packaging the offline distribution.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log('Seeding pnpm store from workspace install...');
const r = spawnSync('pnpm', ['install', '--filter', '@teacher-dsh/artifact-cli', '--filter', '@teacher-dsh/artifact-sdk', '--filter', '@teacher-dsh/ppt-kit'], {
  cwd: root,
  shell: true,
  stdio: 'inherit'
});
process.exit(r.status ?? 1);