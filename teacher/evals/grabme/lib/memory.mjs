/**
 * Memory records reaching a session, and the two memory metrics' inputs.
 *
 * `metrics.md` §5/§6 count over `M(s)`: "所有被注入上下文的记忆条目 … 含 `preloaded_memory`
 * 中实际注入的部分和会话中 `memory_get`/`memory_search` 命中的部分". This module
 * assembles that set from three log-visible sources and reports which one each
 * record came from:
 *
 * 1. a `memory.json` snapshot stored beside the session artifact (an array of the
 *    `MemoryRecord` rows declared in `teacher/packages/global-memory/schema.ts`);
 * 2. the case's `preloaded_memory` block from `cases.json` (expanded to one record
 *    per leaf entry, keyed `<namespace>.<key>`);
 * 3. records returned by `memory_get` / `memory_search` tool results inside the log,
 *    with the seq of that result as the record's injection point.
 *
 * Nothing here reads assistant prose. Record *relevance* and *wrong use* are
 * decided from structured fields (`namespace`, `key`, `value`, `source.source`,
 * `expires_at`) plus the question table and the artifact fingerprints.
 *
 * @module grabme/lib/memory.mjs
 */

import { matchSlots, normalizeText, extractSlotValue, isConfirmingQuestion, SLOT_LABELS } from './slots.mjs'
import { toolResultText } from './questions.mjs'

/**
 * Retrieval rules per task type.
 *
 * Authored copy of `MEMORY_RETRIEVAL_RULES` in
 * `teacher/packages/global-memory/schema.ts`. The unit tests assert every
 * `task_type` here still appears in that file, so a schema edit that adds a task
 * type shows up as a test failure rather than as a silently narrower metric.
 *
 * @type {ReadonlyArray<{ task_type: string, namespaces: readonly string[], mustExclude: readonly string[], maxRecords: number }>}
 */
export const RETRIEVAL_RULES = Object.freeze([
  {
    task_type: 'lesson_design',
    namespaces: ['environment', 'preferences', 'corrections', 'projects'],
    mustExclude: ['projects.deliverable_index'],
    maxRecords: 12,
  },
  {
    task_type: 'ppt_design',
    namespaces: ['preferences', 'corrections'],
    mustExclude: ['environment.class_profile', 'environment.available_equipment'],
    maxRecords: 8,
  },
  {
    task_type: 'assessment_design',
    namespaces: ['environment', 'preferences', 'corrections', 'profile'],
    mustExclude: ['projects.open_threads'],
    maxRecords: 10,
  },
  {
    task_type: 'general',
    namespaces: ['preferences', 'corrections'],
    mustExclude: [],
    maxRecords: 6,
  },
])

/** Provenance values that are behavioural inference rather than a statement. */
const INFERENCE_SOURCES = new Set(['repeated_behavior', 'strong_inference', 'weak_inference'])

/** Field-name aliases from the case files' `preloaded_memory` into the schema's field names. */
const KEY_ALIASES = Object.freeze({
  'environment.grade': 'environment.grades_taught',
  'environment.textbook': 'environment.textbook_edition',
  'environment.lesson_minutes': 'environment.class_duration_minutes',
  'environment.academic_year': 'environment.school_year',
})

/** Namespace+key → canonical slot, for the parts of the schema that map onto a case slot. */
const KEY_TO_SLOT = Object.freeze({
  'profile.subject': 'subject',
  'profile.grades_taught': 'grade',
  'environment.grades_taught': 'grade',
  'environment.textbook_edition': 'textbook',
  'environment.class_duration_minutes': 'lesson_minutes',
  'environment.curriculum_standard': 'curriculum_standard',
  'environment.class_profile': 'class_difference',
  'environment.school_year': 'grade',
  'preferences.pedagogy_preference': 'teaching_focus',
  'preferences.output_format_preference': 'delivery_form',
  'preferences.assessment_preference': 'question_type_ratio',
  'corrections.rejected_behavior': null,
  'corrections.corrected_value': null,
})

/**
 * Derive the task type of one task from its teacher message.
 *
 * `metrics.md` §5 defines relevance against "brief 的 `task` 字段". No Requirement
 * Brief event type exists in `KNOWN_SESSION_EVENT_TYPES`, so the task type falls
 * back to the same key vocabulary applied to the case's opening message; the
 * report names the derivation for every session.
 *
 * @param teacherMessage - the case's opening user message, if a case is associated.
 * @returns one of {@link RETRIEVAL_RULES}'s `task_type` values.
 */
