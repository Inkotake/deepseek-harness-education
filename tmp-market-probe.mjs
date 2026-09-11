// Throwaway probe: which shipped Market provider actually composes in this checkout?
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const R = 'C:/Users/inkot/Desktop/kc/teacher-dsh-desktop'
const { prepareDesktopProfile } = await import(pathToFileURL(path.join(R, 'dsh-plugin-desktop/lib/profile.js')).href)

for (const provider of ['disabled', 'community-market', 'dsh-market']) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `probe-${provider}-`))
  fs.writeFileSync(path.join(home, 'settings.yaml'), 'dsh-desktop:\n  mode: compatibility\n')
  fs.writeFileSync(path.join(home, 'cordis.yml'), '[]\n')
  try {
    const prepared = prepareDesktopProfile('1', home, 'win32', 'desktop', undefined, {
      requested: provider,
      effective: provider,
      legacyDefaulted: false,
    })
    console.log(JSON.stringify({
      provider,
      requested: prepared.market.requested,
      effective: prepared.market.effective,
      failure: prepared.marketFailure ?? null,
    }))
  } catch (cause) {
    console.log(JSON.stringify({ provider, error: cause instanceof Error ? cause.message : String(cause) }))
  }
}
