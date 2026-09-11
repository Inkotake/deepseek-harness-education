/**
 * The six model-facing tools (README §10).
 *
 * Each tool is defined with `defineTool` and registered by the plugin through
 * `ctx.tools.register(definition)` — `ToolRuntime.register`
 * (`deepseek-harness/packages/core/tools/src/index.ts:1027`) — which returns the
 * exact disposer, so every registration is a Cordis effect and unloads cleanly.
 *
 * Three things are deliberate here:
 *
 * - The model-facing text (name, description, parameters, output schema) comes
 *   from `schema.ts` through `wire.ts`. No tool text is written twice.
 * - Every canonical result is validated by the registry against the same declared
 *   output schema, so the single cast in {@link canonical} records a promise the
 *   registry keeps rather than asserting one.
 * - Each tool declares a presenter. `presentCall`/`presentResult` are pure
 *   (`index.ts:271`, `:279`), so they read only their arguments and the result's
 *   own presentation metadata.
 *
 * @module @teacher-dsh/global-memory/src/tools
 */

import {
  defineTool,
  type InferValue,
  type ObjectValueSchemaSpec,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import type {
  MemoryFeedbackInput,
  MemoryForgetInput,
  MemoryGetInput,
  MemorySearchInput,
  MemorySetInput,
  MemoryToolName,
  MemoryUpdateInput,
} from '../schema.ts'
import { type MemoryStore, type MemoryRecordWire } from './store.ts'
import { memoryOutputSchema, memoryParameters, memoryToolDeclaration } from './wire.ts'

/** What every tool needs from the plugin. */
export interface MemoryToolServices {
  /** The durable store the tools operate on. */
  readonly store: MemoryStore
}

/** The canonical value type `defineTool` expects for a projected output schema. */
type CanonicalOutput = InferValue<ObjectValueSchemaSpec>

/**
 * Hand one canonical result to the registry.
 *
 * `defineTool` validates every returned value against `output.schema` before it
 * leaves the tool (`core/tools/src/index.ts:1785`), and that schema is the
 * projection of the declaration this result was built from, so this cast records
 * the declared output type rather than asserting a new one.
 * @param value - the canonical result.
 * @returns the same value as the registry's canonical type.
 */
function canonical<T>(value: T): CanonicalOutput {
  return value as unknown as CanonicalOutput
}

/**
 * Read model-supplied arguments as one tool's declared input.
 *
 * The registry validates the arguments against the property map projected from the
 * same declaration before `execute` runs, so this narrows a value that already
 * satisfies the declared input type.
 * @param args - the validated arguments.
 * @returns the declared input.
 */
function inputOf<T>(args: unknown): T {
  return args as T
}

/** Read one tool's canonical result as the declared output type. */
function outputOf<T>(value: unknown): T {
  return value as unknown as T
}

/** Narrow one result's presentation metadata to a JSON object. */
function metaOf(value: unknown): { readonly [key: string]: unknown } | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as { readonly [key: string]: unknown }
}

/** Read one string field out of presentation metadata. */
function metaString(meta: { readonly [key: string]: unknown } | undefined, key: string): string | undefined {
  const value = meta?.[key]
  return typeof value === 'string' ? value : undefined
}

/** One line naming a record's field and value. */
function recordLine(record: MemoryRecordWire): string {
  return `[${record.namespace}] ${record.key}: ${record.value}`
}

/** The text projection of one `memory_get` result. */
function renderGet(value: { readonly found: boolean; readonly record?: MemoryRecordWire }): string {
  if (!value.found || value.record === undefined) return 'No memory matches that field.'
  return recordLine(value.record)
}

/** The text projection of one `memory_search` result. */
function renderSearch(value: { readonly records: readonly MemoryRecordWire[]; readonly truncated: boolean }): string {
  if (value.records.length === 0) return 'No memories match that query.'
  const lines = [`${value.records.length} ${value.records.length === 1 ? 'memory' : 'memories'}${value.truncated ? ' (more exist)' : ''}:`]
  for (const record of value.records) lines.push(`- ${recordLine(record)}`)
  return lines.join('\n')
}