export function deriveTaskType(teacherMessage) {
  const text = normalizeText(teacherMessage ?? '')
  if (/(课件|ppt|幻灯|幻灯片)/u.test(text)) return 'ppt_design'
  if (/(试卷|月考|期中|期末|测验|小测|练习|题目|卷子|考试)/u.test(text)) return 'assessment_design'
  if (/(教案|一节课|上课|教学|讲授|复习课|单元|课堂|讲)/u.test(text)) return 'lesson_design'
  return 'general'
}

/**
 * Expand a `preloaded_memory` block from `cases.json` into canonical records.
 *
 * The block is `{ namespace: { key: value | [{...}] } }`. Array values (the
 * `corrections` list) expand to one record per element, keyed by the element's
 * `scope` when present, so a correction's `text` carries its own record.
 *
 * @param preloaded - the case's `preloaded_memory` object.
 * @returns records shaped like `MemoryRecord` where the fields exist in the case file.
 */
export function recordsFromPreloadedMemory(preloaded) {
  const records = []
  if (preloaded === null || typeof preloaded !== 'object') return records
  for (const [namespace, fields] of Object.entries(preloaded)) {
    if (fields === null || typeof fields !== 'object') continue
    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          const element = value[index]
          if (element === null || typeof element !== 'object') continue
          const scoped = typeof element.scope === 'string' ? element.scope : `${key}[${index}]`
          records.push({
            id: `preloaded:${namespace}.${scoped}`,
            namespace,
            key: scoped,
            value: String(element.text ?? element.value ?? ''),
            source: element.source === undefined ? undefined : { source: String(element.source) },
            confidence: element.confidence === undefined ? undefined : String(element.confidence),
            expires_at: element.expires_at ?? null,
            updated_at: element.updated_at,
            origin: 'preloaded_memory',
            injectionSeq: 0,
            injectionTurn: 0,
          })
        }
        continue
      }
      if (value !== null && typeof value === 'object') {
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
          records.push(makePreloadedRecord(namespace, nestedKey, nestedValue))
        }
        continue
      }
      records.push(makePreloadedRecord(namespace, key, value))
    }
  }
  return records
}

/** Build one record from a scalar leaf of `preloaded_memory`. */
function makePreloadedRecord(namespace, key, value) {
  return {
    id: `preloaded:${namespace}.${key}`,
    namespace,
    key,
    value: String(value),
    expires_at: null,
    origin: 'preloaded_memory',
    injectionSeq: 0,
    injectionTurn: 0,
  }
}

/**
 * Normalize a `MemoryRecord` snapshot row.
 * @param record - one element of a `memory.json` array.
 * @param index - its position, used to synthesize an id when the row has none.
 * @returns a record carrying at least `id`, `namespace`, `key`, `value`, `expires_at`, `origin`.
 */
export function normalizeRecord(record, index) {
  const namespace = String(record?.namespace ?? 'unknown')
  const key = String(record?.key ?? `field[${index}]`)
  return {
    id: typeof record?.id === 'string' ? record.id : `memory.json:${namespace}.${key}`,
    namespace,
    key,
    value: String(record?.value ?? ''),
    details: record?.details,
    scope: record?.scope,
    source: record?.source,
    confidence: record?.confidence,
    updated_at: record?.updated_at,
    expires_at: typeof record?.expires_at === 'string' ? record.expires_at : null,
    last_confirmed_at: record?.last_confirmed_at,
    origin: 'memory.json',
    injectionSeq: 0,
    injectionTurn: 0,
  }
}

/**
 * Read memory records returned by `memory_get` / `memory_search` inside the log.
 * @param session - the session model.
 * @param memoryToolNames - the two record-returning tool names.
 * @returns `{ records, problems }`; each record carries the seq of the result that injected it.
 */
