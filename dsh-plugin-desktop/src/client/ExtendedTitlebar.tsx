/** Independent Desktop frame portalled above the upstream content viewport. */

import { createPortal } from 'react-dom'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopClientEnvironment } from './environment.ts'

/** Registration-side environment consumed by the frame band. */
export interface DesktopFrameTitlebarInjected {
  /** Generation environment whose platform and material drive the band's data attributes. */
  readonly environment: Pick<DesktopClientEnvironment, 'platform' | 'material'>
}

export type DesktopFrameTitlebarProps = PropsRuntime<'shell.overlay'>
  & InjectFace<DesktopFrameTitlebarInjected>

/**
 * Horizontal frame surface; the unrelated upstream content starts below it.
 *
 * The band is deliberately empty: it only reserves the platform caption-button
 * corner and provides the window drag region, so the default window reads as the
 * official client. It used to carry the "DSH Desktop" identity block (version
 * and presentation mode) and the launcher action cluster; presentation mode and
 * version/update controls now live in the Desktop settings page, and the
 * launcher actions in the settings header, both registered by
 * `desktop-settings.ts`. `data-platform` and `data-material` stay because the
 * frame stylesheet derives that reserved corner from them.
 */
export function DesktopFrameTitlebar({ environment }: DesktopFrameTitlebarProps) {
  return createPortal((
    <header
      className="dshDesktopFrameTitlebar"
      data-dsh-desktop-frame="titlebar"
      data-platform={environment.platform}
      data-material={environment.material}
    />
  ), document.body)
}
