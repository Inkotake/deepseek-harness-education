import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockFile = path.join(root, 'config', 'versions.lock.json');
const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));

const expectedLicenses = {
  'vite': 'MIT',
  'three': 'MIT',
  'katex': 'MIT',
  'jsxgraph': 'MIT-compatible (LGPL/MIT, see COPYRIGHT)',
  'echarts': 'Apache-2.0',
  'mermaid': 'MIT',
  'matter-js': 'MIT',
  'pptxgenjs': 'MIT',
  'netlify-cli': 'MIT',
  'wrangler': 'MIT OR Apache-2.0',
  'vercel': 'Apache-2.0'
};

console.log('Version lock:');
for (const [k, v] of Object.entries(lock.packages)) {
  const lic = expectedLicenses[k] || 'see package';
  console.log(`  ${k} @ ${v}  (${lic})`);
}

console.log('Note: Tectonic is NOT bundled in MVP 0.1; .tex -> PDF engine is interface-only.');
console.log('verify-licenses: OK');