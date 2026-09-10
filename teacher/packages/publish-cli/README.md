# @teacher-dsh/publish-cli

`teacher-publish` publishes a built static teaching artifact (the `dist/` a
`teacher-artifact build` produces) to a static host and then **proves** the result is really
there. It is the only component allowed to talk to a hosting service, and it never installs
anything: every provider protocol is implemented in-process, and the four persistent providers
are driven through the CLIs bundled in `resources/teacher-runtime/deploy`.

The CLI is English-only and has no dependencies outside the Node.js standard library.

```powershell
node bin/teacher-publish.mjs detect
node bin/teacher-publish.mjs plan --mode quick-share
node bin/teacher-publish.mjs deploy --mode quick-share --auto
```

## Commands

| Command | Purpose |
|---|---|
| `detect [dir]` | Find the static artifact (`dist`, `build`, `public`, `out`, or any directory holding `index.html`) and report the registry, enabled providers, project config markers, git remote and installed tunnel tools. |
| `inspect [dir]` | Build the byte-level manifest and run the safety scan. Reports file count, total bytes, largest file, extension inventory, referenced-but-missing assets, and every blocked/warned file. |
| `plan [dir]` | Order the candidate providers for one mode and explain each decision (eligible, disabled, incompatible, circuit-open). Contacts no provider. |
| `deploy [dir]` | Walk the plan, upload, and verify. This is the only command that mutates remote state. |
| `verify <url> [dir]` | Compare the served bytes against the local manifest by SHA-256. Without `[dir]` only the root document can be checked, which is reported as a partial (`root-only`) result. |
| `providers` | Print the merged registry: builtin fields plus the overlay and the local health cache, including whether an adapter is actually available. |
| `tunnel detect\|start` | Detect a local tunnel CLI (`cloudflared`, `lt`, `ngrok`) or expose localhost for the lifetime of the process. Teacher DSH bundles no tunnel and installs none. |

Every command accepts an optional directory; the default is the current working directory, and
discovery descends up to three levels.

## Flags

| Flag | Applies to | Meaning |
|---|---|---|
| `--json` | all | Print exactly one JSON document on stdout. Every diagnostic goes to stderr. |
| `--mode <quick-share\|persistent\|tunnel>` | `plan`, `deploy` | Select the deployment mode. Default `quick-share`. |
| `--auto` | `deploy` | Never prompt for confirmation. |
| `--provider <id>` | `deploy` | Restrict the attempt to one provider id. A disabled provider is refused with its `disabledReason`. |
| `--dry-run` | `deploy` | Print the order and exit 0 without contacting anything. |
| `--no-verify` | `deploy` | Skip remote verification. The deployment is then never reported as `success: true`. |
| `--allow-inexact` | `plan`, `deploy` | Also consider hosts that rewrite HTML on the wire (ShipStatic, here.now, aft.page). Excluded by default because rewritten HTML can never pass a byte comparison; with this flag HTML is presence-checked and every other resource is still hash-verified. |
| `--timeout <ms>` | network commands | Request timeout. |
| `--verbose` | all | Trace diagnostics on stderr. |
| `--help` | all | Print usage. |

## Success rule

An HTTP 2xx from an upload is only a **candidate success**. `deploy` reports `success: true` only
after `verify` has compared the served bytes against the local manifest:

- every resource is fetched again over HTTPS and its SHA-256 is compared with the local hash;
- under the default `strict` HTML policy every file, HTML included, must match byte for byte;
- under `presence-only` (opt-in via `--allow-inexact`) the HTML is presence-checked instead, and
  the result is flagged with `htmlExact: false` rather than reported as fully byte-verified;
- a deployment whose verification cannot run is treated as **failed**, never as a success.

`--no-verify` therefore cannot produce a verified success. In `persistent` mode, a failed
provider is never silently downgraded to an anonymous temporary host: the command stops with the
failure and a `nextAction`.

## `--json` output contract

With `--json`, stdout carries exactly one parseable JSON document and nothing else; all progress,
warnings and errors go to stderr, so a caller can pipe stdout straight into a JSON parser.

| Command | Top-level keys |
|---|---|
| `detect` | `ok`, `requested`, `searched`, `artifact`, `candidates`, `providerIds` (`providers`), `project`, `tunnel`, `registryFile` |
| `inspect` | `dir`, `fileCount`, `totalBytes`, `largestFile`, `extensions`, `features`, `manifest`, `blocked`, `warnings`, `missingReferences`, `clean` |
| `plan` | `mode`, `dir`, `artifact`, `plan`, `context`, `healthFile`, `safety` |
| `deploy` | on success: `success`, `mode`, `attempts`, `provider`, `url`, `urlSource`, `persistence`, `expiresAt`, `claim`, `verification`, `artifact`; on failure: `success: false`, `mode`, `attempts`, `artifactOk`, `reason`, `nextAction` |
| `verify` | `success`, `mode` (`manifest` or `root-only`), `url`, `verification` |
| `providers` | `ok`, `registryFile`, `registryVersion`, `updatedAt`, `overlay`, `warnings`, `healthFile`, `health`, `providers[]`, `modes` |

