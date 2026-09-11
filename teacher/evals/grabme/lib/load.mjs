/**
 * Session-log discovery and parsing.
 *
 * Reads the repository's append-only JSONL session artifacts and turns them into
 * the session model every metric consumes. Physical framing follows
 * `deepseek-harness/packages/session/session-persistence-jsonl/src/format.ts`:
 * the first line is a `type: 'session'` header, every following line is one
 * event row `{ type, data, seq?, time?, surfaceOp?, sourceEventSeqs? }`.
 *
 * Deliberate limits, reported rather than hidden:
 *
 * - Only logical-row generations are parsed. Pre-v2 generations encode assistant
 *   output as physical `assistant/chunk` / `reasoning-chunks` rows that need the
 *   released migration codecs under `deepseek-harness/packages/session/`; this
 *   runner refuses such a log instead of mis-reading it (see {@link parseSession}).
 * - `.jsonl.zstd` is decompressed with Node's built-in zstd binding. On a Node
 *   build without it, the file is reported unreadable, never skipped silently.
 *
 * @module grabme/lib/load.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Canonical session artifact filename: `session[.<ordinal>][.vN].jsonl[.zstd]`. */
const SESSION_FILENAME = /^session(?:\.(\d+))?(?:\.v(\d+))?\.jsonl(\.zstd)?$/

/** Directory names never descended into while scanning a batch root. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'lib', 'build'])

/**
 * Describe one candidate session artifact file.
 * @param filename - a directory entry name.
 * @returns `{ ordinal, version, compressed }`, or `undefined` when the name is not a canonical artifact.
 */
export function describeSessionFilename(filename) {
  const match = SESSION_FILENAME.exec(filename)
  if (match === null) return undefined
  return {
    ordinal: match[1] === undefined ? 0 : Number.parseInt(match[1], 10),
    version: match[2] === undefined ? 0 : Number.parseInt(match[2], 10),
    compressed: match[3] === '.zstd',
  }
}

/**
 * Order two candidate artifacts so the newest generation wins.
 *
 * The snapshots policy states that a directory may retain several generations of
 * one role and that readers select the numerically highest; the same rule is
 * applied here, with the child ordinal breaking ties for multi-role directories.
 *
 * @param left - one described candidate.
 * @param right - the other described candidate.
 * @returns a negative number when `left` is older than `right`.
 */
export function compareGenerations(left, right) {
  if (left.version !== right.version) return left.version - right.version
  return left.ordinal - right.ordinal
}

/**
 * Pick the artifact this run should read out of one directory's entries.
 * @param filenames - entry names of one directory.
 * @returns the selected filename, or `undefined` when the directory holds no session artifact.
 */
export function selectGeneration(filenames) {
  let best
  let bestRank
  for (const filename of filenames) {
    const described = describeSessionFilename(filename)
    if (described === undefined) continue
    if (bestRank === undefined || compareGenerations(bestRank, described) < 0) {
      best = filename
      bestRank = described
    }
  }
  return best
}

/**
 * Expand a CLI path argument into the session artifacts it names.
 *
 * A log file is taken as-is. A directory holding canonical artifacts yields its
 * newest generation. Any other directory is walked for session directories, so a
 * batch root can be passed directly.
 *
 * @param inputPath - a session directory, a log file, or a batch root directory.
 * @returns `{ files, missing }`: absolute artifact paths, plus inputs that named nothing.
 */
export function collectSessionFiles(inputPath) {
  const stat = statSync(inputPath, { throwIfNoEntry: false })
  if (stat === undefined) return { files: [], missing: [inputPath] }
  if (stat.isFile()) return { files: [inputPath], missing: [] }

  const entries = readdirSync(inputPath)
  const direct = selectGeneration(entries)
  if (direct !== undefined) return { files: [join(inputPath, direct)], missing: [] }

  const files = []
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue
    const child = join(inputPath, entry)
    const childStat = statSync(child, { throwIfNoEntry: false })
    if (childStat === undefined) continue
    if (childStat.isDirectory()) {
      const nested = collectSessionFiles(child)
      files.push(...nested.files)
    } else if (describeSessionFilename(entry) !== undefined) {
      files.push(child)
    }
  }
  return { files: files.sort(), missing: [] }
}

