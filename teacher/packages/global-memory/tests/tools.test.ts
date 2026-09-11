/**
 * The six tools as registered (README §10): their wire projection through the real
 * `defineTool`, and their behavior through the real execution path.
 *
 * @module @teacher-dsh/global-memory/tests/tools
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  validateJsonSchemaValue,
  type JsonSchemaNode,
  type ToolDefinition,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import { MEMORY_TOOL_NAMES } from '../schema.ts'
import { memoryToolDefinitions } from '../src/tools.ts'
import { makeStore, type FakeStore } from './fakes.ts'

const NOW = '2026-09-07T01:20:00.000Z'

/** The execution identity a direct tool call gets; these handlers read only `agent`. */
const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

/** Build the six tools over one store and index them by name. */
function tools(fake: FakeStore): Map<string, ToolDefinition> {
  const definitions = memoryToolDefinitions({ store: fake.store })
  return new Map(definitions.map(definition => [definition.name, definition]))
}

/**
 * The compiled parameter schema the registry enforces for one registered tool.
 *
 * `defineTool` compiles the author property map into raw JSON Schema and stores it
 * on the definition, so this is exactly what the registry validates model
 * arguments against.
 */
function parametersOf(tool: ToolDefinition): JsonSchemaNode {
  return tool.parameters as unknown as JsonSchemaNode
}

/** The required property names of one compiled parameter schema. */
function requiredOf(tool: ToolDefinition): readonly string[] {
  const required = (parametersOf(tool) as { readonly required?: readonly string[] }).required
  return [...required ?? []]
}

/** Run one tool and return its canonical value, asserting the output schema accepts it. */
async function call(
  tool: ToolDefinition | undefined,
  args: unknown,
): Promise<Record<string, unknown>> {
  assert.ok(tool !== undefined)
  const value = await tool.execute(args, exec)
  const violations = validateJsonSchemaValue(tool.output.schema, value, 'value')
  assert.deepEqual(violations, [], `${tool.name} returned a value its own output schema rejects`)
  return value as Record<string, unknown>
}

test('exactly the six declared tools are built, in declaration order', () => {
  const definitions = memoryToolDefinitions({ store: makeStore(() => NOW).store })
  assert.deepEqual(definitions.map(definition => definition.name), [...MEMORY_TOOL_NAMES])
  assert.equal(definitions.length, 6)
})

test('every registration carries a description, parameters, and an output schema', () => {
  for (const definition of memoryToolDefinitions({ store: makeStore(() => NOW).store })) {
    assert.ok(definition.description.length > 40, `${definition.name} needs a model-facing description`)
    const compiled = parametersOf(definition) as { readonly type?: string; readonly properties?: unknown }
    assert.equal(compiled.type, 'object')
    assert.ok(compiled.properties !== undefined)
    assert.equal(definition.output.schema.type, 'object')
  }
})

test('the compiled parameter schema requires the declared required properties', () => {
  const definitions = tools(makeStore(() => NOW))
  const set = definitions.get('memory_set')
  const forget = definitions.get('memory_forget')
  assert.ok(set !== undefined && forget !== undefined)
  assert.deepEqual([...requiredOf(set)].sort(), ['confidence', 'evidence', 'key', 'namespace', 'scope', 'value'])
  assert.deepEqual([...requiredOf(forget)], ['confirm'])
})

test('the promotion gate rejects weak_inference before execute runs', () => {
  const definition = tools(makeStore(() => NOW)).get('memory_set')
  assert.ok(definition !== undefined)
  const violations = validateJsonSchemaValue(parametersOf(definition), {
    namespace: 'preferences',
    key: 'pedagogy_preference',
    value: '用户不喜欢课堂活动',
    scope: { scope_type: 'stable' },
    confidence: 'weak_inference',
    evidence: '一次否定。',
  })
  assert.equal(violations.length > 0, true)
  assert.equal(violations.join(' ').includes('confidence'), true)
})

test('memory_set then memory_get round-trips one durable fact', async () => {
  const fake = makeStore(() => NOW)
  const definitions = tools(fake)
  const written = await call(definitions.get('memory_set'), {
    namespace: 'environment',
    key: 'textbook_edition',
    value: '人教版必修一',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    evidence: '老师说明使用人教版必修一。',
    quoted_fragment: '我们用的是人教版必修一',
  })
  assert.equal(written['created'], true)
  const record = written['record'] as Record<string, unknown>
  assert.equal(record['value'], '人教版必修一')
  assert.equal(record['expires_at'], '2027-09-07T01:20:00.000Z')
  // `session_ref` is an evidence locator: it is stored, and never projected.
  const source = record['source'] as Record<string, unknown>
  assert.deepEqual(Object.keys(source).sort(), ['observed_at', 'quoted_fragment', 'source'])

  const read = await call(definitions.get('memory_get'), {
    namespace: 'environment',
    key: 'textbook_edition',
  })
  assert.equal(read['found'], true)
  assert.equal((read['record'] as Record<string, unknown>)['id'], record['id'])
})

test('a stable record omits expires_at rather than emitting a null', async () => {
  const fake = makeStore(() => NOW)
  const definitions = tools(fake)
  const written = await call(definitions.get('memory_set'), {
    namespace: 'preferences',
    key: 'language_style',
    value: '用中文、口语化',
    scope: { scope_type: 'stable' },
    confidence: 'explicit_user',
    evidence: '老师明确说过。',
  })
  const record = written['record'] as Record<string, unknown>
  assert.equal('expires_at' in record, false)
})