`verification` always carries `passed`, `method`, `filesExpected`, `filesRequired`,
`filesVerified`, `bytesVerified`, `problems`, `failures`, `mismatches` and a human `note`. A
claim value (`claim_token`, `editToken`, `artifactToken`, …) grants ownership and is returned
exactly once; it is never a share link.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | The command succeeded. |
| 1 | `deploy` uploaded but did not reach a verified success, or an unexpected error. |
| 2 | Usage error (unknown flag/command, bad `--mode`, bad `--port`). |
| 3 | No static artifact found. |
| 4 | `inspect` found hard-blocked files (credentials, keys, class data). |
| 5 | The provider registry is unusable (or `providers` could not load it). |
| 6 | `plan` produced no eligible provider for the requested mode. |
| 7 | `verify` failed. |
| 8 | `tunnel` is unsupported on this machine (no tunnel CLI installed). |

Nothing is ever uploaded while the safety scan has a hard block.

## Where the provider policy lives

The provider table is **not** hard-coded in the adapters. A shipped, signed registry
(`config/providers.json`) is authoritative for identity and protocol, and an optional overlay may
only adjust presentation and availability:

| Layer | Source | Owns |
|---|---|---|
| Builtin | `config/providers.json` (overridable with `TEACHER_PUBLISH_REGISTRY`) | `adapter`, `endpoint`, `protocol`, `allowedHosts`, `capabilities`, `modes`, `id`, `persistent` |
| Overlay | `TEACHER_PUBLISH_STATUS_FILE`, else `<TEACHER_DSH_HOME>/publish-provider-status.json` | `enabled`, `priority`, `health`, `lastValidated`, `notes` |

The overlay is read from disk, never fetched: there is no network call in the registry path. Any
overlay entry that tries to move an endpoint, swap an adapter or change a protocol is **refused
and reported** (`rejected[]`), not silently ignored. An overlay may name an unknown provider
(`unknownProviders[]`) or try to re-enable `wh-drop`, but `wh-drop` has no adapter at all —
`adapterAvailability()` returns false for it, so it can never be dispatched.

Registry validation is strict: every provider needs an adapter, a label, a boolean `enabled`, a
non-empty `modes` array, a non-empty `allowedHosts` array containing its own endpoint host, and a
complete `capabilities` object in which every documented limit is either an explicit value or
`null` ("the service documents no limit, so the client enforces none"). A disabled provider must
carry a `disabledReason`.

## Health cache and circuit breaker

Health state lives in `<TEACHER_DSH_HOME>/publish-provider-health.json` — never in the
installation directory, which is read-only after install. It is advisory, not authoritative: a
cache written by a future format version is ignored rather than misread.

Failures open a breaker so `deploy` cannot hammer a host that is down:

| Failure kind | Open for |
|---|---|
| `dns` | 24 h |
| `unreachable` | 20 min |
| `server` (5xx) | 10 min |
| `rateLimited` | 1 h |
| `auth` | 30 min (throttles retries; the health state stays `auth-required` because the service is up) |
| `capability` | 24 h |
| `integrity` (verification mismatch) | 6 h |
| `unknown` | 5 min |

Successes clear the breaker and reset the consecutive-failure count. A provider whose breaker is
open is reported as `circuitOpen` in `providers`/`plan` and skipped by `deploy`.

## Deployment modes

| Mode | Behaviour |
|---|---|
| `quick-share` (default) | Anonymous temporary host. Failover between compatible hosts is allowed; the URL expires (30 days for ship.page, less for others). Used for "send this to my class now". |
| `persistent` | Account-owned durable host (`netlify`, `cloudflare-pages`, `vercel`, `github-pages`), driven through the bundled CLIs. A provider is only selected when the project has configuration for it or its CLI is authenticated. Never downgraded to a temporary host. |
| `tunnel` | Session-only exposure of localhost through a tunnel CLI that must already be installed. Nothing is published and the result is explicitly not a durable deployment. |

## Documentation

[`docs/provider-protocols.md`](docs/provider-protocols.md) is the verified protocol reference and
the contract every adapter in `src/providers/` must satisfy. It includes the live observations
that refine or contradict the published documentation (ship.page's zip transport, ShipStatic's
`files[]` part name and HTML rewriting, here.now's `versionId`/`finalizeUrl`, aft.page serving a
generated wrapper page, Show's `*.127.dev` host, Dropley's unpublished extension allowlist) and
the per-provider limits that must be enforced *before* an upload.

## Known limitation: persistent providers are unverified

The anonymous quick-share paths were exercised against live services (including a real
ship.page deployment whose 62 files were all hash-verified). **The persistent success paths are
not**: `netlify`, `cloudflare-pages`, `vercel` and `github-pages` were implemented against their
documented CLI contracts, and only the unauthenticated failure path was exercised, because no
provider credentials were available during development. Do not treat a `persistent` deployment as
proven until it has been run against a real authenticated account.

## Development

```powershell
node tools/check-imports.mjs      # every module resolves from the shipped tree
node tools/smoke.mjs <artifact>   # command surface + --json contract, contacts no provider
node tools/probe-contracts.mjs    # re-measure the live anonymous providers
```
