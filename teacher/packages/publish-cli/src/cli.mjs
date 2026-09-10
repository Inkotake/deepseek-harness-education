import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { err, findStaticDir, log, walk } from './common.mjs';
import { scanSensitiveFiles } from './detect.mjs';
import { printPlan, rankProviders } from './plan.mjs';
import { deployCloudflarePages, deployGithubPages, deployNetlify, deployVercel } from './adapters.mjs';

function usage() {
  log(`
teacher-publish - Teacher DSH static publishing CLI

Usage:
  teacher-publish detect                 Detect static dir, providers, tokens, git
  teacher-publish inspect [dir]          Inspect files and sensitive content
  teacher-publish deploy [dir]           Rank providers, confirm, deploy, return URL

Providers: Netlify, Cloudflare Pages, Vercel, GitHub Pages, Netlify anonymous.
Never discovers unknown hosting sites at runtime.
`);
}

function confirm(question) {
  process.stdout.write(question + ' [y/N] ');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === 'help') { usage(); return; }

  if (command === 'detect') {
    const dist = findStaticDir();
    log('Static dir: ' + (dist ?? 'NOT FOUND (build first)'));
    if (!dist) process.exitCode = 1;
    return;
  }

  if (command === 'inspect') {
    const dist = path.resolve(process.cwd(), args[0] || findStaticDir() || 'dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      err('No index.html in ' + dist);
      process.exitCode = 1;
      return;
    }
    const files = walk(dist);
    const sensitive = scanSensitiveFiles(files, dist);
    log('Inspect ' + dist);
    log('  files: ' + files.length);
    for (const f of files) log('    ' + path.relative(dist, f));
    if (sensitive.length) {
      err('Sensitive files detected: ' + sensitive.join(', '));
      process.exitCode = 1;
    } else {
      log('  sensitive scan: clean');
    }
    return;
  }

  if (command === 'deploy') {
    const dist = path.resolve(process.cwd(), args[0] || findStaticDir() || 'dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      err('No index.html in ' + dist);
      process.exitCode = 1;
      return;
    }
    const files = walk(dist);
    const sensitive = scanSensitiveFiles(files, dist);
    if (sensitive.length) {
      err('Refusing to deploy: sensitive files detected: ' + sensitive.join(', '));
      process.exitCode = 1;
      return;
    }
    const providers = rankProviders({ cwd: process.cwd() });
    printPlan({ dist, files, sensitive, providers, gitRemote: null });

    const first = providers[0];
    if (!first) { err('No provider available'); process.exitCode = 1; return; }
    log('');
    log(`Will deploy to ${first.id}.`);
    const ok = await confirm('Publish this static directory publicly?');
    if (!ok) {
      log('Aborted by user.');
      return;
    }

    let status = 1;
    let url = null;
    switch (first.id) {
      case 'netlify':
        status = deployNetlify({ dir: dist, anonymous: false, prod: true });
        break;
      case 'netlify-anonymous':
        status = deployNetlify({ dir: dist, anonymous: true, prod: false });
        break;
      case 'cloudflare-pages':
        status = deployCloudflarePages({ dir: dist, projectName: path.basename(path.resolve(process.cwd(), '..')) });
        break;
      case 'vercel':
        status = deployVercel({ dir: dist, prod: true });
        break;
      case 'github-pages':
        status = deployGithubPages({ dir: dist, repoDir: process.cwd() });
        break;
      default:
        err('Unknown provider ' + first.id);
        process.exitCode = 1;
        return;
    }

    if (status !== 0) {
      err(`${first.id} deployment failed (exit ${status}).`);
      log('Next providers in order were: ' + providers.slice(1).map((p) => p.id).join(', '));
      process.exitCode = status;
      return;
    }
    log('');
    log('Deployed via ' + first.id + '. The deploy tool prints the URL above.');
    log('Update next time: run teacher-publish deploy again from the project root.');
    return;
  }

  usage();
}

main().catch((cause) => {
  err(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});