export function recordsFromToolResults(session, memoryToolNames = ['memory_get', 'memory_search']) {
  const callsById = new Map()
  for (const event of session.events) {
    if (event.type === 'tool/call' && typeof event.data?.callId === 'string') {
      callsById.set(event.data.callId, event.data.name)
    }
  }

  const records = []
  const problems = []
  for (const event of session.events) {
    if (event.type !== 'tool/result') continue
    const callId = event.data?.message?.source?.callId
    const name = typeof callId === 'string' ? callsById.get(callId) : undefined
    if (name === undefined || !memoryToolNames.includes(name)) continue
    const text = toolResultText(event)
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      problems.push({ kind: 'unparsable-memory-tool-result', callId, detail: error.message })
      continue
    }
    const rows = []
    if (parsed?.record !== undefined) rows.push(parsed.record)
    if (Array.isArray(parsed?.records)) rows.push(...parsed.records)
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue
      const normalized = normalizeRecord(row, records.length)
      normalized.origin = `tool:${name}`
      normalized.injectionSeq = event.seq ?? 0
      normalized.injectionTurn = event.turn ?? 0
      records.push(normalized)
    }
  }
  return { records, problems }
}

/**
 * Load the memory set for one session from all available sources.
 *
 * Precedence follows evidence strength: a `memory.json` snapshot beside the
 * artifact describes what was actually in the store, so it replaces the case's
 * `preloaded_memory` block. Retrieved records are always additive, because they
 * entered the context during the session.
 *
 * @param session - the session model.
 * @param options - `preloaded` (the case's block) and `snapshot` (parsed `memory.json` rows).
 * @returns `{ records, sources }` where `sources` records which inputs contributed.
 */
export function collectMemoryRecords(session, options = {}) {
  const { preloaded, snapshot } = options
  const records = []
  const sources = { snapshot: 0, preloaded: 0, retrieval: 0 }

  if (Array.isArray(snapshot)) {
    snapshot.forEach((row, index) => records.push(normalizeRecord(row, index)))
    sources.snapshot = records.length
  } else if (preloaded !== undefined) {
    const expanded = recordsFromPreloadedMemory(preloaded)
    records.push(...expanded)
    sources.preloaded = expanded.length
  }

  const retrieved = recordsFromToolResults(session)
  records.push(...retrieved.records)
  sources.retrieval = retrieved.records.length

  for (const record of records) {
    if (record.slot === undefined) {
      record.slot = slotForRecord(record)
      record.slots = slotsForRecord(record)
    }
  }
  return { records, sources, problems: retrieved.problems }
}

/** Canonical slot named by a record's schema path, if any. */
function slotForRecord(record) {
  const canonicalKey = KEY_ALIASES[`${record.namespace}.${record.key}`] ?? `${record.namespace}.${record.key}`
  const declared = KEY_TO_SLOT[canonicalKey]
  if (typeof declared === 'string') return declared
  const fromValue = matchSlots(record.value).slots
  if (fromValue.length > 0) return fromValue[0]
  return null
}

/** Every canonical slot a record's key and value name. */
function slotsForRecord(record) {
  const canonicalKey = KEY_ALIASES[`${record.namespace}.${record.key}`] ?? `${record.namespace}.${record.key}`
  const slots = []
  const declared = KEY_TO_SLOT[canonicalKey]
  if (typeof declared === 'string') slots.push(declared)
  for (const slot of matchSlots(record.value).slots) if (!slots.includes(slot)) slots.push(slot)
  if (slots.length === 0 && /class_\d/u.test(record.key)) slots.push('class_difference')
  return slots
}

/**
 * Decide a memory record's TTL re-confirmation exemption, the only exemption
 * `metrics.md` §2 grants. All three conditions must hold:
 *
 * - (a) the record carries an `expires_at` earlier than this session and already past;
 * - (b) the question is a confirmation, not an interrogation;
 * - (c) the session log contains that record's injection.
 *
 * @param context - `{ question, record, session }`.
 * @returns `{ a, b, c, exempt, reasons }`; each condition is reported separately so a
 *   question that fails exemption says which condition failed.
 */
export function evaluateTtlExemption(context) {
  const { question, record, session } = context
  const reasons = []

  const expiresAt = record?.expires_at ?? null
  let a = false
  if (expiresAt === null) {
    reasons.push('(a) no memory record for this slot carries expires_at, so expiry cannot be established from the log')
  } else {
    const expiry = Date.parse(expiresAt)
    const sessionStart = session.createdAt
    if (Number.isNaN(expiry)) {
      reasons.push(`(a) expires_at "${expiresAt}" is not a parseable instant`)
    } else if (expiry >= sessionStart) {
      reasons.push(`(a) the record expires at ${expiresAt}, which is not earlier than this session`)
    } else {
      a = true
    }
  }

  const b = isConfirmingQuestion(question.text)
  if (!b) reasons.push('(b) the question is phrased as an interrogation, not a re-confirmation')

  let c = false
  if (record !== undefined) {
    const needles = [record.id, record.value].filter(needle => typeof needle === 'string' && needle.length >= 2)
    c = session.events.some(event => {
      if (event.type !== 'user/message') return false
      if (event.data?.source?.kind === 'user') return false
      const text = normalizeText(JSON.stringify(event.data))
      return needles.some(needle => text.includes(normalizeText(needle)))
    })
    if (!c) {
      reasons.push('(c) no injected user/message in the log carries this memory record, so the re-confirmation is not evidenced')
    }
  } else {
    reasons.push('(c) no record was identified for this slot')
  }

  return { a, b, c, exempt: a && b && c, reasons }
}

