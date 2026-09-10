import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTemplates, log, readJson, resolveTemplatesRoot, run, warn } from './common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, '..');

export async function initArtifact(args) {
  const name = args.find((a) => !a.startsWith('-') && a !== 'init');
  const tIdx = args.indexOf('--template');
  const template = tIdx >= 0 ? args[tIdx + 1] : null;
  const skipInstall = args.includes('--skip-install');

  if (!name) throw new Error('Usage: teacher-artifact init <name> --template <template>');
  if (!template) throw new Error('Missing --template. Choose from: ' + listTemplates().join(', '));

  const templatesRoot = resolveTemplatesRoot();
  const templateDir = path.join(templatesRoot, template);
  const manifestFile = path.join(templateDir, 'template.json');
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`Unknown template "${template}". Available: ${listTemplates().join(', ')}`);
  }

  const projectDir = path.resolve(process.cwd(), name);
  if (fs.existsSync(projectDir)) {
    throw new Error(`Directory already exists: ${projectDir}`);
  }

  const manifest = readJson(manifestFile);
  log(`Initializing ${name} from template "${template}" (${manifest.description || ''})`);

  // 1. copy template files (except template.json)
  fs.mkdirSync(projectDir, { recursive: true });
  copyDir(templateDir, projectDir, (entry) => entry === 'template.json' || entry === 'package.json');
  fs.mkdirSync(path.join(projectDir, 'public', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'public', 'assets', '.gitkeep'), '');

  // 2. copy bundled artifact-sdk tarball for offline install
  const vendorTarball = path.join(CLI_ROOT, 'vendor', 'artifact-sdk.tgz');
  if (!fs.existsSync(vendorTarball)) {
    warn('vendor/artifact-sdk.tgz not found. Run scripts/build-toolchain.mjs first.');
  } else {
    const dot = path.join(projectDir, '.teacher');
    fs.mkdirSync(dot, { recursive: true });
    fs.copyFileSync(vendorTarball, path.join(dot, 'artifact-sdk.tgz'));
  }

  // 3. generate package.json from manifest
  const pkg = {
    name: sanitizeName(name),
    version: '0.1.0',
    private: true,
    type: 'module',
    teacherArtifact: true,
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview'
    },
    dependencies: {},
    devDependencies: {}
  };

  const deps = { ...(manifest.dependencies || {}) };
  if (manifest.useSdk) {
    deps['@teacher-dsh/artifact-sdk'] = fs.existsSync(vendorTarball)
      ? 'file:.teacher/artifact-sdk.tgz'
      : '0.1.0';
  }
  pkg.dependencies = deps;
  pkg.devDependencies = { ...(manifest.devDependencies || {}) };

  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  );

  // 4. offline-first install
  if (!skipInstall) {
    await installOfflineFirst(projectDir);
  } else {
    log('Skipped install (--skip-install). Run teacher-artifact build to install and build.');
  }

  log(`Artifact ready: ${projectDir}`);
  log('Next steps:');
  log('  cd ' + name);
  log('  teacher-artifact build');
  log('  teacher-artifact preview');
  return 0;
}

function sanitizeName(name) {
  const s = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) throw new Error(`Invalid artifact name: ${name}`);
  return s;
}

function copyDir(src, dest, skipEntry = () => false) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipEntry(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyDir(s, d, skipEntry);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

async function installOfflineFirst(projectDir) {
  const offline = process.env.TEACHER_DSH_OFFLINE === '1';
  const args = ['install', '--ignore-workspace', '--frozen-lockfile', '--trust-lockfile', '--reporter=append-only'];
  if (offline || !process.env.TEACHER_DSH_ALLOW_ONLINE) {
    args.push('--offline');
  }
  log('Running pnpm ' + args.join(' '));
  let status = run('pnpm', args, { cwd: projectDir });
  if (status !== 0 && !offline && process.env.TEACHER_DSH_ALLOW_ONLINE !== '0') {
    warn('Offline install failed. Falling back to online install (bundled store is preferred).');
    status = run('pnpm', ['install', '--ignore-workspace', '--frozen-lockfile', '--trust-lockfile', '--reporter=append-only'], { cwd: projectDir });
  }
  if (status !== 0) {
    throw new Error('pnpm install failed. Ensure the Teacher DSH offline store is seeded.');
  }
}