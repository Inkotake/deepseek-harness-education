import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TEACHER_DSH_MARKET_PROVIDER,
  TEACHER_DSH_SETUP_HANDLING,
  TEACHER_DSH_SETUP_OUTCOME,
  teacherDshMarketSelection,
  teacherDshSetupWizardRequested,
} from '../src/installation-defaults.ts'
import { defaultDesktopSetupWizardSettings } from '../src/setup-wizard-settings.ts'
import { DESKTOP_MARKET_IDENTITIES } from '../src/desktop-market.ts'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

describe('Teacher DSH 0.1 installation defaults', () => {
  it('ships first-run Setup already decided and never shows the Wizard', () => {
    expect(TEACHER_DSH_SETUP_HANDLING).toBe('preconfigured')
    expect(TEACHER_DSH_SETUP_OUTCOME).toBe('skipped')
    expect(teacherDshSetupWizardRequested()).toBe(false)
  })

  it('records the shipped Setup decision before the interactive Wizard branch', () => {
    const required = main.indexOf('const setupWizardRequired = safeModePaths === undefined')
    const record = main.indexOf('if (setupWizardRequired && !teacherDshSetupWizardRequested())')
    const outcome = main.indexOf('TEACHER_DSH_SETUP_OUTCOME,', record)
    const wizard = main.indexOf('if (setupWizardRequired && teacherDshSetupWizardRequested())')
    const window = main.indexOf('new DesktopSetupWizardWindow({', wizard)

    expect(required).toBeGreaterThanOrEqual(0)
    expect(record).toBeGreaterThan(required)
    expect(outcome).toBeGreaterThan(record)
    expect(wizard).toBeGreaterThan(outcome)
    expect(window).toBeGreaterThan(wizard)
  })

  it('ships the plugin Market enabled and keeps the shipped no-browser surface', () => {
    expect(TEACHER_DSH_MARKET_PROVIDER).toBe(DESKTOP_MARKET_IDENTITIES.dshMarket.provider)
    const settings = defaultDesktopSetupWizardSettings()
    expect(settings.openBrowser).toBe(false)
    expect(settings.networkExposure).toBe('loopback')
  })

  it('replaces only the never-persisted Market state with the shipped provider', () => {
    const fresh = teacherDshMarketSelection({
      requested: 'disabled',
      effective: 'disabled',
      legacyDefaulted: true,
    })
    expect(fresh).toEqual({
      requested: 'dsh-market',
      effective: 'dsh-market',
      legacyDefaulted: false,
    })
    expect(Object.isFrozen(fresh)).toBe(true)

    const chosen = teacherDshMarketSelection({
      requested: 'community-market',
      effective: 'community-market',
      legacyDefaulted: false,
    })
    expect(chosen.requested).toBe('community-market')

    const declined = teacherDshMarketSelection({
      requested: 'disabled',
      effective: 'disabled',
      legacyDefaulted: false,
    })
    expect(declined.requested).toBe('disabled')
  })

  it('applies the shipped Market default to the first prepared generation and Profile state', () => {
    const lanAddresses = main.indexOf('const lanAddresses = desktopLanAddresses()')
    const marketFallback = main.indexOf('teacherDshMarketSelection(', lanAddresses)
    const readPreferences = main.indexOf(
      'readDesktopProfilePreferences(marketUserDataDir, activeProfileDir)',
      marketFallback,
    )
    const firstGeneration = main.indexOf('? legacyMarketSelection', readPreferences)
    const lazyPreferenceImport = main.indexOf('legacyMarketSelection.requested,', firstGeneration)

    expect(lanAddresses).toBeGreaterThanOrEqual(0)
    expect(marketFallback).toBeGreaterThan(lanAddresses)
    expect(readPreferences).toBeGreaterThan(marketFallback)
    expect(firstGeneration).toBeGreaterThan(readPreferences)
    expect(lazyPreferenceImport).toBeGreaterThan(firstGeneration)
  })
})
