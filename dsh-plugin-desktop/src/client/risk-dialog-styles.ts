/**
 * Keep the expanded Full access warning readable as a list.
 *
 * `RiskConfirmation` renders its `description` prop as `<p>{description}</p>`
 * inside the warning row (`@deepseek-ai/dsh-client-ui-primitives/lib/index.js`)
 * and its stylesheet sets no `white-space` for that paragraph, so the browser
 * collapses every newline into a space. Teacher DSH 0.1 therefore ships one
 * rule of its own: that paragraph preserves its line breaks, which is what
 * turns the warning copy into a bulleted list. The selector anchors on stable
 * structure — a dialog, and a sibling label that owns the acknowledgement
 * checkbox — never on generated class names, so a restructured vendored dialog
 * only stops matching and the copy degrades to one collapsed paragraph. The
 * beta variant does not compose this rule.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'

const STYLE_ID = 'dsh-desktop-risk-confirmation-styles'

/** The warning paragraph of a risk-confirmation dialog that owns the acknowledgement checkbox. */
export const RISK_CONFIRMATION_DESCRIPTION_SELECTOR =
  'div[role="dialog"] div:has(+ label > input[type="checkbox"]) > p'

/** The complete desktop stylesheet for the confirmation dialog. */
export const RISK_CONFIRMATION_STYLES = `${RISK_CONFIRMATION_DESCRIPTION_SELECTOR} { white-space: pre-line; }\n`

/**
 * Install the one-rule stylesheet; tolerate headless Client boot.
 * @returns the uninstaller removing the style element.
 */
export function installRiskConfirmationStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = RISK_CONFIRMATION_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}

/**
 * Install the stylesheet for the lifetime of the desktop plugin fiber.
 * @param ctx - client context owning the effect.
 */
export function applyRiskConfirmationStyles(ctx: ClientContext): void {
  ctx.effect(
    () => installRiskConfirmationStyles(),
    'dsh-plugin-desktop: risk confirmation list styles',
  )
}
