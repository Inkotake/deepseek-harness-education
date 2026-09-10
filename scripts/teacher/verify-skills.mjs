#!/usr/bin/env node
/**
 * Skill validation gate.
 *
 * Every bundled Skill must be a directory with a `SKILL.md`, valid YAML frontmatter that
 * declares `name` and `description`, and a `name` matching its directory. Names must be unique
 * across the bundle because DSH discovers bundled skills from a single flat root.
 *
 * Usage:
 *   node scripts/teacher/verify-skills.mjs [--root <dir>]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const rootArg = process.argv.indexOf('--root')
const SKILLS_ROOT = rootArg >= 0 && process.argv[rootArg + 1] !== undefined
  ? path.resolve(process.argv[rootArg + 1])
  : path.join(ROOT, 'resources', 'teacher-runtime', 'skills')

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u
const errors = []
const warnings = []

/** Parse the leading YAML frontmatter block without a YAML dependency. */
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null
  const end = text.indexOf('\n---', 3)
  if (end < 0) return null
  const block = text.slice(3, end)
  const fields = {}
  let currentKey = null
  for (const raw of block.split(/\r?\n/u)) {
    // Vendored skill files may carry stray carriage returns; never let them hide a field.
    const rawLine = raw.replace(/\r+$/u, '')
    if (rawLine.trim().length === 0) continue
    const match = /^([A-Za-z0-9_-]+):[ \t]*([\s\S]*)$/u.exec(rawLine)
    if (match !== null) {
      currentKey = match[1]
      fields[currentKey] = match[2].trim()
      continue
    }
    if (currentKey !== null && /^\s+/u.test(rawLine)) {
      fields[currentKey] = `${fields[currentKey]} ${rawLine.trim()}`.trim()
    }
  }
  // Folded/literal block scalars are common for long descriptions.
  for (const [key, value] of Object.entries(fields)) {
    if (value === '|' || value === '>' || value === '|-' || value === '>-') fields[key] = ''
  }
  return fields
}

function main() {
  if (!fs.existsSync(SKILLS_ROOT)) {
    process.stderr.write(`[verify-skills] FAIL skills root not found: ${SKILLS_ROOT}\n`)
    process.exitCode = 1
    return
  }

  const seen = new Map()
  const entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()

  for (const name of entries) {
    const dir = path.join(SKILLS_ROOT, name, 'SKILL.md')
    if (!fs.existsSync(dir)) {
      errors.push(`${name}: missing SKILL.md`)
      continue
    }
    if (!NAME_PATTERN.test(name)) {
      errors.push(`${name}: directory name must be lowercase kebab-case`)
    }
    const text = fs.readFileSync(dir, 'utf8')
    const fields = parseFrontmatter(text)
    if (fields === null) {
      errors.push(`${name}: SKILL.md has no YAML frontmatter block`)
      continue
    }
    if (fields.name === undefined || fields.name.length === 0) {
      errors.push(`${name}: frontmatter is missing \`name\``)
    } else if (fields.name !== name) {
      errors.push(`${name}: frontmatter name "${fields.name}" does not match the directory`)
    }
    if (fields.description === undefined || fields.description.length < 20) {
      const observed = fields.description === undefined
        ? 'missing'
        : `${String(fields.description.length)} chars: ${JSON.stringify(fields.description.slice(0, 40))}`
      errors.push(`${name}: frontmatter needs a descriptive \`description\` (>= 20 characters); observed ${observed}`)
    }
    if (seen.has(name)) errors.push(`${name}: duplicate skill name`)
    seen.set(name, true)
    if (text.split(/\r?\n/u).length < 12) {
      warnings.push(`${name}: SKILL.md is very short; confirm it carries real instructions`)
    }
  }

  if (entries.length === 0) errors.push('no skills were found')

  for (const warning of warnings) process.stderr.write(`[verify-skills] WARN ${warning}\n`)
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`[verify-skills] FAIL ${error}\n`)
    process.stderr.write(`[verify-skills] ${errors.length} error(s)\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`[verify-skills] OK ${entries.length} skills validated in ${SKILLS_ROOT}\n`)
}

main()
