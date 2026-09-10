// Windows x64 packaging script (MVP 0.1).
// Produces: Teacher DSH.exe layout described in README.
// Electron packaging is intentionally delegated to the official DSH Desktop build.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log('Teacher DSH 0.1 Windows package plan');
console.log('1. Build official DSH Desktop from upstream/deepseek-harness.');
console.log('2. Copy resources:');
console.log('   - resources/node/');
console.log('   - resources/pnpm/');
console.log('   - packages/artifact-cli (with vendor tarball)');
console.log('   - packages/artifact-sdk');
console.log('   - packages/ppt-kit');
console.log('   - packages/deploy-toolchain');
console.log('   - skills/ -> resources/teacher-skills/');
console.log('   - templates/ -> resources/templates/');
console.log('3. Set PATH for DSH child process to resources/node;resources/toolchain/bin;resources/pnpm.');
console.log('4. Bundle profile: teacher (see packages/teacher-bundle).');
console.log('5. Run tests/smoke/run-all.mjs before packaging.');