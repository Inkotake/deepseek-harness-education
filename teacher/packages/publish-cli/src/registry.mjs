/**
 * Provider registry: builtin file plus an optional remote status overlay.
 *
 * `config/providers.json` ships with the app and is authoritative for identity and protocol:
 * adapter, endpoint, allowed hosts, protocol, mode and capabilities.
 *
 * An overlay (a signed status feed in a future version) may only ever change the presentation
 * and availability fields: `enabled`, `priority`, `health`, `lastValidated`, `notes`. Any
 * attempt to move an endpoint, swap an adapter or change a protocol is refused outright, and
 * the refusal is reported rather than silently ignored. No network fetch happens here: the
 * overlay is read from `TEACHER_PUBLISH_STATUS_FILE` or `<TEACHER_DSH_HOME>/publish-provider-status.json`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CLI_ROOT, PACKAGE_ROOT, readJsonFile, statePath } from './common.mjs';

/** Fields the overlay is permitted to touch. */
export const OVERLAY_MUTABLE_FIELDS = ['enabled', 'priority', 'health', 'lastValidated', 'notes'];
/** Fields the overlay must never touch, even to an identical value. */
export const OVERLAY_PROTECTED_FIELDS = ['adapter', 'endpoint', 'protocol', 'allowedHosts', 'capabilities', 'modes', 'id', 'persistent'];

const MODES = ['quick-share', 'persistent', 'tunnel'];
const HEALTH_STATES = ['healthy', 'degraded', 'unreachable', 'auth-required', 'incompatible', 'rate-limited', 'unknown'];

function builtinRegistryCandidates(env) {
  return [
    env.TEACHER_PUBLISH_REGISTRY,
    path.join(CLI_ROOT, 'config', 'providers.json'),
    path.join(PACKAGE_ROOT, 'config', 'providers.json'),
    path.join(CLI_ROOT, '..', '..', '..', 'config', 'providers.json')
  ].filter(Boolean);
}

