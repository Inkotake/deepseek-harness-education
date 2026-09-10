import fs from 'node:fs';
import path from 'node:path';
import { run } from './common.mjs';

const SENSITIVE_PATTERNS = [
  /^\.env(\..*)?$/,
  /\.key$/,
  /\.pem$/,
  /^credentials\.json$/,
  /^id_rsa$/,
  /student.*\.(csv|xlsx|xls)$/i,
  /grades.*\.(csv|xlsx|xls)$/i,
  /\.secret$/i,
];

export function scanSensitiveFiles(files, dist) {
  return files
    .filter((f) => SENSITIVE_PATTERNS.some((re) => re.test(path.basename(f))))
    .map((f) => path.relative(dist, f));
}

export function detectConfiguredProviders(cwd) {
  const found = [];
  if (fs.existsSync(path.join(cwd, '.netlify')) || fs.existsSync(path.join(cwd, 'netlify.toml'))) found.push('netlify');
  if (fs.existsSync(path.join(cwd, '.vercel')) || fs.existsSync(path.join(cwd, 'vercel.json'))) found.push('vercel');
  if (fs.existsSync(path.join(cwd, 'wrangler.toml')) || fs.existsSync(path.join(cwd, 'wrangler.json'))) found.push('cloudflare-pages');
  if (fs.existsSync(path.join(cwd, '.github', 'workflows')) || fs.existsSync(path.join(cwd, '.git'))) found.push('github-pages');
  return found;
}

export function detectAuthTokens(env = process.env) {
  const tokens = {
    netlify: Boolean(env.NETLIFY_AUTH_TOKEN),
    vercel: Boolean(env.VERCEL_TOKEN),
    cloudflare: Boolean(env.CLOUDFLARE_API_TOKEN),
  };
  return tokens;
}

export function detectClis() {
  const result = { netlify: false, vercel: false, wrangler: false };
  result.netlify = run('netlify', ['--version'], { stdio: 'pipe', capture: true }).status === 0;
  result.vercel = run('vercel', ['--version'], { stdio: 'pipe', capture: true }).status === 0;
  result.wrangler = run('wrangler', ['--version'], { stdio: 'pipe', capture: true }).status === 0;
  return result;
}

export function detectGitRemote(cwd) {
  const r = run('git', ['remote', 'get-url', 'origin'], { cwd, stdio: 'pipe', capture: true });
  if (r.status === 0) return r.stdout.trim() || null;
  return null;
}