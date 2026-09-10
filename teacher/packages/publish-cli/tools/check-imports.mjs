#!/usr/bin/env node
/**
 * Import hygiene check — NOT part of the CLI.
 *
 * The bundled runtime has no install step, so the package must import only `node:` builtins and
 * relative modules. This fails loudly if anything else appears.
 *
 * Usage: node tools/check-imports.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const offenders = [];

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full);
      continue;
    }
    if (!/\.(mjs|js)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      offenders.push(`${path.relative(root, full)} -> ${specifier}`);
    }
  }
})(root);

if (offenders.length) {
  process.stdout.write('non-builtin imports found:\n' + offenders.join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('ok: every import is a node: builtin or a relative module\n');
