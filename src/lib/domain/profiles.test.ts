import { describe, expect, it } from 'vitest'
import { terrainRequirementsFor } from './profiles'

describe('terrainRequirementsFor', () => {
  it('intervals demand flat, paved, quiet ground with an uninterrupted stretch of one rep', () => {
    const req = terrainRequirementsFor({
      type: 'intervals',
      reps: 6,
      repMeters: 800,
      recovery: 'jog',
      targetPaceSecondsPerKm: 300,
    })
    expect(req.minUninterruptedMeters).toBe(800)
    expect(req.surface).toBe('paved')
    expect(req.maxAvgGradientPercent).toBeLessThanOrEqual(1)
    expect(req.minQuietness).toBeGreaterThanOrEqual(0.7)
    expect(req.minAvgGradientPercent).toBeNull()
  })

  it('hills are the one session type that demands gradient', () => {
    const req = terrainRequirementsFor({
      type: 'hills',
      reps: 8,
      hillMeters: 300,
      targetPaceSecondsPerKm: 300,
    })
    expect(req.minAvgGradientPercent).not.toBeNull()
    expect(req.minAvgGradientPercent!).toBeGreaterThanOrEqual(4)
    expect(req.minUninterruptedMeters).toBe(300)
  })

  it('tempo requires an uninterrupted stretch of the tempo distance capped at 1.5km', () => {
    const long = terrainRequirementsFor({ type: 'tempo', reps: 1, tempoMeters: 5000, recovery: 'jog', targetPaceSecondsPerKm: 300 })
    expect(long.minUninterruptedMeters).toBe(1500)
    const short = terrainRequirementsFor({
      type: 'tempo',
      reps: 1,
      tempoMeters: 1000,
      recovery: 'jog',
      targetPaceSecondsPerKm: 300,
    })
    expect(short.minUninterruptedMeters).toBe(1000)
    expect(long.surface).toBe('paved')
  })

  it('easy runs are the most permissive profile', () => {
    const easy = terrainRequirementsFor({ type: 'easy', distanceMeters: 8000 })
    const tempo = terrainRequirementsFor({ type: 'tempo', reps: 1, tempoMeters: 5000, recovery: 'jog', targetPaceSecondsPerKm: 300 })
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

describe('decision 18: quality weights are session-tuned and sum to 1', () => {
  const intervals = terrainRequirementsFor({
    type: 'intervals',
    reps: 6,
    repMeters: 800,
    recovery: 'jog',
  })
  const easy = terrainRequirementsFor({ type: 'easy', distanceMeters: 8000 })
  const hills = terrainRequirementsFor({ type: 'hills', reps: 8, hillMeters: 300 })

  it('every profile sums to 1', () => {
    for (const req of [
      easy,
      terrainRequirementsFor({ type: 'long', distanceMeters: 20000 }),
      terrainRequirementsFor({ type: 'tempo', reps: 1, tempoMeters: 3000, recovery: 'jog' }),
      intervals,
      hills,
    ]) {
      const sum = Object.values(req.qualityWeights).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1)
    }
  })

  it('structured work weights flow (crossings/turns) above easy; easy weights non-repetition above structured', () => {
    expect(intervals.qualityWeights.crossingFree).toBeGreaterThan(easy.qualityWeights.crossingFree)
    expect(intervals.qualityWeights.turnSmoothness).toBeGreaterThan(easy.qualityWeights.turnSmoothness)
    expect(easy.qualityWeights.nonRepetition).toBeGreaterThan(intervals.qualityWeights.nonRepetition)
  })

  it('decision 19: hills read a sustained climb, tempo an even one, easy any', () => {
    expect(hills.gradientShape).toBe('sustained')
    expect(terrainRequirementsFor({ type: 'tempo', reps: 1, tempoMeters: 3000, recovery: 'jog' }).gradientShape).toBe('even')
    expect(easy.gradientShape).toBe('any')
  })
})
