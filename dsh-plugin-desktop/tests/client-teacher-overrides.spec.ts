import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsOnboardingOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  applyRiskConfirmationStyles,
  installRiskConfirmationStyles,
  RISK_CONFIRMATION_DESCRIPTION_SELECTOR,
  RISK_CONFIRMATION_STYLES,
} from '../src/client/risk-dialog-styles.ts'
import {
  applyFullAccessWarningCopy,
  CONVERSATION_NAMESPACE,
  FULL_ACCESS_RISK_ITEM_COUNT,
  FULL_ACCESS_WARNING_COPY,
  FULL_ACCESS_WARNING_TARGETS,
  PERMISSION_ACCESS_NAMESPACE,
  SETTINGS_PERMISSION_NAMESPACE,
} from '../src/client/teacher-copy-overrides.ts'
import {
  applyWelcomeNoticeSuppression,
  SuppressedWelcomeNotice,
  WELCOME_NOTICE_STEP_ID,
  WELCOME_NOTICE_STEP_ORDER,
  WELCOME_NOTICE_SUPPRESSION_PRIORITY,
} from '../src/client/welcome-notice-suppression.ts'

const NAMESPACES = [
  SETTINGS_PERMISSION_NAMESPACE,
  PERMISSION_ACCESS_NAMESPACE,
  CONVERSATION_NAMESPACE,
] as const

/** The key each namespace's own package renders, which differs for the composer's selector. */
const warningKey = (namespace: string): string => FULL_ACCESS_WARNING_TARGETS[namespace] ?? ''

const REQUIRED_TOPICS_ZH = [
  '操作系统账户权限',
  '永久删除',
  'SSH 私钥',
  '上传到外部服务',
  '卸载软件',
  '注册表',
  '计划任务',
  '无法恢复',
] as const

const REQUIRED_TOPICS_EN = [
  'operating-system account privileges',
  'permanently deleted',
  'SSH private keys',
  'uploaded to remote services',
  'removed',
  'registry',
  'scheduled tasks',
  'cannot be undone',
] as const

describe('Full access warning copy', () => {
  it('replaces confirm.description in both vendored namespaces, in both locales', () => {
    for (const namespace of NAMESPACES) {
      const copy = FULL_ACCESS_WARNING_COPY[namespace]
      expect(copy).toBeDefined()
      expect(Object.keys(copy ?? {}).sort()).toEqual(['en', 'zh'])
    }
  })

  it('enumerates every required risk as its own bullet, in both locales', () => {
    for (const namespace of NAMESPACES) {
      for (const locale of ['zh', 'en'] as const) {
        const text = FULL_ACCESS_WARNING_COPY[namespace]?.[locale] ?? ''
        const lines = text.split('\n')
        expect(lines).toHaveLength(FULL_ACCESS_RISK_ITEM_COUNT + 2)
        const topics = locale === 'zh' ? REQUIRED_TOPICS_ZH : REQUIRED_TOPICS_EN
        for (const topic of topics) expect(text).toContain(topic)
        for (const item of lines.slice(1, -1)) expect(item.startsWith('• ')).toBe(true)
      }
    }
  })

  it('names the persistence scope of the settings row and of the session popup', () => {
    expect(FULL_ACCESS_WARNING_COPY[SETTINGS_PERMISSION_NAMESPACE]?.zh).toContain('只对之后新建的会话生效')
    expect(FULL_ACCESS_WARNING_COPY[SETTINGS_PERMISSION_NAMESPACE]?.en).toContain('only to sessions created afterwards')
    expect(FULL_ACCESS_WARNING_COPY[PERMISSION_ACCESS_NAMESPACE]?.zh).toContain('只对当前会话生效')
    expect(FULL_ACCESS_WARNING_COPY[PERMISSION_ACCESS_NAMESPACE]?.en).toContain('only to the current session')
    for (const namespace of NAMESPACES) {
      expect(FULL_ACCESS_WARNING_COPY[namespace]?.zh).toContain('工作区内修改')
      expect(FULL_ACCESS_WARNING_COPY[namespace]?.en).toContain('Workspace Write')
    }
  })
})

