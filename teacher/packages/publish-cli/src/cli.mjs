#!/usr/bin/env node
/**
 * teacher-publish - Teacher DSH static publishing CLI.
 *
 * Commands: detect, inspect, plan, deploy, verify, providers, tunnel.
 *
 * Output contract: with `--json`, stdout carries exactly one JSON document and every diagnostic
 * goes to stderr, so a caller can pipe stdout straight into a JSON parser. Exit code 0 on
 * success, non-zero on failure.
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  emitJson,
  error,
  formatBytes,
  httpRequest,
  log,
  textOf,
  trace,
  warn
} from './common.mjs';
import {
  buildManifest,
  discoverArtifacts,
  inspectArtifact,
  printInspect,
  resolveArtifact,
  summarizeInspect
} from './inspect.mjs';
import { loadRegistry } from './registry.mjs';
import { buildProjectContext, planProviders, printPlan, summarizePlan } from './planner.mjs';
import { loadHealth, mergedHealth, summaryHealth } from './health.mjs';
import { DEFAULT_MODE, MODES, deployArtifact, detectTunnelTools, printDeployResult, summarizeDeploy } from './deploy.mjs';
import { verifyDeployment } from './verify.mjs';
import { adapterAvailability } from './providers/index.mjs';

/* -------------------------------------------------------------------- args ---- */

const BOOLEAN_FLAGS = new Set(['json', 'help', 'auto', 'dry-run', 'no-verify', 'verbose', 'cn', 'yes', 'allow-inexact']);
const VALUE_FLAGS = new Set(['mode', 'provider', 'port', 'timeout']);

export function parseArgs(argv) {
  const options = { positional: [], mode: DEFAULT_MODE, provider: null, port: null, timeout: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      options.positional.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const equals = body.indexOf('=');
      const name = equals === -1 ? body : body.slice(0, equals);
      const inlineValue = equals === -1 ? null : body.slice(equals + 1);
      if (BOOLEAN_FLAGS.has(name)) {
        setFlag(options, name, inlineValue === null ? true : inlineValue !== 'false');
        continue;
      }
      if (VALUE_FLAGS.has(name)) {
        const value = inlineValue !== null ? inlineValue : argv[index + 1];
        if (value === undefined) throw new UsageError(`--${name} requires a value`);
        if (inlineValue === null) index += 1;
        setFlag(options, name, value);
        continue;
      }
      throw new UsageError(`unknown option --${name}`);
    }
    if (token.startsWith('-') && token.length > 1) {
      throw new UsageError(`unknown option ${token}`);
    }
    options.positional.push(token);
  }
  if (!MODES.includes(options.mode)) {
    throw new UsageError(`--mode must be one of ${MODES.join(', ')} (got ${options.mode})`);
  }
  if (options.port !== null) {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError('--port must be an integer between 1 and 65535');
    options.port = port;
  }
  return options;
}

function setFlag(options, name, value) {
  const key = name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  options[key] = value;
}

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/* ------------------------------------------------------------------- usage ---- */

export const USAGE = `teacher-publish - Teacher DSH static publishing CLI

Usage:
  teacher-publish detect [dir]
  teacher-publish inspect [dir] [--json]
  teacher-publish plan [dir] --mode <quick-share|persistent|tunnel> [--json]
  teacher-publish deploy [dir] --mode <mode> [--json] [--auto] [--provider <id>] [--dry-run]
  teacher-publish verify <url> [dir] [--json]
  teacher-publish providers [--json]
  teacher-publish tunnel detect [--json]
  teacher-publish tunnel start --port <n> [--auto] [--json]

Modes:
  quick-share (default)  anonymous temporary host; failover allowed between compatible hosts
  persistent             account-owned durable host; never downgraded to a temporary host
  tunnel                 session-only exposure through a local tunnel CLI when one is installed

Options:
  --json        print exactly one JSON document on stdout (diagnostics go to stderr)
  --auto        do not prompt for confirmation
  --provider    restrict a deploy to one provider id
  --dry-run     show the order without contacting any provider
  --no-verify   skip remote verification (a deployment is then never reported as verified)
  --allow-inexact
                also consider providers whose HTML the service rewrites (ShipStatic, here.now,
                aft.page). Those hosts are excluded by default because their HTML can never pass a
                byte comparison; with this flag the HTML is presence-checked and every other
                resource is still SHA-256 compared. Success still requires verification to pass.

Nothing is uploaded until the safety scan is clean. An HTTP 2xx from an upload is only a
candidate success: deploy reports success only after remote SHA-256 verification passes.
`;

