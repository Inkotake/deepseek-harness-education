/**
 * Persistent providers, driven through the bundled CLIs in
 * `resources/teacher-runtime/deploy/node_modules/.bin` (TEACHER_DEPLOY_HOME).
 *
 * A persistent deploy is durable and account-owned, which is exactly why a failure here must
 * never be silently downgraded to an anonymous temporary host: `deploy` stops and reports.
 * The URL is taken from the CLI output. For github-pages the deployed repository determines the
 * Pages URL, and that value is labelled as derived-from-the-remote rather than response-reported.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveBundledBin, runCapture, runCaptureAsync, trace } from '../common.mjs';
import { ProviderError } from './errors.mjs';

export const id = 'persistent';

const CLI_BINARIES = {
  netlify: 'netlify',
  'cloudflare-pages': 'wrangler',
  vercel: 'vercel',
  'github-pages': 'git'
};

export function cliAvailable(providerId, env = process.env) {
  const name = CLI_BINARIES[providerId];
  if (!name) return false;
  const binary = resolveBundledBin(name, env);
  if (binary === name) {
    // Not bundled: fall back to a version probe on PATH so the CLI can still be used.
    const result = runCapture(name, ['--version'], { timeoutMs: 15000 });
    return result.status === 0;
  }
  return true;
}

export async function deploy({ provider, manifest, context = {} }) {
  switch (provider.id) {
    case 'netlify':
      return deployNetlify(provider, manifest);
    case 'cloudflare-pages':
      return deployCloudflarePages(provider, manifest, context);
    case 'vercel':
      return deployVercel(provider, manifest);
    case 'github-pages':
      return deployGithubPages(provider, manifest, context);
    default:
      throw new ProviderError('capability', `${id}: no persistent adapter for ${provider.id}`, { permanent: true });
  }
}

/* ------------------------------------------------------------------ netlify ---- */

async function deployNetlify(provider, manifest) {
  const binary = resolveBundledBin('netlify');
  const args = ['deploy', '--dir', manifest.dir, '--prod', '--json', '--message', 'teacher-publish'];
  trace(`netlify: running ${path.basename(binary)} deploy --prod`);
  const result = await runCaptureAsync(binary, args, { cwd: path.dirname(manifest.dir), timeoutMs: 15 * 60 * 1000 });

  if (result.status !== 0) {
    throw classifyCliFailure('netlify', result);
  }
  const payload = tryParseJson(result.stdout);
  const url = payload && (payload.url || payload.deploy_url || payload.ssl_url);
  if (!url) {
    throw new ProviderError('server', `netlify: the CLI exited successfully but printed no deploy URL. Output: ${truncate(result.stdout)}`, { permanent: false });
  }
  return {
    url: String(url),
    persistence: 'persistent',
    expiresAt: null,
    claim: null,
    fileCount: manifest.fileCount,
    providerDetail: {
      deployId: payload.deploy_id ?? null,
      siteId: payload.site_id ?? null,
      adminUrl: payload.admin_url ?? null,
      urlSource: 'cli-output'
    },
    transport: 'cli'
  };
}

/* --------------------------------------------------------- cloudflare-pages ---- */

async function deployCloudflarePages(provider, manifest, context) {
  const binary = resolveBundledBin('wrangler');
  const projectName = context.projectName || path.basename(path.dirname(manifest.dir)) || 'teacher-artifact';
  const args = ['pages', 'deploy', manifest.dir, '--project-name', projectName, '--commit-dirty=true'];
  trace(`cloudflare-pages: running wrangler pages deploy --project-name ${projectName}`);
  const result = await runCaptureAsync(binary, args, { cwd: path.dirname(manifest.dir), timeoutMs: 15 * 60 * 1000 });

  if (result.status !== 0) {
    throw classifyCliFailure('cloudflare-pages', result);
  }
  const combined = result.stdout + '\n' + result.stderr;
  const url = firstUrl(combined, (candidate) => candidate.hostname.endsWith('.pages.dev'))
    || firstUrl(combined, (candidate) => candidate.hostname.endsWith('.workers.dev'));
  if (!url) {
    throw new ProviderError('server', `cloudflare-pages: wrangler exited successfully but no *.pages.dev URL was printed. Output: ${truncate(combined)}`, { permanent: false });
  }
  return {
    url,
    persistence: 'persistent',
    expiresAt: null,
    claim: null,
    fileCount: manifest.fileCount,
    providerDetail: { projectName, urlSource: 'cli-output' },
    transport: 'cli'
  };
}

/* ------------------------------------------------------------------- vercel ---- */

async function deployVercel(provider, manifest) {
  const binary = resolveBundledBin('vercel');
  const args = ['deploy', manifest.dir, '--prod', '--yes'];
  trace('vercel: running vercel deploy --prod');
  const result = await runCaptureAsync(binary, args, { cwd: path.dirname(manifest.dir), timeoutMs: 15 * 60 * 1000 });

  if (result.status !== 0) {
    throw classifyCliFailure('vercel', result);
  }
  const combined = result.stdout + '\n' + result.stderr;
  const url = firstUrl(combined, (candidate) => candidate.hostname.endsWith('.vercel.app') || candidate.hostname.endsWith('.now.sh'));
  if (!url) {
    throw new ProviderError('server', `vercel: the CLI exited successfully but no deployment URL was printed. Output: ${truncate(combined)}`, { permanent: false });
  }
  return {
    url,
    persistence: 'persistent',
    expiresAt: null,
    claim: null,
    fileCount: manifest.fileCount,
    providerDetail: { urlSource: 'cli-output' },
    transport: 'cli'
  };
}

/* ------------------------------------------------------------- github-pages ---- */

