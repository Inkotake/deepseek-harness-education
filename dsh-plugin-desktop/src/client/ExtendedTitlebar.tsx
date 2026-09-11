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

/** Product wordmark shown in the frame band. A brand name, not translatable copy. */
export const DESKTOP_FRAME_TITLE = 'DeepSeek Harness Teacher'

/**
 * Horizontal frame surface; the unrelated upstream content starts below it.
 *
 * The band carries the product wordmark and nothing else. It used to hold the version control,
 * the presentation-mode switcher and the launcher action cluster; those live in Settings now
 * (registered by `desktop-settings.ts`), so the band cannot be mistaken for part of the official
 * client. It stays a drag region, and `data-platform` and `data-material` stay because the frame
 * stylesheet derives the reserved caption-button corner from them.
 */
export function DesktopFrameTitlebar({ environment }: DesktopFrameTitlebarProps) {
  return createPortal((
    <header
      className="dshDesktopFrameTitlebar"
      data-dsh-desktop-frame="titlebar"
      data-platform={environment.platform}
      data-material={environment.material}
    >
      <span className="dshDesktopFrameTitle">{DESKTOP_FRAME_TITLE}</span>
    </header>
  ), document.body)
}
