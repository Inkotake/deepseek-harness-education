/**
 * First-run Teacher DSH profile seed.
 *
 * A Teacher DSH installation ships a complete, already-materialised DSH home: the `desktop`
 * profile with its launcher bundles, the pinned vendor plugins (Cowork, Better Sidebar,
 * PPTKit), and the bundled Teacher Skills. First run only copies that seed into the user's DSH
 * home, so an installation becomes usable without installing anything from the network.
 *
 * Existing user data is never overwritten: the seed is materialised only when the target
 * profile does not exist yet.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Outcome of one seed materialisation attempt. */
export interface TeacherProfileSeedResult {
  /** Whether the seed was copied into the user's Harness home. */
  applied: boolean
  /** Machine-readable reason describing the outcome. */
  reason: 'applied' | 'no-seed' | 'profile-exists' | 'seed-incomplete'
  /** Seed directory that was considered. */
  seedDir: string
  /** Harness home that was targeted. */
  homeDir: string
  /** Files copied when `applied` is true. */
  filesCopied: number
}

/** Count regular files below one directory. */
function countFiles(root: string, limit = 200_000): number {
  let files = 0
  const stack = [root]
  while (stack.length > 0 && files < limit) {
    const current = stack.pop()
    if (current === undefined) break
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(join(current, entry.name))
      else if (entry.isFile()) files += 1
    }
  }
  return files
}

/**
 * Materialise the bundled Teacher profile seed into a Harness home when it is absent.
 * @param options - seed location, target Harness home, and an optional diagnostic sink.
 * @returns what was applied and why.
 */
export function materializeTeacherProfileSeed(options: {
  /** Bundled Teacher runtime root that contains `seed/dsh-home`. */
  runtimeRoot: string
  /** Harness home the launcher will use. */
  homeDir: string
  /** Optional diagnostic sink. */
  log?: ((message: string) => void) | undefined
}): TeacherProfileSeedResult {
  const homeDir = resolve(options.homeDir)
  const seedDir = join(options.runtimeRoot, 'seed', 'dsh-home')
  const target = join(homeDir, 'profiles', 'desktop', 'package.json')

  if (existsSync(target)) {
    return { applied: false, reason: 'profile-exists', seedDir, homeDir, filesCopied: 0 }
  }
  const seedManifest = join(seedDir, 'TEACHER-SEED.json')
  if (!existsSync(seedManifest)) {
    return { applied: false, reason: 'no-seed', seedDir, homeDir, filesCopied: 0 }
  }
  if (!existsSync(join(seedDir, 'profiles', 'desktop', 'package.json'))) {
    return { applied: false, reason: 'seed-incomplete', seedDir, homeDir, filesCopied: 0 }
  }

  const filesCopied = countFiles(seedDir)
  mkdirSync(homeDir, { recursive: true })
  // Never clobber anything the user already has in the Harness home.
  cpSync(seedDir, homeDir, { recursive: true, dereference: true, force: false, errorOnExist: false })

  // Record the seed identity for diagnostics; a failure here must never block startup.
  try {
    writeFileSync(
      join(homeDir, 'TEACHER-SEED-APPLIED.json'),
      readFileSync(seedManifest, 'utf8'),
      'utf8',
    )
  } catch {
    // Diagnostics only.
  }

  options.log?.(
    `dsh-plugin-desktop: materialised bundled Teacher profile seed into ${homeDir}`
    + ` (${String(filesCopied)} files)`,
  )
  return { applied: true, reason: 'applied', seedDir, homeDir, filesCopied }
}
