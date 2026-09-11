/**
 * The DSH session-event vocabulary this runner is allowed to interpret.
 *
 * The authoritative list lives in the pinned harness checkout:
 * `deepseek-harness/packages/core/session/src/known-event-types.ts`. That file
 * states the read-path rule the runner mirrors: a log carrying a type outside
 * the set is refused unless the event envelope marks it `ignorable`, because
 * silently skipping a required event reconstructs a wrong session.
 *
 * The list is parsed out of that file at run time so the runner cannot drift
 * from the build it evaluates. `EMBEDDED_KNOWN_EVENT_TYPES` is the fallback for
 * a checkout where the file is unreadable; the unit tests assert both agree.
 *
 * @module grabme/lib/known-events
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Relative path of the authoritative vocabulary inside the repository. */
export const KNOWN_EVENT_TYPES_RELATIVE_PATH =
  'deepseek-harness/packages/core/session/src/known-event-types.ts'

/** Verbatim copy of `KNOWN_SESSION_EVENT_TYPES`, used only when the harness file is unreadable. */
export const EMBEDDED_KNOWN_EVENT_TYPES = Object.freeze([
  'agent-preset/selected',
  'agent/inbox/spliced',
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'assistant/attempt',
  'assistant/message',
  'command/done',
  'command/run',
  'compaction/end',
  'compaction/prune',
  'compaction/start',
  'compaction/summary',
  'deliverables/presented',
  'feedback/message-delete',
  'feedback/message-put',
  'feedback/record',
  'goal/change',
  'hook/invoked',
  'hook/result',
  'llm/retry',
  'llm/retry-started',
  'model/selection',
  'permission/preset',
  'plan/mode',
  'request/context',
  'request/header',
  'sandbox/mode',
  'schedule/change',
  'session-log-deepseek/delivery-accepted',
  'session/end-seed',
  'session/title',
  'session/title-llm-request',
  'step/end',
  'step/start',
  'subagent/catalog',
  'subagent/descriptor',
  'subagent/model-selection-policy',
  'system/message',
  'team/member',
  'team/message/delivered',
  'team/message/queued',
  'team/task',
  'todo/write',
  'tool-workflow/agent-end',
  'tool-workflow/agent-start',
  'tool-workflow/run-end',
  'tool-workflow/run-start',
  'tool/call',
  'tool/ptc-dispatch',
  'tool/ptc-dispatch-start',
  'tool/result',
  'turn/end',
  'turn/start',
  'user/message',
  'web/deepseek-search-llm-request',
])

/**
 * Extract the quoted event names from the harness vocabulary source.
 *
 * The file is a generated `new Set([...])` literal of single-quoted strings.
 * Extraction is deliberately narrow: it locates that one declaration and takes
 * every single-quoted run inside it. A shape change makes extraction return an
 * empty list, which callers treat as a failure rather than as "no events".
 *
 * @param source - the text of `known-event-types.ts`.
 * @returns the event names in declaration order, or an empty array when the declaration is absent.
 */
export function parseKnownEventTypes(source) {
  const match = /KNOWN_SESSION_EVENT_TYPES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(source)
  if (match === null) return []
  const names = []
  for (const quoted of match[1].matchAll(/'([^']*)'/g)) names.push(quoted[1])
  return names
}

/**
 * Read the event vocabulary from the pinned harness checkout.
 *
 * @param repoRoot - absolute path of the repository root (the directory holding `deepseek-harness/`).
 * @returns `{ types, source, path, note }`:
 *   `types` is a frozen `Set` of event names, `source` is `'harness'` or `'embedded'`,
 *   `path` is the file consulted, and `note` explains a fallback.
 */
export function loadKnownEventTypes(repoRoot) {
  const path = join(repoRoot, KNOWN_EVENT_TYPES_RELATIVE_PATH)
  try {
    const parsed = parseKnownEventTypes(readFileSync(path, 'utf8'))
    if (parsed.length > 0) {
      return Object.freeze({
        types: Object.freeze(new Set(parsed)),
        source: 'harness',
        path,
        note: null,
      })
    }
    return Object.freeze({
      types: Object.freeze(new Set(EMBEDDED_KNOWN_EVENT_TYPES)),
      source: 'embedded',
      path,
      note: 'harness vocabulary file was readable but declared no event names; using the embedded copy',
    })
  } catch (error) {
    return Object.freeze({
      types: Object.freeze(new Set(EMBEDDED_KNOWN_EVENT_TYPES)),
      source: 'embedded',
      path,
      note: `harness vocabulary file unreadable (${error.message}); using the embedded copy`,
    })
  }
}
