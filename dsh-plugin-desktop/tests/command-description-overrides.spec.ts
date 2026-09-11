import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context as HostContext } from '@deepseek-ai/cordis'
import {
  applyCommandDescriptionCopy,
  COMMAND_DESCRIPTION_COPY,
  installCommandDescriptionCopy,
  localizeCommandDescriptors,
  type CommandDescriptor,
} from '../src/command-description-overrides.ts'

/** Cordis' own escape hatch from the traceable Service proxy to its instance. */
const CORDIS_ORIGINAL = Symbol.for('cordis.original')

/**
 * Every Host command this distribution registers, with the package that registers it
 * and the exact English description its upstream registration site passes to
 * `commands.register`. A command missing here is a command the panel still shows in
 * English, so the first spec below reads each site back from the installed package.
 */
const COMMAND_INVENTORY = [
  {
    package: '@deepseek-ai/dsh-command-compact',
    name: 'compact',
    description: 'Compact older conversation history',
  },
  {
    package: '@deepseek-ai/dsh-session-log-export',
    name: 'export',
    description: 'Download this Session log as a ZIP archive',
  },
  {
    package: '@deepseek-ai/dsh-command-feedback',
    name: 'feedback',
    description: 'record feedback about this session',
  },
  {
    package: '@deepseek-ai/dsh-command-goal',
    name: 'goal',
    description: 'set or view the goal for a long-running task',
  },
  {
    package: '@deepseek-ai/dsh-permission-presets',
    name: 'permission',
    description: 'Switch the permission preset (sandbox mode + approval policy)',
  },
  {
    package: '@deepseek-ai/dsh-plan-mode',
    name: 'plan',
    description: 'Enter or leave plan mode',
  },
] as const

/** One `name` / `description` pair in a built vendor source. */
const REGISTERED_PAIR = /name:\s*"([a-z][a-z0-9_-]*)",\s*\n\s*description:\s*"((?:[^"\\]|\\.)*)"/gu

/**
 * The description one installed package registers for one command. The package may
 * declare other name/description pairs (its preset table, for instance), so the
 * command name selects the pair; two registrations of one name are a defect.
 */
function registeredPair(packageName: string, commandName: string): { name: string; description: string } {
  const entry = createRequire(import.meta.url).resolve(`${packageName}/package.json`)
  const source = readFileSync(join(dirname(entry), 'lib', 'index.js'), 'utf8')
  const pairs = [...source.matchAll(REGISTERED_PAIR)].flatMap((match) => {
    const name = match[1]
    const description = match[2]
    return name === undefined || description === undefined ? [] : [{ name, description }]
  })
  const matches = pairs.filter(pair => pair.name === commandName)
  const match = matches[0]
  if (matches.length !== 1 || match === undefined) {
    throw new Error(
      `${packageName} registers ${String(matches.length)} pairs named "${commandName}"`
      + ` (all pairs: ${pairs.map(pair => pair.name).join(', ') || 'none'})`,
    )
  }
  return match
}

/** A command registry whose `list` sits on a prototype, like the vendored CommandRuntime. */
class FakeCommandRegistry {
  list(agent: unknown): readonly CommandDescriptor[] {
    void agent
    return Object.freeze([
      Object.freeze({ name: 'compact', description: 'Compact older conversation history' }),
      Object.freeze({
        name: 'goal',
        description: 'set or view the goal for a long-running task',
        input: Object.freeze({ hint: '<objective>' }),
      }),
      Object.freeze({ name: 'invented', description: 'An upstream command this table does not name' }),
    ])
  }
}

/**
 * Reproduce Cordis' traceable Service proxy for one instance: `symbols.original`
 * reads the instance, a prototype-method write lands on that instance, and every
 * other read is forwarded, so this is the object the Typert Gateway resolves.
 */
function traceableService(runtime: object): object {
  return new Proxy(runtime, {
    get: (target, prop, receiver) => prop === CORDIS_ORIGINAL
      ? target
      : Reflect.get(target, prop, receiver),
    set: (target, prop, value, receiver) => Reflect.set(target, prop, value, receiver),
  })
}

/** Call the `list` method exactly as the gateway does: `Reflect.get` off `ctx.get(...)`. */
function listThroughService(service: object): readonly CommandDescriptor[] {
  const method: unknown = Reflect.get(service, 'list')
  if (typeof method !== 'function') throw new Error('the service exposes no list method')
  return Reflect.apply(method, service, [undefined]) as readonly CommandDescriptor[]
}

