---
name: publish-static
description: Publish a built static teaching artifact online and return a URL. Use when the user says "发到网上", "发布", "部署", "分享链接", "传到网页". Never discovers random hosting sites at runtime; only uses providers from teacher/manifests/providers.lock.json.
---

# Publish Static

## Workflow

1. Identify the project root (`package.json` with `teacherArtifact: true`).
2. Locate static output: prefer `dist/`, then `build/`, then `public/`.
3. Run `teacher-artifact check`. If it fails, stop and fix.
4. Read `teacher/manifests/providers.lock.json`.
5. Detect existing provider configuration (`.netlify/`, `vercel.json`, `wrangler.toml`, `.github/workflows`, env tokens).
6. Sort candidates: already-configured providers first, then registry `priority_cn`.
7. Present the exact directory, provider, and public visibility. Require explicit user approval.
8. Deploy through the provider adapter in `@teacher-dsh/publish-cli`.
9. Return: URL, provider, temporary or persistent, how to update next time.

## Safety

Before any public deployment:

- inspect the output file list;
- reject `.env`, `*.key`, `*.pem`, `credentials.json`, `id_rsa`, `student*.csv`, `grades*.xlsx`;
- warn about student or personal information;
- show the exact directory and provider;
- require explicit user approval.

Never publish the whole workspace. Only publish `dist/`.

## Providers

Only these reviewed providers are allowed (see `providers.lock.json`):

- ship.page (no account, ZIP upload, returns URL; default CN candidate)
- Netlify anonymous deploy (fallback)
- Other candidates only when enabled and tested.

## Tunnels

Tunnel providers are last-resort fallback only. The provider registry controls enablement.

## Completion

Return deployment URL, provider, URL lifetime, and update instructions.