#!/usr/bin/env node
/**
 * Secret gate: fail the build if a real credential is about to be published.
 *
 * This scans the *tracked* tree (`git ls-files`), not the working directory, because only
 * tracked content can reach GitHub. It is deliberately narrow: it matches high-confidence
 * credential shapes, so that ordinary words like "token" or "apiKey" do not fail the build.
 *
 * Upstream test fixtures contain deliberately fake credentials (for example AWS's documented
 * `AKIAIOSFODNN7EXAMPLE` and a dummy private key block inside a redaction spec). Those exact
 * strings are allow-listed by value, so the gate stays meaningful instead of being tuned down
 * until it never fires.
 *
 * It additionally refuses to publish the build machine's own paths, which would leak a
 * developer's local layout into a public repository.
 *
 * Usage:
 *   node scripts/teacher/verify-no-secrets.mjs [--json]
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const JSON_OUTPUT = process.argv.includes('--json')

/** Text files worth scanning; anything else is treated as binary and skipped. */
const TEXT_EXTENSIONS = /\.(?:js|mjs|cjs|jsx|ts|tsx|json|json5|yaml|yml|toml|md|markdown|txt|env|ini|cfg|conf|sh|bash|ps1|cmd|bat|nsh|html|htm|css|scss|xml|svg|cs|py|go|rs|java|rb|php|sql)$/iu

/** Files that are allowed to contain credential-shaped strings, by exact path. */
const PATH_ALLOWLIST = new Set([
  // Redaction tests whose whole purpose is to prove that secrets do NOT leak.
  'resources/teacher-seed/plugins/dsh-better-sidebar/tests/redact.spec.ts',
  'teacher/vendor-skills/vercel-web-design/packages/vercel-optimize/tests/test/vercel-redaction.test.mjs',
  'dsh-plugin-desktop/tests/mask-secrets.spec.ts',
])

/**
 * Exact literal strings that are documented placeholders, allow-listed by value so that a real
 * credential of the same shape still fails the gate.
 */
const VALUE_ALLOWLIST = [
  'AKIAIOSFODNN7EXAMPLE', // AWS's own documentation example key
  'ghp_abcdefghijklmnopqrst', // short, non-token-length placeholder used by redaction tests
  'sk-imaginary-placeholder',
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', // AWS documentation example secret
]

/**
 * High-confidence credential shapes. Length floors are chosen so that short placeholders used in
 * test fixtures cannot match; a real GitHub token is `ghp_` plus 36 characters.
 */
const RULES = [
  { id: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/gu },
  { id: 'github-fine-grained-pat', pattern: /github_pat_[A-Za-z0-9_]{60,}/gu },
  { id: 'openai-key', pattern: /sk-(?!imaginary)[A-Za-z0-9_-]{40,}/gu },
  { id: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{40,}/gu },
  { id: 'aws-access-key-id', pattern: /(?:AKIA|ASIA)[0-9A-Z]{16}/gu },
  { id: 'google-api-key', pattern: /AIza[0-9A-Za-z_-]{35}/gu },
  { id: 'slack-token', pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/gu },
  { id: 'private-key-block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/gu },
  { id: 'bearer-literal', pattern: /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._-]{40,}/gu },
]

/**
 * Local-layout leaks: this machine's own user profile must not be published.
 *
 * The rule is deliberately keyed to the *local* user name rather than a generic path shape,
 * because upstream test fixtures legitimately contain paths such as `/Users/test` and
 * `/home/tester`. Matching only the real user name keeps the gate precise: it fires when a
 * developer's own home directory leaks, and stays quiet for every placeholder.
 */
function pathLeakRules() {
  const user = os.userInfo().username
  const escaped = user.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return [
    { id: 'windows-user-profile', pattern: new RegExp(`[A-Za-z]:\\\\Users\\\\${escaped}\\\\`, 'giu') },
    { id: 'posix-home', pattern: new RegExp(`/(?:home|Users)/${escaped}/`, 'gu') },
  ]
}