/**
 * Read one session artifact into raw JSON rows.
 *
 * @param filePath - absolute path of a `.jsonl` or `.jsonl.zstd` artifact.
 * @returns the parsed rows, header line first.
 * @throws when the file is empty, compressed without zstd support, or holds an unparsable line.
 */
export function readSessionRows(filePath) {
  const raw = readFileSync(filePath)
  let text
  if (filePath.endsWith('.zstd')) {
    if (typeof zstdDecompressSync !== 'function') {
      throw new Error(
        `${basename(filePath)}: this Node build has no zstd support (zlib.zstdDecompressSync); `
          + 're-run on Node >= 22.15 or decompress the artifact first',
      )
    }
    text = zstdDecompressSync(raw).toString('utf8')
  } else {
    text = raw.toString('utf8')
  }

  const rows = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') continue
    try {
      rows.push(JSON.parse(line))
    } catch (error) {
      throw new Error(`${basename(filePath)}: line ${index + 1} is not valid JSON (${error.message})`)
    }
  }
  if (rows.length === 0) throw new Error(`${basename(filePath)}: no JSONL records`)
  return rows
}

/** Physical row types emitted by pre-v2 generations; they need the released migration codecs. */
const LEGACY_PHYSICAL_ROW_TYPES = new Set([
  'assistant/chunk',
  'reasoning-chunks',
  'text-chunks',
  'tool-call-chunks',
])

/** Message-role event types whose `data` is a message rather than a payload wrapper. */
const MESSAGE_EVENT_TYPES = new Set(['user/message', 'assistant/message', 'system/message', 'tool/result'])

/**
 * Turn raw rows into the session model every metric reads.
 *
 * @param rows - parsed JSONL rows, header first.
 * @param options - `filePath` for diagnostics, `knownEventTypes` as a `Set`, and
 *   `tolerateUnknownEvents` to downgrade an unknown non-`ignorable` event type
 *   from a refusal to a reported warning.
 * @returns the session model `{ filePath, sessionId, version, createdAt, header, events, turns, warnings, unknownEventTypes, skippedEvents }`.
 * @throws when the header is missing or malformed, when a row is not an object,
 *   or when an unknown required event type is present and tolerance is off.
 */
export function parseSession(rows, options) {
  const { filePath, knownEventTypes, tolerateUnknownEvents = false } = options
  const header = rows[0]
  if (typeof header !== 'object' || header === null || header.type !== 'session') {
    throw new Error(`${basename(filePath)}: first record is not a session header`)
  }
  if (typeof header.id !== 'string' || typeof header.createdAt !== 'number') {
    throw new Error(`${basename(filePath)}: session header lacks a string id and numeric createdAt`)
  }

  const warnings = []
  const unknownEventTypes = []
  const skippedEvents = []
  const events = []

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new Error(`${basename(filePath)}: record ${index + 1} is not a JSON object`)
    }
    if (typeof row.type !== 'string') {
      throw new Error(`${basename(filePath)}: record ${index + 1} has no event type`)
    }
    if (LEGACY_PHYSICAL_ROW_TYPES.has(row.type)) {
      throw new Error(
        `${basename(filePath)}: record ${index + 1} uses the legacy physical row type "${row.type}". `
          + 'Pre-v2 generations need the released migration codecs under '
          + 'deepseek-harness/packages/session/; this runner reads logical rows only and will not guess.',
      )
    }
    if (!knownEventTypes.has(row.type)) {
      if (row.ignorable === true) {
        skippedEvents.push({ type: row.type, seq: row.seq ?? null, reason: 'ignorable' })
        continue
      }
      if (!tolerateUnknownEvents) {
        throw new Error(
          `${basename(filePath)}: record ${index + 1} has event type "${row.type}", which is not in `
            + 'KNOWN_SESSION_EVENT_TYPES and carries no ignorable marker. The DSH read path refuses such a log '
            + 'because skipping a required event reconstructs a wrong session. Re-run with '
            + '--tolerate-unknown-events to score it anyway; the unknown types are listed in the report.',
        )
      }
      unknownEventTypes.push(row.type)
      warnings.push(`event type "${row.type}" is outside KNOWN_SESSION_EVENT_TYPES (tolerated by request)`)
    }
    events.push(normalizeRow(row, index))
  }

  const turns = buildTurns(events, warnings)
  return {
    filePath,
    sessionId: header.id,
    version: typeof header.version === 'number' ? header.version : 0,
    createdAt: header.createdAt,
    header,
    events,
    turns,
    warnings,
    unknownEventTypes: [...new Set(unknownEventTypes)],
    skippedEvents,
  }
}

