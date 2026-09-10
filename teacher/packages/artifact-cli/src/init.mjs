import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  linkSharedNodeModules,
  listTemplates,
  log,
  readJson,
  resolveSharedNodeModules,
  resolveTemplatesRoot,
  run,
  warn
} from './common.mjs';

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
  if (!fs.existsSync(templateDir) || !fs.existsSync(path.join(templateDir, 'index.html'))) {
    throw new Error(`Unknown template "${template}". Available: ${listTemplates().join(', ')}`);
  }
  const manifest = fs.existsSync(manifestFile) ? readJson(manifestFile) : { description: template };

  const projectDir = path.resolve(process.cwd(), name);
  if (fs.existsSync(projectDir)) {
    throw new Error(`Directory already exists: ${projectDir}`);
  }

  log(`Initializing ${name} from template "${template}" (${manifest.description || ''})`);

  // 1. copy template files
  fs.mkdirSync(projectDir, { recursive: true });
  copyDir(templateDir, projectDir, (entry) => entry === 'template.json');
  fs.mkdirSync(path.join(projectDir, 'public', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'public', 'assets', '.gitkeep'), '');

  // 2. keep the SDK tarball next to the project so the manifest stays truthful
  const vendorTarball = path.join(CLI_ROOT, 'vendor', 'artifact-sdk.tgz');
  if (!fs.existsSync(vendorTarball)) {
    warn('vendor/artifact-sdk.tgz not found. Run scripts/build-toolchain.mjs first.');
  } else {
    const dot = path.join(projectDir, '.teacher');
    fs.mkdirSync(dot, { recursive: true });
    fs.copyFileSync(vendorTarball, path.join(dot, 'artifact-sdk.tgz'));
  }

  // 3. generate package.json from the template manifest
  const deps = { ...(manifest.dependencies || {}) };
  if (manifest.useSdk !== false) {
    deps['@teacher-dsh/artifact-sdk'] = fs.existsSync(vendorTarball)
      ? 'file:.teacher/artifact-sdk.tgz'
      : '0.1.0';
  }
  const pkg = {
    name: sanitizeName(name),
    version: '0.1.0',
    private: true,
    type: 'module',
    teacherArtifact: true,
    template,
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview'
    },
    dependencies: deps,
    devDependencies: { ...(manifest.devDependencies || {}) }
  };
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // 4. dependencies: link the bundled tree (zero network, zero copy) or install
  if (skipInstall) {
    log('Skipped dependency install (--skip-install). Run teacher-artifact install to link them.');
  } else if (resolveSharedNodeModules() && linkSharedNodeModules(projectDir)) {
    log('Linked bundled Teacher DSH artifact toolchain (offline).');
  } else {
    await installDependencies(projectDir);
  }

  log(`Artifact ready: ${projectDir}`);
  log('Next steps:');
  log('  cd ' + name);
  log('  teacher-artifact build');
  log('  teacher-artifact preview --open');
  return 0;
}

/** Install this project's declared dependencies with the bundled pnpm. */
export async function installDependencies(projectDir) {
  const offline = process.env.TEACHER_DSH_OFFLINE === '1';
  const args = ['install', '--ignore-workspace', '--reporter=append-only'];
  if (offline) args.push('--offline');
  log('Running pnpm ' + args.join(' '));
  let status = run('pnpm', args, { cwd: projectDir });
  if (status !== 0 && !offline) {
    warn('Dependency install failed. Check the network connection or reinstall Teacher DSH.');
  }
  if (status !== 0) {
    throw new Error('pnpm install failed. Ensure the Teacher DSH runtime is complete.');
  }
  return status;
}

export function sanitizeName(name) {
  const s = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) throw new Error(`Invalid artifact name: ${name}`);
  return s;
}

export function copyDir(src, dest, skipEntry = () => false) {
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

export { listTemplates };
