#!/usr/bin/env node
/**
 * Generates `THIRD_PARTY_NOTICES.md` and `licenses/` for the Teacher DSH distribution.
 *
 * Outputs:
 *   THIRD_PARTY_NOTICES.md      human-readable bundle notice
 *   licenses/<component>/...    verbatim upstream license texts
 *   teacher/manifests/licenses.lock.json   machine-readable inventory
 *
 * Usage:
 *   node scripts/teacher/build-notices.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RESOURCES = path.join(ROOT, 'resources')
const TEACHER = path.join(ROOT, 'teacher')
const NOTICES = path.join(ROOT, 'THIRD_PARTY_NOTICES.md')
const LICENSES_DIR = path.join(ROOT, 'licenses')
const LOCK_FILE = path.join(TEACHER, 'manifests', 'licenses.lock.json')

const LICENSE_FILE_PATTERN = /^(LICEN[CS]E|COPYING|NOTICE)(\.(md|txt|rst))?$/iu

/**
 * Components that are not discoverable by walking `node_modules`, with the license text that
 * must travel with the distribution.
 */
const CURATED = [
  {
    name: 'DeepSeek Harness',
    version: '0.1.2-rc.1',
    license: 'MIT',
    source: 'https://github.com/deepseek-ai/deepseek-harness',
    role: 'Agent runtime, plugin loader, client UI, and tool protocol',
  },
  {
    name: 'DSH Desktop (anywhere-labs)',
    version: 'v2.0.5',
    license: 'MIT',
    source: 'https://github.com/anywhere-labs/dsh-desktop',
    role: 'Electron shell, profile manager, and packaging pipeline this distribution builds on',
  },
  {
    name: 'Node.js',
    version: '22.23.2',
    license: 'MIT',
    source: 'https://nodejs.org',
    role: 'Bundled JavaScript runtime used by every Teacher command',
  },
  {
    name: 'pnpm',
    version: '11.8.0',
    license: 'MIT',
    source: 'https://github.com/pnpm/pnpm',
    role: 'Bundled package manager for artifact projects',
  },
  {
    name: 'Git for Windows (MinGit)',
    version: '2.55.0.5',
    license: 'GPL-2.0-only',
    source: 'https://github.com/git-for-windows/git',
    role: 'Embedded git, so version control works on a machine with nothing installed',
    copyleft: true,
    attribution:
      'Git is free software distributed under the GNU General Public License version 2. The '
      + 'complete corresponding source is available from the upstream project at the source URL '
      + 'above. The license text ships alongside the binary as '
      + 'teacher-runtime/git/LICENSE.txt, and this distribution conveys the unmodified upstream '
      + 'binary under that license.',
  },
  {
    name: 'Education Agent Skills (Gareth Manning)',
    version: 'pinned commit',
    license: 'CC BY-SA 4.0',
    source: 'https://github.com/GarethManning/education-agent-skills',
    role: 'Seven vendored education Skills, redistributed unmodified',
    attribution:
      'Education Agent Skills by Gareth Manning, licensed CC BY-SA 4.0. The skills are '
      + 'redistributed verbatim; see the LICENSE and SOURCE.json inside each vendored skill '
      + 'directory. Any redistribution of this bundle must keep the same license for these '
      + 'files and credit the original author.',
    copyleft: true,
  },
  {
    name: 'PPTKit Presentation',
    version: 'pinned commit',
    license: 'MIT',
    source: 'https://github.com/openHacking/pptkit-presentation',
    role: 'Vendored presentation workflow Skill',
  },
  {
    name: 'Vercel Web Design Guidelines',
    version: 'pinned commit',
    license: 'MIT',
    source: 'https://github.com/vercel-labs/agent-skills',
    role: 'Vendored design guidelines Skill snapshot',
  },
  {
    name: 'DSH Cowork',
    version: 'pinned commit',
    license: 'MIT',
    source: 'https://github.com/Jesse-njx/dsh-cowork',
    role: 'Office document read/write tools (xlsx, pdf, docx, pptx, ipynb)',
  },
  {
    name: 'DSH Better Sidebar',
    version: '0.19.0',
    license: 'MIT',
    source: 'https://github.com/omdsh-dev/DSH-better-sidebar',
    role: 'Explorer / editor / terminal / git / browser sidebar',
  },
]

