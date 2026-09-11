/**
 * Teacher DSH 0.1 ships an expanded Full access warning in place of the
 * vendored one-liner.
 *
 * A plugin cannot simply re-register a vendored key: `ctx.locale.register`
 * keeps one dictionary per (namespace, locale) pair and throws for a second
 * registration of the same pair (`@deepseek-ai/dsh-client-locale`
 * `lib/client.js`, `LocaleRuntime.register`). Every translation of a vendored
 * namespace — the framework `t` seat included, because every bound translate
 * function re-reads `this.translate` on each call — converges on the locale
 * runtime's single `translate` method, so this module wraps that one method
 * with a desktop-owned lookup table and delegates every other lookup to the
 * vendored implementation. One Cordis effect installs and releases the
 * wrapper, so unloading the desktop plugin restores the vendored strings
 * exactly. The beta variant does not compose these overrides.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'

/** Settings → Permission row: the default preset of sessions created afterwards. */
export const SETTINGS_PERMISSION_NAMESPACE = 'settings.permission'
/** `/permission` popup: the permission preset of the session being viewed. */
export const PERMISSION_ACCESS_NAMESPACE = 'permission.access'
/** The conversation's own permission selector, reached from the composer. */
export const CONVERSATION_NAMESPACE = 'conversation'
/** Locale serving a lookup whose active locale has no desktop-owned copy. */
const COPY_FALLBACK_LOCALE = 'en'

/**
 * The one key each surface renders above its acknowledge checkbox.
 *
 * Three packages gate full access and each owns its own string: the Settings row and the
 * `/permission` popup share `confirm.description` in two namespaces, while the composer's selector
 * keeps `access.confirm.description` under the conversation namespace. Covering only the first two
 * left the composer showing the vendored one-liner, which is how the warning looked unexpanded.
 */
export const FULL_ACCESS_WARNING_TARGETS: Readonly<Record<string, string>> = {
  [SETTINGS_PERMISSION_NAMESPACE]: 'confirm.description',
  [PERMISSION_ACCESS_NAMESPACE]: 'confirm.description',
  [CONVERSATION_NAMESPACE]: 'access.confirm.description',
}

/** Risks that are identical whether the preset applies now or to new sessions. */
const FULL_ACCESS_RISK_ITEMS_ZH = [
  '不再有确认这道防线：删除文件、上传数据、安装软件之前，DSH 不会停下来问你，你只能事后发现。',
  '任意命令执行：DSH 以你的操作系统账户权限直接运行命令，包括你没有预期、也没有细看的命令。',
  '文件与目录改动：可以创建、修改、移动，并永久删除项目目录内外的文件与目录；这类删除通常无法在应用内撤销。',
  '读取敏感数据：可以读取该账户能读到的任何文件，例如 API 密钥、访问令牌、SSH 私钥、浏览器保存的密码、邮件与聊天记录。',
  '学生与个人信息：学生名单、成绩、批改记录、作业原文等材料一旦被读取并发送到外部服务，可能构成隐私或合规问题，且不再受你控制。',
  '提示注入：网页、PDF、课件或代码注释里隐藏的指令，可能被当成你的指令执行，而你在界面上看不到这一步。',
  '网络访问：可以把代码和数据上传到外部服务，其中可能包含你并不打算离开本机的信息。',
  '系统与软件变更：可以安装、降级或卸载软件，修改系统与 Shell 配置，写入注册表或开机启动项。',
  '后台与计划任务：可以创建在本次会话结束后仍在运行的后台进程或计划任务。',
  '不可逆后果：一次误操作或被误解的指令都可能造成无法恢复的结果；应用内的检查点只能恢复部分文件，系统级改动和已经发出的网络请求都无法撤回。',
] as const

/** English counterpart of {@link FULL_ACCESS_RISK_ITEMS_ZH}. */
const FULL_ACCESS_RISK_ITEMS_EN = [
  'No confirmation left as a backstop: DSH will not stop to ask before deleting files, uploading data, or installing software, so you find out afterwards.',
  'Arbitrary command execution: commands run with your own operating-system account privileges, including commands you did not expect and did not read closely.',
  'File and directory changes: files and directories inside and outside the project can be created, modified, moved, and permanently deleted; such deletions usually cannot be undone from the app.',
  'Access to sensitive data: any file that account can read can be read, including API keys, access tokens, SSH private keys, passwords saved in the browser, mail, and chat data.',
  'Student and personal data: class lists, grades, marking records, and submitted work can be read and sent to remote services, which may be a privacy or compliance problem and is then outside your control.',
  'Prompt injection: instructions hidden in a web page, PDF, slide deck, or code comment can be executed as if you had given them, with no visible step in the interface.',
  'Network access: code and data can be uploaded to remote services, including information you did not intend to leave this machine.',
  'System and software changes: software can be installed, downgraded, or removed, and system or shell configuration, the registry, and startup entries can be written.',
  'Background and scheduled work: background processes or scheduled tasks that keep running after this session ends can be created.',
  'Irreversible outcomes: a mistake or a misunderstood instruction can have consequences that cannot be undone; an in-app checkpoint restores only some files, and system-level changes and requests already sent cannot be recalled.',
] as const