/** A host context whose only service is the one read through `ctx.get`. */
function hostContext(service: unknown): {
  ctx: HostContext
  labels: string[]
  disposers: (() => void)[]
} {
  const labels: string[] = []
  const disposers: (() => void)[] = []
  const ctx = {
    get: (name: string) => name === 'commands' ? service : undefined,
    effect: (factory: () => (() => void) | void, label: string) => {
      labels.push(label)
      disposers.push(factory() ?? (() => {}))
    },
  } as unknown as HostContext
  return { ctx, labels, disposers }
}

describe('command description inventory', () => {
  it('records the English description each installed package still registers', () => {
    for (const entry of COMMAND_INVENTORY) {
      expect(registeredPair(entry.package, entry.name), entry.package).toEqual({
        name: entry.name,
        description: entry.description,
      })
    }
  })

  it('covers every inventory command with a distinct Simplified Chinese description', () => {
    expect(Object.keys(COMMAND_DESCRIPTION_COPY).sort())
      .toEqual(COMMAND_INVENTORY.map(entry => entry.name).sort())
    for (const entry of COMMAND_INVENTORY) {
      const zh = COMMAND_DESCRIPTION_COPY[entry.name]
      expect(zh, entry.name).toBeDefined()
      expect(zh?.trim().length, entry.name).toBeGreaterThan(0)
      expect(zh, entry.name).not.toBe(entry.description)
      expect(zh, entry.name).toMatch(/[\u4E00-\u9FFF]/u)
    }
  })
})

describe('command description override', () => {
  it('replaces the named descriptions and leaves every unknown command on the upstream string', () => {
    const upstream = new FakeCommandRegistry().list(undefined)
    const localized = localizeCommandDescriptors(upstream) as readonly CommandDescriptor[]

    expect(localized.map(row => row.name)).toEqual(['compact', 'goal', 'invented'])
    expect(localized[0]?.description).toBe(COMMAND_DESCRIPTION_COPY['compact'])
    expect(localized[1]?.description).toBe(COMMAND_DESCRIPTION_COPY['goal'])
    expect(localized[2]?.description).toBe('An upstream command this table does not name')
    // Untouched fields survive, and the result keeps the frozen contract of the registry.
    expect(localized[1]?.input).toEqual({ hint: '<objective>' })
    expect(Object.isFrozen(localized)).toBe(true)
    expect(Object.isFrozen(localized[0])).toBe(true)
    expect(Object.isFrozen(upstream[1])).toBe(true)
  })

  it('returns an unrecognized upstream value unchanged', () => {
    const upstream = Object.freeze([Object.freeze({ name: 'other', description: 'Other command' })])
    const malformed = [null, 42]
    expect(localizeCommandDescriptors(upstream)).toBe(upstream)
    expect(localizeCommandDescriptors(malformed)).toBe(malformed)
    expect(localizeCommandDescriptors('not a list')).toBe('not a list')
  })

  it('installs through one labelled ctx.effect and reaches the Service the gateway resolves', () => {
    const runtime = new FakeCommandRegistry()
    const proxy = traceableService(runtime)
    const { ctx, labels, disposers } = hostContext(proxy)

    applyCommandDescriptionCopy(ctx)
    expect(labels).toEqual(['dsh-plugin-desktop: Chinese slash-command descriptions'])

    expect(listThroughService(proxy).map(row => row.description)).toEqual([
      COMMAND_DESCRIPTION_COPY['compact'],
      COMMAND_DESCRIPTION_COPY['goal'],
      'An upstream command this table does not name',
    ])
    // The wrapper is an own property of the instance, which is what the gateway reads.
    expect(Object.hasOwn(runtime, 'list')).toBe(true)

    for (const dispose of disposers) dispose()
    expect(listThroughService(proxy)[0]?.description).toBe('Compact older conversation history')
  })

  it('keeps the vendored method as the receiver of every delegated call', () => {
    const runtime = new FakeCommandRegistry()
    const { ctx } = hostContext(traceableService(runtime))
    installCommandDescriptionCopy(ctx)

    const detached = runtime.list
    expect(detached.call(undefined, undefined)[0]?.description).toBe(COMMAND_DESCRIPTION_COPY['compact'])
  })

  it('stays inert when the commands service is absent', () => {
    const { ctx, labels } = hostContext(undefined)
    expect(() => { applyCommandDescriptionCopy(ctx) }).not.toThrow()
    expect(labels).toEqual(['dsh-plugin-desktop: Chinese slash-command descriptions'])
  })

  it('stays inert when the service exposes no list method', () => {
    const { ctx } = hostContext({ register: () => () => {} })
    expect(installCommandDescriptionCopy(ctx)).toBeInstanceOf(Function)
    expect(() => { applyCommandDescriptionCopy(ctx) }).not.toThrow()
  })
})
