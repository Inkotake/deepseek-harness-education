import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CLI_ROOT = path.resolve(__dirname, '..');

export function log(msg) {
  process.stdout.write(msg + '\n');
}

export function warn(msg) {
  process.stderr.write('[teacher-artifact] WARN ' + msg + '\n');
}

export function error(msg) {
  process.stderr.write('[teacher-artifact] ERROR ' + msg + '\n');
}

function firstDirectory(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.statSync(candidate).isDirectory()) return path.resolve(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Bundled templates. In a Teacher DSH installation this is
 * `<resources>/teacher-runtime/artifact/templates`, exported as TEACHER_TEMPLATES_HOME.
 */
export function resolveTemplatesRoot() {
  const root = firstDirectory([
    process.env.TEACHER_DSH_TEMPLATES,
    process.env.TEACHER_TEMPLATES_HOME,
    process.env.TEACHER_ARTIFACT_HOME && path.join(process.env.TEACHER_ARTIFACT_HOME, 'templates'),
    path.join(CLI_ROOT, 'templates'),
    path.join(CLI_ROOT, '..', '..', 'templates'),
    path.join(CLI_ROOT, '..', '..', 'artifact', 'templates')
  ]);
  if (!root) {
    throw new Error(
      'Cannot locate the Teacher DSH template directory. Set TEACHER_TEMPLATES_HOME or TEACHER_DSH_TEMPLATES.'
    );
  }
  return root;
}

/**
 * Shared, pre-installed artifact dependency tree. Artifact projects link to it instead of
 * downloading anything, which is what makes `teacher-artifact init` work with no network.
 */
export function resolveSharedNodeModules() {
  return firstDirectory([
    process.env.TEACHER_ARTIFACT_HOME && path.join(process.env.TEACHER_ARTIFACT_HOME, 'node_modules'),
    path.join(CLI_ROOT, '..', '..', 'artifact', 'node_modules')
  ]);
}

/** Bundled Vite entry point, or null when the shared tree is unavailable. */
export function resolveViteEntry() {
  const shared = resolveSharedNodeModules();
  if (!shared) return null;
  const entry = path.join(shared, 'vite', 'bin', 'vite.js');
  return fs.existsSync(entry) ? entry : null;
}

export function listTemplates() {
  const root = resolveTemplatesRoot();
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(root, name, 'index.html')))
    .sort();
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const json = readJson(pkg);
        if (json.teacherArtifact) return dir;
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Link the shared bundled dependency tree into a project directory.
 * Windows directory junctions need no elevation and cost no disk space.
 */
export function linkSharedNodeModules(projectDir) {
  const shared = resolveSharedNodeModules();
  if (!shared) return false;
  const target = path.join(projectDir, 'node_modules');
  if (fs.existsSync(target)) return true;
  try {
    fs.symlinkSync(shared, target, 'junction');
    return true;
  } catch (cause) {
    warn(`Could not link bundled dependencies (${cause.message}); falling back to a package install.`);
    return false;
  }
}

export function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: options.stdio || 'inherit',
    shell: options.shell ?? false,
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) }
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** Run the bundled Vite through the bundled Node.js. */
export function runVite(viteArgs, options = {}) {
  const entry = resolveViteEntry();
  if (!entry) {
    throw new Error('Bundled Vite was not found. Reinstall Teacher DSH or run teacher-artifact install.');
  }
  return run(process.execPath, [entry, ...viteArgs], options);
}