/* ------------------------------------------------------------------ context ---- */

function resolveDir(positional) {
  const candidate = positional[0] ? path.resolve(process.cwd(), positional[0]) : process.cwd();
  const { artifact, searched } = resolveArtifact(candidate, { maxDepth: 3 });
  return { requested: candidate, artifact, searched };
}

function requireArtifact(positional, options) {
  const { requested, artifact, searched } = resolveDir(positional);
  if (!artifact) {
    throw new Failure(`no static artifact found at or below ${searched} (looking for a directory containing index.html)`, 3);
  }
  if (options.verbose) trace(`artifact: ${artifact.dir} (found via ${artifact.relative})`);
  return { requested, artifact };
}

function runInspection(dir) {
  const result = inspectArtifact(dir);
  if (!result.ok) throw new Failure(result.error, 3);
  return result;
}

export class Failure extends Error {
  constructor(message, exitCode = 1, detail = null) {
    super(message);
    this.name = 'Failure';
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

/* --------------------------------------------------------------- providers ---- */

export function providersReport(options = {}) {
  const env = options.env || process.env;
  const registry = loadRegistry({ env });
  const health = loadHealth(env);
  const includeHealth = options.includeHealth !== false;
  if (!registry.ok) {
    return {
      ok: false,
      error: registry.error,
      problems: registry.problems || [],
      registryFile: registry.registryFile || null,
      registry: null,
      providers: []
    };
  }
  const providers = registry.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    adapter: provider.adapter,
    enabled: provider.enabled === true,
    disabledReason: provider.disabledReason || null,
    modes: provider.modes,
    endpoint: provider.endpoint,
    protocol: provider.protocol,
    protocolNotes: provider.protocolNotes || null,
    transport: provider.transport,
    allowedHosts: provider.allowedHosts,
    priority: provider.priority,
    cnPriority: provider.cnPriority,
    persistence: provider.persistent ? 'persistent' : 'temporary',
    availability: provider.availability || null,
    cli: provider.cli || null,
    hasAdapter: adapterAvailability(provider),
    capabilities: provider.capabilities,
    claim: provider.claim || null,
    health: includeHealth ? mergedHealth(registry, health.state, provider.id) : provider.health
  }));

  return {
    ok: true,
    registryFile: registry.registryFile,
    registryVersion: registry.version,
    updatedAt: registry.updatedAt,
    overlay: registry.overlay,
    warnings: registry.warnings,
    healthFile: health.file,
    health: includeHealth ? summaryHealth(health.state) : null,
    providers,
    modes: MODES
  };
}

function printProviders(report) {
  log('Provider registry: ' + (report.registryFile || '(not found)'));
  if (report.overlay && report.overlay.file) log(`Overlay: ${report.overlay.file}`);
  log('');
  log('id                 enabled  modes        persistence  cn    health');
  for (const provider of report.providers) {
    const state = provider.health && provider.health.circuitOpen ? `circuit open until ${provider.health.openUntil}` : (provider.health ? provider.health.state : 'unknown');
    log(`${provider.id.padEnd(18)} ${(provider.enabled ? 'yes' : 'no').padEnd(8)} ${provider.modes.join(',').padEnd(12)} ${provider.persistence.padEnd(12)} ${String(provider.cnPriority).padEnd(5)} ${state}`);
    if (!provider.enabled && provider.disabledReason) log(`                   disabled: ${provider.disabledReason}`);
  }
  for (const warning of report.warnings || []) warn(warning);
}

