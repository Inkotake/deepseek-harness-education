/** Run the official DSH plugin-removal flow before the Cordis Host starts. */

import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { assertDesktopProfileName } from './profile-manager.ts'
import { PNPM_IGNORE_MINIMUM_RELEASE_AGE } from './pnpm-policy.ts'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024
const ELECTRON_HEADERS_URL = 'https://electronjs.org/headers'
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

/**
 * The package manager the recovery environment puts first on PATH.
 *
 * `dsh plugin --profile <name> <args...>` forwards its arguments to pnpm inside the profile
 * directory and does nothing else, so calling pnpm directly is the same operation without the
 * launcher. It has to be direct: Harness 0.1.5 rejects any CLI invocation that names a profile
 * literally called `desktop` (`rejectElectronProfile` in the CLI's argument parser, reached from
 * both the boot path and the `plugin` command), which is exactly the profile this removes from.
 */
const PNPM_COMMAND = 'pnpm'

export interface RecoveryPluginUninstallOptions {
  readonly profileName: string
  readonly profileDir: string
  readonly homeDir: string
  readonly nodeBinDir: string
  readonly nodeShimPath: string
  /** Directory containing Desktop's packaged pnpm command shim. */
  readonly pnpmBinDir: string
  readonly electronVersion: string
  readonly packageName: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
  /** Injectable only for focused environment-isolation tests. */
  readonly environment?: NodeJS.ProcessEnv
}

