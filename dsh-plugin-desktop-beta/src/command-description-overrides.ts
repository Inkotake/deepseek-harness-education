/**
 * Teacher DSH shows the slash-command panel in Simplified Chinese.
 *
 * The panel's own chrome is already localized by `@deepseek-ai/dsh-client-ui-commands`,
 * but one row's text is not client copy: it is the `description` a Host plugin passed
 * to `ctx.commands.register`. `@deepseek-ai/dsh-commands` requires a non-empty plain
 * string there and carries no locale mechanism, and the client renders it verbatim
 * (`ui-commands` `lib/client.js`, `description: c.description`). A distribution plugin
 * cannot re-register the commands either — one scope owns one entry per name and a
 * second registration throws — so the desktop table wraps the registry instead.
 *
 * Every command list the client renders arrives through the single Remote method
 * `commands/list`. The Typert Gateway resolves that method on the live Service
 * instance at call time (`dsh-api-gateway` `lib/index.js`, `prepareInvocation`:
 * `Reflect.get(receiver, implementation)`), so wrapping the one instance method is
 * enough. One Cordis effect installs and releases the wrapper, and a missing service
 * or a renamed method leaves the upstream English strings exactly as they were.
 */

import type { Context as HostContext } from '@deepseek-ai/cordis'

/**
 * Chinese description per command name, covering every Host command this
 * distribution registers. Names absent here keep the upstream English string.
 */
export const COMMAND_DESCRIPTION_COPY: Readonly<Record<string, string>> = {
  compact: '压缩较早的会话历史',
  export: '将会话日志下载为 ZIP 压缩包',
  feedback: '记录关于本次会话的反馈',
  goal: '设置或查看长任务的目标',
  permission: '切换权限预设（沙箱模式与审批策略）',
  plan: '进入或退出计划模式',
}

/** One command descriptor as `commands/list` returns it. */
export interface CommandDescriptor {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string; readonly images?: boolean }
}

/** The one Host Service method whose result reaches the slash-command panel. */
interface CommandListService {
  list(agent: unknown): readonly CommandDescriptor[]
}

/**
 * Cordis' own escape hatch from the traceable Service proxy to the underlying
 * instance. `dsh-api-gateway` reads the same symbol to attach and find its Remote
 * markers, so the instance reached here is the exact receiver it invokes.
 */
const CORDIS_ORIGINAL = Symbol.for('cordis.original')

/** Narrow an unknown value to a non-null object or function. */
function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/**
 * Localize the descriptions in one `commands/list` result.
 * @param descriptors - the upstream result, trusted only as far as the loop below.
 * @returns the upstream value unchanged when nothing is known, otherwise a new frozen list.
 */
export function localizeCommandDescriptors(descriptors: unknown): unknown {
  if (!Array.isArray(descriptors)) return descriptors
  let changed = false
  const rows = descriptors.map((entry: unknown) => {
    if (!isObjectLike(entry)) return entry
    const name: unknown = Reflect.get(entry, 'name')
    const description = typeof name === 'string' ? COMMAND_DESCRIPTION_COPY[name] : undefined
    if (description === undefined || description === Reflect.get(entry, 'description')) return entry
    changed = true
    return Object.freeze({ ...entry, description })
  })
  return changed ? Object.freeze(rows) : descriptors
}

/**
 * Wrap the command registry's one read method with the desktop copy table.
 *
 * Inert rather than fatal: an absent Service, an absent method, or an upstream
 * rename returns a no-op uninstaller and leaves upstream behaviour untouched.
 * @param ctx - Host context composing the desktop shell.
 * @returns the uninstaller restoring the upstream method.
 */
export function installCommandDescriptionCopy(ctx: HostContext): () => void {
  const service: unknown = ctx.get('commands')
  if (!isObjectLike(service)) return () => {}
  const original: unknown = Reflect.get(service, CORDIS_ORIGINAL)
  const runtime = (isObjectLike(original) ? original : service) as Partial<CommandListService>
  const vendored = runtime.list
  if (typeof vendored !== 'function') return () => {}
  const replacement = function replacement(this: unknown, agent: unknown): readonly CommandDescriptor[] {
    return localizeCommandDescriptors(
      Reflect.apply(vendored, this ?? runtime, [agent]),
    ) as readonly CommandDescriptor[]
  }
  runtime.list = replacement
  return () => {
    if (runtime.list !== replacement) return
    // Restore the captured implementation instead of deleting the property: the
    // vendored method sits on the prototype today, but a runtime that defines its
    // own method must survive this uninstall unchanged.
    runtime.list = vendored
  }
}

/**
 * Install the Chinese command descriptions for the lifetime of the desktop plugin fiber.
 * @param ctx - Host context composing the desktop shell.
 */
export function applyCommandDescriptionCopy(ctx: HostContext): void {
  ctx.effect(
    () => installCommandDescriptionCopy(ctx),
    'dsh-plugin-desktop: Chinese slash-command descriptions',
  )
}