/* ------------------------------------------------------------------ detect ---- */

function detectReport(requested, options) {
  const { artifact, searched } = resolveArtifact(requested, { maxDepth: 3 });
  const all = discoverArtifacts(requested, { maxDepth: 3 }).artifacts;
  const registry = loadRegistry({ env: options.env });
  const context = buildProjectContext(path.dirname(artifact ? artifact.dir : requested), { probe: false, env: options.env });
  return {
    ok: Boolean(artifact),
    requested,
    searched,
    artifact: artifact ? { dir: artifact.dir, relative: artifact.relative } : null,
    candidates: all.map((candidate) => ({ dir: candidate.dir, relative: candidate.relative })),
    project: {
      config: context.config.byProvider,
      otherMarkers: context.config.other,
      gitRemote: context.gitRemote
    },
    providers: registry.ok ? registry.providers.filter((provider) => provider.enabled).map((provider) => provider.id) : [],
    tunnel: detectTunnelTools(),
    registryFile: registry.registryFile || null
  };
}

/* ------------------------------------------------------------------- verify ---- */

async function verifyCommand(url, positional, options) {
  if (!url) throw new UsageError('verify requires a URL');
  let target;
  try {
    target = new URL(url).toString();
  } catch {
    throw new Failure(`not a valid URL: ${url}`, 2);
  }

  let manifest = null;
  let dir = null;
  const explicit = positional[0];
  const { artifact } = resolveArtifact(explicit ? path.resolve(process.cwd(), explicit) : process.cwd(), { maxDepth: 3 });
  if (artifact) {
    const result = inspectArtifact(artifact.dir);
    if (result.ok) {
      manifest = result.manifest;
      dir = artifact.dir;
    }
  }
  if (!manifest) {
    if (explicit) throw new Failure(`no static artifact found at ${explicit}, so hashes cannot be compared`, 3);
    // Without a local artifact only the root document can be checked; that is reported as partial.
    let response;
    try {
      response = await httpRequest({ url: target, method: 'GET', timeoutMs: 60000 });
    } catch (cause) {
      return {
        success: false,
        mode: 'root-only',
        url: target,
        status: null,
        verification: {
          passed: false,
          method: 'http-root-only',
          filesExpected: 0,
          filesVerified: 0,
          bytesVerified: 0,
          browserVerified: false,
          failures: [{ path: '/', kind: 'fetch', detail: cause && cause.message ? cause.message : String(cause) }],
          problems: [`the root URL could not be fetched: ${cause && cause.message ? cause.message : String(cause)}`],
          note: 'No local artifact was found, so only the root document could be checked. Pass [dir] to compare SHA-256 hashes.'
        }
      };
    }
    const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const body = textOf(response).slice(0, 400).toLowerCase();
    const isHtml = contentType === 'text/html' || body.includes('<html') || body.includes('<!doctype html');
    const ok = response.status >= 200 && response.status < 300 && isHtml;
    return {
      success: ok,
      mode: 'root-only',
      url: target,
      status: response.status,
      contentType,
      html: isHtml,
      verification: {
        passed: ok,
        method: 'http-root-only',
        filesExpected: 0,
        filesVerified: 0,
        bytesVerified: 0,
        browserVerified: false,
        problems: ok ? [] : [`HTTP ${response.status} with content-type ${contentType || 'unknown'}; a successful status and HTML are required`],
        note: 'No local artifact was found, so only the root document could be checked. Pass [dir] to compare SHA-256 hashes.'
      }
    };
  }

  let verification;
  try {
    verification = await verifyDeployment({ publicUrl: target, manifest, options: options.verifyOptions });
  } catch (cause) {
    // A transport failure is a verification failure, not a crash: --json must still emit one
    // JSON document and the exit code must still be the verification failure code.
    const detail = cause && cause.message ? cause.message : String(cause);
    verification = {
      passed: false,
      method: 'http-sha256',
      url: target,
      filesExpected: manifest.fileCount,
      filesRequired: 0,
      filesVerified: 0,
      bytesVerified: 0,
      browserVerified: false,
      problems: [`the deployment could not be fetched: ${detail}`],
      failures: [{ path: '/', kind: 'fetch', detail }],
      mismatches: [],
      note: 'The root URL could not be fetched, so no resource was compared.'
    };
  }
  return {
    success: verification.passed,
    mode: 'manifest',
    dir,
    url: target,
    verification
  };
}