export interface RecoveryPluginUninstallResult {
  readonly packageName: string
  readonly profileName: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export class RecoveryPluginUninstallError extends Error {
  constructor(
    message: string,
    readonly result?: Omit<RecoveryPluginUninstallResult, 'exitCode'> & {
      readonly exitCode: number | string | null
      readonly signal: NodeJS.Signals | null
    },
  ) {
    super(message)
    this.name = 'RecoveryPluginUninstallError'
  }
}

function assertAbsolutePath(label: string, value: string): void {
  if (value.length === 0 || value.includes('\0') || !isAbsolute(value)) {
    throw new RecoveryPluginUninstallError(`recovery plugin uninstall ${label} must be an absolute path without NUL`)
  }
}

function inheritedPath(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const exact = environment.PATH
  if (exact !== undefined || platform !== 'win32') return exact ?? ''
  return Object.entries(environment).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
}

/** Build the fixed Desktop command environment used after Host quiescence. */
export function recoveryPluginEnvironment(
  options: Pick<RecoveryPluginUninstallOptions,
    | 'homeDir'
    | 'nodeBinDir'
    | 'nodeShimPath'
    | 'pnpmBinDir'
    | 'electronVersion'
    | 'environment'>,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment = { ...(options.environment ?? process.env) }
  if (platform === 'win32') {
    for (const key of Object.keys(environment)) {
      if (key.toUpperCase() === 'PATH') delete environment[key]
    }
  }
  const path = inheritedPath(options.environment ?? process.env, platform)
  environment.PATH = [options.nodeBinDir, options.pnpmBinDir, path]
    .filter(value => value.length > 0)
    .join(platform === 'win32' ? ';' : ':')
  environment.NODE = options.nodeShimPath
  environment.ELECTRON_RUN_AS_NODE = '1'
  environment.DSH_HOME = options.homeDir
  environment.CI = 'true'
  environment.npm_config_runtime = 'electron'
  environment.npm_config_target = options.electronVersion
  environment.npm_config_disturl = ELECTRON_HEADERS_URL
  return environment
}

function diagnosticStream(label: string, value: string): string | undefined {
  const normalized = value.trim()
  return normalized.length === 0 ? undefined : `${label}:\n${normalized}`
}

/** Bounded technical context suitable for a local Desktop error window. */
export function formatRecoveryPluginRemoveFailure(cause: unknown): string {
  if (!(cause instanceof RecoveryPluginUninstallError) || cause.result === undefined) {
    return cause instanceof Error ? cause.stack ?? cause.message : String(cause)
  }
  return [
    'DSH plugin uninstall failed.',
    `Command: ${PNPM_COMMAND} remove ${cause.result.packageName} (in profile ${cause.result.profileName})`,
    `Package-manager policy: ${PNPM_IGNORE_MINIMUM_RELEASE_AGE}`,
    `Exit status: ${String(cause.result.exitCode)}`,
    `Signal: ${cause.result.signal ?? 'none'}`,
    diagnosticStream('stderr', cause.result.stderr),
    diagnosticStream('stdout', cause.result.stdout),
  ].filter((section): section is string => section !== undefined).join('\n\n')
}

/**
 * Drop one package from the profile's declared bundle list.
 *
 * `pnpm remove` rewrites the dependency and the lockfile but knows nothing about this distribution's
 * `dsh.profile.bundles` field. A profile that keeps naming a removed bundle fails to compose on the
 * next boot, which is the one outcome a recovery path must not leave behind. Missing or unreadable
 * structure is left alone: there is nothing to reconcile, and this runs while the app is already
 * recovering.
 * @param profileDir - the profile directory pnpm just rewrote.
 * @param packageName - the package to drop from the bundle list.
 */
function reconcileProfileBundles(profileDir: string, packageName: string): void {
  const manifestPath = join(profileDir, 'package.json')
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  } catch {
    return
  }
  const dsh = manifest.dsh
  if (typeof dsh !== 'object' || dsh === null) return
  const profile = (dsh as Record<string, unknown>).profile
  if (typeof profile !== 'object' || profile === null) return
  const bundles = (profile as Record<string, unknown>).bundles
  if (!Array.isArray(bundles)) return
  const next = bundles.filter(entry => entry !== packageName)
  if (next.length === bundles.length) return
  ;(profile as Record<string, unknown>).bundles = next
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * Remove one direct Profile dependency with the packaged pnpm, then reconcile the bundle list.
 *
 * `dsh plugin --profile <name> remove <pkg>` is a thin forwarder to pnpm in the profile directory,
 * so this performs the same mutation without the launcher — which refuses the call outright because
 * this profile is named `desktop`.
 */
export async function removeRecoveryPlugin(
  options: RecoveryPluginUninstallOptions,
): Promise<RecoveryPluginUninstallResult> {
  assertDesktopProfileName(options.profileName)
  if (!PACKAGE_NAME_PATTERN.test(options.packageName)) {
    throw new RecoveryPluginUninstallError('recovery plugin uninstall package name is invalid')
  }
  for (const [label, value] of [
    ['Profile directory', options.profileDir],
    ['Harness home', options.homeDir],
    ['Node command directory', options.nodeBinDir],
    ['Node command', options.nodeShimPath],
    ['pnpm command directory', options.pnpmBinDir],
  ] as const) assertAbsolutePath(label, value)
  if (options.electronVersion.length === 0 || options.electronVersion.includes('\0')) {
    throw new RecoveryPluginUninstallError('recovery plugin uninstall Electron version is invalid')
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBuffer = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(maxBuffer) || maxBuffer <= 0) {
    throw new RecoveryPluginUninstallError('recovery plugin uninstall process limits are invalid')
  }
  options.signal?.throwIfAborted()
  // Do not forward the pnpm policy here. The packaged pnpm command shim adds
  // it at the actual package-manager boundary; forwarding it too makes pnpm
  // parse the numeric option as an array and produces an invalid cutoff date.
  return await new Promise<RecoveryPluginUninstallResult>((resolve, reject) => {
    execFile(PNPM_COMMAND, ['remove', options.packageName], {
      cwd: options.profileDir,
      encoding: 'utf8',
      env: recoveryPluginEnvironment(options),
      maxBuffer,
      timeout: timeoutMs,
      windowsHide: true,
      // The packaged pnpm is a `.cmd` shim on Windows, which CreateProcess cannot launch directly.
      // `packageName` was checked against PACKAGE_NAME_PATTERN above, so no shell metacharacter can
      // reach the command line.
      shell: process.platform === 'win32',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }, (cause, stdout, stderr) => {
      if (cause === null) {
        try {
          reconcileProfileBundles(options.profileDir, options.packageName)
        } catch (reconcileCause) {
          reject(new RecoveryPluginUninstallError(
            `pnpm removed ${options.packageName} but its profile bundle entry could not be dropped`,
            {
              packageName: options.packageName,
              profileName: options.profileName,
              exitCode: 0,
              signal: null,
              stdout,
              stderr: `${stderr}\n${String(reconcileCause)}`,
            },
          ))
          return
        }
        resolve({
          packageName: options.packageName,
          profileName: options.profileName,
          exitCode: 0,
          stdout,
          stderr,
        })
        return
      }
      reject(new RecoveryPluginUninstallError(
        `pnpm remove exited unsuccessfully (code=${String(cause.code)}, signal=${String(cause.signal)})`,
        {
          packageName: options.packageName,
          profileName: options.profileName,
          exitCode: cause.code ?? null,
          signal: cause.signal ?? null,
          stdout,
          stderr,
        },
      ))
    })
  })
}
