// Windows x64 packaging orchestrator for Teacher DSH 0.1.0.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
console.log('Teacher DSH 0.1.0 Windows package plan');
console.log('1. yarn install --immutable (desktop workspace, Yarn 4.18.0)');
console.log('2. yarn workspace dsh-plugin-desktop package:win');
console.log('3. Verify output artifacts: Teacher-DSH-0.1.0-x64-Setup.exe');
console.log('4. resources/teacher-seed is bundled into the Desktop build by scripts/teacher/build-offline-store.mjs');
console.log('5. Run tests/clean-machine on a Windows VM without Node/pnpm/Git.');