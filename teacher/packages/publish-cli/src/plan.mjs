import { detectAuthTokens, detectClis, detectConfiguredProviders, detectGitRemote } from './detect.mjs';
import { log } from './common.mjs';

export function rankProviders({ cwd, tokens = detectAuthTokens(), clis = detectClis(), existing = detectConfiguredProviders(cwd) }) {
  const ordered = [];

  const push = (id, priority, reason) => ordered.push({ id, priority, reason });

  if (existing.includes('netlify') || tokens.netlify || clis.netlify) {
    push('netlify', existing.includes('netlify') ? 100 : tokens.netlify ? 95 : clis.netlify ? 90 : 0, 'existing-config-or-cli');
  }
  if (existing.includes('cloudflare-pages') || tokens.cloudflare || clis.wrangler) {
    push('cloudflare-pages', existing.includes('cloudflare-pages') ? 98 : tokens.cloudflare ? 94 : clis.wrangler ? 89 : 0, 'existing-config-or-cli');
  }
  if (existing.includes('vercel') || tokens.vercel || clis.vercel) {
    push('vercel', existing.includes('vercel') ? 96 : tokens.vercel ? 93 : clis.vercel ? 88 : 0, 'existing-config-or-cli');
  }
  if (existing.includes('github-pages')) {
    push('github-pages', 85, 'git-repository');
  }
  // Netlify anonymous deploy is always a valid temporary fallback.
  push('netlify-anonymous', 10, 'temporary-no-account');

  return ordered.sort((a, b) => b.priority - a.priority);
}

export function printPlan({ dist, files, sensitive, providers, gitRemote }) {
  log('Teacher DSH publish plan');
  log(`  dir:      ${dist}`);
  log(`  files:    ${files.length}`);
  if (sensitive.length) {
    log(`  BLOCKED-sensitive: ${sensitive.join(', ')}`);
  }
  log('  providers (ranked):');
  for (const p of providers) log(`    ${p.priority}\t${p.id}\t(${p.reason})`);
  if (gitRemote) log(`  git remote: ${gitRemote}`);
}