/** One tracked file and its text content, or null for binary/oversized files. */
function readTracked(file) {
  if (!TEXT_EXTENSIONS.test(file) && path.basename(file) !== '.gitignore' && !file.startsWith('.github/')) {
    return null
  }
  const absolute = path.join(ROOT, file)
  let stat
  try {
    stat = fs.statSync(absolute)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return null
  try {
    const text = fs.readFileSync(absolute, 'utf8')
    // A NUL byte in the first block means binary.
    return text.includes('\0') ? null : text
  } catch {
    return null
  }
}

function main() {
  let tracked
  try {
    tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
  } catch (cause) {
    process.stderr.write(`[verify-no-secrets] FAIL cannot list tracked files: ${String(cause)}\n`)
    process.exitCode = 1
    return
  }

  const findings = []
  const pathRules = pathLeakRules()
  let scanned = 0
  for (const file of tracked) {
    const text = readTracked(file)
    if (text === null) continue
    scanned += 1
    const allowlistedFile = PATH_ALLOWLIST.has(file)
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0
      for (const match of text.matchAll(rule.pattern)) {
        const value = match[0]
        if (VALUE_ALLOWLIST.some(allowed => value.includes(allowed))) continue
        if (allowlistedFile) continue
        findings.push({ id: rule.id, file, value: redact(value) })
      }
    }
    for (const rule of pathRules) {
      rule.pattern.lastIndex = 0
      for (const match of text.matchAll(rule.pattern)) {
        findings.push({ id: rule.id, file, value: redact(match[0]) })
      }
    }
  }

  // The token a developer keeps in `.git/config` must never be tracked.
  for (const file of tracked) {
    if (path.basename(file) === 'config' && file.includes('.git')) {
      findings.push({ id: 'git-config-tracked', file, value: 'a .git/config file is tracked' })
    }
  }

  // A credential embedded in a remote URL is a local convenience, not a publishable secret, so
  // this is a warning rather than a failure: `.git/config` is never tracked or pushed. It is
  // reported because `git remote -v` output, terminal logs, and screenshots all expose it.
  const remoteWarnings = credentialRemoteWarnings()

  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify({ scanned, findings, remoteWarnings }, null, 2)}\n`)
  }

  for (const warning of remoteWarnings) {
    process.stderr.write(`[verify-no-secrets] WARN ${warning}\n`)
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(`[verify-no-secrets] FAIL ${finding.id} in ${finding.file}: ${finding.value}\n`)
    }
    process.stderr.write(
      `[verify-no-secrets] ${String(findings.length)} potential secret(s) would be published.`
      + ' Move them out of the tracked tree, or add the exact placeholder to VALUE_ALLOWLIST.\n',
    )
    process.exitCode = 1
    return
  }
  process.stdout.write(`[verify-no-secrets] OK ${String(scanned)} tracked text files scanned, no credentials or local paths\n`)
}

/** Keep a short, non-reversible fingerprint so the log is useful without leaking the value. */
function redact(value) {
  const trimmed = value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
  return `${trimmed} (${String(value.length)} chars)`
}

/**
 * Report, without failing, any git remote whose URL embeds a credential.
 *
 * `.git/config` is never part of the tracked tree, so a token stored there cannot reach GitHub.
 * It is still worth surfacing, because `git remote -v`, CI logs, terminal scrollback, and
 * screenshots all render the URL in full.
 */
function credentialRemoteWarnings() {
  let config
  try {
    config = fs.readFileSync(path.join(ROOT, '.git', 'config'), 'utf8')
  } catch {
    return []
  }
  const warnings = []
  for (const match of config.matchAll(/url\s*=\s*(\S+)/gu)) {
    const url = match[1]
    const credential = /^https?:\/\/[^/@\s]*:[^/@\s]+@/u.exec(url)
    if (credential === null) continue
    const safe = `${url.slice(0, url.indexOf('@') + 1).replace(credential[0], `${credential[0].split(':')[0]}:***@`)}${url.slice(url.indexOf('@') + 1)}`
    warnings.push(
      `a git remote URL embeds a credential and will be shown by \`git remote -v\`: ${safe}`
      + ' - this is local-only and is never pushed, but rotate the token if it was ever shared.',
    )
  }
  return warnings
}

main()