/* ------------------------------------------------------------------- tunnel ---- */

async function tunnelCommand(action, options) {
  const detection = detectTunnelTools();
  if (!action || action === 'detect') {
    return {
      supported: detection.supported,
      persistence: 'session',
      available: detection.available,
      unavailable: detection.unavailable,
      note: detection.supported
        ? 'A local tunnel CLI is installed. `tunnel start --port <n>` exposes localhost for the lifetime of the process only.'
        : 'No tunnel CLI (cloudflared, lt, ngrok) was found on PATH. Teacher DSH does not bundle one, and nothing is installed automatically.',
      result: detection.supported ? 'available' : 'unsupported'
    };
  }
  if (action !== 'start') throw new UsageError(`unknown tunnel action ${action} (expected detect or start)`);
  if (!options.port) throw new UsageError('tunnel start requires --port <n>');
  if (!detection.supported) {
    return {
      supported: false,
      persistence: 'session',
      result: 'unsupported',
      reason: 'no tunnel CLI (cloudflared, lt, ngrok) is installed; teacher-publish will not install one',
      nextAction: 'install cloudflared, localtunnel or ngrok, then run teacher-publish tunnel detect'
    };
  }
  const tool = pickTool(detection.available, options.auto);
  if (!tool) throw new Failure('no tunnel tool selected; pass --auto to use the first available tool', 2);
  return startTunnel(tool, options);
}

function pickTool(available, auto) {
  if (!available.length) return null;
  if (auto) return available[0];
  return available[0];
}

async function startTunnel(tool, options) {
  const args = tool.id === 'ngrok'
    ? ['http', String(options.port)]
    : tool.id === 'localtunnel'
      ? ['--port', String(options.port)]
      : ['tunnel', '--url', `http://localhost:${options.port}`];
  const child = spawn(tool.binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' && /\.cmd$/i.test(tool.binary) });

  const collected = [];
  const url = await new Promise((resolve) => {
    const deadline = Date.now() + (options.timeout ?? 60000);
    const inspect = () => {
      const text = collected.join('\n');
      const match = text.match(/https:\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/[^\s"'<>]*)?/i);
      if (match) return match[0];
      return null;
    };
    const onData = (chunk) => {
      collected.push(chunk.toString('utf8'));
      const found = inspect();
      if (found) resolve(found);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const poll = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(poll);
        resolve(null);
      }
    }, 500);
    child.on('error', () => {
      clearInterval(poll);
      resolve(null);
    });
    child.on('close', () => {
      clearInterval(poll);
      resolve(inspect());
    });
    child.unref?.();
  });

  if (!url) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    return {
      supported: true,
      persistence: 'session',
      result: 'failed',
      tool: tool.id,
      reason: `the tunnel CLI started but no public URL appeared within ${(options.timeout ?? 60000) / 1000}s`,
      output: collected.join('').split('\n').slice(-20).join('\n')
    };
  }

  return {
    supported: true,
    persistence: 'session',
    result: 'started',
    tool: tool.id,
    url,
    pid: child.pid ?? null,
    localPort: options.port,
    expiresAt: null,
    note: 'The tunnel only exists while this process runs. It is not a durable deployment and was not verified against a manifest.'
  };
}

