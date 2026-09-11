/**
 * Teacher-owned agent presets for the shell modes that are not Advanced.
 *
 * Harness 0.1.5 ships four agent presets and offers no way to hide one: `dsh-agent-presets` configures
 * roots, `includeShippedRoot` and `includeUserRoot`, and nothing else. A teacher who never turns on
 * Advanced mode should choose between the standard agent and the education-facing one, so this
 * materializes a root holding exactly those and turns the shipped roster off.
 *
 * The standard composition is copied out of the pinned runtime on every preparation, the same way
 * `agent-preset-compat` materializes its legacy aliases: copying keeps it in lock-step with the
 * runtime, where shipping our own copy would go stale without saying so.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Preset ids the non-advanced root exposes, in the order the picker shows them. */
export const TEACHER_PRESET_IDS = ['standard', 'education'] as const

/** Directory under the Harness home holding the materialized non-advanced preset root. */
export const TEACHER_PRESET_DIRNAME = 'teacher-presets'

export interface TeacherPresetRootOptions {
  /** Harness home the root is materialized under. */
  readonly homeDir: string
  /** Shipped preset root of the pinned `dsh-agent-presets` package. */
  readonly shippedRoot: string
  /** This package's own preset directory, holding the education preset. */
  readonly teacherSource: string
}

/**
 * Materialize the non-advanced preset root.
 *
 * Fails soft by returning `undefined`, which leaves the shipped roster in place: a half-built root
 * would boot a picker with nothing to choose, and an empty picker is a worse outcome than a longer
 * one.
 * @param options - the home to materialize under and the two sources to copy from.
 * @returns the root to configure, or undefined when it cannot be built completely.
 */
export function materializeTeacherPresetRoot(options: TeacherPresetRootOptions): string | undefined {
  const root = join(options.homeDir, TEACHER_PRESET_DIRNAME)
  const planned = TEACHER_PRESET_IDS.map(id => ({
    id,
    source: id === 'education' ? join(options.teacherSource, id) : join(options.shippedRoot, id),
  }))
  for (const preset of planned) {
    if (!existsSync(join(preset.source, 'agent.cordis.yml'))) {
      rmSync(root, { recursive: true, force: true })
      return undefined
    }
  }
  for (const preset of planned) {
    const target = join(root, preset.id)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    cpSync(preset.source, target, { recursive: true })
  }
  return root
}
