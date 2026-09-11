import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatRecoveryPluginRemoveFailure,
  recoveryPluginEnvironment,
  RecoveryPluginUninstallError,
  removeRecoveryPlugin,
} from '../src/recovery-plugin-uninstall.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-recovery-plugin-uninstall-'))
  roots.push(root)
  const profileDir = join(root, 'home', 'profiles', 'desktop')
  const nodeBinDir = join(root, 'runtime', 'node-bin')
  const pnpmBinDir = join(root, 'runtime', 'pnpm-bin')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(nodeBinDir, { recursive: true })
  mkdirSync(pnpmBinDir, { recursive: true })
  return {
    profileName: 'desktop',
    profileDir,
    homeDir: join(root, 'home'),
    nodeBinDir,
    nodeShimPath: join(nodeBinDir, 'node'),
    pnpmBinDir,
    electronVersion: '43.4.0',
    packageName: 'third-party-plugin',
  }
}

/** The pnpm command name the recovery environment resolves first on PATH. */
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

/** Write the `pnpm` shim the recovery path resolves, running `script`. */
function writePnpmShim(pnpmBinDir: string, script: string): void {
  const target = join(pnpmBinDir, PNPM_COMMAND)
  writeFileSync(target, process.platform === 'win32'
    ? `@"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
  if (process.platform !== 'win32') chmodSync(target, 0o700)
}

describe('pre-Host recovery plugin uninstall command', () => {
  it('pins packaged Node and pnpm ahead of a released or hostile system PATH', () => {
    const options = fixture()
    const systemBin = join(dirname(options.profileDir), 'system-bin')
    const environment = recoveryPluginEnvironment({
      ...options,
      environment: { PATH: systemBin, KEEP: 'value' },
    })

    expect(environment.PATH?.split(delimiter)).toEqual([
      options.nodeBinDir,
      options.pnpmBinDir,
      systemBin,
    ])
    expect(environment).toMatchObject({
      NODE: options.nodeShimPath,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: options.homeDir,
      KEEP: 'value',
    })
  })

  it('normalizes the case-insensitive Windows PATH before projecting recovery commands', () => {
    const options = fixture()
    const systemBin = 'C:\\System Pnpm'
    const environment = recoveryPluginEnvironment({
      ...options,
      environment: { Path: systemBin, KEEP: 'value' },
    }, 'win32')

    expect(environment.PATH).toBe(`${options.nodeBinDir};${options.pnpmBinDir};${systemBin}`)
    expect(environment).not.toHaveProperty('Path')
    expect(environment.KEEP).toBe('value')
  })

  it('runs the packaged pnpm remove argv inside the selected Profile directory', async () => {
    const options = fixture()
    const systemBin = join(dirname(options.profileDir), 'system-bin')
    const echo = join(options.pnpmBinDir, 'echo-pnpm.cjs')
    writeFileSync(echo, 'process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), home: process.env.DSH_HOME, path: process.env.PATH }))\n')
    writePnpmShim(options.pnpmBinDir, echo)
    const result = await removeRecoveryPlugin({ ...options, environment: { PATH: systemBin } })
    expect(JSON.parse(result.stdout)).toEqual({
      // pnpm's own argument vector, not a `dsh plugin` forward: Harness 0.1.5 refuses the launcher for
      // a profile named `desktop`, so the recovery path calls the package manager directly.
      argv: ['remove', 'third-party-plugin'],
      cwd: options.profileDir,
      home: options.homeDir,
      path: [options.nodeBinDir, options.pnpmBinDir, systemBin].join(delimiter),
    })
    expect(result).toMatchObject({
      packageName: 'third-party-plugin',
      profileName: 'desktop',
      exitCode: 0,
    })
  })

  it('uses packaged pnpm after runtime PATH release and preserves official bundle reconciliation', async () => {
    const base = fixture()
    const systemBin = join(dirname(base.profileDir), 'system-bin')
    const selectedMarker = join(dirname(base.profileDir), 'selected-pnpm.txt')
    const packagedScript = join(base.pnpmBinDir, 'packaged-pnpm.cjs')
    const systemScript = join(systemBin, 'system-pnpm.cjs')
    const installedPluginDir = join(base.profileDir, 'node_modules', 'third-party-plugin')
    const lockfilePath = join(base.profileDir, 'pnpm-lock.yaml')
    const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    mkdirSync(systemBin, { recursive: true })
    writeFileSync(join(base.profileDir, 'package.json'), `${JSON.stringify({
      name: 'recovery-profile',
      private: true,
      dependencies: { 'third-party-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['dsh-base', 'third-party-plugin'] } },
    }, null, 2)}\n`)
    mkdirSync(installedPluginDir, { recursive: true })
    writeFileSync(join(installedPluginDir, 'package.json'), '{"name":"third-party-plugin","version":"1.0.0"}\n')
    writeFileSync(lockfilePath, [
      "lockfileVersion: '9.0'",
      'importers:',
      '  .:',
      '    dependencies:',
      '      third-party-plugin:',
      '        specifier: 1.0.0',
      '        version: 1.0.0',
      '',
    ].join('\n'))
    writeFileSync(packagedScript, [
      "const { readFileSync, rmSync, writeFileSync } = require('node:fs')",
      "const { join } = require('node:path')",
      "const manifestPath = join(process.cwd(), 'package.json')",
      "const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))",
      "delete manifest.dependencies[process.argv.at(-1)]",
      "writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\\n`)",
      "writeFileSync(join(process.cwd(), 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\\nimporters:\\n  .: {}\\n`)",
      "rmSync(join(process.cwd(), 'node_modules', process.argv.at(-1)), { recursive: true, force: true })",
      "writeFileSync(process.env.PNPM_SELECTION_MARKER, 'packaged-11.8.0')",
      '',
    ].join('\n'))
    writeFileSync(systemScript, [
      "const { writeFileSync } = require('node:fs')",
      "writeFileSync(process.env.PNPM_SELECTION_MARKER, 'system-pnpm')",
      'process.exitCode = 91',
      '',
    ].join('\n'))
    const commandShim = (script: string): string => process.platform === 'win32'
      ? `@"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`
    const packagedCommand = join(base.pnpmBinDir, pnpmCommand)
    const systemCommand = join(systemBin, pnpmCommand)
    writeFileSync(packagedCommand, commandShim(packagedScript))
    writeFileSync(systemCommand, commandShim(systemScript))
    if (process.platform !== 'win32') {
      chmodSync(packagedCommand, 0o700)
      chmodSync(systemCommand, 0o700)
    }

    // A released runtime yields its own PATH but keeps the standard Windows
    // shell variables every real process inherits; upstream `dsh plugin`
    // reaches pnpm through `spawnSync(..., { shell: true })`, which resolves
    // the shell from ComSpec (and needs SystemRoot/PATHEXT for a usable one).
    const windowsShell = process.platform === 'win32'
      ? {
          ComSpec: process.env.ComSpec ?? 'cmd.exe',
          SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
          PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
        }
      : {}
    await expect(removeRecoveryPlugin({
      ...base,
      environment: {
        ...windowsShell,
        PATH: systemBin,
        PNPM_SELECTION_MARKER: selectedMarker,
      },
    })).resolves.toMatchObject({ exitCode: 0 })

    expect(readFileSync(selectedMarker, 'utf8')).toBe('packaged-11.8.0')
    const manifest = JSON.parse(readFileSync(join(base.profileDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>
      dsh?: { profile?: { bundles?: unknown[] } }
    }
    expect(manifest.dependencies).not.toHaveProperty('third-party-plugin')
    expect(manifest.dsh?.profile?.bundles).toEqual(['dsh-base'])
    expect(readFileSync(lockfilePath, 'utf8')).not.toContain('third-party-plugin')
    expect(existsSync(installedPluginDir)).toBe(false)
  })

  it('retains bounded command diagnostics when pnpm remove fails', async () => {
    const options = fixture()
    const failing = join(options.pnpmBinDir, 'failing-pnpm.cjs')
    writeFileSync(failing, "process.stderr.write('simulated remove failure\\n'); process.exitCode = 7\n")
    writePnpmShim(options.pnpmBinDir, failing)
    let failure: unknown
    try { await removeRecoveryPlugin(options) } catch (cause) { failure = cause }
    expect(failure).toBeInstanceOf(RecoveryPluginUninstallError)
    const detail = formatRecoveryPluginRemoveFailure(failure)
    expect(detail).toContain('pnpm remove third-party-plugin')
    expect(detail).toContain('Package-manager policy: --config.minimumReleaseAge=0')
    expect(detail).toContain('Exit status: 7')
    expect(detail).toContain('simulated remove failure')
  })
})