const FULL_ACCESS_LEAD_ZH =
  '启用完全权限后，DSH 不再逐步请求确认，而是直接以你的操作系统账户身份执行操作。可能出现的后果包括：'
const FULL_ACCESS_LEAD_EN =
  'With Full access, DSH stops asking for step-by-step confirmation and acts directly as your operating-system account. The consequences can include:'

const FULL_ACCESS_CLOSING_ZH = {
  newSessions: '该设置只对之后新建的会话生效。处理完需要放开的任务后，请把权限改回“工作区内修改”或“仅可查看”。',
  currentSession: '该设置只对当前会话生效。处理完之后，请把权限改回“工作区内修改”或“仅可查看”。',
} as const

const FULL_ACCESS_CLOSING_EN = {
  newSessions: 'This setting applies only to sessions created afterwards. When the job that needed it is done, switch the permission back to “Workspace Write” or “Read Only”.',
  currentSession: 'This applies only to the current session. When you are done, switch the permission back to “Workspace Write” or “Read Only”.',
} as const

/**
 * Compose one warning: lead-in, one bullet per risk, and the scope note.
 * @param lead - first line naming what full access changes.
 * @param items - risk sentences, rendered one bullet each.
 * @param closing - last line naming the scope and how to turn the setting off.
 * @returns the multi-line warning text.
 */
function composeWarning(lead: string, items: readonly string[], closing: string): string {
  return [lead, ...items.map((item) => `• ${item}`), closing].join('\n')
}

/**
 * Desktop-owned `confirm.description` per namespace and locale. The Settings
 * row dialog writes the default for future sessions, while the `/permission`
 * popup switches the session on screen, so the two closing lines differ.
 */
export const FULL_ACCESS_WARNING_COPY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [SETTINGS_PERMISSION_NAMESPACE]: {
    zh: composeWarning(FULL_ACCESS_LEAD_ZH, FULL_ACCESS_RISK_ITEMS_ZH, FULL_ACCESS_CLOSING_ZH.newSessions),
    en: composeWarning(FULL_ACCESS_LEAD_EN, FULL_ACCESS_RISK_ITEMS_EN, FULL_ACCESS_CLOSING_EN.newSessions),
  },
  [PERMISSION_ACCESS_NAMESPACE]: {
    zh: composeWarning(FULL_ACCESS_LEAD_ZH, FULL_ACCESS_RISK_ITEMS_ZH, FULL_ACCESS_CLOSING_ZH.currentSession),
    en: composeWarning(FULL_ACCESS_LEAD_EN, FULL_ACCESS_RISK_ITEMS_EN, FULL_ACCESS_CLOSING_EN.currentSession),
  },
  // The composer's selector switches the session on screen, exactly like the `/permission` popup.
  [CONVERSATION_NAMESPACE]: {
    zh: composeWarning(FULL_ACCESS_LEAD_ZH, FULL_ACCESS_RISK_ITEMS_ZH, FULL_ACCESS_CLOSING_ZH.currentSession),
    en: composeWarning(FULL_ACCESS_LEAD_EN, FULL_ACCESS_RISK_ITEMS_EN, FULL_ACCESS_CLOSING_EN.currentSession),
  },
}

/** Risk sentences, exposed for the copy gate in the client tests. */
export const FULL_ACCESS_RISK_ITEM_COUNT = FULL_ACCESS_RISK_ITEMS_ZH.length

/** The one locale-runtime method every translation call passes through. */
interface TranslateRuntime {
  translate(namespace: string, key: string, params?: Record<string, string>): string
}

/**
 * Wrap the locale runtime's translation lookup with the desktop copy table.
 * @param ctx - client context owning the locale service.
 * @returns the uninstaller restoring the vendored lookup.
 */
export function installFullAccessWarningCopy(ctx: ClientContext): () => void {
  const runtime = ctx.locale as unknown as Partial<TranslateRuntime>
  const vendored = runtime.translate
  if (typeof vendored !== 'function') return () => {}
  const replacement = function replacement(
    this: unknown,
    namespace: string,
    key: string,
    params?: Record<string, string>,
  ): string {
    if (FULL_ACCESS_WARNING_TARGETS[namespace] === key) {
      const forNamespace = FULL_ACCESS_WARNING_COPY[namespace]
      const active = ctx.locale.getSnapshot().active
      const text = forNamespace?.[active] ?? forNamespace?.[COPY_FALLBACK_LOCALE]
      if (text !== undefined) return text
    }
    return Reflect.apply(vendored, this ?? runtime, [namespace, key, params])
  }
  runtime.translate = replacement
  return () => {
    if (runtime.translate !== replacement) return
    // Restore the captured implementation instead of deleting the property:
    // the vendored method sits on the runtime's prototype today, but a runtime
    // that defines its own method must survive this uninstall unchanged.
    runtime.translate = vendored
  }
}

/**
 * Install the expanded warning for the lifetime of the desktop plugin fiber.
 * @param ctx - client context owning the locale service.
 */
export function applyFullAccessWarningCopy(ctx: ClientContext): void {
  ctx.effect(
    () => installFullAccessWarningCopy(ctx),
    'dsh-plugin-desktop: expanded Full access warning copy',
  )
}
