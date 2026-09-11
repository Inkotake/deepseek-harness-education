import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DirectoryPickerBrowseCapability } from '@deepseek-ai/dsh-host-directory-picker'
import { afterEach, describe, expect, it, vi } from 'vitest'

const statState = vi.hoisted(() => ({
  calls: [] as string[],
  failures: new Set<string>(),
  stalls: new Map<string, () => void>(),
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    stat: (path: Parameters<typeof actual.stat>[0]) => {
      const key = String(path)
      statState.calls.push(key)
      if (statState.failures.has(key)) {
        return Promise.reject(Object.assign(new Error(`cannot stat ${key}`), { code: 'EPERM' }))
      }
      const started = statState.stalls.get(key)
      if (started !== undefined) {
        started()
        return new Promise<never>(() => {})
      }
      return actual.stat(path)
    },
  }
})

interface BrowseFixture {
  capability: DirectoryPickerBrowseCapability
  dispose(): Promise<void>
}

/**
 * Point `os.homedir()` at one fixture directory for the duration of a test.
 *
 * The backend resolves its starting point from `homedir()` on every call, so overriding the
 * variables that function reads is what lets a test choose a home directory with a Desktop and one
 * without. Windows reads `USERPROFILE`; POSIX reads `HOME`.
 */
function stubHomeDirectory(homeDirectory: string): () => void {
  const overridden = ['USERPROFILE', 'HOME'] as const
  const previous = overridden.map(name => [name, process.env[name]] as const)
  for (const name of overridden) process.env[name] = homeDirectory
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

async function browseFixture(): Promise<BrowseFixture> {
  vi.resetModules()
  const [{ Context }, { default: BrowseDirectoryPicker }] = await Promise.all([
    import('@deepseek-ai/cordis'),
    import('@deepseek-ai/dsh-host-directory-picker-browse'),
  ])
  const ctx = new Context()
  const fiber = ctx.plugin(BrowseDirectoryPicker)
  await fiber.await()
  const capability = ctx.get('directoryPicker')?.capability()
  if (capability?.kind !== 'browse') throw new Error('browse directory picker was not installed')
  return { capability, dispose: () => fiber.dispose() }
}

describe('alpha host directory-picker browse patch', () => {
  afterEach(() => {
    statState.calls.length = 0
    statState.failures.clear()
    statState.stalls.clear()
  })

  it('stats directory and symlink candidates and skips ordinary stat failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-browse-'))
    const accessible = join(root, 'accessible')
    const blockedDirectory = join(root, 'blocked-directory')
    const linkedTarget = join(root, 'linked-target')
    const blockedLink = join(root, 'blocked-link')
    await Promise.all([
      mkdir(accessible),
      mkdir(blockedDirectory),
      mkdir(linkedTarget),
    ])
    await symlink(linkedTarget, blockedLink, process.platform === 'win32' ? 'junction' : 'dir')
    statState.failures.add(blockedDirectory)
    statState.failures.add(blockedLink)
    const fixture = await browseFixture()

    try {
      const listing = await fixture.capability.list(root)
      expect(listing.entries.map(entry => entry.name)).toEqual(['accessible', 'linked-target'])
      expect(statState.calls).toEqual(expect.arrayContaining([
        accessible,
        blockedDirectory,
        blockedLink,
        linkedTarget,
      ]))
    } finally {
      await fixture.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('lets an abort interrupt a stalled stat of a directory candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-browse-abort-'))
    const stalled = join(root, 'stalled')
    await mkdir(stalled)
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    statState.stalls.set(stalled, markStarted)
    const fixture = await browseFixture()
    const controller = new AbortController()
    const reason = new Error('caller left during stat')

    try {
      const listing = fixture.capability.list(root, controller.signal)
      await started
      controller.abort(reason)
      await expect(listing).rejects.toBe(reason)
    } finally {
      await fixture.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  // The Desktop starting point is Windows-only, so its coverage is too.
  it.runIf(process.platform === 'win32')(
    'starts at the user Desktop while reporting the real home directory',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-home-'))
      const desktop = join(home, 'Desktop')
      await mkdir(desktop)
      const restoreHome = stubHomeDirectory(home)
      const fixture = await browseFixture()

      try {
        const listing = await fixture.capability.list()
        expect(listing.path).toBe(desktop)
        // home stays the breadcrumb anchor: it is where the client collapses the crumb row, not
        // the level the picker opens on.
        expect(listing.home).toBe(home)
        expect(listing.crumbs.map(crumb => crumb.path)).toEqual(
          expect.arrayContaining([home, desktop]),
        )
      } finally {
        await fixture.dispose()
        restoreHome()
        await rm(home, { recursive: true, force: true })
      }
    },
  )

  it.runIf(process.platform === 'win32')(
    'falls back to the home listing when the profile has no Desktop directory',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-nodesktop-'))
      await mkdir(join(home, 'workspace'))
      const restoreHome = stubHomeDirectory(home)
      const fixture = await browseFixture()

      try {
        const listing = await fixture.capability.list()
        // The absent Desktop must not surface as directory-unreadable: the panel still opens, at
        // the same level it opened on before the Desktop starting point existed.
        expect(listing.path).toBe(home)
        expect(listing.home).toBe(home)
        expect(listing.entries.map(entry => entry.name)).toEqual(['workspace'])
      } finally {
        await fixture.dispose()
        restoreHome()
        await rm(home, { recursive: true, force: true })
      }
    },
  )

  it.runIf(process.platform === 'win32')(
    'falls back to the home listing when the Desktop entry is not a directory',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-desktopfile-'))
      await writeFile(join(home, 'Desktop'), '')
      await mkdir(join(home, 'workspace'))
      const restoreHome = stubHomeDirectory(home)
      const fixture = await browseFixture()

      try {
        const listing = await fixture.capability.list()
        expect(listing.path).toBe(home)
        expect(listing.entries.map(entry => entry.name)).toEqual(['workspace'])
      } finally {
        await fixture.dispose()
        restoreHome()
        await rm(home, { recursive: true, force: true })
      }
    },
  )

  it.runIf(process.platform === 'win32')(
    'falls back to the home listing when the Desktop cannot be stat-ed',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-desktoperror-'))
      await mkdir(join(home, 'workspace'))
      statState.failures.add(join(home, 'Desktop'))
      const restoreHome = stubHomeDirectory(home)
      const fixture = await browseFixture()

      try {
        const listing = await fixture.capability.list()
        expect(listing.path).toBe(home)
      } finally {
        await fixture.dispose()
        restoreHome()
        await rm(home, { recursive: true, force: true })
      }
    },
  )
})
