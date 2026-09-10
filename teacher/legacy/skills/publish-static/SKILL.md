---
name: publish-static
description: Publish, host, share, deploy, or put a generated static teaching artifact online. Use when the user says "发到网上", "发布", "部署", "分享链接", "传到网页", or similar. Handles provider discovery, safety checks, explicit confirmation, deployment, and returning the URL.
---

# Publish Static

Use this skill when the user wants to publish, host, share, deploy, or put a generated static teaching artifact online.

## Goal

Publish a prebuilt static site with the least setup possible.

## Discovery

1. Identify the project root (look for `teacherArtifact: true` in `package.json`).
2. Locate the static output directory. Prefer `dist/`, then `build/`, then `public/`.
3. Never deploy source directories when a build output exists.
4. Detect existing provider configuration:
   - `.netlify/`, `netlify.toml`
   - `.vercel/`, `vercel.json`
   - `wrangler.toml`, `wrangler.json`
   - `firebase.json`
   - `.git/`, `.github/workflows/`
5. Detect authenticated provider CLIs (run `--version` or `whoami` where safe).
6. Prefer an existing configured provider.

## No existing provider

For quick temporary sharing, prefer Netlify anonymous deploy.

For persistent hosting, present the available authenticated providers and recommend the lowest-friction option.

## Safety (mandatory)

Before any public deployment:

- inspect the output file list;
- reject secrets and credential files;
- warn about student or personal information;
- show the exact directory and provider;
- require explicit user approval.

Sensitive file patterns to reject: `.env`, `.env.*`, `*.key`, `*.pem`, `credentials.json`, `id_rsa`, `student*.csv`, `grades*.xlsx`.

Never publish a user's whole workspace. Only publish `dist/`.

## Deployment commands

Netlify:

```bash
netlify deploy --dir <dir>
netlify deploy --prod --dir <dir>
```

Temporary Netlify (no login, URL valid for 1 hour, can be claimed):

```bash
netlify deploy --allow-anonymous --dir <dir>
```

Cloudflare Pages:

```bash
wrangler pages deploy <dir> --project-name <name>
```

Vercel:

```bash
vercel <dir>
vercel <dir> --prod
```

GitHub Pages:

- Prefer an existing repository and GitHub Actions deployment.
- For branch direct publish, create `.nojekyll`.

## Provider priority

1. Already configured platforms
2. Already logged-in platforms
3. Netlify
4. Cloudflare
5. Vercel
6. GitHub Pages

## Completion

Return:

- deployment URL;
- provider;
- whether the URL is temporary or persistent;
- how to update it next time.