interface WrappedLocale {
  readonly calls: string[]
  translate(namespace: string, key: string, params?: Record<string, string>): string
  getSnapshot(): { active: string; locales: readonly never[]; revision: number }
  active: string
}

function wrappedLocale(): WrappedLocale {
  const runtime: WrappedLocale = {
    active: 'zh',
    calls: [],
    translate(namespace: string, key: string) {
      runtime.calls.push(`${namespace}/${key}`)
      return `vendored:${namespace}/${key}`
    },
    getSnapshot: () => ({ active: runtime.active, locales: [], revision: 0 }),
  }
  return runtime
}

function localeContext(runtime: WrappedLocale): { ctx: ClientContext; labels: string[]; disposers: (() => void)[] } {
  const labels: string[] = []
  const disposers: (() => void)[] = []
  const ctx = {
    locale: runtime,
    effect: (factory: () => (() => void) | void, label: string) => {
      labels.push(label)
      disposers.push(factory() ?? (() => {}))
    },
  } as unknown as ClientContext
  return { ctx, labels, disposers }
}

describe('vendored translation override', () => {
  it('replaces confirm.description per namespace and locale and delegates everything else', () => {
    const runtime = wrappedLocale()
    const { ctx, labels, disposers } = localeContext(runtime)

    applyFullAccessWarningCopy(ctx)
    expect(labels).toEqual(['dsh-plugin-desktop: expanded Full access warning copy'])

    expect(runtime.translate(SETTINGS_PERMISSION_NAMESPACE, warningKey(SETTINGS_PERMISSION_NAMESPACE)))
      .toBe(FULL_ACCESS_WARNING_COPY[SETTINGS_PERMISSION_NAMESPACE]?.zh)
    expect(runtime.translate(PERMISSION_ACCESS_NAMESPACE, warningKey(PERMISSION_ACCESS_NAMESPACE)))
      .toBe(FULL_ACCESS_WARNING_COPY[PERMISSION_ACCESS_NAMESPACE]?.zh)
    // The composer's selector lives in the conversation namespace under a different key; covering
    // only the two permission namespaces is what left it showing the vendored one-liner.
    expect(runtime.translate(CONVERSATION_NAMESPACE, warningKey(CONVERSATION_NAMESPACE)))
      .toBe(FULL_ACCESS_WARNING_COPY[CONVERSATION_NAMESPACE]?.zh)
    runtime.active = 'en'
    expect(runtime.translate(SETTINGS_PERMISSION_NAMESPACE, warningKey(SETTINGS_PERMISSION_NAMESPACE)))
      .toBe(FULL_ACCESS_WARNING_COPY[SETTINGS_PERMISSION_NAMESPACE]?.en)

    expect(runtime.translate(SETTINGS_PERMISSION_NAMESPACE, 'title')).toBe(`vendored:${SETTINGS_PERMISSION_NAMESPACE}/title`)
    expect(runtime.translate('settings.models', warningKey(SETTINGS_PERMISSION_NAMESPACE)))
      .toBe(`vendored:settings.models/${warningKey(SETTINGS_PERMISSION_NAMESPACE)}`)
    expect(runtime.calls).toEqual([
      `${SETTINGS_PERMISSION_NAMESPACE}/title`,
      `settings.models/${warningKey(SETTINGS_PERMISSION_NAMESPACE)}`,
    ])

    for (const dispose of disposers) dispose()
    expect(runtime.translate(SETTINGS_PERMISSION_NAMESPACE, warningKey(SETTINGS_PERMISSION_NAMESPACE)))
      .toBe(`vendored:${SETTINGS_PERMISSION_NAMESPACE}/${warningKey(SETTINGS_PERMISSION_NAMESPACE)}`)
  })

  it('keeps the vendored method as the receiver of every delegated call', () => {
    const runtime = wrappedLocale()
    const { ctx } = localeContext(runtime)
    applyFullAccessWarningCopy(ctx)

    const detached = runtime.translate
    expect(detached.call(undefined, SETTINGS_PERMISSION_NAMESPACE, 'title'))
      .toBe(`vendored:${SETTINGS_PERMISSION_NAMESPACE}/title`)
  })

  it('stays inert when the locale service exposes no translate method', () => {
    const ctx = {
      locale: { getSnapshot: () => ({ active: 'zh', locales: [], revision: 0 }) },
      effect: (factory: () => unknown) => { factory() },
    } as unknown as ClientContext

    expect(() => { applyFullAccessWarningCopy(ctx) }).not.toThrow()
  })
})

