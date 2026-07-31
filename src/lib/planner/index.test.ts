import { describe, expect, it } from 'vitest'
import { createDefaultElevationSampler, planRoute } from '.'

/** Pins the pillar's public seam: the routing entry points are exposed. */
describe('planner seam', () => {
  it('re-exports planRoute and createDefaultElevationSampler', () => {
    expect(typeof planRoute).toBe('function')
    expect(typeof createDefaultElevationSampler).toBe('function')
  })
})
