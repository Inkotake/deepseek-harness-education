/**
 * The wire projection of `schema.ts`'s six tool declarations.
 *
 * Schema.ts is the source: it carries each tool's model-facing description, its
 * input JSON Schema, its canonical output JSON Schema, and one realistic call.
 * `dsh-tools` needs those in its own author DSL (an implicit property map for
 * `parameters`, a value-schema node for `output.schema`), so this module projects
 * the declared nodes onto that DSL and does nothing else. It is pure — the only
 * import from `dsh-tools` is a type — so the projection is unit-testable, and in
 * particular the promotion gate is testable as data:
 *
 * - `memory_set`'s `confidence` enum has four members and `weak_inference` is not
 *   one of them, so the gate cannot be bypassed through the tool.
 * - `memory_search`'s `scope_type` is the scope-type enum, which is what
 *   `MemorySearchInput.scope_type` declares. The declared JSON Schema spells that
 *   slot as the memory `scope` property map instead — a transcription slip in the
 *   readable JSON Schema, not in the TypeScript input type — so this projection
 *   expands it to the enum the type names. `MOUNT.md` records it.
 *
 * @module @teacher-dsh/global-memory/src/wire
 */

import type {
  ObjectValueSchemaSpec,
  ParameterPropertySpec,
  ParameterSchemaSpec,
} from '@deepseek-ai/dsh-tools'
import {
  MEMORY_TOOLS,
  MEMORY_TTL_POLICY,
  type AnyMemoryToolDeclaration,
  type MemoryJson,
  type MemoryToolName,
} from '../schema.ts'

/** Keys the author schema DSL accepts; anything else must not reach `defineTool`. */
const PROJECTED_KEYS = [
  'type',
  'required',
  'description',
  'enum',
  'const',
  'items',
  'properties',
  'additionalProperties',
] as const

/** The scope types `memory_search` accepts, in TTL-table declaration order. */
const SCOPE_TYPE_PARAMETER: MemoryJson = {
  type: 'string',
  description: 'Only search records whose scope has this lifetime class.',
  enum: Object.keys(MEMORY_TTL_POLICY),
}

/** Cast one narrowed JSON node onto the author DSL. */
function asOutputSchema(node: MemoryJson): ObjectValueSchemaSpec {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new Error('memory: a declared tool output schema is not an object')
  }
  const record = node as { readonly [key: string]: MemoryJson }
  if (record['type'] !== 'object' || typeof record['additionalProperties'] !== 'boolean') {
    throw new Error('memory: every declared tool output schema must be an object with explicit openness')
  }
  return record as unknown as ObjectValueSchemaSpec
}

/** Read one node as a JSON object map, failing loud when it is not one. */
function asRecord(node: MemoryJson, what: string): { readonly [key: string]: MemoryJson } {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new Error(`memory: ${what} is not an object`)
  }
  return node as { readonly [key: string]: MemoryJson }
}

/** Project one property map, recursing into each property node. */
function projectProperties(node: MemoryJson): { readonly [key: string]: MemoryJson } {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new Error('memory: a declared tool schema property map is not an object')
  }
  const source = node as { readonly [key: string]: MemoryJson }
  const projected: Record<string, MemoryJson> = {}
  for (const [key, value] of Object.entries(source)) {
    projected[key] = projectNode(value)
  }
  return projected
}

/** Project one declared node onto the DSL, dropping every unsupported keyword. */
function projectNode(node: MemoryJson): MemoryJson {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new Error('memory: a declared tool schema node is not an object')
  }
  const source = node as { readonly [key: string]: MemoryJson }
  const projected: Record<string, MemoryJson> = {}
  for (const key of PROJECTED_KEYS) {
    const value = source[key]
    if (value === undefined) continue
    if (key === 'properties') {
      projected[key] = projectProperties(value)
      continue
    }
    if (key === 'items') {
      projected[key] = projectNode(value)
      continue
    }
    projected[key] = value
  }
  return projected
}

/**
 * The declaration of one of the six tools.
 * @param name - the tool name.
 * @returns the declaration from `MEMORY_TOOLS`.
 * @throws when the name is not one of the six, because a seventh tool would be a
 * contract change rather than a plugin decision.
 */
export function memoryToolDeclaration(name: MemoryToolName): AnyMemoryToolDeclaration {
  const declaration = MEMORY_TOOLS.find(tool => tool.name === name)
  if (declaration === undefined) {
    throw new Error(`memory: '${name}' is not one of the six declared tools`)
  }
  return declaration
}

/**
 * Build one tool's `parameters` in the registry's implicit property-map DSL.
 * @param name - the tool name.
 * @returns the parameter map `defineTool` compiles.
 * @throws when the declared input is not an object-rooted schema.
 */
export function memoryParameters(name: MemoryToolName): ParameterSchemaSpec {
  const root = asRecord(memoryToolDeclaration(name).input, `${name}.input`)
  if (root['type'] !== 'object') {
    throw new Error(`memory: ${name}.input must be an object-rooted schema`)
  }
  const declared = root['properties']
  const properties = declared === undefined ? {} : asRecord(declared, `${name}.input.properties`)
  const corrected = name === 'memory_search'
    ? { ...properties, scope_type: SCOPE_TYPE_PARAMETER }
    : properties
  return projectProperties(corrected) as unknown as ParameterSchemaSpec
}

/**
 * Build one tool's canonical output schema.
 * @param name - the tool name.
 * @returns the object-rooted value schema `defineTool` enforces on every result.
 * @throws when the declared output is not an explicit object root, because
 * `defineTool` requires nested and output objects to declare their openness.
 */
export function memoryOutputSchema(name: MemoryToolName): ObjectValueSchemaSpec {
  return asOutputSchema(projectNode(memoryToolDeclaration(name).output))
}

/**
 * The parameter spec one tool declares for one property.
 * @param name - the tool name.
 * @param property - the property to read.
 * @returns the projected property spec, or `undefined` when the tool has none.
 */
export function memoryParameter(name: MemoryToolName, property: string): ParameterPropertySpec | undefined {
  return memoryParameters(name)[property]
}

/** The six declared tool names, in declaration order. */
export const PROJECTED_TOOL_NAMES: readonly MemoryToolName[] = MEMORY_TOOLS.map(tool => tool.name)
