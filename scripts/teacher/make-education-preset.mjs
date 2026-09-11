#!/usr/bin/env node
/**
 * Derive the education agent preset's composition from the shipped `standard` one.
 *
 * The preset is the standard composition under a teacher-facing persona and nothing else: a teacher
 * needs the same tools, and what differs is the framing plus the bundled teaching Skills. Deriving it
 * here rather than carrying a hand-copied 255-line file keeps the two in step by construction — if
 * upstream rewrites either block this script targets, it fails loudly instead of leaving a silently
 * stale copy behind. That is the same contract the version-pinned patches use.
 *
 * Usage:
 *   node scripts/teacher/make-education-preset.mjs [--check]
 *
 * `--check` re-derives in memory and reports whether the committed preset still matches, without
 * writing.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECK = process.argv.includes('--check')
const STANDARD = path.join(
  ROOT, 'deepseek-harness', 'packages', 'preset', 'agent-presets', 'presets', 'standard',
)
const TARGET = path.join(ROOT, 'dsh-plugin-desktop', 'presets', 'education')

const HEADER_FROM = '# The `standard` agent preset: the full coding agent, mounted once per process.'
const HEADER_TO = [
  '# The `education` agent preset: the standard composition under a teacher-facing persona.',
  '#',
  '# Derived from `standard` by scripts/teacher/make-education-preset.mjs, which substitutes the',
  '# persona block below and nothing else: a teacher needs the same tools (files, shell, search,',
  '# skills, plan, subagents) and the bundled teaching Skills are what make the difference, not a',
  '# reduced toolset.',
].join('\n')

const STANDARD_PERSONA = '      You are a coding agent powered by the {{model}} model.\n'
const EDUCATION_PERSONA = [
  '      You are a teaching assistant powered by the {{model}} model, working with a teacher who is',
  '      preparing classroom materials. The whole standard toolset is yours: build the material, check',
  '      it yourself before handing it over, and prefer artifacts a teacher can open, read and adjust',
  '      without a developer — a web page, a document, a deck, a spreadsheet.',
  '',
  '      Put the working directory under version control before you change anything in it: run',
  '      `git init` if there is no repository yet, commit as you reach working states, and use the',
  '      history to recover an earlier version when a later change turns out wrong. Version control',
  '      here is your own working tool, not something the teacher asked for — do not explain it, do',
  '      not ask about it, and do not make it part of what you hand back.',
].join('\n')

const METADATA = [
  'name: 教育智能开发模式',
  'description: >-',
  '  面向教师的完整 Agent：与标准模式同一套工具，使用教育向设定，配合内置教学 Skills',
  '  （教具、LaTeX 文档、课件、静态网页发布）；改动前自动用 git 记录版本，便于回退。',
  'order: 2',
  '',
].join('\n')

const source = readFileSync(path.join(STANDARD, 'agent.cordis.yml'), 'utf8')
if (!source.includes(HEADER_FROM)) throw new Error('standard composition header moved; re-derive this script')
if (!source.includes(STANDARD_PERSONA)) throw new Error('standard persona block moved; re-derive this script')

const composition = source.replace(HEADER_FROM, HEADER_TO).replace(STANDARD_PERSONA, EDUCATION_PERSONA)

if (CHECK) {
  const committed = readFileSync(path.join(TARGET, 'agent.cordis.yml'), 'utf8')
  const committedMetadata = readFileSync(path.join(TARGET, 'preset.yml'), 'utf8')
  if (committed !== composition || committedMetadata !== METADATA) {
    process.stderr.write('[education-preset] the committed preset differs from the derived one\n')
    process.exitCode = 1
    process.exit()
  }
  process.stdout.write('[education-preset] the committed preset matches the derived composition\n')
  process.exit()
}

mkdirSync(TARGET, { recursive: true })
writeFileSync(path.join(TARGET, 'agent.cordis.yml'), composition)
writeFileSync(path.join(TARGET, 'preset.yml'), METADATA)
process.stdout.write(`[education-preset] wrote ${String(composition.length)} bytes to presets/education\n`)