/* --------------------------------------------------------------------- main ---- */

export async function main(argv, streams = {}) {
  void streams;
  const [command, ...rest] = argv;
  const options = parseArgs(rest);
  const env = process.env;

  if (!command || command === 'help' || options.help) {
    log(USAGE.trimEnd());
    return 0;
  }

  switch (command) {
    case 'detect': {
      const requested = options.positional[0] ? path.resolve(options.positional[0]) : process.cwd();
      const report = detectReport(requested, options);
      if (options.json) emitJson(report);
      else {
        log('Static artifact: ' + (report.artifact ? report.artifact.dir : 'NOT FOUND (build the artifact first)'));
        if (report.candidates.length > 1) log('Other candidates: ' + report.candidates.map((candidate) => candidate.relative).join(', '));
        log('Registry: ' + (report.registryFile || 'NOT FOUND'));
        log('Enabled providers: ' + (report.providers.join(', ') || '(none)'));
        log('Project config: ' + (Object.entries(report.project.config).filter(([, value]) => value.length).map(([key, value]) => `${key}(${value.join('/')})`).join(', ') || 'none'));
        log('Git remote: ' + (report.project.gitRemote || 'none'));
        log('Tunnel tools: ' + (report.tunnel.available.map((tool) => tool.id).join(', ') || 'none installed'));
      }
      return report.ok ? 0 : 3;
    }

    case 'inspect': {
      const { artifact } = requireArtifact(options.positional, options);
      const result = runInspection(artifact.dir);
      const summary = summarizeInspect(result);
      if (options.json) emitJson(summary);
      else printInspect(summary);
      return summary.blocked.length ? 4 : 0;
    }

    case 'plan': {
      const { artifact } = requireArtifact(options.positional, options);
      const result = runInspection(artifact.dir);
      const registry = loadRegistry({ env });
      if (!registry.ok) throw new Failure(`provider registry unusable: ${registry.error}`, 5, registry.problems);
      const health = loadHealth(env);
      const context = buildProjectContext(path.dirname(artifact.dir), { probe: true, env });
      const plan = planProviders({
        registry,
        manifest: result.manifest,
        mode: options.mode,
        healthState: health.state,
        context,
        allowInexact: options.allowInexact === true,
        healthFor: (id) => mergedHealth(registry, health.state, id)
      });
      const summary = summarizePlan(plan);
      const payload = {
        mode: plan.mode,
        dir: artifact.dir,
        artifact: {
          fileCount: result.manifest.fileCount,
          totalBytes: result.manifest.totalBytes,
          extensions: result.manifest.extensions,
          features: result.manifest.features
        },
        plan: summary,
        context: {
          config: context.config.byProvider,
          otherMarkers: context.config.other,
          gitRemote: context.gitRemote,
          cliAuth: context.cliAuth
        },
        healthFile: health.file,
        safety: { blocked: result.safety.blocked.length, warnings: result.safety.warnings.length }
      };
      if (options.json) emitJson(payload);
      else {
        log(`Artifact ${artifact.dir} (${result.manifest.fileCount} files, ${formatBytes(result.manifest.totalBytes)})`);
        printPlan(plan);
        if (!result.safety.blocked.length) log('safety scan: no hard-blocked files');
        else log(`safety scan: ${result.safety.blocked.length} hard-blocked file(s) - inspect before deploying`);
      }
      return plan.eligible.length ? 0 : 6;
    }

    case 'deploy': {
      const { artifact } = requireArtifact(options.positional, options);
      const result = runInspection(artifact.dir);
      const summary = summarizeInspect(result);
      const registry = loadRegistry({ env });
      if (!registry.ok) throw new Failure(`provider registry unusable: ${registry.error}`, 5, registry.problems);
      const health = loadHealth(env);
      const context = buildProjectContext(path.dirname(artifact.dir), { probe: true, env });
      const plan = planProviders({
        registry,
        manifest: result.manifest,
        mode: options.mode,
        healthState: health.state,
        context,
        allowInexact: options.allowInexact === true,
        healthFor: (id) => mergedHealth(registry, health.state, id)
      });

      const outcome = await deployArtifact({
        manifest: result.manifest,
        registry,
        mode: options.mode,
        healthState: health.state,
        plan,
        dryRun: options.dryRun,
        onlyProvider: options.provider,
        verify: options.noVerify !== true,
        inspectSummary: summary,
        context: { ...context, root: path.dirname(artifact.dir) },
        env
      });

      const payload = summarizeDeploy(outcome);
      if (options.json) {
        emitJson(payload);
        for (const attempt of outcome.attempts) {
          if (attempt.result !== 'attempted') trace(`${attempt.provider}: ${attempt.result}${attempt.failureKind ? ` (${attempt.failureKind})` : ''}${attempt.detail ? ` - ${attempt.detail}` : ''}`);
        }
      } else {
        printDeployResult(outcome);
      }
      // A dry run is a successful command: it contacted nothing and reported the order.
      if (outcome.dryRun) return 0;
      return outcome.success ? 0 : 1;
    }

    case 'verify': {
      const url = options.positional[0];
      const result = await verifyCommand(url, options.positional.slice(1), options);
      if (options.json) emitJson(result);
      else {
        if (result.success) log(`Verification passed: ${result.url}`);
        else log(`Verification failed: ${result.url}`);
        log('  ' + (result.verification.note || ''));
        for (const problem of result.verification.problems || []) log('  problem: ' + problem);
        for (const failure of result.verification.failures || []) log(`  ${failure.path}: ${failure.detail}`);
        for (const mismatch of result.verification.mismatches || []) log(`  ${mismatch.path}: ${mismatch.detail}`);
        log(`  files verified: ${result.verification.filesVerified}/${result.verification.filesExpected}, bytes ${result.verification.bytesVerified}`);
      }
      return result.success ? 0 : 7;
    }

    case 'providers': {
      const report = providersReport({ env });
      if (options.json) emitJson(report);
      else printProviders(report);
      for (const warning of report.warnings || []) warn(warning);
      return report.ok ? 0 : 5;
    }

    case 'tunnel': {
      const action = options.positional[0] || 'detect';
      const result = await tunnelCommand(action, options);
      if (options.json) emitJson(result);
      else {
        if (result.result === 'started') {
          log(`Tunnel started with ${result.tool}: ${result.url}`);
          log('  This URL only exists while the tunnel process runs (persistence: session).');
        } else if (result.available || result.supported) {
          log('Tunnel tools available: ' + (result.available ? result.available.map((tool) => tool.id).join(', ') : 'none'));
        } else {
          log('Tunnel mode is unsupported on this machine.');
          if (result.reason) log('  ' + result.reason);
          if (result.note) log('  ' + result.note);
        }
      }
      return result.result === 'unsupported' || result.result === 'failed' ? 8 : 0;
    }

    default:
      throw new UsageError(`unknown command ${command}`);
  }
}

/**
 * Run the CLI for an argv slice. Returns the process exit code.
 * `bin/teacher-publish.mjs` is the only entry point; this module never self-executes so it stays
 * importable for tests.
 */
export async function run(argv = process.argv.slice(2)) {
  try {
    const code = await main(argv);
    return code ?? 0;
  } catch (cause) {
    if (cause instanceof UsageError) {
      error(cause.message);
      error('run teacher-publish help for usage');
      return 2;
    }
    if (cause instanceof Failure) {
      error(cause.message);
      if (cause.detail) error(JSON.stringify(cause.detail));
      return cause.exitCode ?? 1;
    }
    error(cause && cause.stack ? cause.stack : String(cause));
    return 1;
  }
}
