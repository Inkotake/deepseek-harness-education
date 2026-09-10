---
name: publish-static
description: Publish a finished static teaching artifact or web project to a shareable URL. Detects existing hosting, discovers and ranks a suitable provider, handles mainland-China quick-share failover, verifies the deployed files over HTTP, and reports lifetime, ownership, and how to keep the site.
whenToUse: Use when the user asks to deploy, publish, host, share online, create a public link for, or put online a generated static website, teaching artifact, or classroom demo.
user-invocable: true
disable-model-invocation: false
metadata:
  teacher-dsh:
    version: 1
    cli: teacher-publish
---

# Publish Static

Publish an already-built static site or teaching artifact so a teacher can share a link.

Always go through the bundled `teacher-publish` CLI. Do not hand-write provider HTTP requests,
`curl` invocations, archive formats, or checksums: the CLI owns every provider protocol, retry, and
verification step, and it is the only component that may declare a deployment verified.

```bash
teacher-publish detect
teacher-publish inspect <dir> --json
teacher-publish plan <dir> --mode <mode> --json
teacher-publish deploy <dir> --mode <mode> --auto --json
teacher-publish verify <url> <dir> --json
teacher-publish providers --json
```

## Decide the mode

| The user says | Mode |
|---|---|
| 发网上, 分享一下, 给我个链接, 临时发布, put it online so I can show the class | `quick-share` |
| 正式发布, 上线, 部署到我们的站点, custom domain, update our existing site | `persistent` |
| expose the localhost page I am running right now | `tunnel` |

When the user clearly asks to publish, deploy, host, or share the site online, that request already
authorizes the normal deployment action. Normal deployments do **not** need a separate confirmation
beyond the safety conditions below. Do not ask "shall I publish?" and then publish; publish and
report the result.

## Locate the artifact

Prefer a finished build output, in this order:

1. a path the user gave you
2. the output recorded by Teacher Artifact tooling (the project's `dist/`)
3. `dist/`
4. `build/`
5. `out/`
6. a directory containing `index.html` that is clearly a finished static artifact

Never publish the whole workspace when a build output exists. Never publish `node_modules/`,
`.git/`, source trees, the Teacher DSH runtime directories, or a parent directory merely because it
contains an `index.html`.

If this is a Teacher Artifact project that has not been built or checked yet, run
`teacher-artifact build` and `teacher-artifact check` first and make sure `check` exits 0.

## Inspect before uploading

```bash
teacher-publish inspect <dir> --json
```

Inspection reports file count, total bytes, largest file, extensions and MIME types, whether
`.glb` / `.gltf` / `.wasm` / fonts / video are present, whether source maps exist, whether the HTML
references files that are missing, and whether anything looks like a credential or private data.

Stop and ask the user before uploading when inspection finds:

- obvious secrets: `.env`, `.env.*`, `*.pem`, `*.key`, private SSH keys, credential files, cloud
  access tokens
- for teaching projects, files whose names suggest student records, grades, rosters, contact
  details, or other personal information

Do not publish source maps unless the user explicitly needs them.

## Provider selection is decided by the CLI, not by you

```bash
teacher-publish plan <dir> --mode quick-share --json
teacher-publish deploy <dir> --mode quick-share --auto --json
```

The planner considers existing provider configuration, deployment mode, required file extensions,
file count and total size, provider limits, expected lifetime, recent local provider health,
mainland-China priority, and authentication requirements. `--auto` runs the plan with failover,
`--provider <id>` forces one provider, and `--dry-run` shows what would happen without uploading.

Never construct a deployment hostname, subdomain, or slug yourself. The public URL is **always**
the value the provider returned. A URL that merely matches a provider's naming convention is not
evidence of a successful deployment.

Never choose a provider by nominal latency. A provider that cannot serve a required asset type is
**incompatible**, not merely lower priority — a provider whose file-type allowlist excludes `.glb`
must never be attempted for an artifact containing a model file. The planner already enforces this;
do not override it.

Never attempt a provider the registry marks disabled. Some historically listed services no longer
exist; a disabled entry is not revived by appearing in older documentation.

## Success is decided by verification, not by the upload

An HTTP 2xx from an upload is only a *candidate* success. The CLI reports `success: true` only after
it has fetched the deployed files back and compared their SHA-256 digests against a local manifest.
Treat a deployment as successful only when the JSON says:

```json
"verification": { "passed": true, "method": "http-sha256" }
```

If verification did not pass, the deployment failed — even if a URL came back. Do not present an
unverified URL as a working link. A root page returning 200 while a required `.glb` returns 404 is
a failed deployment.

## Modes and failover

- `quick-share` may fail over freely among compatible anonymous providers.
- `persistent` must **never** silently downgrade to a temporary anonymous host. If the established
  provider fails to authenticate or deploy, stop and tell the user which provider failed and why.
  Finding a 3-day anonymous mirror instead of the school's real site is worse than reporting a
  failure.
- `tunnel` results are session-scoped. Say explicitly that the link only works while Teacher DSH
  and the local page stay running. Never describe a tunnel URL as a published website.

## Reporting the result to the teacher

On success, report:

- the public URL
- the provider used
- whether the deployment is temporary or persistent, and the expiry when the provider returns one
- whether remote verification passed
- whether browser/WebGL rendering was actually tested, or only HTTP integrity — never claim a
  browser check that did not happen
- ownership/claim instructions when the provider returned a claim value

**Claim links are capability-bearing.** Anyone who has a claim URL or token can take ownership of
the deployment. Present them in a separate block, never on the same line as the share URL, and say
plainly that the claim link must not be forwarded to students or colleagues.

Keep the success message short. If failover happened, say in one clause that the first provider was
unavailable and another verified provider was used; do not dump every attempt.

## When everything fails

Do not report the last upload URL as usable. Report concisely:

- which provider classes were attempted
- the dominant failure reason
- whether the artifact itself passed local inspection
- the single most useful next action

## Never do this

- Do not modify the artifact to satisfy one hosting provider. In particular, never delete or convert
  a `.glb` model, downgrade a texture, or strip a feature merely to make a provider that rejects
  that file type succeed while GLB-capable providers remain available.
- Do not reimplement provider HTTP protocols with `curl` "just in case". If the bundled CLI is
  genuinely unavailable, say so instead of improvising an upload.
- Do not publish a directory that inspection blocked, and do not publish around a secret finding.