/** The text projection of one `memory_feedback` result. */
function renderFeedback(value: {
  readonly action: string
  readonly record?: MemoryRecordWire
  readonly correction_recorded: boolean
}): string {
  const target = value.record === undefined ? '' : ` ${recordLine(value.record)}`
  switch (value.action) {
    case 'corrected':
      return `Corrected the memory:${target}. The correction is durable.`
    case 'invalidated':
      return `Withdrew the memory:${target}.`
    case 'suppressed_for_session':
      return `Suppressed the memory:${target} for this session only. The stored value is unchanged.`
    default:
      return 'No memory matched that feedback, so nothing changed.'
  }
}

/**
 * Build the six tool definitions.
 * @param services - the store the tools operate on.
 * @returns the six definitions, in `schema.ts` declaration order.
 */
export function memoryToolDefinitions(services: MemoryToolServices): readonly ToolDefinition[] {
  const { store } = services
  const definition = (name: MemoryToolName): ToolDefinition => {
    const declared = memoryToolDeclaration(name)
    const parameters = memoryParameters(name)
    const schema = memoryOutputSchema(name)
    const description = declared.description
    switch (name) {
      case 'memory_get':
        return defineTool({
          name,
          description,
          parameters,
          output: {
            schema,
            render: (_args, value) => [{ type: 'text', text: renderGet(outputOf(value)) }],
            presentationMeta: (_args, value) => {
              const result = outputOf<{ readonly found: boolean; readonly record?: MemoryRecordWire }>(value)
              return {
                found: result.found,
                namespace: result.record?.namespace ?? '',
                key: result.record?.key ?? '',
                value: result.record?.value ?? '',
                reconfirm: result.record === undefined ? '' : result.record.value,
              }
            },
          },
          async execute(args, exec) {
            const input = inputOf<MemoryGetInput>(args)
            const sessionRef = exec.agent === undefined ? undefined : String(exec.agent.session.header.id)
            return canonical(store.get({
              namespace: input.namespace,
              key: input.key,
              ...input.scope === undefined ? {} : { scope: input.scope },
              ...input.include_expired === undefined ? {} : { include_expired: input.include_expired },
              nowIso: store.now(),
              ...sessionRef === undefined ? {} : { session_ref: sessionRef },
            }))
          },
          presentCall(args) {
            const input = inputOf<MemoryGetInput>(args)
            return {
              card: 'generic',
              title: `Read memory ${input.namespace}.${input.key}`,
              kind: 'read',
              rawInput: `${input.namespace}.${input.key}`,
            }
          },
          presentResult(_args, result) {
            const meta = metaOf(result.meta)
            if (metaString(meta, 'found') === undefined && meta?.['found'] !== true) {
              return { card: 'generic', title: 'Read memory' }
            }
            const namespace = metaString(meta, 'namespace') ?? ''
            const key = metaString(meta, 'key') ?? ''
            const value = metaString(meta, 'value') ?? ''
            return {
              card: 'generic',
              title: value === '' ? `No memory for ${namespace}.${key}` : `Memory ${namespace}.${key}`,
              content: [{ type: 'text', text: value === '' ? 'Not remembered yet.' : value }],
            }
          },
        })

      case 'memory_search':
        return defineTool({
          name,
          description,
          parameters,
          output: {
            schema,
            render: (_args, value) => [{
              type: 'text',
              text: renderSearch(outputOf(value)),
            }],
            presentationMeta: (_args, value) => {
              const result = outputOf<{ readonly records: readonly MemoryRecordWire[]; readonly truncated: boolean }>(value)
              return {
                count: result.records.length,
                truncated: result.truncated,
                records: result.records.map(record => recordLine(record)),
              }
            },
          },
          async execute(args, exec) {
            const input = inputOf<MemorySearchInput>(args)
            const sessionRef = exec.agent === undefined ? undefined : String(exec.agent.session.header.id)
            return canonical(store.search({
              query: input.query,
              ...input.namespaces === undefined ? {} : { namespaces: input.namespaces },
              ...input.scope_type === undefined ? {} : { scope_type: input.scope_type },
              ...input.min_confidence === undefined ? {} : { min_confidence: input.min_confidence },
              ...input.include_expired === undefined ? {} : { include_expired: input.include_expired },
              ...input.limit === undefined ? {} : { limit: input.limit },
              nowIso: store.now(),
              ...sessionRef === undefined ? {} : { session_ref: sessionRef },
            }))
          },
          presentCall(args) {
            const input = inputOf<MemorySearchInput>(args)
            return {
              card: 'generic',
              title: input.query.trim() === '' ? 'List everything remembered' : `Search memory: ${input.query}`,
              kind: 'search',
              rawInput: input.query,
            }
          },
          presentResult(_args, result) {
            const meta = metaOf(result.meta)
            const count = typeof meta?.['count'] === 'number' ? meta['count'] : undefined
            const records = Array.isArray(meta?.['records'])
              ? (meta['records'] as unknown[]).filter((line): line is string => typeof line === 'string')
              : []
            return {
              card: 'generic',
              title: count === undefined ? 'Memory search' : `${count} ${count === 1 ? 'memory' : 'memories'} found`,
              content: [{
                type: 'text',
                text: records.length === 0 ? 'Nothing matched.' : records.join('\n'),
              }],
            }
          },
        })

      case 'memory_set':
        return defineTool({
          name,
          description,
          parameters,
          output: {
            schema,
            render: (_args, value) => {
              const result = outputOf<{ readonly record: MemoryRecordWire; readonly created: boolean }>(value)
              return [{
                type: 'text',
                text: `${result.created ? 'Remembered' : 'Updated'} ${recordLine(result.record)}`,
              }]
            },
            presentationMeta: (_args, value) => {
              const result = outputOf<{ readonly record: MemoryRecordWire; readonly created: boolean }>(value)
              return { namespace: result.record.namespace, key: result.record.key, value: result.record.value, created: result.created }
            },
          },
          async execute(args, exec) {
            const input = inputOf<MemorySetInput>(args)
            const sessionRef = exec.agent === undefined ? undefined : String(exec.agent.session.header.id)
            return canonical(await store.set({
              ...input,
              ...sessionRef === undefined ? {} : { session_ref: sessionRef },
            }))
          },
          presentCall(args) {
            const input = inputOf<MemorySetInput>(args)
            return {
              card: 'generic',
              title: `Remember ${input.namespace}.${input.key}`,
              kind: 'edit',
              rawInput: `${input.namespace}.${input.key} = ${input.value}`,
            }
          },
          presentResult(_args, result) {
            const meta = metaOf(result.meta)
            const created = meta?.['created'] === true
            return {
              card: 'generic',
              title: created ? 'Remembered' : 'Updated memory',
              content: [{
                type: 'text',
                text: `${metaString(meta, 'namespace') ?? ''}.${metaString(meta, 'key') ?? ''} = ${metaString(meta, 'value') ?? ''}`,
              }],
            }
          },
        })

      case 'memory_update':
        return defineTool({
          name,
          description,
          parameters,
          output: {
            schema,
            render: (_args, value) => {
              const result = outputOf<{ readonly record: MemoryRecordWire; readonly previous_value: string }>(value)
              return [{
                type: 'text',
                text: `${result.record.namespace}.${result.record.key}: ${result.previous_value} → ${result.record.value}`,
              }]
            },
            presentationMeta: (_args, value) => {
              const result = outputOf<{ readonly record: MemoryRecordWire; readonly previous_value: string }>(value)
              return {
                namespace: result.record.namespace,
                key: result.record.key,
                previous: result.previous_value,
                value: result.record.value,
              }
            },
          },
          async execute(args, exec) {
            const input = inputOf<MemoryUpdateInput>(args)
            const sessionRef = exec.agent === undefined ? undefined : String(exec.agent.session.header.id)
            return canonical(await store.update({
              ...input,
              ...sessionRef === undefined ? {} : { session_ref: sessionRef },
            }))
          },
          presentCall(args) {
            const input = inputOf<MemoryUpdateInput>(args)
            return { card: 'generic', title: `Update memory ${String(input.id)}`, kind: 'edit', rawInput: input.value ?? '' }
          },
          presentResult(_args, result) {
            const meta = metaOf(result.meta)
            return {
              card: 'generic',
              title: `Updated ${metaString(meta, 'namespace') ?? ''}.${metaString(meta, 'key') ?? ''}`,
              content: [{
                type: 'text',
                text: `${metaString(meta, 'previous') ?? ''} → ${metaString(meta, 'value') ?? ''}`,
              }],
            }
          },
        })

      case 'memory_forget':
        return defineTool({
          name,
          description,
          parameters,
          output: {
            schema,
            render: (_args, value) => {
              const result = outputOf<{ readonly deleted: number }>(value)
              return [{
                type: 'text',
                text: result.deleted === 0 ? 'Nothing was deleted.' : `Deleted ${result.deleted} ${result.deleted === 1 ? 'memory' : 'memories'}.`,
              }]
            },
            presentationMeta: (_args, value) => {
              const result = outputOf<{ readonly deleted: number }>(value)
              return { deleted: result.deleted }
            },
          },
          async execute(args) {
            const input = inputOf<MemoryForgetInput>(args)
            return canonical(await store.forget(input))
          },
          presentCall(args) {
            const input = inputOf<MemoryForgetInput>(args)
            return {
              card: 'generic',
              title: 'Delete memories',
              kind: 'delete',
              rawInput: input.id === undefined ? `${input.namespace ?? ''}.${input.key ?? ''}` : String(input.id),
            }
          },
          presentResult(_args, result) {
            const meta = metaOf(result.meta)
            const deleted = typeof meta?.['deleted'] === 'number' ? meta['deleted'] : 0
            return {
              card: 'generic',
              title: deleted === 0 ? 'Nothing deleted' : `Deleted ${deleted}`,
              content: [{ type: 'text', text: 'Deletion is durable: the value cannot be retrieved again.' }],
            }
          },
        })

      case 'memory_feedback':
        return defineTool({
          name,
          description,
          parameters,
          output: {
            schema,
            render: (_args, value) => [{
              type: 'text',
              text: renderFeedback(outputOf(value)),
            }],
            presentationMeta: (_args, value) => {
              const result = outputOf<{
                readonly action: string
                readonly correction_recorded: boolean
                readonly record?: MemoryRecordWire
              }>(value)
              return {
                action: result.action,
                correction_recorded: result.correction_recorded,
                value: result.record?.value ?? '',
                namespace: result.record?.namespace ?? '',
                key: result.record?.key ?? '',
              }
            },
          },
          async execute(args, exec) {
            const input = inputOf<MemoryFeedbackInput>(args)
            const sessionRef = exec.agent === undefined ? undefined : String(exec.agent.session.header.id)
            return canonical(await store.feedback({
              ...input,
              ...sessionRef === undefined ? {} : { session_ref: sessionRef },
            }))
          },
          presentCall(args) {
            const input = inputOf<MemoryFeedbackInput>(args)
            const target = input.record_id === undefined
              ? `${input.namespace ?? ''}.${input.key ?? ''}`
              : String(input.record_id)
            return { card: 'generic', title: `Report memory ${input.signal}`, kind: 'other', rawInput: target }
          },
          presentResult(_args, result) {
            const meta = metaOf(result.meta)
            const action = metaString(meta, 'action') ?? 'no_op'
            const value = metaString(meta, 'value') ?? ''
            if (action === 'suppressed_for_session') {
              return {
                card: 'generic',
                title: 'Suppressed for this task only',
                content: [{
                  type: 'text',
                  text: `The stored value is unchanged (${value}). The next session sees it again.`,
                }],
              }
            }
            return {
              card: 'generic',
              title: action === 'corrected' ? 'Correction recorded' : action === 'invalidated' ? 'Memory withdrawn' : 'No change',
            }
          },
        })
    }
  }
  return [
    definition('memory_get'),
    definition('memory_search'),
    definition('memory_set'),
    definition('memory_update'),
    definition('memory_forget'),
    definition('memory_feedback'),
  ]
}