/** Runtime trees whose package licenses must be enumerated. */
const RUNTIME_TREES = [
  ['artifact toolchain', path.join(RESOURCES, 'teacher-runtime', 'artifact', 'node_modules')],
  ['presentation toolchain', path.join(RESOURCES, 'teacher-runtime', 'ppt', 'node_modules')],
  ['deploy toolchain', path.join(RESOURCES, 'teacher-runtime', 'deploy', 'node_modules')],
  ['harness runtime', path.join(ROOT, 'dsh-plugin-desktop', 'node_modules', '@deepseek-ai')],
]

function log(message) {
  process.stdout.write(`[notices] ${message}\n`)
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function licenseOf(manifest) {
  const value = manifest?.license
  if (typeof value === 'string' && value.length > 0) return value
  if (value !== null && typeof value === 'object' && typeof value.type === 'string') return value.type
  if (Array.isArray(manifest?.licenses)) {
    return manifest.licenses.map(entry => entry.type ?? entry).filter(Boolean).join(' OR ')
  }
  return 'UNKNOWN'
}

function slugify(value) {
  return value.replace(/^@/u, '').replaceAll('/', '__').replace(/[^A-Za-z0-9._-]/gu, '-')
}

/** Enumerate installed packages in one node_modules tree, including nested node_modules. */
function sweepTree(tree) {
  const found = new Map()
  const stack = [tree]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = path.join(current, entry.name)
      if (entry.name === 'node_modules') {
        stack.push(full)
        continue
      }
      if (entry.name.startsWith('.')) continue
      if (entry.name.startsWith('@')) {
        stack.push(full)
        continue
      }
      const manifestPath = path.join(full, 'package.json')
      if (!fs.existsSync(manifestPath)) continue
      const manifest = readJson(manifestPath)
      if (manifest?.name === undefined) continue
      const key = `${manifest.name}@${manifest.version ?? '0.0.0'}`
      if (!found.has(key)) {
        found.set(key, {
          name: manifest.name,
          version: manifest.version ?? '0.0.0',
          license: licenseOf(manifest),
          homepage: manifest.homepage ?? manifest.repository?.url ?? '',
          dir: full,
        })
      }
      const nested = path.join(full, 'node_modules')
      if (fs.existsSync(nested)) stack.push(nested)
    }
  }
  return found
}

/** Copy the license file that ships with one package. */
function copyLicense(packageDir, componentSlug) {
  let entries
  try {
    entries = fs.readdirSync(packageDir, { withFileTypes: true })
  } catch {
    return null
  }
  const match = entries.find(entry => entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name))
  if (match === undefined) return null
  const targetDir = path.join(LICENSES_DIR, componentSlug)
  fs.mkdirSync(targetDir, { recursive: true })
  const target = path.join(targetDir, match.name)
  fs.copyFileSync(path.join(packageDir, match.name), target)
  return path.relative(ROOT, target).replaceAll('\\', '/')
}

