/**
 * Teacher DSH 0.1 ships without the internal-testing notice.
 *
 * `@deepseek-ai/dsh-client-ui-settings-models` contributes that notice as the
 * `settings.onboarding` list entry `welcome-notice`, whose document title is the
 * `welcomeTitle` dictionary entry ("内测声明" / "Internal Testing Notice").
 * Emptying that string is not a removal: the onboarding coordinator still mounts
 * the step, so its body copy and Continue button stay on screen. The slot ledger
 * shadows a list cell by priority — the lowest live priority renders, and a
 * second registration at the same priority throws (`ui-slots` `SlotCore.register`)
 * — so this module registers the same id at priority -1 with a component that
 * paints nothing and completes itself. The coordinator then transfers ownership
 * to the next step (the API-key onboarding), which stays exactly as vendored.
 * The beta variant does not compose this override.
 */

import { useEffect } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsOnboardingOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Onboarding step id owned by the vendored settings-models plugin. */
export const WELCOME_NOTICE_STEP_ID = 'welcome-notice'
/** Contributor order of that step, kept so the cell holds its ledger position. */
export const WELCOME_NOTICE_STEP_ORDER = -100
/** Shadowing rank below every additive onboarding step (lowest renders). */
export const WELCOME_NOTICE_SUPPRESSION_PRIORITY = -1

/** Owner share of the currently active onboarding step that this step reads. */
export type WelcomeNoticeSuppressionProps = Pick<SettingsOnboardingOwnerProps, 'complete'>

/**
 * Paint nothing and hand the onboarding coordinator to the next step.
 * @param props - coordinator owner share carrying `complete`.
 * @returns null, always: the notice is suppressed rather than re-drawn.
 */
export function SuppressedWelcomeNotice({ complete }: WelcomeNoticeSuppressionProps): null {
  useEffect(() => { complete() }, [complete])
  return null
}

/**
 * Shadow the vendored welcome-notice step for the desktop plugin fiber.
 * @param ctx - client context owning the slot service.
 */
export function applyWelcomeNoticeSuppression(ctx: ClientContext): void {
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: WELCOME_NOTICE_STEP_ID,
    order: WELCOME_NOTICE_STEP_ORDER,
    priority: WELCOME_NOTICE_SUPPRESSION_PRIORITY,
  }, SuppressedWelcomeNotice))
}
