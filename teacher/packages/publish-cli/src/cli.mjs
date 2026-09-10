import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const providersFile = path.join(root, 'teacher', 'manifests', 'providers.lock.json');

function loadProviders() {
  if (!fs.existsSync(providersFile)) {
    throw new Error(`Provider registry not found: ${providersFile}`);
  }
  return JSON.parse(fs.readFileSync(providersFile, 'utf8'));
}

function usage() {
  console.log(`
teacher-publish - Teacher DSH static publishing CLI

Usage:
  teacher-publish providers            List reviewed providers
  teacher-publish plan <dist>          Show the deployment plan (provider order, files)
  teacher-publish deploy <dist>        Deploy after explicit confirmation
`);
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === 'help') { usage(); return; }

  if (command === 'providers') {
    const registry = loadProviders();
    console.log('Reviewed providers (providers.lock.json):');
    for (const p of registry.candidates) {
      console.log(`  ${p.enabled ? '[enabled]' : '[disabled]'} ${p.id} (priority_cn=${p.priority_cn}, auth=${p.auth}) status=${p.status}`);
    }
    console.log('Tunnel fallback:', registry.tunnels_fallback.map(t => t.id).join(', '));
    return;
  }

  if (command === 'plan') {
    const dist = path.resolve(process.cwd(), args[0] || 'dist');
    const files = fs.existsSync(dist) ? fs.readdirSync(dist, { recursive: true, withFileTypes: true }).filter(f => f.isFile()).length : 0;
    console.log(`Deployment plan for ${dist} (${files} files)`);
    console.log('Providers ordered by priority_cn; existing provider configs are detected by the publish-static skill.');
    console.log('Deploy is never silent. Confirmation is required by the Skill.');
    return;
  }

  if (command === 'deploy') {
    console.log('Deployment adapters are pending CN provider tests. See teacher/manifests/providers.lock.json status field.');
    console.log('For 0.1.0, the publish-static skill orchestrates the selected provider CLI.');
    process.exitCode = 1;
    return;
  }

  usage();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });