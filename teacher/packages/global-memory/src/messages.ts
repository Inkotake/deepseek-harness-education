/**
 * The one model-visible message this plugin adds, and where it came from.
 *
 * Memory reaches the model at the step boundary, not by rewriting the system
 * prompt (README §8.3): the assembled system prompt is the KV-cache prefix, so a
 * value that changes per step would discard the cache, while an appended
 * user-role message is cache-neutral at the tail. Only the tiny standing profile
 * rides the prompt registry.
 *
 * The harness convention "Model-visible ⟺ logged" (deepseek-harness/AGENTS.md)
 * requires every model-visible input to be reconstructable from the session log,
 * so this message declares its own `MessageSourceMap` member — the same extension
 * point `dsh-agent-instructions` (`src/state.ts:48-52`) and `dsh-tool-skill`
 * (`src/index.ts:43-47`) use — and records which records it contained, which is
 * what the plan's §七 `Memory Precision` observable is read back from.
 *
 * @module @teacher-dsh/global-memory/src/messages
 */

import { createHash } from 'node:crypto'
import { createUserMessage, type ContextSnapshotSection, type UserMessage } from '@deepseek-ai/dsh-llm'

/** Durable record of exactly what memory reached the model in one step. */
export interface MemoryContextSource {
  /** Source kind, distinct from the skill catalog and workspace instructions. */
  readonly kind: 'global-memory'
  /** A snapshot: a later publication from this producer supersedes an earlier one. */
  readonly form: 'snapshot'
  /** The named contribution this message carried, verbatim. */
  readonly sections: readonly ContextSnapshotSection[]
  /** Ids of the memory records the message contained, in injection order. */
  readonly recordIds: readonly string[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'global-memory': MemoryContextSource
  }
}

/** Name of the single section one memory context carries. */
export const MEMORY_CONTEXT_SECTION = 'memory-retrieval'

/**
 * Build the injected memory message.
 * @param text - the model-facing context text.
 * @param recordIds - ids of the records it contains.
 * @returns an identified, frozen user message tagged as this plugin's context.
 */
export function memoryContextMessage(text: string, recordIds: readonly string[]): UserMessage {
  const sections: readonly ContextSnapshotSection[] = [{ name: MEMORY_CONTEXT_SECTION, text }]
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'global-memory', form: 'snapshot', sections, recordIds },
  })
}

/**
 * The task statement a step carries, if it carries one.
 *
 * Only messages the teacher sent count (`source.kind === 'user'`): a tool result
 * is also a user-role message, and a tool continuation adds no task, so nothing
 * is retrieved for it.
 * @param messages - the messages entering the step.
 * @returns the newest task text, or `undefined` when the step carries no task.
 */
export function taskTextOf(messages: readonly UserMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.source.kind !== 'user') continue
    const text = message.content
      .map(block => block.type === 'text' ? block.text : '')
      .join('\n')
      .trim()
    if (text !== '') return text
  }
  return undefined
}

/**
 * Digests one rendered context, so an unchanged context is not re-injected at the
 * next step of the same turn (`dsh-tool-skill` suppresses its catalog the same
 * way, `src/index.ts:231`).
 * @param text - the rendered context.
 * @returns a stable hex digest.
 */
export function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