/**
 * Score one record for the two memory metrics.
 *
 * `rel(m)` follows `metrics.md` §5: the record must belong to the task type's
 * retrieval rule and must have a landing point in the artifacts or the questions.
 * `bad(m)` follows §6's three bullets:
 *
 * - rule 1 — conflicts with the user's explicit statement in this session;
 * - rule 2 — `expires_at` passed but the value was still used as current fact;
 * - rule 3 — a behavioural-inference `source` used as a settled conclusion.
 *
 * @param context - `{ record, rule, session, questions, artifactText, preAnswerArtifactText, humanMessages }`.
 * @returns `{ rel, bad, undetermined, rules, reasons }`.
 */
export function scoreRecord(context) {
  const { record, rule, session, questions, artifactText, humanMessages } = context
  const reasons = []
  const rules = { conflict: false, expired: false, inference: false }

  const usedAsFact = artifactText.includes(normalizeText(record.value)) && record.value.length >= 2
  const inQuestion = questions.some(question => {
    const normalized = normalizeText(question.text)
    return (question.attribution.primary !== null && question.attribution.primary === record.slot)
      || normalized.includes(normalizeText(record.value))
  })
  const rel = rule.namespaces.includes(record.namespace)
    && !rule.mustExclude.includes(`${record.namespace}.${record.key}`)
    && (usedAsFact || inQuestion)
  if (!rel) {
    reasons.push(
      rule.namespaces.includes(record.namespace)
        ? 'no landing point in this session\'s artifacts or questions'
        : `namespace "${record.namespace}" is not retrieved for task type "${rule.task_type}"`,
    )
  }

  // Rule 1 — current explicit user expression outranks the stored record.
  let rule1Undetermined = false
  if (record.slot !== null) {
    for (const message of humanMessages) {
      const normalized = normalizeText(message.text)
      const mentions = matchSlots(message.text).slots.includes(record.slot)
      if (!mentions) continue
      const stated = extractSlotValue(record.slot, message.text)
      if (stated === undefined) {
        rule1Undetermined = true
        reasons.push(`rule 1: user message mentions ${SLOT_LABELS[record.slot] ?? record.slot} but states no checkable value`)
        continue
      }
      if (!valuesAgree(stated, record.value)) {
        rules.conflict = true
        reasons.push(`rule 1: user said "${stated}" while memory holds "${record.value}"`)
      }
    }
  }

  // Rule 2 — an expired record used as a current fact.
  if (record.expires_at !== null) {
    const expiry = Date.parse(record.expires_at)
    if (!Number.isNaN(expiry) && expiry < session.createdAt && usedAsFact) {
      rules.expired = true
      reasons.push(`rule 2: expires_at ${record.expires_at} predates this session and the value was used in an artifact`)
    }
  }

  // Rule 3 — inference presented as a settled conclusion.
  const provenance = record.source?.source ?? record.confidence ?? null
  if (provenance !== null && INFERENCE_SOURCES.has(String(provenance)) && usedAsFact) {
    rules.inference = true
    reasons.push(`rule 3: source "${provenance}" is behavioural inference and the value was used as a settled artifact value`)
  }

  const bad = rules.conflict || rules.expired || rules.inference
  return {
    rel,
    bad,
    undetermined: !bad && rule1Undetermined,
    rules,
    reasons,
  }
}

/** Whether an extracted user value agrees with a stored value. */
function valuesAgree(stated, stored) {
  const left = normalizeText(stated)
  const right = normalizeText(stored)
  if (left === right) return true
  const leftNumber = Number.parseFloat(left)
  const rightNumber = Number.parseFloat(right)
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) return leftNumber === rightNumber
  return right.includes(left) || left.includes(right)
}
