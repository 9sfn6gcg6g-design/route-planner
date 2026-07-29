import { describe, expect, it } from 'vitest'
import { terrainRequirementsFor } from './profiles'

describe('terrainRequirementsFor', () => {
  it('intervals demand flat, paved, quiet ground with an uninterrupted stretch of one rep', () => {
    const req = terrainRequirementsFor({
      type: 'intervals',
      reps: 6,
      repMeters: 800,
      recovery: 'jog',
    })
    expect(req.minUninterruptedMeters).toBe(800)
    expect(req.surface).toBe('paved')
    expect(req.maxAvgGradientPercent).toBeLessThanOrEqual(1)
    expect(req.minQuietness).toBeGreaterThanOrEqual(0.7)
    expect(req.minAvgGradientPercent).toBeNull()
  })

  it('hills are the one session type that demands gradient', () => {
    const req = terrainRequirementsFor({ type: 'hills', reps: 8, hillMeters: 300 })
    expect(req.minAvgGradientPercent).not.toBeNull()
    expect(req.minAvgGradientPercent!).toBeGreaterThanOrEqual(4)
    expect(req.minUninterruptedMeters).toBe(300)
  })

  it('tempo requires an uninterrupted stretch of the tempo distance capped at 1.5km', () => {
    const long = terrainRequirementsFor({ type: 'tempo', tempoMeters: 5000 })
    expect(long.minUninterruptedMeters).toBe(1500)
    const short = terrainRequirementsFor({ type: 'tempo', tempoMeters: 1000 })
    expect(short.minUninterruptedMeters).toBe(1000)
    expect(long.surface).toBe('paved')
  })

  it('easy runs are the most permissive profile', () => {
    const easy = terrainRequirementsFor({ type: 'easy', distanceMeters: 8000 })
    const tempo = terrainRequirementsFor({ type: 'tempo', tempoMeters: 5000 })
    expect(easy.surface).toBe('any')
    expect(easy.maxJunctionsPerKm).toBeGreaterThan(tempo.maxJunctionsPerKm)
    expect(easy.minQuietness).toBeLessThan(tempo.minQuietness)
  })

  it('long runs allow any surface but prefer more quiet than easy runs', () => {
    const long = terrainRequirementsFor({ type: 'long', distanceMeters: 20000 })
    const easy = terrainRequirementsFor({ type: 'easy', distanceMeters: 8000 })
    expect(long.surface).toBe('any')
    expect(long.minQuietness).toBeGreaterThan(easy.minQuietness)
    expect(long.minUninterruptedMeters).toBeNull()
  })
})