function main() {
  fs.rmSync(LICENSES_DIR, { recursive: true, force: true })
  fs.mkdirSync(LICENSES_DIR, { recursive: true })

  const inventory = []
  const seen = new Set()

  for (const component of CURATED) {
    const slug = slugify(component.name)
    inventory.push({ ...component, group: 'bundled component' })
    seen.add(component.name.toLowerCase())
    // Keep a pointer file so `licenses/` documents every curated component.
    const targetDir = path.join(LICENSES_DIR, slug)
    fs.mkdirSync(targetDir, { recursive: true })
    fs.writeFileSync(path.join(targetDir, 'SOURCE.md'), [
      `# ${component.name}`,
      '',
      `- version: ${component.version}`,
      `- license: ${component.license}`,
      `- source: ${component.source}`,
      `- role: ${component.role}`,
      component.attribution === undefined ? '' : `\n${component.attribution}`,
      '',
    ].join('\n'))
  }

  const byTree = []
  for (const [label, tree] of RUNTIME_TREES) {
    if (!fs.existsSync(tree)) {
      log(`skipping ${label}: ${tree} not built`)
      continue
    }
    const packages = sweepTree(tree)
    for (const pkg of packages.values()) {
      const key = `${pkg.name}@${pkg.version}`
      const licensePath = copyLicense(pkg.dir, slugify(`${pkg.name}-${pkg.version}`))
      if (!seen.has(pkg.name.toLowerCase())) seen.add(pkg.name.toLowerCase())
      inventory.push({ ...pkg, group: label, licenseFile: licensePath ?? null })
    }
    byTree.push([label, packages.size])
    log(`${label}: ${packages.size} packages`)
  }

  const lock = {
    name: 'teacher-licenses.lock',
    version: '0.1.0',
    generatedAt: new Date().toISOString(),
    policy:
      'Every component shipped in the installer must appear here with a license. '
      + 'CC BY-SA 4.0 components keep their attribution and license text.',
    curated: CURATED.map(({ name, version, license, source, role, attribution, copyleft }) => ({
      name, version, license, source, role,
      ...(attribution === undefined ? {} : { attribution }),
      ...(copyleft === undefined ? {} : { copyleft }),
    })),
    packages: inventory
      .filter(entry => entry.group !== 'bundled component')
      .map(({ name, version, license, group, licenseFile }) => ({ name, version, license, group, licenseFile: licenseFile ?? null }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version)),
  }
  fs.writeFileSync(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`)
  log(`wrote ${path.relative(ROOT, LOCK_FILE)} (${lock.packages.length} packages)`)

  writeNotices(lock)
}

function writeNotices(lock) {
  const lines = []
  lines.push('# Third-Party Notices — Teacher DSH 0.1')
  lines.push('')
  lines.push(
    'Teacher DSH is a redistribution that bundles the components below. Each component remains '
    + 'under its own license; the Teacher DSH layer itself is MIT.',
  )
  lines.push('')
  lines.push('Verbatim license texts are collected in [`licenses/`](./licenses).')
  lines.push('')
  lines.push(`Generated: ${lock.generatedAt}`)
  lines.push('')
  lines.push('## Bundled components')
  lines.push('')
  lines.push('| Component | Version | License | Role |')
  lines.push('|---|---|---|---|')
  for (const entry of lock.curated) {
    lines.push(`| ${entry.name} | ${entry.version} | ${entry.license} | ${entry.role} |`)
  }
  lines.push('')
  const copyleft = lock.curated.filter(entry => entry.copyleft === true)
  if (copyleft.length > 0) {
    lines.push('## Share-alike components')
    lines.push('')
    for (const entry of copyleft) {
      lines.push(`### ${entry.name} — ${entry.license}`)
      lines.push('')
      lines.push(entry.attribution ?? '')
      lines.push('')
    }
  }
  lines.push('## Bundled npm dependencies')
  lines.push('')
  lines.push(
    'The following packages are installed into the shipped runtime trees. Each entry keeps the '
    + 'license recorded in its own `package.json`.',
  )
  lines.push('')
  const groups = new Map()
  for (const entry of lock.packages) {
    if (!groups.has(entry.group)) groups.set(entry.group, [])
    groups.get(entry.group).push(entry)
  }
  for (const [group, entries] of groups) {
    lines.push(`### ${group} (${entries.length})`)
    lines.push('')
    lines.push('| Package | Version | License |')
    lines.push('|---|---|---|')
    for (const entry of entries) {
      lines.push(`| ${entry.name} | ${entry.version} | ${entry.license} |`)
    }
    lines.push('')
  }
  const unknown = lock.packages.filter(entry => entry.license === 'UNKNOWN')
  if (unknown.length > 0) {
    lines.push('## Packages without a declared license')
    lines.push('')
    lines.push(
      'These packages do not declare a license in `package.json`. They are listed so the gap is '
      + 'visible; review them before publishing a release.',
    )
    lines.push('')
    for (const entry of unknown) lines.push(`- ${entry.name}@${entry.version} (${entry.group})`)
    lines.push('')
  }
  fs.writeFileSync(NOTICES, `${lines.join('\n')}\n`)
  log(`wrote ${path.relative(ROOT, NOTICES)}`)
}

main()
