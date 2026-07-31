import { describe, expect, it } from 'vitest'
import { buildGpxDownload, formatQuality, sessionSummary, sessionTargetPace } from '.'

/** Pins the pillar's public seam: formatters + the GPX-download builder are exposed. */
describe('results seam', () => {
  it('re-exports the presentation helpers and GPX builder', () => {
    expect(typeof formatQuality).toBe('function')
    expect(typeof sessionSummary).toBe('function')
    expect(typeof sessionTargetPace).toBe('function')
    expect(typeof buildGpxDownload).toBe('function')
  })
})