test('memory_update reports the previous value', async () => {
  const fake = makeStore(() => NOW)
  const definitions = tools(fake)
  const written = await call(definitions.get('memory_set'), {
    namespace: 'environment',
    key: 'class_duration_minutes',
    value: '45',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    evidence: '老师说明每节课 45 分钟。',
  })
  const id = (written['record'] as Record<string, unknown>)['id']
  const updated = await call(definitions.get('memory_update'), {
    id,
    value: '40',
    confidence: 'explicit_correction',
    evidence: '老师纠正：这学期调成了 40 分钟。',
  })
  assert.equal(updated['previous_value'], '45')
  assert.equal((updated['record'] as Record<string, unknown>)['value'], '40')
  assert.equal(fake.store.all().length, 1)
})

test('memory_search returns records and never a session locator', async () => {
  const fake = makeStore(() => NOW)
  const definitions = tools(fake)
  await fake.store.set({
    namespace: 'preferences',
    key: 'output_format_preference',
    value: 'PPT 每页不超过 6 行字',
    scope: { scope_type: 'stable' },
    confidence: 'explicit_user',
    evidence: '老师明确说过。',
    session_ref: 'session-secret',
  })
  const found = await call(definitions.get('memory_search'), {
    query: 'PPT',
    namespaces: ['preferences'],
    limit: 8,
  })
  const records = found['records'] as readonly Record<string, unknown>[]
  assert.equal(records.length, 1)
  assert.equal(JSON.stringify(found).includes('session-secret'), false)
})

test('memory_forget refuses to run without confirm: true', async () => {
  const definition = tools(makeStore(() => NOW)).get('memory_forget')
  assert.ok(definition !== undefined)
  const violations = validateJsonSchemaValue(parametersOf(definition), { namespace: 'preferences' }, '')
  assert.equal(violations.length > 0, true)
})

test('memory_forget deletes the named record and nothing else', async () => {
  const fake = makeStore(() => NOW)
  const definitions = tools(fake)
  const first = await call(definitions.get('memory_set'), {
    namespace: 'profile',
    key: 'display_name',
    value: '张老师',
    scope: { scope_type: 'stable' },
    confidence: 'explicit_user',
    evidence: '老师自我介绍。',
  })
  await fake.store.set({
    namespace: 'profile',
    key: 'subject',
    value: '高中地理',
    scope: { scope_type: 'stable' },
    confidence: 'explicit_user',
    evidence: '老师说明学科。',
  })
  const deleted = await call(definitions.get('memory_forget'), {
    id: (first['record'] as Record<string, unknown>)['id'],
    confirm: true,
  })
  assert.equal(deleted['deleted'], 1)
  assert.equal(fake.store.all().length, 1)
})

test('memory_feedback suppressions never overwrite the value', async () => {
  const fake = makeStore(() => NOW)
  const definitions = tools(fake)
  await fake.store.set({
    namespace: 'environment',
    key: 'class_duration_minutes',
    value: '45',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    evidence: '老师说明每节课 45 分钟。',
  })
  const target = fake.store.all()[0]
  assert.ok(target !== undefined)
  const result = await call(definitions.get('memory_feedback'), {
    record_id: target.id,
    signal: 'dont_use_this_time',
    evidence: '老师说明本次公开课 35 分钟，不是平时的 45 分钟。',
  })
  assert.equal(result['action'], 'suppressed_for_session')
  assert.equal(result['correction_recorded'], false)
  assert.equal((result['record'] as Record<string, unknown>)['value'], '45')
  assert.equal(fake.store.all().find(row => row.key === 'class_duration_minutes')?.value, '45')
})

test('memory_feedback correct writes a durable correction', async () => {
  const fake = makeStore(() => NOW)
  const definitions = tools(fake)
  await fake.store.set({
    namespace: 'environment',
    key: 'class_duration_minutes',
    value: '45',
    scope: { scope_type: 'school_year', valid_for: '2026-2027' },
    confidence: 'explicit_user',
    evidence: '老师说明每节课 45 分钟。',
  })
  const target = fake.store.all()[0]
  assert.ok(target !== undefined)
  const result = await call(definitions.get('memory_feedback'), {
    record_id: target.id,
    signal: 'correct',
    corrected_value: '40',
    evidence: '老师纠正：这学期调成了 40 分钟。',
  })
  assert.equal(result['action'], 'corrected')
  assert.equal(result['correction_recorded'], true)
  assert.equal(
    fake.store.all().filter(row => row.namespace === 'corrections').length >= 1,
    true,
  )
})

test('every registration returns a disposer, so the tools are effects', () => {
  const registered: string[] = []
  const disposed: string[] = []
  const registry = {
    register(definition: ToolDefinition): () => void {
      registered.push(definition.name)
      return () => {
        disposed.push(definition.name)
      }
    },
  }
  const definitions = memoryToolDefinitions({ store: makeStore(() => NOW).store })
  const disposers = definitions.map(definition => registry.register(definition))
  assert.deepEqual(registered, [...MEMORY_TOOL_NAMES])
  for (const dispose of disposers) dispose()
  assert.deepEqual(disposed, [...MEMORY_TOOL_NAMES])
})