async function deployGithubPages(provider, manifest, context) {
  const remote = context.gitRemote;
  if (!remote) {
    throw new ProviderError('capability', 'github-pages: the project has no git origin remote, so there is nowhere to publish', { permanent: true });
  }
  const slug = await readGithubSlug(context.root || process.cwd());
  if (!slug) {
    throw new ProviderError('capability', `github-pages: the origin remote (${remote}) is not a recognisable GitHub URL`, { permanent: true });
  }

  const branch = 'gh-pages';
  const cwd = context.root || process.cwd();
  // The staging worktree must live outside the artifact directory, otherwise it would be copied
  // into itself and into the published output.
  const staging = path.join(cwd, '.teacher-publish-gh-pages');
  const git = resolveBundledBin('git');
  let worktreeAdded = false;
  try {
    await runStep('worktree', git, ['worktree', 'add', '--force', '-B', branch, staging], cwd);
    worktreeAdded = true;
    // Replace the branch content with the artifact, then commit and push.
    for (const entry of fs.readdirSync(staging)) {
      if (entry === '.git') continue;
      fs.rmSync(path.join(staging, entry), { recursive: true, force: true });
    }
    fs.cpSync(manifest.dir, staging, { recursive: true, force: true });
    fs.writeFileSync(path.join(staging, '.nojekyll'), '');
    await runStep('add', git, ['add', '-A'], staging);
    await runStep('commit', git, ['commit', '-m', 'teacher-publish static artifact'], staging, { allowFailure: true });
    await runStep('push', git, ['push', 'origin', `HEAD:${branch}`, '--force'], staging);
  } finally {
    if (worktreeAdded) {
      await runCaptureAsync(git, ['worktree', 'remove', '--force', staging], { cwd, timeoutMs: 120000 });
    }
  }

  return {
    url: `https://${slug.owner}.github.io/${slug.repo}/`,
    persistence: 'persistent',
    expiresAt: null,
    claim: null,
    fileCount: manifest.fileCount,
    providerDetail: {
      urlSource: 'derived-from-git-remote',
      branch,
      owner: slug.owner,
      repo: slug.repo,
      note: 'The published URL comes from the GitHub repository itself; the deployment appears only after GitHub Pages finishes building, so immediate remote verification can legitimately fail.'
    },
    transport: 'git'
  };
}

async function runStep(label, binary, args, cwd, options = {}) {
  trace(`github-pages: ${label} ${args[0]}`);
  const result = await runCaptureAsync(binary, args, { cwd, timeoutMs: 10 * 60 * 1000 });
  if (result.status !== 0 && !options.allowFailure) {
    throw classifyCliFailure('github-pages', result, label);
  }
  return result;
}

async function readGithubSlug(cwd) {
  const result = await runCaptureAsync(resolveBundledBin('git'), ['remote', 'get-url', 'origin'], { cwd, timeoutMs: 15000 });
  if (result.status !== 0) return null;
  return parseGithubRemote(result.stdout.trim());
}

export function parseGithubRemote(remote) {
  if (!remote) return null;
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i,
    /^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i,
    /^git:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i
  ];
  for (const pattern of patterns) {
    const match = remote.match(pattern);
    if (match) return { owner: match[1], repo: match[2].replace(/\.git$/i, '') };
  }
  return null;
}

/* ------------------------------------------------------------------ helpers ---- */

/**
 * Arguments reach the spawned process as an argv array and never through a shell (a Windows
 * `.cmd` shim is resolved to its entry script first), so a path containing spaces is safe.
 */

function tryParseJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to the last balanced object */
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function firstUrl(text, predicate) {
  const matches = String(text || '').match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  for (const candidate of matches) {
    try {
      const parsed = new URL(candidate);
      if (predicate(parsed)) return parsed.origin + (parsed.pathname === '/' ? '/' : parsed.pathname);
    } catch {
      continue;
    }
  }
  return null;
}

function classifyCliFailure(providerId, result, label) {
  const message = truncate(`${result.stderr || ''}\n${result.stdout || ''}`.trim(), 600);
  if ((result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) || /is not recognized|command not found|no such file/i.test(message)) {
    return new ProviderError('capability', `${providerId}: the CLI could not be started (${label || 'deploy'}), which is a local installation problem, not a service outage. ${message}`, { detail: (result.error && result.error.code) || 'ENOENT', permanent: true });
  }
  if (/not logged in|authentication|unauthorized|401|403|no token|must be logged|access token/i.test(message)) {
    return new ProviderError('auth', `${providerId}: the CLI is not authenticated. ${message}`, { status: 401 });
  }
  if (/could not parse configuration|invalid toml|invalid json|configuration file|no such directory|does not exist|not a directory|enoent/i.test(message)) {
    // A local configuration problem is not a service outage; do not count it against the host.
    return new ProviderError('capability', `${providerId}: local configuration problem. ${message}`, { permanent: true });
  }
  if (/enotfound|getaddrinfo|eai_again|etimedout|econnreset|network error|socket hang up/i.test(message)) {
    return new ProviderError('unreachable', `${providerId}: network failure from the CLI. ${message}`, { detail: 'network' });
  }
  if (/too many files|exceeds|invalid argument|unsupported|not supported|file too large|payload too large/i.test(message)) {
    return new ProviderError('capability', `${providerId}: the service rejected the artifact. ${message}`, { permanent: true });
  }
  return new ProviderError('server', `${providerId}: the CLI exited with status ${result.status}. ${message}`, { permanent: false });
}

function truncate(text, limit = 400) {
  const value = String(text || '');
  return value.length > limit ? value.slice(0, limit) + '...' : value;
}
