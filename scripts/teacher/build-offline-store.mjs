// Seeds the teacher layer pnpm store for offline artifact init.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const teacher = path.join(root, 'teacher');

function run(cmd, args, cwd) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: true });
}

run('pnpm', ['install', '--filter', '@teacher-dsh/artifact-cli', '--filter', '@teacher-dsh/artifact-sdk'], teacher);
console.log('Offline store seeded.');