describe('welcome notice suppression', () => {
  it('shadows the vendored onboarding cell by priority instead of re-registering it', () => {
    const register = vi.fn(() => () => {})
    const injected: string[] = []
    const ctx = {
      slots: {
        inject: (key: string, factory: () => unknown) => { injected.push(key); factory() },
        register,
      },
    } as unknown as ClientContext

    applyWelcomeNoticeSuppression(ctx)

    expect(injected).toEqual(['settings.onboarding'])
    expect(register).toHaveBeenCalledWith({
      name: 'settings.onboarding',
      id: WELCOME_NOTICE_STEP_ID,
      order: WELCOME_NOTICE_STEP_ORDER,
      priority: WELCOME_NOTICE_SUPPRESSION_PRIORITY,
    }, SuppressedWelcomeNotice)
    expect(WELCOME_NOTICE_SUPPRESSION_PRIORITY).toBeLessThan(0)
  })

  it('paints nothing and leaves completion to the mount effect', () => {
    const complete = vi.fn()
    const props: Pick<SettingsOnboardingOwnerProps, 'complete'> = { complete }

    // The mount effect is what hands the coordinator to the next step; static
    // rendering only proves the step itself paints nothing.
    expect(renderToStaticMarkup(createElement(SuppressedWelcomeNotice, props))).toBe('')
    expect(complete).not.toHaveBeenCalled()
  })
})

describe('risk confirmation list styles', () => {
  it('preserves the warning paragraph line breaks without generated class names', () => {
    let css = ''
    const remove = vi.fn()
    const style = {
      id: '',
      get textContent() { return css },
      set textContent(value: string) { css = value },
      remove,
    }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      createElement: () => style,
      getElementById: () => null,
      head: { appendChild },
    })

    try {
      const dispose = installRiskConfirmationStyles()
      expect(style.id).toBe('dsh-desktop-risk-confirmation-styles')
      expect(css).toBe(RISK_CONFIRMATION_STYLES)
      expect(css).toContain(RISK_CONFIRMATION_DESCRIPTION_SELECTOR)
      expect(css).toContain('white-space: pre-line;')
      expect(RISK_CONFIRMATION_DESCRIPTION_SELECTOR).toBe('div[role="dialog"] div:has(+ label > input[type="checkbox"]) > p')
      expect(RISK_CONFIRMATION_DESCRIPTION_SELECTOR).not.toMatch(/\.[A-Za-z_][A-Za-z0-9_]*_[A-Za-z0-9]/)
      expect(appendChild).toHaveBeenCalledWith(style)
      dispose()
      expect(remove).toHaveBeenCalledOnce()

      const labels: string[] = []
      const ctx = {
        effect: (factory: () => (() => void) | void, label: string) => { labels.push(label); factory() },
      } as unknown as ClientContext
      applyRiskConfirmationStyles(ctx)
      expect(labels).toEqual(['dsh-plugin-desktop: risk confirmation list styles'])
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('tolerates a headless client boot', () => {
    vi.stubGlobal('document', undefined)
    try {
      expect(installRiskConfirmationStyles()).toBeInstanceOf(Function)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