export function resolveRegistryFile(env = process.env) {
  for (const candidate of builtinRegistryCandidates(env)) {
    try {
      if (fs.statSync(candidate).isFile()) return path.resolve(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

export function resolveOverlayFile(env = process.env) {
  if (env.TEACHER_PUBLISH_STATUS_FILE) return path.resolve(env.TEACHER_PUBLISH_STATUS_FILE);
  return statePath('publish-provider-status.json', env);
}

/* ----------------------------------------------------------- validation ---- */

export function validateProvider(entry, index) {
  const problems = [];
  if (!entry || typeof entry !== 'object') return [`entry ${index} is not an object`];
  if (!entry.id || typeof entry.id !== 'string') problems.push(`entry ${index}: missing id`);
  if (!entry.adapter || typeof entry.adapter !== 'string') problems.push(`${entry.id}: missing adapter`);
  if (!entry.label || typeof entry.label !== 'string') problems.push(`${entry.id}: missing label`);
  if (typeof entry.enabled !== 'boolean') problems.push(`${entry.id}: enabled must be a boolean`);
  if (!Array.isArray(entry.modes) || !entry.modes.length) problems.push(`${entry.id}: modes must be a non-empty array`);
  else {
    for (const mode of entry.modes) {
      if (!MODES.includes(mode)) problems.push(`${entry.id}: unknown mode ${mode}`);
    }
  }
  if (entry.transport === 'cli') {
    if (!entry.cli || typeof entry.cli !== 'string') problems.push(`${entry.id}: a cli-transport provider requires a cli name`);
  } else if (entry.endpoint === null || entry.endpoint === undefined) {
    // A registry entry with no service (wh-drop) may omit the endpoint, but it must be disabled.
    if (entry.enabled !== false) problems.push(`${entry.id}: a provider without an endpoint must be disabled`);
  } else if (!/^https:\/\//.test(entry.endpoint)) {
    problems.push(`${entry.id}: endpoint must be an absolute https URL`);
  }
  if (!Array.isArray(entry.allowedHosts) || !entry.allowedHosts.length) {
    problems.push(`${entry.id}: allowedHosts must be a non-empty array`);
  } else {
    for (const host of entry.allowedHosts) {
      if (!/^(\*\.)?[a-z0-9.-]+$/i.test(host)) problems.push(`${entry.id}: invalid allowed host ${host}`);
    }
    if (entry.endpoint) {
      const endpointHost = new URL(entry.endpoint).hostname;
      const allowed = entry.allowedHosts.some((host) => (host.startsWith('*.') ? endpointHost.endsWith(host.slice(1)) : endpointHost === host));
      if (!allowed) problems.push(`${entry.id}: endpoint host ${endpointHost} is not listed in allowedHosts`);
    }
  }
  if (typeof entry.priority !== 'number' || !Number.isFinite(entry.priority)) problems.push(`${entry.id}: priority must be a number`);
  if (typeof entry.cnPriority !== 'number' || !Number.isFinite(entry.cnPriority)) problems.push(`${entry.id}: cnPriority must be a number`);
  if (!entry.capabilities || typeof entry.capabilities !== 'object') problems.push(`${entry.id}: missing capabilities`);
  else {
    const caps = entry.capabilities;
    // Every capability key must be present and explicit: either a documented value, or null
    // meaning "the service does not document this limit, so the client enforces nothing".
    for (const key of ['maxFiles', 'maxFileBytes', 'maxTotalBytes', 'supportedExtensions', 'supportsModelFiles', 'anonymous']) {
      if (!(key in caps)) {
        problems.push(`${entry.id}: capabilities.${key} is missing (use null when the service does not document a limit)`);
        continue;
      }
      const value = caps[key];
      if (value === null) continue;
      if (key === 'supportedExtensions') {
        if (!Array.isArray(value)) problems.push(`${entry.id}: capabilities.supportedExtensions must be an array or null`);
      } else if (key === 'supportsModelFiles' || key === 'anonymous') {
        if (typeof value !== 'boolean') problems.push(`${entry.id}: capabilities.${key} must be a boolean`);
      } else if (typeof value !== 'number' || !Number.isFinite(value)) {
        problems.push(`${entry.id}: capabilities.${key} must be a finite number or null`);
      }
    }
  }
  if (entry.enabled === false && !entry.disabledReason) {
    problems.push(`${entry.id}: a disabled provider must carry disabledReason`);
  }
  if (entry.health && !HEALTH_STATES.includes(entry.health.state)) {
    problems.push(`${entry.id}: unknown health state ${entry.health.state}`);
  }
  return problems;
}

/**
 * Validate an overlay and merge it into the builtin registry.
 * Returns the merged provider list plus a report of every rejected change.
 */
export function applyOverlay(providers, overlay) {
  const report = { applied: [], rejected: [], unknownProviders: [] };
  if (!overlay || typeof overlay !== 'object') {
    report.rejected.push({ provider: '*', field: '*', reason: 'overlay is not a JSON object' });
    return { providers, report };
  }
  const entries = Array.isArray(overlay.providers) ? overlay.providers : [];
  if (!Array.isArray(overlay.providers)) {
    report.rejected.push({ provider: '*', field: 'providers', reason: 'overlay.providers must be an array' });
    return { providers, report };
  }
  for (const candidate of entries) {
    if (!candidate || typeof candidate.id !== 'string') {
      report.rejected.push({ provider: String(candidate && candidate.id), field: 'id', reason: 'overlay entry needs a provider id' });
      continue;
    }
    const target = providers.find((provider) => provider.id === candidate.id);
    if (!target) {
      report.unknownProviders.push(candidate.id);
      report.rejected.push({ provider: candidate.id, field: '*', reason: 'overlay references a provider that is not in the builtin registry' });
      continue;
    }
    for (const key of Object.keys(candidate)) {
      if (key === 'id') continue;
      if (OVERLAY_PROTECTED_FIELDS.includes(key)) {
        report.rejected.push({
          provider: candidate.id,
          field: key,
          reason: `refused: overlay may not change ${key} (protected field)`
        });
        continue;
      }
      if (!OVERLAY_MUTABLE_FIELDS.includes(key)) {
        report.rejected.push({ provider: candidate.id, field: key, reason: `refused: ${key} is not an overlay-mutable field` });
        continue;
      }
      const value = candidate[key];
      if (key === 'enabled') {
        if (typeof value !== 'boolean') {
          report.rejected.push({ provider: candidate.id, field: key, reason: 'enabled must be a boolean' });
          continue;
        }
        target.enabled = value;
      } else if (key === 'priority') {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          report.rejected.push({ provider: candidate.id, field: key, reason: 'priority must be a finite number' });
          continue;
        }
        target.priority = value;
      } else if (key === 'health') {
        if (!value || typeof value !== 'object' || !HEALTH_STATES.includes(value.state)) {
          report.rejected.push({ provider: candidate.id, field: key, reason: 'health must be an object with a known state' });
          continue;
        }
        target.health = { ...target.health, ...value };
        target.healthSource = 'overlay';
      } else if (key === 'lastValidated') {
        target.lastValidated = value == null ? null : String(value);
      } else if (key === 'notes') {
        target.notes = value == null ? null : String(value);
      }
      report.applied.push({ provider: candidate.id, field: key });
    }
  }
  // A refused field must not be half-applied: callers can inspect report.rejected and decide.
  return { providers, report };
}

/* ------------------------------------------------------------------ load ---- */

export function loadRegistry(options = {}) {
  const env = options.env || process.env;
  const warnings = [];
  const registryFile = resolveRegistryFile(env);
  if (!registryFile) {
    return {
      ok: false,
      error: 'Cannot locate the bundled provider registry (config/providers.json).',
      providers: [],
      warnings,
      overlay: null
    };
  }

  const raw = readJsonFile(registryFile, null);
  if (!raw || !Array.isArray(raw.providers)) {
    return { ok: false, error: `Registry ${registryFile} is missing a providers array.`, providers: [], warnings, overlay: null };
  }

  const problems = [];
  const providers = [];
  const seen = new Set();
  for (const [index, entry] of raw.providers.entries()) {
    const entryProblems = validateProvider(entry, index);
    problems.push(...entryProblems);
    if (entry && typeof entry.id === 'string') {
      if (seen.has(entry.id)) problems.push(`duplicate provider id ${entry.id}`);
      seen.add(entry.id);
    }
    providers.push({
      ...entry,
      allowedHosts: Array.isArray(entry.allowedHosts) ? [...entry.allowedHosts] : [],
      capabilities: { ...(entry.capabilities || {}) },
      modes: Array.isArray(entry.modes) ? [...entry.modes] : [],
      health: entry.health && typeof entry.health === 'object' ? { ...entry.health } : { state: 'unknown' },
      healthSource: 'builtin',
      registryFile
    });
  }

  if (problems.length) {
    return { ok: false, error: 'Registry validation failed.', problems, providers, warnings, overlay: null, registryFile };
  }

  const overlayFile = resolveOverlayFile(env);
  let overlay = null;
  let merged = providers;
  if (overlayFile) {
    let overlayRaw = null;
    let overlayExists = false;
    try {
      overlayExists = fs.statSync(overlayFile).isFile();
    } catch {
      overlayExists = false;
    }
    if (overlayExists) {
      overlayRaw = readJsonFile(overlayFile, undefined);
      if (overlayRaw === undefined) {
        warnings.push(`Overlay ${overlayFile} is not valid JSON and was ignored.`);
        overlay = { file: overlayFile, applied: [], rejected: [{ provider: '*', field: '*', reason: 'invalid JSON' }], unknownProviders: [] };
      } else {
        const result = applyOverlay(merged, overlayRaw);
        merged = result.providers;
        overlay = { file: overlayFile, ...result.report };
        for (const rejection of result.report.rejected) {
          warnings.push(`Overlay refused ${rejection.provider}.${rejection.field}: ${rejection.reason}`);
        }
      }
    }
  }

  const order = new Map(raw.providers.map((entry, index) => [entry.id, index]));
  merged.sort((a, b) => (b.priority - a.priority) || (order.get(a.id) - order.get(b.id)));

  return {
    ok: true,
    version: raw.registryVersion ?? null,
    updatedAt: raw.updatedAt ?? null,
    notes: raw.notes ?? null,
    registryFile,
    overlayFile: overlayFile || null,
    overlay,
    providers: merged,
    warnings,
    problems: []
  };
}

export function providerById(registry, id) {
  return registry.providers.find((provider) => provider.id === id) || null;
}

export function isEnabled(provider) {
  return provider.enabled === true;
}
