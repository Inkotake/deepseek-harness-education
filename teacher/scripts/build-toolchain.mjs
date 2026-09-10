// Packs @teacher-dsh/artifact-sdk into teacher/packages/artifact-cli/vendor/artifact-sdk.tgz
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkDir = path.join(root, 'packages', 'artifact-sdk');
const vendorDir = path.join(root, 'packages', 'artifact-cli', 'vendor');
const dest = path.join(vendorDir, 'artifact-sdk.tgz');

fs.mkdirSync(vendorDir, { recursive: true });
console.log('Packing @teacher-dsh/artifact-sdk ...');
const r = spawnSync('pnpm', ['pack', '--pack-destination', vendorDir], { cwd: sdkDir, shell: true, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
const files = fs.readdirSync(vendorDir).filter((f) => f.startsWith('teacher-dsh-artifact-sdk-'));
if (files.length !== 1) {
  console.error('Expected exactly one packed tarball, found:', files);
  process.exit(1);
}
if (fs.existsSync(dest)) fs.unlinkSync(dest);
fs.renameSync(path.join(vendorDir, files[0]), dest);
console.log('Wrote', dest);