import fs from 'node:fs';
import path from 'node:path';
import { run } from './common.mjs';

/**
 * Provider adapters run the bundled CLIs (Netlify, Wrangler, Vercel) or Git
 * for GitHub Pages. Every deploy returns { ok, url, detail }.
 */

export function deployNetlify({ dir, anonymous = false, prod = false }) {
  const args = ['deploy'];
  if (anonymous) args.push('--allow-anonymous');
  if (prod) args.push('--prod');
  args.push('--dir', dir);
  return run('netlify', args);
}

export function deployCloudflarePages({ dir, projectName }) {
  const args = ['pages', 'deploy', dir];
  if (projectName) args.push('--project-name', projectName);
  return run('wrangler', args);
}

export function deployVercel({ dir, prod = false }) {
  const args = [dir];
  if (prod) args.push('--prod');
  return run('vercel', args);
}

export function deployGithubPages({ dir, repoDir }) {
  // Copy dist/ into a gh-pages branch via git worktree; used only when the
  // project is already a GitHub repository.
  const root = repoDir || process.cwd();
  const pages = path.join(root, '.gh-pages-tmp');
  if (fs.existsSync(pages)) fs.rmSync(pages, { recursive: true, force: true });

  let status = run('git', ['worktree', 'add', pages, '-B', 'gh-pages'], { cwd: root });
  if (status !== 0) return status;
  try {
    for (const entry of fs.readdirSync(pages)) {
      if (entry !== '.git') fs.rmSync(path.join(pages, entry), { recursive: true, force: true });
    }
    for (const entry of fs.readdirSync(dir)) {
      fs.cpSync(path.join(dir, entry), path.join(pages, entry), { recursive: true });
    }
    fs.writeFileSync(path.join(pages, '.nojekyll'), '');
    status = run('git', ['add', '-A'], { cwd: pages });
    if (status !== 0) return status;
    status = run('git', ['commit', '-m', 'Teacher DSH static artifact'], { cwd: pages, env: process.env });
    if (status !== 0 && status !== 1) return status; // 1 means nothing to commit
    return run('git', ['push', 'origin', 'gh-pages', '--force'], { cwd: pages });
  } finally {
    run('git', ['worktree', 'remove', pages, '--force'], { cwd: root });
  }
}