/** Normalize one physical row to the logical event the metrics read. */
function normalizeRow(row, index) {
  const data = typeof row.data === 'object' && row.data !== null ? row.data : {}
  const base = {
    type: row.type,
    seq: typeof row.seq === 'number' ? row.seq : null,
    time: typeof row.time === 'number' ? row.time : null,
    data,
    rowIndex: index,
    turn: null,
  }
  if (MESSAGE_EVENT_TYPES.has(row.type) && typeof data.turn === 'number') base.turn = data.turn
  return base
}

/**
 * Group events into turns using the `turn/start` … `turn/end` brackets.
 *
 * Events before the first `turn/start` belong to the synthetic turn 0, which
 * holds header-adjacent records and injected seed context. A turn records
 * whether it ended with a `turn/end` event, which the clarification-round metric
 * requires.
 */
function buildTurns(events, warnings) {
  const turns = []
  let current = {
    turn: 0,
    index: 0,
    events: [],
    ended: false,
    startSeq: null,
    endSeq: null,
  }
  let openTurn = null

  const push = (turn) => {
    turns.push(turn)
    return turn
  }
  push(current)

  for (const event of events) {
    if (event.type === 'turn/start') {
      const number = typeof event.data.turn === 'number' ? event.data.turn : turns.length
      current = push({
        turn: number,
        index: turns.length,
        events: [],
        ended: false,
        startSeq: event.seq,
        endSeq: null,
      })
      openTurn = current
      event.turn = number
      current.events.push(event)
      continue
    }
    if (event.type === 'turn/end') {
      if (openTurn === null) {
        warnings.push(`turn/end for turn ${String(event.data.turn)} has no open turn/start`)
      } else {
        openTurn.ended = true
        openTurn.endSeq = event.seq
        event.turn = openTurn.turn
        openTurn.events.push(event)
        openTurn = null
      }
      continue
    }
    if (event.turn === null) event.turn = current.turn
    current.events.push(event)
  }

  if (openTurn !== null) {
    warnings.push(`turn ${openTurn.turn} was never closed by turn/end; it is treated as unfinished`)
  }
  return turns.filter(turn => turn.turn !== 0 || turn.events.length > 0)
}

/** Options accepted by {@link loadSessionLog}. */
export const SESSION_LOAD_DEFAULTS = Object.freeze({ tolerateUnknownEvents: false })

/**
 * Read and parse one session artifact end to end.
 * @param filePath - absolute path of the artifact.
 * @param knownEventTypes - the `Set` from `loadKnownEventTypes`.
 * @param options - `tolerateUnknownEvents`.
 * @returns the session model, or `{ error }` when the artifact cannot be scored.
 */
export function loadSessionLog(filePath, knownEventTypes, options = SESSION_LOAD_DEFAULTS) {
  try {
    const rows = readSessionRows(filePath)
    return { session: parseSession(rows, { filePath, knownEventTypes, ...options }) }
  } catch (error) {
    return { error: { filePath, message: error.message } }
  }
}
