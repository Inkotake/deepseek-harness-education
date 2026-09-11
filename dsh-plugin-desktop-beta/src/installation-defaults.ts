/**
 * Installation-owned first-run defaults for the Teacher DSH 0.1 distribution.
 *
 * Teacher DSH 0.1 ships these as build-time product defaults rather than per-user choices, so a
 * fresh installation:
 *
 * - opens straight into the desktop shell, with first-run Setup already decided instead of the
 *   interactive Desktop Setup Wizard;
 * - uses the automatically created `desktop` Profile instead of a Profile create/select wizard;
 * - exposes no ordinary-browser or LAN web surface (`dsh-desktop.openBrowser` stays `false` and
 *   `dsh-desktop.networkExposure` stays `loopback`, both pinned in the bundled profile seed);
 * - already has the plugin Market enabled.
 *
 * Nothing here removes a capability. The Setup Wizard, the Profile creator, and the Desktop LAN
 * HTTPS edge all stay implemented and reachable: Safe Mode and the recovery assistant keep using
 * them, the tray and the Desktop settings UI can still create or select Profiles, and the
 * settings UI can still turn browser access or the Market back on. Only the decision that a
 * *normal* first run starts from changes. Setting `TEACHER_DSH_SETUP_HANDLING` back to
 * `'interactive'` (or deleting this module and its two call sites in `main.ts`) restores the
 * upstream Desktop behaviour.
 */

import type { DesktopMarketProvider, DesktopMarketSnapshot } from './desktop-market.ts'
import type { DesktopSetupWizardOutcome } from './setup-wizard-state.ts'

/** How a normal, non-Safe-Mode launch resolves its Desktop Setup decision. */
export type TeacherDshSetupHandling =
  /** Record the shipped decision and go straight to the desktop shell. */
  | 'preconfigured'
  /** Show the interactive Desktop Setup Wizard, as the upstream Desktop build does. */
  | 'interactive'

/** Plugin Market a fresh Teacher DSH 0.1 installation ships enabled. */
export const TEACHER_DSH_MARKET_PROVIDER: DesktopMarketProvider = 'dsh-market'

/** Teacher DSH 0.1 ships first-run Setup already decided. */
export const TEACHER_DSH_SETUP_HANDLING: TeacherDshSetupHandling = 'preconfigured'

/** Decision recorded for the shipped Setup defaults; it keeps the shipped preferences as-is. */
export const TEACHER_DSH_SETUP_OUTCOME: DesktopSetupWizardOutcome = 'skipped'

/**
 * Replace only the "no Market choice was ever persisted" state with the shipped provider.
 *
 * A missing, unreadable, or invalid machine-level state document is the only thing the reader
 * reports as `legacyDefaulted: true`. An explicit user choice — including an explicit `disabled`
 * — never sets that flag, so Teacher DSH 0.1 changes what a fresh installation ships without ever
 * overriding a decision somebody already made.
 * @param machineWide - machine-level selection as read from the Desktop user-data directory.
 * @returns the installation default for a fresh installation, or the stored selection unchanged.
 */
export function teacherDshMarketSelection(
  machineWide: DesktopMarketSnapshot,
): DesktopMarketSnapshot {
  if (!machineWide.legacyDefaulted) return machineWide
  return Object.freeze({
    requested: TEACHER_DSH_MARKET_PROVIDER,
    effective: TEACHER_DSH_MARKET_PROVIDER,
    legacyDefaulted: false,
  })
}

/** Whether this installation still requires the interactive Desktop Setup Wizard. */
export function teacherDshSetupWizardRequested(): boolean {
  return TEACHER_DSH_SETUP_HANDLING === 'interactive'
}
