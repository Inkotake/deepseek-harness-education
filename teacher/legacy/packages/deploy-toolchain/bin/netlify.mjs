#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync('pnpm', ['exec', 'netlify', ...process.argv.slice(2)], { stdio: 'inherit', shell: true, cwd: pkgRoot });
process.exit(r.status ?? 1);