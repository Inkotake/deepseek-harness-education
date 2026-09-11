/**
 * The framed Desktop chrome.
 *
 * This module used to own a second presentation mode as well, `extended`, which claimed the same
 * layout contract `advanced` owns. With both present one of them was always the wrong answer, so
 * `extended` was removed and only the frame remains. The filename is kept because the two product
 * variants share this tree byte-for-byte and a rename would be churn in both for no behavioural
 * gain.
 *
 * @module dsh-plugin-desktop/src/client/extended-shell
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from './contracts.ts'
import type { DesktopClientEnvironment } from './environment.ts'
import { DesktopFrameTitlebar } from './ExtendedTitlebar.tsx'
import { installExtendedStyles } from './extended-styles.ts'

/**
 * Layer the framed Desktop chrome over the upstream root.
 *
 * The frame does not take the `root` slot, so the official client keeps presenting the content and
 * this only repaints the surrounding chrome. The band renders no controls of its own, so it injects
 * only the generation environment its platform and material attributes are derived from.
 * @param ctx - the client context the effects and slots register against.
 * @param environment - the validated renderer environment for this generation.
 */
export function applyFramedShell(
  ctx: ClientContext,
  environment: DesktopClientEnvironment,
): void {
  if (environment.mode !== 'compatibility') {
    throw new Error(`dsh-plugin-desktop: framed shell received mode ${JSON.stringify(environment.mode)}`)
  }

  ctx.effect(() => {
    const contentViewport = document.getElementById('root')
    if (contentViewport === null) {
      throw new Error('dsh-plugin-desktop: framed shell requires the upstream root')
    }
    document.body.dataset.dshDesktopMode = environment.mode
    document.body.dataset.dshDesktopPlatform = environment.platform
    document.body.dataset.dshDesktopMaterial = environment.material
    contentViewport.dataset.dshDesktopContentViewport = ''
    const removeStyles = installExtendedStyles()
    return () => {
      removeStyles()
      delete contentViewport.dataset.dshDesktopContentViewport
      delete document.body.dataset.dshDesktopMode
      delete document.body.dataset.dshDesktopPlatform
      delete document.body.dataset.dshDesktopMaterial
    }
  }, `desktop: independent ${environment.mode} frame styles`)

  // The band renders no controls of its own, so it injects only the generation
  // environment its platform and material attributes are derived from.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-frame-titlebar',
    order: -1000,
    inject: () => ({ environment }),
  }, DesktopFrameTitlebar))
}
