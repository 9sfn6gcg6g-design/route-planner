import { describe, expect, it } from 'vitest'
import { segmentQuality } from './quality'

/** Pins the pillar's public seam: the 0–1 quality score is exposed (decision 16). */
describe('quality seam', () => {
  it('re-exports segmentQuality, returning a 0–1 score', () => {
    const q = segmentQuality({
      quietness: 1,
      gradientPercent: 0,
      wantsClimb: false,
      crossings: 0,
      lengthMeters: 1000,
      conversationalTargetMeters: null,
    })
    expect(q).toBeGreaterThanOrEqual(0)
    expect(q).toBeLessThanOrEqual(1)
  })
})
